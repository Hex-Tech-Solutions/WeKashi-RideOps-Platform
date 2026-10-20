/**
 * DriverRentalRide — the live rental lifecycle card on the driver's Rides tab,
 * for a rental the driver has accepted. Mirrors the normal ride flow:
 *   assigned     → navigate to pickup + slide to confirm arrival
 *   (arrived)    → enter pickup OTP (given verbally by the supervisor)
 *   in_progress  → live timer + distance; once the package limit is hit an
 *                  overage pop-up must be acknowledged before the drop OTP
 *                  can complete the ride
 *   complete     → enter drop OTP (verbal) to stop billing
 *
 * OTPs are never sent to the driver — they type what the supervisor reads out.
 * GPS breadcrumbs are pushed every few seconds while in progress; the backend
 * turns them into the billed odometer distance.
 */
import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  useRentalArrived, useStartRental, useAgreeRentalOverage, useCompleteRental,
  useLogRentalLocation, useRentalProgress, useReleaseRental, useRentalNoShow,
  mapsUrlForAddress, type RentalRow,
} from "@/lib/queries";
import { getDevicePosition, watchDevicePosition } from "@/lib/deviceLocation";
import {
  CarFront, Phone, MapPin, Navigation, Timer, Gauge, IndianRupee, Check, X, KeyRound, Clock,
} from "lucide-react";
import { toast } from "sonner";

