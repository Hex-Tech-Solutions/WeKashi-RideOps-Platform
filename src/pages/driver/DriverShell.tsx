import { useState } from "react";
import { useDriverMe, useDriverRides, useDriverSosIssues, type IssueRow } from "@/lib/queries";
import DriverHome from "./DriverHome";
import DriverScheduled from "./DriverScheduled";
import DriverDocuments from "./DriverDocuments";
import DriverAccount from "./DriverAccount";
import { SosModal } from "@/components/SosModal";
import { DriverChat } from "@/components/DriverChat";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Car, CalendarClock, FileText, User, AlertTriangle } from "lucide-react";

type Tab = "rides" | "scheduled" | "documents" | "account";

const TABS: { key: Tab; label: string; Icon: typeof Car }[] = [
  { key: "rides",     label: "Rides",     Icon: Car },
  { key: "scheduled", label: "Scheduled", Icon: CalendarClock },
  { key: "documents", label: "Documents", Icon: FileText },
  { key: "account",   label: "Account",   Icon: User },
];

export default function DriverShell() {
  const [tab, setTab]       = useState<Tab>("rides");
  const { data: me }        = useDriverMe();
  const { data: ridesData } = useDriverRides();
  const { data: sosData }   = useDriverSosIssues();
  const online = me?.isOnline ?? false;

  // Active ride — needed to attach the SOS to the right ride
  const rides  = ridesData?.rides ?? [];
  const active = rides.find((r) => r.status === "assigned" || r.status === "in_progress");

  // SOS state
  const [sosOpen,  setSosOpen]  = useState(false);
  const [chatIssue, setChatIssue] = useState<IssueRow | null>(null);

  // Latest open SOS for quick-return to chat
  const openSos = (sosData?.issues ?? []).find((i) => i.isSos && i.status === "open");

  const handleSosCreated = (issueId: string) => {
    // Find the newly created SOS in the refetched list and open chat
    const found = (sosData?.issues ?? []).find((i) => i.id === issueId);
    if (found) setChatIssue(found);
    // If not yet in cache, open chat on next render via useEffect — just close SOS modal
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="max-w-md w-full mx-auto flex-1 flex flex-col">

        {/* Top bar */}
        <div className="flex items-center gap-2 px-4 h-14 border-b sticky top-0 bg-background/95 backdrop-blur z-10">
          <div className="h-8 w-8 rounded-lg bg-gold flex items-center justify-center">
            <Car className="h-4 w-4 text-gold-foreground" />
          </div>
          <div className="font-bold">RideOps Driver</div>

          {/* Online status */}
          <span className={`inline-flex items-center gap-1.5 text-xs ${online ? "text-success" : "text-muted-foreground"}`}>
            <span className={`h-2 w-2 rounded-full ${online ? "bg-success animate-pulse" : "bg-muted-foreground/40"}`} />
            {online ? "Online" : "Offline"}
          </span>

          {/* SOS button — only enabled during an active ride */}
          <div className="ml-auto flex items-center gap-2">
            {/* Quick-return to open SOS chat */}
            {openSos && !chatIssue && (
              <button
                type="button"
                onClick={() => setChatIssue(openSos)}
                className="flex items-center gap-1.5 rounded-full border border-destructive/50 bg-destructive/10 px-2.5 py-1 text-xs text-destructive font-semibold animate-pulse"
              >
                <AlertTriangle className="h-3.5 w-3.5" /> SOS active
              </button>
            )}
            <button
              type="button"
              onClick={() => active ? setSosOpen(true) : undefined}
              disabled={!active}
              title={active ? "Send SOS to supervisor" : "SOS only available during an active ride"}
              className={`flex items-center justify-center h-9 w-9 rounded-full shadow-lg transition-transform ${
                active
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:scale-95 cursor-pointer"
                  : "bg-muted text-muted-foreground cursor-not-allowed opacity-40"
              }`}
              aria-label="Send SOS alert"
            >
              <AlertTriangle className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto pb-20">
          {tab === "rides"     && <DriverHome />}
          {tab === "scheduled" && <DriverScheduled />}
          {tab === "documents" && <DriverDocuments />}
          {tab === "account"   && <DriverAccount />}
        </div>

        {/* Bottom nav */}
        <div className="fixed bottom-0 inset-x-0 max-w-md mx-auto border-t bg-background">
          <div className="grid grid-cols-4">
            {TABS.map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex flex-col items-center gap-1 py-2.5 text-xs transition-colors ${
                  tab === key ? "text-gold" : "text-muted-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* SOS modal — issue type selector */}
      <SosModal
        open={sosOpen}
        onOpenChange={setSosOpen}
        activeRideId={active?.id}
        onCreated={(issueId) => {
          setSosOpen(false);
          // Delay slightly to let the query refetch
          setTimeout(() => {
            const found = (sosData?.issues ?? []).find((i) => i.id === issueId);
            if (found) {
              setChatIssue(found);
            } else {
              // Fallback: open chat with a stub so the driver sees the confirmation
              handleSosCreated(issueId);
            }
          }, 600);
        }}
      />

      {/* SOS chat sheet — slides up from the bottom */}
      <Sheet open={!!chatIssue} onOpenChange={(o) => { if (!o) setChatIssue(null); }}>
        <SheetContent
          side="bottom"
          className="h-[80vh] p-0 flex flex-col rounded-t-2xl overflow-hidden"
        >
          <SheetHeader className="px-4 py-3 border-b">
            <SheetTitle className="text-sm flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              SOS — Chat with supervisor
            </SheetTitle>
          </SheetHeader>
          {chatIssue && <DriverChat issue={chatIssue} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
