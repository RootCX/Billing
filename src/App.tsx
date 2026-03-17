import { useState } from "react";
import { AuthGate } from "@rootcx/sdk";
import {
  AppShell, AppShellSidebar, AppShellMain,
  Sidebar, SidebarItem, SidebarSection,
  Toaster,
} from "@rootcx/ui";
import { IconFileInvoice, IconSettings, IconLogout, IconUsers, IconInbox, IconSend } from "@tabler/icons-react";
import { Button } from "@rootcx/ui";
import InvoiceListView from "./views/InvoiceListView";
import InvoiceDetailView from "./views/InvoiceDetailView";
import SellerSettingsView from "./views/SellerSettingsView";
import CustomersView from "./views/CustomersView";
import PeppolTransmissionsView from "./views/PeppolTransmissionsView";
import IncomingInvoicesView from "./views/IncomingInvoicesView";

export type AppView =
  | { type: "list" }
  | { type: "detail"; invoiceId: string }
  | { type: "new" }
  | { type: "settings" }
  | { type: "customers" }
  | { type: "peppol" }
  | { type: "incoming" };

export default function App() {
  const [view, setView] = useState<AppView>({ type: "list" });

  return (
    <AuthGate appTitle="Billing">
      {({ user, logout }) => (
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
                    <span className="truncate text-sm text-muted-foreground">{user.username}</span>
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
                active={view.type === "list" || view.type === "detail" || view.type === "new"}
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
            {view.type === "list" && (
              <InvoiceListView
                onOpenInvoice={(id) => setView({ type: "detail", invoiceId: id })}
                onNewInvoice={() => setView({ type: "new" })}
              />
            )}
            {view.type === "detail" && (
              <InvoiceDetailView
                invoiceId={view.invoiceId}
                onBack={() => setView({ type: "list" })}
              />
            )}
            {view.type === "new" && (
              <InvoiceDetailView
                invoiceId={null}
                onBack={() => setView({ type: "list" })}
              />
            )}
            {view.type === "customers" && <CustomersView />}
            {view.type === "settings" && <SellerSettingsView />}
            {view.type === "incoming" && <IncomingInvoicesView />}
            {view.type === "peppol" && (
              <PeppolTransmissionsView
                onOpenInvoice={(id) => setView({ type: "detail", invoiceId: id })}
              />
            )}
          </AppShellMain>

          <Toaster />
        </AppShell>
      )}
    </AuthGate>
  );
}

