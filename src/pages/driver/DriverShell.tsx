import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDriverMe, useDriverRides, useDriverSosIssues, useDriverOffers, type IssueRow } from "@/lib/queries";
import { useDriverBroadcastSocket, type DriverBroadcastPayload } from "@/lib/driverRideAlerts";
import { IncomingRideOverlay } from "./IncomingRideOverlay";
import DriverHome from "./DriverHome";
import DriverScheduled from "./DriverScheduled";
import DriverDocuments from "./DriverDocuments";
import { DriverAccountPanel } from "./DriverAccountPanel";
import { SosModal } from "@/components/SosModal";
import { OPEN_SCREEN_EVENT, takePendingScreen, type NoticeScreen } from "@/lib/notificationNav";
import { getPendingCapture, hasRestoredPhoto, FACE_CHECK_CAPTURE } from "@/lib/nativeCamera";
import { OnlineFlowProvider, useOnlineFlow } from "./DriverOnlineFlow";
import { DriverChat } from "@/components/DriverChat";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Car, CalendarClock, FileText, User, AlertTriangle } from "lucide-react";

type Tab = "rides" | "scheduled" | "documents";

const TABS: { key: Tab | "account"; label: string; Icon: typeof Car }[] = [
  { key: "rides",     label: "Rides",     Icon: Car },
  { key: "scheduled", label: "Scheduled", Icon: CalendarClock },
  { key: "documents", label: "Documents", Icon: FileText },
  { key: "account",   label: "Account",   Icon: User },
];

export default function DriverShell() {
  return (
    <OnlineFlowProvider>
      <ShellInner />
    </OnlineFlowProvider>
  );
}

