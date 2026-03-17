import { useState, useEffect } from "react";
import { useAppCollection } from "@rootcx/sdk";
import {
  PageHeader, Button, Input, Label, Separator, toast, LoadingState,
} from "@rootcx/ui";
import { IconDeviceFloppy } from "@tabler/icons-react";
import type { SellerSettings } from "../types";

const APP_ID = "billing";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

export default function SellerSettingsView() {
  const { data, loading, create, update } = useAppCollection<SellerSettings>(APP_ID, "seller_settings");
  const [form, setForm] = useState<Partial<SellerSettings>>({});
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (data && !initialized) {
      setForm(data[0] ?? {});
      setInitialized(true);
    }
  }, [data, initialized]);

  const patch = (p: Partial<SellerSettings>) => setForm((f) => ({ ...f, ...p }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        company_name: form.company_name ?? "",
        vat_number: form.vat_number ?? "",
        street: form.street ?? "",
        city: form.city ?? "",
        postal_code: form.postal_code ?? "",
        country_code: form.country_code ?? "",
        email: form.email ?? "",
        phone: form.phone ?? "",
        iban: form.iban ?? "",
        bic: form.bic ?? "",
        logo_url: form.logo_url ?? "",
        default_currency: form.default_currency ?? "EUR",
        default_vat_rate: form.default_vat_rate ?? 0,
        invoice_prefix: form.invoice_prefix ?? "INV",
      };
      if (data?.[0]?.id) {
        await update(data[0].id, payload);
      } else {
        await create(payload);
      }
      toast.success("Seller settings saved");
    } catch (e: any) {
      toast.error("Failed to save: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState variant="spinner" />;

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <PageHeader
        title="Seller Settings"
        description="Your company information shown on invoices"
        actions={
          <Button onClick={handleSave} disabled={saving}>
            <IconDeviceFloppy className="h-4 w-4 mr-2" />
            {saving ? "Saving…" : "Save Settings"}
          </Button>
        }
      />

      <div className="space-y-8">
        <Section title="Company">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Company Name">
              <Input value={form.company_name ?? ""} onChange={(e) => patch({ company_name: e.target.value })} placeholder="Acme Corp" />
            </Field>
            <Field label="VAT Number">
              <Input value={form.vat_number ?? ""} onChange={(e) => patch({ vat_number: e.target.value })} placeholder="BE0123456789" />
            </Field>
          </div>
          <Field label="Logo URL">
            <Input value={form.logo_url ?? ""} onChange={(e) => patch({ logo_url: e.target.value })} placeholder="https://…" />
          </Field>
        </Section>

        <Separator />

        <Section title="Address">
          <Field label="Street">
            <Input value={form.street ?? ""} onChange={(e) => patch({ street: e.target.value })} placeholder="Street address" />
          </Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Postal Code">
              <Input value={form.postal_code ?? ""} onChange={(e) => patch({ postal_code: e.target.value })} placeholder="1000" />
            </Field>
            <div className="col-span-2">
              <Field label="City">
                <Input value={form.city ?? ""} onChange={(e) => patch({ city: e.target.value })} placeholder="Brussels" />
              </Field>
            </div>
          </div>
          <Field label="Country Code">
            <Input value={form.country_code ?? ""} onChange={(e) => patch({ country_code: e.target.value })} placeholder="BE" maxLength={2} className="max-w-[80px]" />
          </Field>
        </Section>

        <Separator />

        <Section title="Contact">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Email">
              <Input type="email" value={form.email ?? ""} onChange={(e) => patch({ email: e.target.value })} placeholder="billing@company.com" />
            </Field>
            <Field label="Phone">
              <Input value={form.phone ?? ""} onChange={(e) => patch({ phone: e.target.value })} placeholder="+32 …" />
            </Field>
          </div>
        </Section>

        <Separator />

        <Section title="Bank">
          <div className="grid grid-cols-2 gap-4">
            <Field label="IBAN">
              <Input value={form.iban ?? ""} onChange={(e) => patch({ iban: e.target.value })} placeholder="BE68 5390 0754 7034" />
            </Field>
            <Field label="BIC">
              <Input value={form.bic ?? ""} onChange={(e) => patch({ bic: e.target.value })} placeholder="TRIOBEBB" />
            </Field>
          </div>
        </Section>

        <Separator />

        <Section title="Defaults">
          <div className="grid grid-cols-3 gap-4">
            <Field label="Invoice Prefix">
              <Input value={form.invoice_prefix ?? "INV"} onChange={(e) => patch({ invoice_prefix: e.target.value })} placeholder="INV" />
            </Field>
            <Field label="Default Currency">
              <Input value={form.default_currency ?? "EUR"} onChange={(e) => patch({ default_currency: e.target.value })} placeholder="EUR" maxLength={3} />
            </Field>
            <Field label="Default VAT Rate (%)">
              <Input type="number" min={0} max={100} value={form.default_vat_rate ?? 0} onChange={(e) => patch({ default_vat_rate: parseFloat(e.target.value) || 0 })} />
            </Field>
          </div>
        </Section>
      </div>
    </div>
  );
}
