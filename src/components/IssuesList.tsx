import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useIssues, useUpdateIssueStatus, useIssueMessages, useSendIssueMessage,
  useSosRebook, useNearbyDrivers, useAssignRide, useRide,
  type IssueRow,
} from "@/lib/queries";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { Loader2, AlertTriangle, MessageSquare, Send, Navigation, MapPin, UserCheck, RotateCcw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { mapsUrl } from "@/lib/queries";

export function IssuesList({ canResolve = false }: { canResolve?: boolean }) {
  const { data, isLoading } = useIssues();
  const issues = data?.issues ?? [];

  if (isLoading) return <Card className="shadow-card"><CardContent className="py-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></CardContent></Card>;
  if (issues.length === 0) return <Card className="shadow-card"><CardContent className="py-12 text-center text-sm text-muted-foreground">No issues raised. All good. 🎉</CardContent></Card>;

  return (
    <div className="space-y-3">
      {issues.map((i) => <IssueCard key={i.id} issue={i} canResolve={canResolve} />)}
    </div>
  );
}

function IssueCard({ issue: i, canResolve }: { issue: IssueRow; canResolve: boolean }) {
  const { user } = useAuth();
  const update = useUpdateIssueStatus();
  const sosRebook = useSosRebook();
  const assignRide = useAssignRide();
  const [chatOpen, setChatOpen] = useState(false);
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [showNearby, setShowNearby] = useState(false);
  const [nearbyRadius, setNearbyRadius] = useState(10);
  // newRideId is set after a successful sos-rebook — nearby drivers use this ride
  const [newRideId, setNewRideId] = useState<string | null>(null);

  // Fetch new ride details for display after rebook
  const { data: newRideData } = useRide(newRideId ?? undefined);

  // Fetch original ride status to determine if manual assign is safe
  const { data: originalRideData } = useRide(i.rideId ?? undefined);
  const originalRideStatus = originalRideData?.status;

  // "Find nearby driver" should only be enabled when:
  //   a) A rebook has already happened (newRideId set) — target is the new broadcasting ride, OR
  //   b) The original ride is in a state that allows direct assign (not in_progress/assigned)
  const canFindNearby = !!newRideId || (
    !!i.rideId &&
    !["in_progress", "assigned"].includes(originalRideStatus ?? "")
  );
  const findNearbyTooltip = !canFindNearby
    ? "Cancel & rebook first — the ride is currently active"
    : undefined;

  // Nearby drivers: use the new rebooked ride if available, otherwise the original
  const activeRideId = newRideId ?? i.rideId;

  const { data: nearbyData } = useNearbyDrivers(
    showNearby && activeRideId ? activeRideId : null,
    10,
    showNearby && !!activeRideId,
  );

  const isSupervisor = user?.role === "supervisor";

  const fetchDriverLocation = async () => {
    setLocationLoading(true);
    try {
      const res = await api<{ location: { lat: number; lng: number } | null }>(`/issues/${i.id}/driver-location`);
      if (res.location) {
        setDriverLocation(res.location);
      } else {
        toast.error("Driver location not available — GPS may be off");
      }
    } catch {
      toast.error("Could not fetch driver location");
    } finally {
      setLocationLoading(false);
    }
  };

  const handleCancelAndRebook = () => {
    if (!i.rideId && !i.id) { toast.error("No ride linked to this SOS"); return; }
    sosRebook.mutate(i.id, {
      onSuccess: (result) => {
        setNewRideId(result.newRideId);
        // Reset and reopen nearby panel so it fetches against the NEW ride — not cached old results
        setShowNearby(false);
        setTimeout(() => setShowNearby(true), 100);
        toast.success(
          `New ride created for ${result.employeeCount} passenger${result.employeeCount === 1 ? "" : "s"} · ${result.nearbyCount} nearby driver${result.nearbyCount === 1 ? "" : "s"} notified`,
        );
      },
      onError: (e: any) => toast.error(e?.message ?? "Could not rebook ride"),
    });
  };

  return (
    <Card className={`shadow-card ${
      i.isSos && i.status === "open"
        ? "border-destructive/60 bg-destructive/5"
        : i.status === "open"
        ? "border-warning/40"
        : ""
    }`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className={`h-4 w-4 mt-0.5 ${
            i.isSos && i.status === "open" ? "text-destructive"
            : i.status === "open" ? "text-warning"
            : "text-muted-foreground"
          }`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {i.isSos && (
                <span className={`inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                  i.status === "open"
                    ? "border-destructive/50 bg-destructive/10 text-destructive animate-pulse"
                    : "border-muted text-muted-foreground"
                }`}>
                  🆘 SOS
                </span>
              )}
              {i.issueType && (
                <Badge variant="outline" className="text-[10px] py-0 capitalize">
                  {i.issueType.replace("_", " ")}
                </Badge>
              )}
              <span className="font-medium text-sm">Driver: {i.driver?.fullName ?? i.driverId.slice(0, 8)}</span>
              {i.driver?.phone && (
                <a href={`tel:${i.driver.phone}`} className="text-xs text-muted-foreground hover:text-foreground">
                  {i.driver.phone}
                </a>
              )}
              <Badge variant="outline" className={i.status === "resolved" ? "border-success/40 text-success" : "border-warning/40 text-warning"}>
                {i.status}
              </Badge>
            </div>
            <div className="text-sm mt-1">{i.description}</div>
            {i.ride && (
              <div className="text-xs text-muted-foreground mt-1">
                Ride {i.rideId?.slice(0, 8)} · {i.ride.pickupAddress} → {i.ride.dropAddress}
                {i.ride.price != null ? ` · ₹${i.ride.price}` : ""}
              </div>
            )}
            <div className="text-xs text-muted-foreground mt-1">
              {formatDistanceToNow(new Date(i.createdAt), { addSuffix: true })}
              {" · "}vendor {i.vendor?.name ?? "—"}
            </div>

            {/* Driver location — supervisor only, SOS only */}
            {i.isSos && isSupervisor && i.status === "open" && (
              <div className="mt-2 space-y-2">
                {!driverLocation ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 h-7 text-xs"
                    disabled={locationLoading}
                    onClick={fetchDriverLocation}
                  >
                    {locationLoading
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <MapPin className="h-3 w-3" />}
                    Get driver location
                  </Button>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 text-xs bg-destructive/10 border border-destructive/30 rounded px-2 py-1">
                      <MapPin className="h-3 w-3 text-destructive" />
                      <span className="text-destructive font-medium">
                        {driverLocation.lat.toFixed(5)}, {driverLocation.lng.toFixed(5)}
                      </span>
                    </div>
                    <a
                      href={mapsUrl(driverLocation.lat, driverLocation.lng)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"
                    >
                      <Navigation className="h-3 w-3" /> Open in Maps
                    </a>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 h-7 text-xs"
                      disabled={locationLoading}
                      onClick={fetchDriverLocation}
                    >
                      <RotateCcw className="h-3 w-3" /> Refresh
                    </Button>
                  </div>
                )}

                {/* New ride info — shown after successful rebook */}
                {newRideId && newRideData && (
                  <div className="rounded-md border border-success/30 bg-success/5 p-2.5 space-y-1">
                    <div className="text-xs font-semibold text-success flex items-center gap-1.5">
                      ✓ New ride created · {newRideId.slice(0, 8)}
                      <span className={`ml-1 px-1.5 py-0 rounded-full text-[10px] border ${
                        newRideData.status === "broadcasting"
                          ? "border-gold/40 text-gold-dark bg-gold-soft"
                          : newRideData.status === "assigned"
                          ? "border-success/40 text-success bg-success/10"
                          : "border-border text-muted-foreground"
                      }`}>{newRideData.status}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{newRideData.pickupAddress} → {newRideData.dropAddress}</div>
                    <div className="text-xs text-muted-foreground">
                      {newRideData.paxCount} passenger{newRideData.paxCount === 1 ? "" : "s"}
                      {newRideData.distanceKm != null ? ` · ${newRideData.distanceKm} km` : ""}
                      {newRideData.price != null ? ` · ₹${newRideData.price}` : ""}
                    </div>
                  </div>
                )}

                {/* SOS actions */}
                <div className="flex gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 h-7 text-xs border-warning/40 text-warning hover:bg-warning/10"
                    disabled={sosRebook.isPending || (!i.rideId && !i.id)}
                    onClick={handleCancelAndRebook}
                  >
                    {sosRebook.isPending
                      ? <><Loader2 className="h-3 w-3 animate-spin" /> Rebooking…</>
                      : <><RotateCcw className="h-3 w-3" /> {newRideId ? "Rebook again" : "Cancel & rebook"}</>}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 h-7 text-xs"
                    onClick={() => setShowNearby((v) => !v)}
                    disabled={!canFindNearby}
                    title={findNearbyTooltip}
                  >
                    <UserCheck className="h-3 w-3" />
                    {showNearby ? "Hide nearby" : "Find nearby driver"}
                    {!canFindNearby && (
                      <span className="ml-1 text-[9px] text-muted-foreground">(rebook first)</span>
                    )}
                  </Button>
                </div>

                {/* Nearby drivers list — excludes the driver who raised the SOS */}
                {showNearby && nearbyData && (
                  <div className="rounded-md border p-2 space-y-1.5 bg-background">
                    <div className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                      Nearby drivers (10 km)
                      {newRideId && (
                        <span className="text-[10px] text-success font-semibold">· New ride {newRideId.slice(0, 8)}</span>
                      )}
                    </div>
                    {nearbyData.drivers.filter((d) => d.id !== i.driverId).length === 0 ? (
                      <div className="text-xs text-muted-foreground">No other drivers available nearby</div>
                    ) : nearbyData.drivers.filter((d) => d.id !== i.driverId).map((d) => (
                      <div key={d.id} className="flex items-center justify-between gap-2">
                        <div className="text-xs min-w-0">
                          <div className="font-medium">{d.fullName}</div>
                          <div className="text-muted-foreground flex items-center gap-2 flex-wrap">
                            <span>⭐ {d.rating.toFixed(1)} · {d.distanceKm} km</span>
                            {d.phone && (
                              <a href={`tel:${d.phone}`} className="hover:underline">{d.phone}</a>
                            )}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          className="h-6 text-[10px] px-2 bg-gold text-gold-foreground hover:bg-gold/90 shrink-0"
                          disabled={assignRide.isPending || !activeRideId}
                          onClick={() => activeRideId && assignRide.mutate(
                            { rideId: activeRideId, driverId: d.id },
                            {
                              onSuccess: () => toast.success(`${d.fullName} assigned to ${newRideId ? "new" : "original"} ride`),
                              onError: (e: any) => toast.error(e?.message ?? "Failed"),
                            },
                          )}
                        >
                          Assign
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5 shrink-0">
            {canResolve && (
              <Button size="sm" variant="outline" disabled={update.isPending}
                onClick={() => update.mutate(
                  { id: i.id, status: i.status === "open" ? "resolved" : "open" },
                  {
                    onSuccess: () => toast.success(i.status === "open" ? (i.isSos ? "SOS closed" : "Marked resolved") : "Reopened"),
                    onError: (e: any) => toast.error(e?.message ?? "Failed"),
                  },
                )}>
                {i.status === "open" ? (i.isSos ? "Close SOS" : "Resolve") : "Reopen"}
              </Button>
            )}
            <Button
              size="sm"
              variant={chatOpen ? "default" : i.isSos && i.status === "open" ? "destructive" : "outline"}
              onClick={() => setChatOpen((o) => !o)}
            >
              <MessageSquare className="h-3.5 w-3.5" /> Chat
            </Button>
          </div>
        </div>

        {chatOpen && <IssueChat issueId={i.id} />}
      </CardContent>
    </Card>
  );
}

function IssueChat({ issueId }: { issueId: string }) {
  const { user } = useAuth();
  const { data, isLoading } = useIssueMessages(issueId, true);
  const send = useSendIssueMessage();
  const [text, setText] = useState("");
  const messages = data?.messages ?? [];

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    send.mutate({ issueId, body }, { onSuccess: () => setText(""), onError: (e: any) => toast.error(e?.message ?? "Failed to send") });
  };

  return (
    <div className="mt-3 border-t pt-3">
      <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
        {isLoading && <div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
        {!isLoading && messages.length === 0 && <div className="text-xs text-muted-foreground text-center py-3">No messages yet — start the conversation.</div>}
        {messages.map((m) => {
          const mine = m.senderId === user?.id;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-1.5 text-sm ${mine ? "bg-gold text-gold-foreground" : "bg-secondary"}`}>
                {!mine && <div className="text-[10px] font-medium opacity-70 capitalize">{m.senderName} · {m.senderRole}</div>}
                <div>{m.body}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 mt-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message…" onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        <Button size="icon" className="bg-foreground text-background hover:bg-foreground/90 shrink-0" disabled={send.isPending} onClick={submit}><Send className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
