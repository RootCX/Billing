import { useState, useEffect } from "react";
import { useAppCollection, useIntegration } from "@rootcx/sdk";
import { Button, toast, ConfirmDialog } from "@rootcx/ui";
import {
  IconCircleCheck, IconAlertCircle, IconLoader2,
  IconRefresh, IconPlugConnected, IconWifi,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { cleanVat } from "@/lib/vat";
import type { PeppolRegistration, SellerSettings } from "../types";

const APP_ID = "billing";

interface Props {
  seller: Partial<SellerSettings>;
}

export default function PeppolRegistrationSection({ seller }: Props) {
  const { data: regs, loading: regLoading, create, update } = useAppCollection<PeppolRegistration>(APP_ID, "peppol_registration");
  const { call } = useIntegration("peppol");

  const [busy, setBusy] = useState(false);
  const [pollingHandle, setPollingHandle] = useState<ReturnType<typeof setInterval> | null>(null);
  const [confirmConnect, setConfirmConnect] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const reg = regs?.[0] ?? null;

  useEffect(() => {
    if (reg?.status === "pending" && reg.peppol_id && !pollingHandle) {
      const h = setInterval(() => handleRefreshStatus(reg), 5000);
      setPollingHandle(h);
    }
    if (reg?.status !== "pending" && pollingHandle) {
      clearInterval(pollingHandle);
      setPollingHandle(null);
    }
    return () => { if (pollingHandle) clearInterval(pollingHandle); };
  }, [reg?.status, reg?.peppol_id]);

  const handleRegister = async () => {
    if (!seller.vat_number?.trim()) return toast.error("VAT number required — fill in Seller Settings first");
    if (!seller.company_name?.trim()) return toast.error("Company name required — fill in Seller Settings first");
    setBusy(true);
    try {
      const regResult = await call("register_participant", {
        vatNumber: cleanVat(seller.vat_number),
        companyName: seller.company_name,
        countryCode: seller.country_code ?? "BE",
      }) as { peppolId: string; dokapiUlid: string; status: string };

      const isAlreadyActive = regResult.status === "active" || regResult.status === "ACTIVE";

      const record = await create({
        peppol_id: regResult.peppolId ?? "",
        dokapi_ulid: regResult.dokapiUlid,
        status: isAlreadyActive ? "active" : "pending",
        document_types_registered: false,
        business_card_pushed: false,
        error_message: "",
      });

      const peppolIdToUse = regResult.peppolId;
      if (peppolIdToUse) {
        try {
          await call("register_document_types", { peppolId: peppolIdToUse, countryCode: seller.country_code ?? "BE" });
          await update(record.id, { document_types_registered: true });
        } catch { /* non-blocking */ }

        if (isAlreadyActive) {
          try {
            await call("push_business_card", { peppolId: peppolIdToUse });
            await update(record.id, { business_card_pushed: true });
          } catch { /* non-blocking */ }
        }
      }

      toast.success(isAlreadyActive ? "Connected to Peppol" : "Registration submitted…");
    } catch (e: any) {
      toast.error("Registration failed: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRefreshStatus = async (current: PeppolRegistration) => {
    if (!current?.peppol_id) return;
    try {
      const res = await call("refresh_participant_status", { peppolId: current.peppol_id }) as { status: string; peppolId?: string };
      const isActive = res.status === "active" || res.status === "ACTIVE";
      const isFailed = res.status === "failed" || res.status === "FAILED" || res.status === "error";
      if (isActive) {
        let pushed = current.business_card_pushed;
        if (!pushed) {
          try { await call("push_business_card", { peppolId: res.peppolId ?? current.peppol_id }); pushed = true; } catch { /* non-blocking */ }
        }
        await update(current.id, { status: "active", peppol_id: res.peppolId ?? current.peppol_id, business_card_pushed: pushed });
        toast.success("Peppol active");
      } else if (isFailed) {
        await update(current.id, { status: "failed", error_message: res.status });
      }
    } catch { /* silent */ }
  };


  const handleDeregister = async () => {
    if (!reg?.peppol_id) return;
    setBusy(true);
    try {
      await call("deregister_participant", { peppolId: reg.peppol_id });
      await update(reg.id, { status: "not_registered", peppol_id: "", dokapi_ulid: "" });
      toast.success("Disconnected from Peppol");
    } catch (e: any) {
      toast.error("Failed: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCancelPending = async () => {
    if (!reg) return;
    setBusy(true);
    try {
      if (reg.peppol_id) {
        try { await call("deregister_participant", { peppolId: reg.peppol_id }); } catch { /* best effort */ }
      }
      await update(reg.id, { status: "not_registered", peppol_id: "", dokapi_ulid: "" });
      toast.success("Registration cancelled");
    } catch (e: any) {
      toast.error("Failed: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  if (regLoading) return null;

  const status = reg?.status ?? "not_registered";

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Peppol E-Invoicing
      </p>

      <div className="rounded-lg border bg-card p-4">

        {/* ── NOT REGISTERED ── */}
        {status === "not_registered" && (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                <IconWifi className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">Not connected</p>
                <p className="text-xs text-muted-foreground">Send e-invoices via the Peppol network</p>
              </div>
            </div>
            <Button size="sm" onClick={() => setConfirmConnect(true)} disabled={busy}>
              {busy
                ? <IconLoader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                : <IconPlugConnected className="h-3.5 w-3.5 mr-1.5" />}
              Connect
            </Button>
          </div>
        )}

        {/* ── PENDING ── */}
        {status === "pending" && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                <IconLoader2 className="h-4 w-4 text-muted-foreground animate-spin" />
              </div>
              <div>
                <p className="text-sm font-medium">Connecting…</p>
                <p className="text-xs text-muted-foreground">Waiting for Peppol network confirmation</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => reg && handleRefreshStatus(reg)} disabled={busy}>
                <IconRefresh className="h-3.5 w-3.5 mr-1.5" />
                Check status
              </Button>
              <Button size="sm" variant="ghost" onClick={handleCancelPending} disabled={busy} className="text-muted-foreground">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* ── ACTIVE ── */}
        {status === "active" && (
          <div className="space-y-4">
            {/* Header row */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                  <IconCircleCheck className="h-4 w-4 text-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">Connected</p>
                  {reg?.peppol_id && (
                    <p className="text-xs text-muted-foreground font-mono">{reg.peppol_id}</p>
                  )}
                </div>
              </div>
              <span className="text-[11px] font-medium text-muted-foreground border rounded-full px-2 py-0.5">
                Active
              </span>
            </div>

            {/* Capabilities */}
            <div className="flex gap-4 border-t pt-3">
              <span className={cn(
                "flex items-center gap-1.5 text-xs",
                reg?.document_types_registered ? "text-foreground" : "text-muted-foreground/40",
              )}>
                <IconCircleCheck className="h-3.5 w-3.5" />
                Receive invoices
              </span>
              <span className={cn(
                "flex items-center gap-1.5 text-xs",
                reg?.business_card_pushed ? "text-foreground" : "text-muted-foreground/40",
              )}>
                <IconCircleCheck className="h-3.5 w-3.5" />
                Directory listing
              </span>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end border-t pt-3">
              <button
                onClick={() => setConfirmDisconnect(true)}
                disabled={busy}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
              >
                Disconnect
              </button>
            </div>
          </div>
        )}

        {/* ── FAILED ── */}
        {status === "failed" && (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                <IconAlertCircle className="h-4 w-4 text-destructive" />
              </div>
              <div>
                <p className="text-sm font-medium">Connection failed</p>
                {reg?.error_message && (
                  <p className="text-xs text-muted-foreground">{reg.error_message}</p>
                )}
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setConfirmConnect(true)} disabled={busy}>
              <IconRefresh className="h-3.5 w-3.5 mr-1.5" />
              Retry
            </Button>
          </div>
        )}

      </div>

      <ConfirmDialog
        open={confirmConnect}
        onOpenChange={setConfirmConnect}
        title="Connect to Peppol?"
        description={`This will register ${seller.company_name ?? "your company"} (${seller.vat_number ?? ""}) on the Peppol e-invoicing network. Once active, invoices can be sent electronically to any Peppol participant.`}
        onConfirm={handleRegister}
      />

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect from Peppol?"
        description={`This will remove ${reg?.peppol_id ?? "your participant ID"} from the Peppol network. You will no longer be able to send or receive Peppol e-invoices until you reconnect.`}
        onConfirm={handleDeregister}
      />

    </div>
  );
}
