import { useEffect, useRef, useState } from "react";
import { useAppRecord, useRuntimeClient } from "@rootcx/sdk";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  Button, toast,
} from "@rootcx/ui";
import { IconDownload, IconLoader2, IconX, IconCheck, IconAlertCircle } from "@tabler/icons-react";
import type { InvoiceExport } from "../types";

const APP_ID = "billing";
const POLL_MS = 1500;

interface Props {
  exportId: string | null;
  onClose: () => void;
}

export default function ExportInvoicesDialog({ exportId, onClose }: Props) {
  const { data: exportRec, refetch } = useAppRecord<InvoiceExport>(APP_ID, "invoice_export", exportId);
  const downloadedRef = useRef<string | null>(null);

  const status = exportRec?.status ?? "pending";
  const generated = exportRec?.generated_count ?? 0;
  const total = exportRec?.total_count ?? 0;
  const fileData = exportRec?.file_data ?? "";
  const fileName = exportRec?.file_name || "invoices.zip";
  const fileSize = exportRec?.file_size ?? 0;
  const isDone = status === "completed";
  const isFailed = status === "failed";
  const progress = total > 0 ? Math.min(100, Math.round((generated / total) * 100)) : 0;

  useEffect(() => {
    if (!exportId || isDone || isFailed) return;
    const id = setInterval(refetch, POLL_MS);
    return () => clearInterval(id);
  }, [exportId, isDone, isFailed, refetch]);

  useEffect(() => {
    if (!exportRec || downloadedRef.current === exportRec.id) return;
    if (isDone && fileData) {
      downloadedRef.current = exportRec.id;
      triggerDownload(fileData, fileName);
      toast.success(`Exported ${generated} invoices`);
    } else if (isFailed) {
      downloadedRef.current = exportRec.id;
      toast.error(exportRec.error_message || "Export failed");
    }
  }, [exportRec, isDone, isFailed, fileData, fileName, generated]);

  return (
    <Dialog open={exportId !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export invoices</DialogTitle>
          <DialogDescription>
            {isDone
              ? `Your ZIP with ${generated} invoice${generated !== 1 ? "s" : ""} is ready.`
              : isFailed
              ? "Something went wrong."
              : total > 0
              ? `Generating ${total} PDF${total !== 1 ? "s" : ""} and building the ZIP…`
              : "Preparing export…"}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {isDone ? (
            <div className="flex items-center gap-3 text-emerald-700">
              <IconCheck className="h-5 w-5" />
              <div>
                <p className="font-medium">Download started</p>
                {fileSize > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {(fileSize / 1024 / 1024).toFixed(1)} MB
                  </p>
                )}
              </div>
            </div>
          ) : isFailed ? (
            <div className="flex items-start gap-3 text-destructive">
              <IconAlertCircle className="h-5 w-5 mt-0.5" />
              <p className="text-sm">{exportRec?.error_message || "Unknown error"}</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <IconLoader2 className="h-4 w-4 animate-spin" />
                <span className="tabular-nums">{generated} / {total || "…"}</span>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          {isDone && fileData && (
            <Button variant="outline" onClick={() => triggerDownload(fileData, fileName)}>
              <IconDownload className="h-4 w-4 mr-2" />
              Download again
            </Button>
          )}
          <Button variant={isDone || isFailed ? "default" : "outline"} onClick={onClose}>
            {isDone || isFailed ? "Close" : <><IconX className="h-4 w-4 mr-2" />Hide</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useInvoiceExport() {
  const client = useRuntimeClient();
  const [exportId, setExportId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const start = async (args: { where?: unknown; orderBy?: string; order?: "asc" | "desc" }) => {
    if (starting) return;
    setStarting(true);
    try {
      const res = (await client.rpc(APP_ID, "start_export", args as Record<string, unknown>)) as {
        export_id: string;
      };
      setExportId(res.export_id);
    } catch (e: any) {
      toast.error(e?.message || "Failed to start export");
    } finally {
      setStarting(false);
    }
  };

  return { exportId, starting, start, close: () => setExportId(null) };
}

function triggerDownload(dataUrl: string, fileName: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