function ShellInner() {
  const { openFaceCheck } = useOnlineFlow();
  const [tab, setTab]       = useState<Tab>("rides");
  const [accountOpen, setAccountOpen] = useState(false);
  // Section to show when the Documents tab sends the driver to fill in details.
  const [accountSection, setAccountSection] = useState<"profile" | "vehicle" | "credits" | "trips" | undefined>(undefined);
  // Latest open SOS, for the "reply to your SOS" notification tap.
  const openSosRef = useRef<IssueRow | undefined>(undefined);
  const { data: me }        = useDriverMe();
  const { data: ridesData } = useDriverRides();
  const { data: sosData }   = useDriverSosIssues();
  const { data: offersData } = useDriverOffers();
  const online = me?.isOnline ?? false;
  const availableOffersCount = offersData?.totalCount ?? 0;
  const queryClient = useQueryClient();

  // Rapido-style live broadcast alert: vibration + sound + surface the offer.
  // Only active while the driver is Online. The hook itself refetches offers.
  const handleBroadcast = useCallback((_payload: DriverBroadcastPayload) => {
    setTab("rides");
  }, []);
  useDriverBroadcastSocket(online, handleBroadcast);

  // When the app is opened from an incoming-ride push, native dispatches a
  // `wekashi:openRide` event. Refetch offers so the ride is present, then the
  // IncomingRideOverlay (mounted below) shows it full-screen. Also jump to the
  // Rides tab so dismissing the overlay lands on the broadcasts list.
  useEffect(() => {
    const onOpenRide = () => {
      setTab("rides");
      void queryClient.invalidateQueries({ queryKey: ["driver", "offers"] });
    };
    window.addEventListener("wekashi:openRide", onOpenRide as EventListener);
    return () => window.removeEventListener("wekashi:openRide", onOpenRide as EventListener);
  }, [queryClient]);

  // A tapped push notice opens the screen it is about (Documents tab, Ride
  // Credits, Profile or home). Also picks up a tap that arrived before this
  // screen had mounted (app opened from closed).
  useEffect(() => {
    const open = (screen: NoticeScreen) => {
      if (screen === "documents") { setAccountOpen(false); setTab("documents"); }
      else if (screen === "home") { setAccountOpen(false); setTab("rides"); }
      else if (screen === "scheduled") { setAccountOpen(false); setTab("scheduled"); }
      else if (screen === "facecheck") { setAccountOpen(false); setTab("rides"); openFaceCheck(); }
      else if (screen === "sos") {
        // The driver's open SOS chat, if it is already loaded.
        setAccountOpen(false);
        setTab("rides");
        if (openSosRef.current) setChatIssue(openSosRef.current);
      }
      else { setAccountSection(screen); setAccountOpen(true); } // credits | profile | trips
    };
    const waiting = takePendingScreen();
    if (waiting) open(waiting);
    // App restarted by Android while the camera was open: go back to Documents,
    // where the photo is uploaded once it arrives. (A face-check selfie is
    // picked up by OnlineFlowProvider on the Rides tab.)
    else {
      const isDoc = (p: { docType: string }) => p.docType !== FACE_CHECK_CAPTURE;
      const pending = getPendingCapture();
      if ((pending && isDoc(pending)) || hasRestoredPhoto(isDoc)) open("documents");
    }
    const onEvent = (e: Event) => {
      takePendingScreen();
      open((e as CustomEvent<NoticeScreen>).detail);
    };
    window.addEventListener(OPEN_SCREEN_EVENT, onEvent);
    return () => window.removeEventListener(OPEN_SCREEN_EVENT, onEvent);
  }, [openFaceCheck]);

  // Active ride — needed to attach the SOS to the right ride
  const rides  = ridesData?.rides ?? [];
  const active = rides.find((r) => r.status === "assigned" || r.status === "in_progress");

  // SOS state
  const [sosOpen,  setSosOpen]  = useState(false);
  const [chatIssue, setChatIssue] = useState<IssueRow | null>(null);

  // Latest open SOS for quick-return to chat
  const openSos = (sosData?.issues ?? []).find((i) => i.isSos && i.status === "open");
  openSosRef.current = openSos;

  const handleSosCreated = (issueId: string) => {
    // Find the newly created SOS in the refetched list and open chat
    const found = (sosData?.issues ?? []).find((i) => i.id === issueId);
    if (found) setChatIssue(found);
    // If not yet in cache, open chat on next render via useEffect — just close SOS modal
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Full-screen incoming-ride takeover — shows the real DriverOfferCard
          when a broadcast arrives or the app is opened from a ride push. */}
      <IncomingRideOverlay enabled={online} />

      <div className="max-w-md w-full mx-auto flex-1 flex flex-col">

        {/* Top bar */}
        <div className="flex items-center gap-2 px-4 h-14 border-b sticky top-0 bg-background/95 backdrop-blur z-10">
          <div className="h-8 w-8 rounded-lg bg-gold flex items-center justify-center">
            <Car className="h-4 w-4 text-gold-foreground" />
          </div>
          <div className="font-bold">Wekashi Cabs</div>

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
          {tab === "documents" && (
            <DriverDocuments onOpenAccount={(s) => { setAccountSection(s); setAccountOpen(true); }} />
          )}
        </div>

        {/* Bottom nav */}
        <div className="fixed bottom-0 inset-x-0 max-w-md mx-auto border-t bg-background">
          <div className="grid grid-cols-4">
            {TABS.map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => (key === "account" ? setAccountOpen(true) : setTab(key as Tab))}
                className={`relative flex flex-col items-center gap-1 py-2.5 text-xs transition-colors ${
                  (key === "account" ? accountOpen : tab === key) ? "text-gold" : "text-muted-foreground"
                }`}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" />
                  {key === "rides" && availableOffersCount > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center leading-none">
                      {availableOffersCount > 99 ? "99+" : availableOffersCount}
                    </span>
                  )}
                </span>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Account side panel — Profile / Vehicle / Wallet / Recent trips */}
      <DriverAccountPanel
        open={accountOpen}
        onOpenChange={(o) => { setAccountOpen(o); if (!o) setAccountSection(undefined); }}
        openSection={accountSection}
      />

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
