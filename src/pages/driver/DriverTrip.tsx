/**
 * DriverTrip - the driver's screen while a group ride is in progress.
 *
 * Ola/Uber/Rapido style: the work happens in a DIALOG, one employee at a time
 * (who, call, navigate, arrival slider, OTP or vehicle-number no-show). When an
 * employee is done the dialog moves on to the next one by itself, and closes when
 * the phase (pickups, then drops) is finished. The ride card behind it only shows
 * progress and ONE status button, in the place of "Start trip":
 *   Pickups - N left  ->  Drop-offs - N left  ->  Complete trip
 *
 * Login:  pickup each employee at home (arrive -> OTP, or no-show), then drop
 *         everyone at the office.
 * Logout: employees already boarded at the office before Start, so this is the
 *         drop at each home, then the escort return-drop OTP if there is one.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  useRidePax,
  useVerifyPickup,
  useVerifyDrop,
  useVerifyEscortDrop,
  useMarkPaxArrived,
  mapsUrl,
  multiStopMapsUrl,
  type RidePaxRow,
} from "@/lib/queries";
import {
  Navigation,
  Check,
  MapPin,
  CheckCircle2,
  Loader2,
  Phone,
  Route,
  Shield,
  UserCheck,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import PaxNoShow from "./PaxNoShow";
import ArrivedSlider from "./ArrivedSlider";

type PaxPhase = "awaiting_pickup" | "awaiting_drop" | "completed" | "no_show";

// Same rule for both ride types: a logout "boarding" is just a pickup at the office.
function phaseOf(p: RidePaxRow): PaxPhase {
  if (p.noShow) return "no_show";
  if (p.droppedAt) return "completed";
  if (p.pickedAt) return "awaiting_drop";
  return "awaiting_pickup";
}

export interface DriverTripProps {
  rideId: string;
  rideType: string;
  dropAddress?: string;
  dropLat?: number | null;
  dropLng?: number | null;
  /** Called when every drop is verified and the driver taps Complete trip. */
  onComplete: () => void;
  completing?: boolean;
}