// Live ticking clock H:MM:SS (or MM:SS under an hour).
function fmtClock(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function DriverRentalRide({ rental: r }: { rental: RentalRow }) {
  const arrived = useRentalArrived();
  const start = useStartRental();
  const agree = useAgreeRentalOverage();
  const complete = useCompleteRental();
  const logLoc = useLogRentalLocation();
  const release = useReleaseRental();
  const noShow = useRentalNoShow();

  const inProgress = r.status === "in_progress";
  const { data: progress } = useRentalProgress(r.id, "driver", inProgress);

  // Live ticking elapsed time — the server's elapsedMin only refreshes on the
  // 5s poll, which looks frozen. Tick every second from startedAt so the timer
  // visibly counts up. Falls back to the server value if startedAt is missing.
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (!inProgress) return;
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [inProgress]);
  const liveElapsedMin = r.startedAt
    ? Math.max(0, Math.floor((nowTs - new Date(r.startedAt).getTime()) / 60000))
    : progress?.elapsedMin ?? 0;
  const liveElapsedSec = r.startedAt
    ? Math.max(0, Math.floor((nowTs - new Date(r.startedAt).getTime()) / 1000))
    : 0;

  const [pickupOtp, setPickupOtp] = useState("");
  const [dropOpen, setDropOpen] = useState(false);
  const [dropOtp, setDropOtp] = useState("");
  const [overageOpen, setOverageOpen] = useState(false);

  const hasArrived = !!r.arrivedAt;

  // Push GPS breadcrumbs while the rental is in progress — the odometer source.
  useEffect(() => {
    if (!inProgress) return;
    const stop = watchDevicePosition((c) => logLoc.mutate({ id: r.id, lat: c.lat, lng: c.lng }));
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inProgress, r.id]);

  // When the package limit is reached, pop the overage dialog ONCE as a
  // notification — "you're over the pack, extra km/hr now bill at these rates."
  // It never blocks anything: the driver can dismiss it and still complete the
  // ride with the drop OTP at any time. Use the live clock OR the server's
  // distance flag so the notice fires promptly on either dimension.
  const limitReached = (progress?.limitReached ?? false) || (r.hours > 0 && liveElapsedMin >= r.hours * 60);
  const prompted = useRef(false);
  useEffect(() => {
    if (inProgress && limitReached && !r.overageAgreed && !prompted.current) {
      prompted.current = true;
      setOverageOpen(true);
    }
  }, [inProgress, limitReached, r.overageAgreed]);

  const submitStart = () => {
    if (pickupOtp.trim().length < 4) { toast.error("Enter the 4-digit pickup OTP"); return; }
    start.mutate({ id: r.id, otp: pickupOtp.trim() }, {
      onSuccess: () => { toast.success("Pickup confirmed — timer started"); setPickupOtp(""); },
      onError: (e: any) => toast.error(e?.message ?? "Incorrect OTP"),
    });
  };

  const submitComplete = () => {
    if (dropOtp.trim().length < 4) { toast.error("Enter the 4-digit drop OTP"); return; }
    complete.mutate({ id: r.id, otp: dropOtp.trim() }, {
      onSuccess: (res) => { toast.success(`Rental completed — ₹${res.total}`); setDropOpen(false); setDropOtp(""); },
      onError: (e: any) => toast.error(e?.message ?? "Could not complete"),
    });
  };

  const confirmArrival = async () => {
    arrived.mutate(r.id, {
      onSuccess: () => toast.success("Arrival confirmed — enter the pickup OTP"),
      onError: (e: any) => toast.error(e?.message ?? "Failed"),
    });
  };

  return (
    <Card className="overflow-hidden border-gold/50 bg-gold/5">
      {/* Header */}
      <div className="bg-foreground text-background px-4 py-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-background/50 font-medium">Rental · est. earnings</div>
          <div className="flex items-baseline gap-1 leading-none">
            <span className="text-3xl font-extrabold text-gold tracking-tight">
              ₹{progress?.finalTotal ?? r.basePrice}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge className="bg-gold/20 text-gold border border-gold/40 gap-1 text-[10px]"><CarFront className="h-2.5 w-2.5" /> {r.vehicleType}</Badge>
          <Badge variant="outline" className="text-[10px] border-background/30 text-background capitalize">{r.status.replace("_", " ")}</Badge>
        </div>
      </div>

      <CardContent className="p-3 space-y-2.5">
        {/* Customer */}
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold text-sm">{r.customerName}</div>
          <a href={`tel:${r.customerPhone}`} className="text-xs text-gold-dark flex items-center gap-1">
            <Phone className="h-3 w-3" /> {r.customerPhone}
          </a>
        </div>

        {/* Package */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {r.hours}h · {r.km}km</span>
          <span>₹{r.extraPerKm}/extra km · ₹{r.extraPerHr}/extra hr</span>
        </div>

        {/* Pickup */}
        <a href={mapsUrlForAddress(r.pickupAddress)} target="_blank" rel="noreferrer" className="flex items-start gap-2 text-sm">
          <MapPin className="h-4 w-4 text-gold mt-0.5 shrink-0" />
          <span className="min-w-0 text-muted-foreground">{r.pickupAddress}</span>
        </a>

        {/* ── Stage: assigned (navigate + arrive + pickup OTP) ── */}
        {r.status === "assigned" && (
          <div className="space-y-2.5">
            {!hasArrived && (
              <>
                <a
                  href={mapsUrlForAddress(r.pickupAddress)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 w-full rounded-md bg-foreground text-background py-2.5 text-sm font-medium"
                >
                  <Navigation className="h-4 w-4" /> Navigate to pickup
                </a>
                <ArriveSlider onArrived={confirmArrival} isPending={arrived.isPending} />
              </>
            )}
            {hasArrived && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-success">
                  <Check className="h-3.5 w-3.5" /> Arrived — ask the supervisor for the pickup OTP
                </div>
                <div className="flex gap-2">
                  <Input
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="Pickup OTP"
                    value={pickupOtp}
                    onChange={(e) => setPickupOtp(e.target.value.replace(/\D/g, ""))}
                    className="h-11 text-center font-mono text-lg tracking-[0.3em]"
                  />
                  <Button className="h-11 bg-gold text-gold-foreground hover:bg-gold/90" disabled={start.isPending} onClick={submitStart}>
                    <KeyRound className="h-4 w-4" /> Start
                  </Button>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 text-muted-foreground hover:text-destructive"
                disabled={release.isPending || noShow.isPending}
                onClick={() => release.mutate(r.id, {
                  onSuccess: () => toast("Rental released — credit refunded"),
                  onError: (e: any) => toast.error(e?.message ?? "Failed"),
                })}
              >
                <X className="h-3.5 w-3.5" /> Release
              </Button>
              {/* Customer no-show: only meaningful once the driver has reached
                  pickup. Closes at half fare and notifies the supervisor. */}
              {hasArrived && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 border-amber-500/40 text-amber-600 hover:bg-amber-500/10"
                  disabled={noShow.isPending || release.isPending}
                  onClick={() => noShow.mutate(r.id, {
                    onSuccess: (res) => toast.success(`Marked no-show — you're paid ₹${res.total} (half fare)`),
                    onError: (e: any) => toast.error(e?.message ?? "Failed"),
                  })}
                >
                  Customer no-show
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ── Stage: in_progress (live meters + complete) ── */}
        {inProgress && progress && (
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <Meter Icon={Timer} label="Elapsed" value={fmtClock(liveElapsedSec)} sub={`of ${progress.includedHours}h`} warn={liveElapsedMin >= progress.includedHours * 60} />
              <Meter Icon={Gauge} label="Distance" value={`${progress.distanceKm} km`} sub={`of ${progress.includedKm} km`} warn={progress.distanceKm >= progress.includedKm} />
            </div>

            {progress.overage.overageAmount > 0 && (
              <div className="rounded-md px-3 py-2 text-sm bg-amber-500/10 border border-amber-500/30 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Overage</span>
                <span className="font-semibold flex items-center gap-0.5"><IndianRupee className="h-3.5 w-3.5" />{progress.overage.overageAmount}</span>
              </div>
            )}

            <div className="rounded-md px-3 py-2 bg-muted/50 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Total so far</span>
              <span className="font-bold text-lg flex items-center gap-0.5"><IndianRupee className="h-4 w-4" />{progress.finalTotal}</span>
            </div>

            {/* The drop OTP is ALWAYS available — the passenger ends the ride
                whenever they want, under or over the pack. Overage (if any) is
                billed into the final total. */}
            <Button className="w-full h-11 bg-foreground text-background hover:bg-foreground/90" onClick={() => setDropOpen(true)}>
              <KeyRound className="h-4 w-4" /> Enter drop OTP to complete
            </Button>
          </div>
        )}
      </CardContent>

      {/* Overage notification — informational only. Dismissing it does NOT
          block completion; the drop OTP stays available throughout. */}
      <Dialog open={overageOpen} onOpenChange={setOverageOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-base">Package limit reached</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground leading-relaxed">
            You've reached the {r.hours}h / {r.km}km package. Any extra now bills at{" "}
            <span className="font-medium text-foreground">₹{r.extraPerKm}/km</span> and{" "}
            <span className="font-medium text-foreground">₹{r.extraPerHr}/hr</span> (prorated) and is added to
            your fare. You can end the ride any time with the drop OTP.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverageOpen(false)}>Dismiss</Button>
            <Button
              className="bg-amber-500 text-white hover:bg-amber-600"
              disabled={agree.isPending}
              onClick={() => agree.mutate(r.id, {
                onSuccess: () => { toast("Got it — extra distance/time is added to the fare"); setOverageOpen(false); },
                onError: (e: any) => toast.error(e?.message ?? "Failed"),
              })}
            >
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Drop OTP dialog */}
      <Dialog open={dropOpen} onOpenChange={setDropOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-base">Complete rental</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">Ask the supervisor for the drop OTP to end the ride and stop billing.</p>
          <Input
            inputMode="numeric"
            maxLength={6}
            placeholder="Drop OTP"
            value={dropOtp}
            onChange={(e) => setDropOtp(e.target.value.replace(/\D/g, ""))}
            className="h-12 text-center font-mono text-xl tracking-[0.3em]"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDropOpen(false)}>Cancel</Button>
            <Button className="bg-gold text-gold-foreground hover:bg-gold/90" disabled={complete.isPending} onClick={submitComplete}>
              Complete ride
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Meter({ Icon, label, value, sub, warn }: { Icon: typeof Timer; label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className={`rounded-md px-3 py-2 ${warn ? "bg-amber-500/10 border border-amber-500/30" : "bg-muted/50"}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Icon className="h-3 w-3" /> {label}</div>
      <div className="font-bold text-lg">{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

// Slide-to-confirm arrival — reuses the pattern from the normal ride flow.
function ArriveSlider({ onArrived, isPending }: { onArrived: () => void; isPending: boolean }) {
  const [value, setValue] = useState(0);
  const confirmed = value >= 95;
  return (
    <div className="relative">
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        disabled={isPending || confirmed}
        onChange={(e) => {
          const v = Number(e.target.value);
          setValue(v);
          if (v >= 95) onArrived();
        }}
        onPointerUp={() => { if (!confirmed) setValue(0); }}
        className="w-full accent-gold h-11 cursor-pointer"
      />
      <div className="text-center text-xs text-muted-foreground -mt-1">
        {confirmed ? "Confirming…" : "Slide to confirm arrival at pickup"}
      </div>
    </div>
  );
}
