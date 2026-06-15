import { useState } from "react";
import { AuthGate, useAppCollection, useRuntimeClient } from "@rootcx/sdk";
import {
  AppShell, AppShellSidebar, AppShellMain,
  Sidebar, SidebarItem, SidebarSection,
  Toaster, toast, Button,
} from "@rootcx/ui";
import { IconFileInvoice, IconSettings, IconLogout, IconUsers, IconInbox, IconSend } from "@tabler/icons-react";
import InvoiceListView from "./views/InvoiceListView";
import InvoiceDetailView from "./views/InvoiceDetailView";
import SellerSettingsView from "./views/SellerSettingsView";
import CustomersView from "./views/CustomersView";
import PeppolTransmissionsView from "./views/PeppolTransmissionsView";
import IncomingInvoicesView from "./views/IncomingInvoicesView";
import type { Invoice, SellerSettings } from "./types";
import { todayISO, addDays } from "./types";

const APP_ID = "billing";

type AppView =
  | { type: "list" }
  | { type: "detail"; invoiceId: string }
  | { type: "settings" }
  | { type: "customers" }
  | { type: "peppol" }
  | { type: "incoming" };

function Shell({ user, logout }: { user: any; logout: () => void }) {
  const [view, setView] = useState<AppView>({ type: "list" });
  const { data: sellerSettings } = useAppCollection<SellerSettings>(APP_ID, "seller_settings");
  const { create } = useAppCollection<Invoice>(APP_ID, "invoice");
  const client = useRuntimeClient();

  const handleNewInvoice = async () => {
    try {
      const seller = sellerSettings?.[0];
      const today = todayISO();
      const { invoice_number } = await client.rpc<{ invoice_number: string }>(
        APP_ID, "next_invoice_number", { prefix: seller?.invoice_prefix || "INV" }
      );
      const invoice = await create({
        invoice_number,
        status: "draft",
        invoice_date: today,
        due_date: addDays(today, 30),
        currency: seller?.default_currency || "EUR",
        vat_treatment: "standard",
        client_company: "", client_vat: "", client_street: "",
        client_city: "", client_postal: "", client_country: "BE",
        client_contact_name: "", client_contact_email: "",
        line_items: [], references: [],
        internal_notes: "", terms: "",
        subtotal: 0, total_tax: 0, total: 0,
      });
      setView({ type: "detail", invoiceId: invoice.id });
    } catch (e: any) {
      toast.error("Failed to create invoice: " + e.message);
    }
  };

  return (
    <AppShell>
      <AppShellSidebar>
        <Sidebar
          header={
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
                <IconFileInvoice className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="text-sm font-semibold tracking-tight">Billing</span>
            </div>
          }
          footer={
            <div className="flex flex-col gap-2">
              <SidebarItem
                icon={<IconSettings className="h-4 w-4" />}
                label="Seller Settings"
                active={view.type === "settings"}
                onClick={() => setView({ type: "settings" })}
              />
              <div className="flex items-center justify-between">
                <span className="truncate text-sm text-muted-foreground">{user.email}</span>
                <Button variant="ghost" size="icon" onClick={() => logout()}>
                  <IconLogout className="h-4 w-4" />
                </Button>
              </div>
            </div>
          }
        >
          <SidebarItem
            icon={<IconFileInvoice className="h-4 w-4" />}
            label="Invoices"
            active={view.type === "list" || view.type === "detail"}
            onClick={() => setView({ type: "list" })}
          />
          <SidebarItem
            icon={<IconUsers className="h-4 w-4" />}
            label="Customers"
            active={view.type === "customers"}
            onClick={() => setView({ type: "customers" })}
          />
          <SidebarSection title="Peppol">
            <SidebarItem
              icon={<IconInbox className="h-4 w-4" />}
              label="Incoming Docs"
              active={view.type === "incoming"}
              onClick={() => setView({ type: "incoming" })}
            />
            <SidebarItem
              icon={<IconSend className="h-4 w-4" />}
              label="Outgoing Logs"
              active={view.type === "peppol"}
              onClick={() => setView({ type: "peppol" })}
            />
          </SidebarSection>
        </Sidebar>
      </AppShellSidebar>

      <AppShellMain>
        {view.type === "list"   && <InvoiceListView onOpenInvoice={(id) => setView({ type: "detail", invoiceId: id })} onNewInvoice={handleNewInvoice} />}
        {view.type === "detail" && <InvoiceDetailView invoiceId={view.invoiceId} onBack={() => setView({ type: "list" })} onDeleted={() => setView({ type: "list" })} onOpenInvoice={(id) => setView({ type: "detail", invoiceId: id })} />}
        {view.type === "customers" && <CustomersView />}
        {view.type === "settings"  && <SellerSettingsView />}
        {view.type === "incoming"  && <IncomingInvoicesView />}
        {view.type === "peppol"    && <PeppolTransmissionsView onOpenInvoice={(id) => setView({ type: "detail", invoiceId: id })} />}
      </AppShellMain>

      <Toaster />
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthGate appTitle="Billing">
      {({ user, logout }) => <Shell user={user} logout={logout} />}
    </AuthGate>
  );
}