export default function DriverTrip({
  rideId,
  rideType,
  dropAddress,
  dropLat,
  dropLng,
  onComplete,
  completing = false,
}: DriverTripProps) {
  const isLogin = rideType !== "logout";
  const { data, isLoading } = useRidePax(rideId);
  const verifyPickup = useVerifyPickup();
  const verifyDrop = useVerifyDrop();
  const verifyEscortDrop = useVerifyEscortDrop();
  const arrive = useMarkPaxArrived();
  const [otp, setOtp] = useState("");
  const [escortOtpInput, setEscortOtpInput] = useState("");
  // Employee the driver tapped in the list; null = follow the planned order.
  const [focusId, setFocusId] = useState<string | null>(null);
  // null = automatic (open for up to 3 employees, collapsed for more).
  const [listOpen, setListOpen] = useState<boolean | null>(null);
  // Which phase the step dialog is open for (null = closed). It closes by itself
  // when that phase has no employees left.
  const [dialogPhase, setDialogPhase] = useState<"pickup" | "drop" | null>(null);
  const autoOpened = useRef(false);

  const pax = data?.pax ?? [];
  const escortRequired = data?.escortRequired ?? false;
  const escortName = data?.escortName ?? null;
  const escortDroppedAt = data?.escortDroppedAt ?? null;
  const total = pax.length;

  const pickupsPending = pax.filter((p) => phaseOf(p) === "awaiting_pickup");
  const dropsPending = pax.filter((p) => phaseOf(p) === "awaiting_drop");
  const allPickupsDone = pickupsPending.length === 0;
  const phase: "pickup" | "drop" = allPickupsDone ? "drop" : "pickup";
  const current = allPickupsDone ? dropsPending[0] : pickupsPending[0];
  const wantedPhase: PaxPhase = allPickupsDone ? "awaiting_drop" : "awaiting_pickup";
  // The employee on screen: the one the driver switched to, else the next in order.
  const focus =
    (focusId && pax.find((p) => p.id === focusId && phaseOf(p) === wantedPhase)) ||
    current ||
    null;
  const focusPhase = focus ? phaseOf(focus) : null;

  const boardedPax = pax.filter((p) => !p.noShow && p.pickedAt);
  // Vacuously true when everyone was a no-show: there is nobody left to drop.
  const allEmployeesDropped = allPickupsDone && boardedPax.every((p) => !!p.droppedAt);
  // Escort return-drop exists on LOGOUT rides only (the escort rides to the
  // office with the employees on login). maybeComplete() enforces the same gate.
  const escortDropNeeded = !isLogin && escortRequired;
  const allDropsDone = allEmployeesDropped && (!escortDropNeeded || !!escortDroppedAt);

  // Start each employee with a clean OTP box.
  useEffect(() => { setOtp(""); }, [focus?.id]);

  // Open the dialog by itself when the trip screen first appears (the driver just
  // pressed Start trip, or reopened the app mid-trip with work still to do).
  useEffect(() => {
    if (isLoading || autoOpened.current) return;
    autoOpened.current = true;
    if (current) setDialogPhase(phase);
  }, [isLoading, current, phase]);

  // Close the dialog when its phase is finished (next phase gets its own button).
  useEffect(() => {
    if (dialogPhase && (dialogPhase !== phase || !current)) setDialogPhase(null);
  }, [dialogPhase, phase, current]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-gold" />
      </div>
    );
  }

  const settledPickups = total - pickupsPending.length;
  const droppedCount = pax.filter((p) => phaseOf(p) === "completed").length;
  const progressText =
    phase === "pickup"
      ? `${isLogin ? "Pickups" : "Boarding"}: ${settledPickups} of ${total} done`
      : `Drops: ${droppedCount} of ${boardedPax.length} done`;
  const progressPct =
    phase === "pickup"
      ? (total ? (settledPickups / total) * 100 : 0)
      : (boardedPax.length ? (droppedCount / boardedPax.length) * 100 : 0);

  // Where "Navigate" should go for the employee in the panel.
  const navUrl = !focus
    ? null
    : focusPhase === "awaiting_drop"
    ? isLogin
      ? dropLat != null && dropLng != null ? mapsUrl(dropLat, dropLng) : null // login drop = the office
      : mapsUrl(focus.lat, focus.lng)                                          // logout drop = their home
    : isLogin
    ? mapsUrl(focus.lat, focus.lng)                                            // login pickup = their home
    : null;                                                                    // logout boarding = already at the office

  const submitOtp = () => {
    if (!focus) return;
    if (otp.length < 4) { toast.error("Enter the 4-digit OTP"); return; }
    const args = { rideId, paxId: focus.id, otp };
    const done = () => { setOtp(""); setFocusId(null); };
    if (focusPhase === "awaiting_drop") {
      verifyDrop.mutate(args, {
        onSuccess: () => { toast.success(`${focus.name} dropped off`); done(); },
        onError: (e: any) => toast.error(e?.message ?? "Wrong OTP"),
      });
    } else {
      verifyPickup.mutate(args, {
        onSuccess: () => { toast.success(isLogin ? `${focus.name} picked up` : `${focus.name} boarded`); done(); },
        onError: (e: any) => toast.error(e?.message ?? "Wrong OTP"),
      });
    }
  };

  const confirmArrival = (p: RidePaxRow) =>
    arrive.mutate(
      { rideId, paxId: p.id },
      {
        onSuccess: () => toast.success(`Arrival confirmed at ${p.name}'s pickup`),
        onError: (e: any) => toast.error(e?.message ?? "Could not confirm arrival"),
      },
    );

  const submitEscortOtp = () => {
    if (escortOtpInput.length < 4) { toast.error("Enter the 4-digit escort OTP"); return; }
    verifyEscortDrop.mutate(
      { rideId, otp: escortOtpInput },
      {
        onSuccess: () => { toast.success("Escort drop verified"); setEscortOtpInput(""); },
        onError: (e: any) => toast.error(e?.message ?? "Wrong OTP"),
      },
    );
  };

  const stepLabel = !focus
    ? ""
    : focusPhase === "awaiting_drop"
    ? isLogin ? "Drop at office" : "Drop at home"
    : isLogin ? `Pickup · stop ${focus.seq + 1} of ${total}` : `Boarding · ${focus.seq + 1} of ${total}`;
  const stepHint = !focus
    ? ""
    : focusPhase === "awaiting_drop"
    ? (isLogin ? dropAddress ?? "" : "Verify the drop OTP when they get off")
    : focus.scheduledPickupTime
    ? `Scheduled pickup ${focus.scheduledPickupTime}`
    : isLogin ? "Go to the employee's pickup point" : "At the office";

  const showList = listOpen ?? false;
  const doneCount = pax.filter((p) => ["completed", "no_show"].includes(phaseOf(p))).length;
  const noShowCount = pax.filter((p) => p.noShow).length;
  const pendingThisPhase = phase === "pickup" ? pickupsPending : dropsPending;
  const stepName = phase === "pickup" ? (isLogin ? "Pickups" : "Boarding") : "Drop-offs";

  // One employee row. In the card it is read-only; in the dialog tapping it
  // switches the step to that employee.
  const renderRow = (p: RidePaxRow, onSelect?: () => void) => {
    const ph = phaseOf(p);
    const done = ph === "completed" || ph === "no_show";
    const selectable = !!onSelect && !done && ph === wantedPhase;
    return (
      <button
        key={p.id}
        type="button"
        disabled={!selectable}
        onClick={onSelect}
        className={`w-full flex items-center gap-2 text-sm px-3 py-2 rounded-md border text-left transition-colors ${
          ph === "no_show" ? "border-destructive/30 bg-destructive/5"
          : ph === "completed" ? "border-success/30 bg-success/5"
          : focus?.id === p.id && onSelect ? "border-gold/50 bg-gold/5"
          : "border-border"
        }`}
      >
        <span className="font-medium flex-1 min-w-0 truncate">{p.seq + 1}. {p.name}</span>
        {isLogin && p.scheduledPickupTime && ph === "awaiting_pickup" && (
          <span className="text-[10px] font-mono text-muted-foreground shrink-0">{p.scheduledPickupTime}</span>
        )}
        {ph === "no_show" ? (
          <span className="text-[10px] text-destructive shrink-0">no-show</span>
        ) : ph === "completed" ? (
          <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
        ) : (
          <>
            <span className="text-[10px] text-gold-dark shrink-0">{ph === "awaiting_drop" ? "On board" : "Waiting"}</span>
            {selectable && <ChevronRight className="h-4 w-4 text-gold-dark shrink-0" />}
          </>
        )}
      </button>
    );
  };

  return (
    <div className="space-y-2.5">
      {/* Progress: one line + bar */}
      {total > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold">{progressText}</span>
            {noShowCount > 0 && <span className="text-destructive">{noShowCount} no-show</span>}
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-gold transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {/* Escort: a single line. Login escorts just ride to the office. */}
      {escortRequired && escortName && (
        <div className="flex items-center gap-2 rounded-md border border-amber-400/60 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
          <Shield className="h-3.5 w-3.5 text-amber-700 shrink-0" />
          <span className="min-w-0 truncate">
            <span className="font-semibold">Escort:</span> {escortName}
            {isLogin ? " · rides to the office with the employees" : ""}
          </span>
        </div>
      )}

      {/* Escort return-drop OTP (logout only): once every employee is dropped */}
      {escortDropNeeded && allEmployeesDropped && !escortDroppedAt && (
        <div className="rounded-lg border border-amber-400/60 bg-amber-50 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-amber-700 shrink-0" />
            <div>
              <div className="text-xs uppercase tracking-wider font-semibold text-amber-700">Drop escort back at office</div>
              <div className="text-sm font-medium text-amber-900 flex items-center gap-1.5 mt-0.5">
                <UserCheck className="h-3.5 w-3.5" /> {escortName}
              </div>
            </div>
          </div>
          <p className="text-[11px] text-amber-700">
            Get the escort OTP from your supervisor by phone once the escort is back at the office.
          </p>
          <div className="flex gap-2">
            <Input
              value={escortOtpInput}
              onChange={(e) => setEscortOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="Escort OTP"
              inputMode="numeric"
              className="tracking-[0.3em] text-center bg-white"
            />
            <Button
              className="bg-amber-600 text-white hover:bg-amber-700 shrink-0"
              disabled={verifyEscortDrop.isPending}
              onClick={submitEscortOtp}
            >
              <Check className="h-4 w-4" /> Verify
            </Button>
          </div>
        </div>
      )}

      {/* Login: where the trip ends, while employees are still being picked up */}
      {isLogin && phase === "pickup" && dropAddress && (
        <div className="flex items-center gap-2 rounded-lg border border-foreground/15 bg-secondary px-3 py-2">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Ends at office</div>
            <div className="truncate text-xs font-medium">{dropAddress}</div>
          </div>
        </div>
      )}

      {/* The ONE status button, in the place of "Start trip" */}
      {allDropsDone ? (
        <Button
          className="w-full bg-foreground text-background hover:bg-foreground/90"
          disabled={completing}
          onClick={onComplete}
        >
          Complete trip
        </Button>
      ) : current ? (
        <Button
          className="w-full bg-gold text-gold-foreground hover:bg-gold/90"
          onClick={() => { setFocusId(null); setDialogPhase(phase); }}
        >
          {stepName} · {pendingThisPhase.length} left
        </Button>
      ) : (
        <>
          <Button className="w-full" disabled>Complete trip</Button>
          {escortDropNeeded && (
            <p className="text-[11px] text-muted-foreground text-center -mt-1">
              Verify the escort's return-drop OTP above to complete the trip.
            </p>
          )}
        </>
      )}

      {/* Read-only roll call (collapsed by default) */}
      {total > 0 && (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setListOpen(!showList)}
            className="w-full flex items-center justify-between text-xs text-muted-foreground py-1"
          >
            <span className="font-medium">Employees ({total})</span>
            <span className="flex items-center gap-1">
              {doneCount} done
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showList ? "rotate-180" : ""}`} />
            </span>
          </button>
          {showList && pax.map((p) => renderRow(p))}
        </div>
      )}

      {/* STEP DIALOG: one employee at a time, moves on by itself */}
      <Dialog open={dialogPhase !== null} onOpenChange={(o) => { if (!o) setDialogPhase(null); }}>
        <DialogContent className="max-w-sm max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">
              {stepName} · {pendingThisPhase.length} left
            </DialogTitle>
          </DialogHeader>

          {focus && (
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] uppercase tracking-wider text-gold-dark font-semibold">{stepLabel}</div>
                  <div className="text-lg font-semibold truncate">{focus.name}</div>
                  {stepHint && <div className="text-xs text-muted-foreground">{stepHint}</div>}
                </div>
                {focus.contactPhone && (
                  <a
                    href={`tel:${focus.contactPhone}`}
                    aria-label={`Call ${focus.contactLabel}`}
                    className="shrink-0 rounded-full border border-gold/50 bg-background p-2.5"
                  >
                    <Phone className="h-4 w-4" />
                  </a>
                )}
              </div>

              {navUrl && (
                <a
                  href={navUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 w-full rounded-md bg-foreground text-background py-2.5 text-sm font-medium"
                >
                  <Navigation className="h-4 w-4" />
                  Navigate
                </a>
              )}

              {focusPhase === "awaiting_pickup" && !focus.arrivedAt ? (
                // Arrival comes first at every pickup. OTP and no-show unlock after it.
                <ArrivedSlider
                  isPending={arrive.isPending}
                  onArrived={() => confirmArrival(focus)}
                  label={`Slide when you reach ${focus.name}`}
                  note={null}
                />
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder={focusPhase === "awaiting_drop" ? "Drop OTP" : isLogin ? "Pickup OTP" : "Boarding OTP"}
                      inputMode="numeric"
                      className="tracking-[0.3em] text-center text-lg"
                    />
                    <Button
                      className="bg-gold text-gold-foreground hover:bg-gold/90 shrink-0"
                      disabled={verifyPickup.isPending || verifyDrop.isPending}
                      onClick={submitOtp}
                    >
                      <Check className="h-4 w-4" /> Verify
                    </Button>
                  </div>
                  {/* Employee did not turn up: timer, then vehicle number. On success
                      the dialog simply moves on to the next employee. */}
                  {focusPhase === "awaiting_pickup" && (
                    <PaxNoShow rideId={rideId} pax={focus} onDone={() => { setOtp(""); setFocusId(null); }} />
                  )}
                </div>
              )}

              {isLogin && phase === "pickup" && pickupsPending.length > 1 && (
                <a
                  href={multiStopMapsUrl(pickupsPending.map((p) => ({ lat: p.lat, lng: p.lng })))}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-1.5 text-[11px] text-gold-dark underline"
                >
                  <Route className="h-3 w-3" /> Navigate full route ({pickupsPending.length} stops)
                </a>
              )}

              {/* Switch to another employee of this phase if the real order differs */}
              {pendingThisPhase.length > 1 && (
                <div className="space-y-1.5 pt-1">
                  <div className="text-[11px] text-muted-foreground">Not in this order? Tap an employee:</div>
                  {pendingThisPhase.map((p) => renderRow(p, () => setFocusId(p.id)))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}