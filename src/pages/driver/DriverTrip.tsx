import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useRidePax,
  useVerifyPickup,
  useVerifyDrop,
  useMarkNoShow,
  useVerifyEscortDrop,
  mapsUrl,
  multiStopMapsUrl,
  type RidePaxRow,
} from "@/lib/queries";
import {
  Navigation,
  Check,
  UserX,
  MapPin,
  CheckCircle2,
  Loader2,
  Phone,
  Route,
  LogIn,
  LogOut,
  Shield,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

type PaxPhase =
  | "awaiting_pickup"
  | "awaiting_board"
  | "awaiting_drop"
  | "completed"
  | "no_show";

function getPaxPhase(p: RidePaxRow): PaxPhase {
  if (p.noShow) return "no_show";
  if (p.droppedAt) return "completed";
  if (p.pickedAt) return "awaiting_drop";
  return "awaiting_pickup";
}

// Logout rides now also have a boarding step: every employee boards together
// at the office and must be individually OTP-verified before the driver can
// depart (mirrors login's per-employee pickup, just at one shared location
// instead of separate home stops).
function getLogoutPhase(p: RidePaxRow): "awaiting_board" | "awaiting_drop" | "completed" | "no_show" {
  if (p.noShow) return "no_show";
  if (p.droppedAt) return "completed";
  if (p.pickedAt) return "awaiting_drop";
  return "awaiting_board";
}



// ─── Props ────────────────────────────────────────────────────────────────────

export interface DriverTripProps {
  rideId: string;
  rideType: string;
  dropAddress?: string;
  dropLat?: number | null;
  dropLng?: number | null;
  onAllDropsDone?: (done: boolean) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DriverTrip({
  rideId,
  rideType,
  dropAddress,
  dropLat,
  dropLng,
  onAllDropsDone,
}: DriverTripProps) {
  const isLogin = rideType !== "logout";
  const { data, isLoading } = useRidePax(rideId);
  const verifyPickup = useVerifyPickup();
  const verifyDrop = useVerifyDrop();
  const noShow = useMarkNoShow();
  const verifyEscortDrop = useVerifyEscortDrop();
  const [otp, setOtp] = useState("");
  const [escortOtpInput, setEscortOtpInput] = useState("");

  const pax = data?.pax ?? [];
  const escortRequired = data?.escortRequired ?? false;
  const escortName     = data?.escortName ?? null;
  const escortDroppedAt = data?.escortDroppedAt ?? null;

  const currentPickup = isLogin
    ? pax.find((p) => getPaxPhase(p) === "awaiting_pickup")
    : pax.find((p) => getLogoutPhase(p) === "awaiting_board");
  const currentDrop = isLogin
    ? pax.find((p) => getPaxPhase(p) === "awaiting_drop")
    : pax.find((p) => getLogoutPhase(p) === "awaiting_drop");

  const allPickupsDone = isLogin
    ? pax.every((p) => getPaxPhase(p) !== "awaiting_pickup")
    : pax.every((p) => getLogoutPhase(p) !== "awaiting_board");

  const current = allPickupsDone ? currentDrop : currentPickup;

  const phase: "pickup" | "drop" = !allPickupsDone ? "pickup" : "drop";

  const boardedPax = pax.filter((p) => !p.noShow && p.pickedAt);
  const allEmployeesDropped =
    boardedPax.length > 0 && boardedPax.every((p) => !!p.droppedAt);
  // Escort rides (logout only) additionally require the escort's own
  // return-drop OTP to be verified before the trip can complete — see
  // maybeComplete() on the backend, which enforces this same gate server-side.
  const escortDropNeeded = !isLogin && escortRequired;
  const allDropsDone =
    allEmployeesDropped && (!escortDropNeeded || !!escortDroppedAt);

  onAllDropsDone?.(allDropsDone);

  const submitEscortOtp = () => {
    if (escortOtpInput.length < 4) { toast.error("Enter the 4-digit escort OTP"); return; }
    verifyEscortDrop.mutate(
      { rideId, otp: escortOtpInput },
      {
        onSuccess: () => { toast.success("Escort drop verified ✓"); setEscortOtpInput(""); },
        onError: (e: any) => toast.error(e?.message ?? "Wrong OTP"),
      },
    );
  };

  const remainingPickups = isLogin
    ? pax.filter((p) => getPaxPhase(p) === "awaiting_pickup")
    : pax.filter((p) => getLogoutPhase(p) === "awaiting_board");
  const remainingDrops = isLogin
    ? pax.filter((p) => getPaxPhase(p) === "awaiting_drop")
    : pax.filter((p) => getLogoutPhase(p) === "awaiting_drop");

  // For logout, all boarding stops are the same office point — navigation to
  // that single location doesn't need a multi-stop link. Once boarding is
  // done, navStops becomes the per-employee home drops as before.
  const navStops = phase === "pickup" && !isLogin ? [] : phase === "pickup" ? remainingPickups : remainingDrops;

  const submitOtp = () => {
    if (!current) return;
    if (otp.length < 4) { toast.error("Enter the 4-digit OTP"); return; }
    const args = { rideId, paxId: current.id, otp };
    const clear = () => setOtp("");
    if (phase === "pickup") {
      verifyPickup.mutate(args, {
        onSuccess: () => { toast.success(isLogin ? `${current.name} picked up ✓` : `${current.name} boarded ✓`); clear(); },
        onError: (e: any) => toast.error(e?.message ?? "Wrong OTP"),
      });
    } else {
      verifyDrop.mutate(args, {
        onSuccess: () => { toast.success(`${current.name} dropped off ✓`); clear(); },
        onError: (e: any) => toast.error(e?.message ?? "Wrong OTP"),
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-gold" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Escort card — shown prominently at the top when escort is assigned */}
      {escortRequired && escortName && (
        <div className="rounded-lg border border-amber-400/60 bg-amber-50 p-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
            <Shield className="h-4 w-4 text-amber-700" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-wider font-semibold text-amber-700">Escort on board</div>
            <div className="font-semibold text-sm text-amber-900 flex items-center gap-1.5 mt-0.5">
              <UserCheck className="h-3.5 w-3.5" /> {escortName}
            </div>
            <div className="text-[10px] text-amber-700 mt-0.5">
              Escort occupies 1 seat. Not counted in passenger OTP flow.
            </div>
          </div>
        </div>
      )}

      {/* Logout boarding banner — all employees board together at the office,
          no navigation needed since the driver is already there. */}
      {!isLogin && !allPickupsDone && (
        <div className="rounded-lg border border-gold/40 bg-gold/5 p-3 flex items-center gap-2">
          <LogIn className="h-4 w-4 text-gold-dark shrink-0" />
          <div className="text-xs text-gold-dark">
            <span className="font-semibold">Boarding at office.</span> Verify each employee's OTP as they get in.
          </div>
        </div>
      )}

      {/* Multi-stop nav */}
      {navStops.length > 1 && (
        <a
          href={multiStopMapsUrl(navStops.map((p) => ({ lat: p.lat, lng: p.lng })))}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-2 w-full rounded-md border border-gold/50 bg-gold/5 text-gold-dark py-2 text-sm font-medium"
        >
          <Route className="h-4 w-4" />
          Navigate full route ({navStops.length} stops)
        </a>
      )}

      {/* Phase chips */}
      {pax.length > 0 && (
        <div className="flex gap-2">
          <PhaseChip
            label={isLogin ? "Pickup phase" : "Boarding phase"}
            Icon={LogIn}
            active={phase === "pickup"}
            done={allPickupsDone}
            count={remainingPickups.length}
          />
          <PhaseChip
            label="Drop phase"
            Icon={LogOut}
            active={phase === "drop"}
            done={allDropsDone}
            count={remainingDrops.length}
          />
        </div>
      )}

      {/* Escort return-drop OTP card — logout escort rides, shown once every
          employee has been dropped but the escort hasn't been verified back
          at the office yet. Blocks trip completion until verified. */}
      {escortDropNeeded && allEmployeesDropped && !escortDroppedAt && (
        <div className="rounded-lg border border-amber-400/60 bg-amber-50 p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-amber-700 shrink-0" />
            <div className="flex-1">
              <div className="text-xs uppercase tracking-wider font-semibold text-amber-700">
                Drop escort back at office
              </div>
              <div className="text-sm font-medium text-amber-900 flex items-center gap-1.5 mt-0.5">
                <UserCheck className="h-3.5 w-3.5" /> {escortName}
              </div>
            </div>
          </div>
          <p className="text-[11px] text-amber-700">
            All employees are dropped. Get the escort OTP from your supervisor by phone once you've
            dropped the escort back at the office.
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

      {/* Status messages */}
      {allDropsDone ? (
        <div className="flex items-center justify-center gap-2 text-sm text-success py-2">
          <CheckCircle2 className="h-4 w-4" />
          All passengers dropped — you can complete the trip.
        </div>
      ) : allPickupsDone && !currentDrop ? (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
          <CheckCircle2 className="h-4 w-4" />
          No passengers boarded.
        </div>
      ) : current ? (
        /* Active stop card */
        <div className="rounded-lg border border-gold/50 bg-gold/5 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wider text-gold-dark font-semibold flex items-center gap-1.5">
              {phase === "pickup" && isLogin ? (
                <><LogIn className="h-3.5 w-3.5" /> Pickup · stop {current.seq + 1}/{pax.length}</>
              ) : phase === "pickup" && !isLogin ? (
                <><LogIn className="h-3.5 w-3.5" /> Boarding · {current.seq + 1}/{pax.length}</>
              ) : (
                <><LogOut className="h-3.5 w-3.5" /> Drop · stop {current.seq + 1}/{pax.length}</>
              )}
            </div>
            <div className="flex items-center gap-2">
              {phase === "pickup" && current.scheduledPickupTime && (
                <span className="text-xs font-mono bg-gold/10 text-gold-dark px-2 py-0.5 rounded border border-gold/20">
                  🕐 {current.scheduledPickupTime}
                </span>
              )}
              <Badge variant="outline" className="border-gold/40 text-gold">
                {current.name}
              </Badge>
            </div>
          </div>

          {/* Logout boarding has no "navigate" link — the driver is already
              at the office. Navigation only applies to login pickups and to
              any drop-off (home for logout, sequential stops for login). */}
          {!(phase === "pickup" && !isLogin) && (
            <a
              href={mapsUrl(current.lat, current.lng)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 w-full rounded-md bg-foreground text-background py-2.5 text-sm font-medium"
            >
              <Navigation className="h-4 w-4" />
              {phase === "pickup" ? "Go to pickup" : "Go to drop-off"} — open maps
            </a>
          )}

          {current.contactPhone && (
            <a
              href={`tel:${current.contactPhone}`}
              className="flex items-center justify-center gap-2 w-full rounded-md border py-2 text-sm"
            >
              <Phone className="h-4 w-4" />
              Call {current.contactLabel} · {current.contactPhone}
            </a>
          )}

          <div className="flex gap-2">
            <Input
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder={phase === "pickup" ? (isLogin ? "Pickup OTP" : "Boarding OTP") : "Drop OTP"}
              inputMode="numeric"
              className="tracking-[0.3em] text-center"
            />
            <Button
              className="bg-gold text-gold-foreground hover:bg-gold/90 shrink-0"
              disabled={verifyPickup.isPending || verifyDrop.isPending}
              onClick={submitOtp}
            >
              <Check className="h-4 w-4" /> Verify
            </Button>
          </div>

          {phase === "pickup" && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-muted-foreground"
              disabled={noShow.isPending}
              onClick={() =>
                noShow.mutate(
                  { rideId, paxId: current.id },
                  {
                    onSuccess: () => toast("Marked no-show"),
                    onError: (e: any) => toast.error(e?.message ?? "Failed"),
                  },
                )
              }
            >
              <UserX className="h-3.5 w-3.5" /> No-show (didn't board)
            </Button>
          )}
        </div>
      ) : null}

      {/* Passenger list */}
      <div className="space-y-1.5">
        {pax.map((p) => {
          const ph = isLogin ? getPaxPhase(p) : (getLogoutPhase(p) as PaxPhase);
          const isCurrent = current?.id === p.id;
          return (
            <div
              key={p.id}
              className={`flex items-center gap-2 text-xs p-2 rounded border ${
                isCurrent ? "border-gold/50 bg-gold/5" : "border-border"
              }`}
            >
              <MapPin
                className={`h-3.5 w-3.5 shrink-0 ${
                  ph === "no_show" ? "text-destructive"
                  : ph === "completed" ? "text-success"
                  : ph === "awaiting_drop" ? "text-gold"
                  : "text-muted-foreground"
                }`}
              />
              <span className="font-medium flex-1 min-w-0 truncate">
                {p.seq + 1}. {p.name}
              </span>
              {/* Scheduled pickup time badge */}
              {isLogin && p.scheduledPickupTime && getPaxPhase(p) === "awaiting_pickup" && (
                <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                  🕐 {p.scheduledPickupTime}
                </span>
              )}

              <div className="flex items-center gap-1 shrink-0">
                <span className={`text-[10px] px-1.5 py-0 rounded border ${
                  p.pickedAt ? "border-success/40 text-success"
                  : p.noShow ? "border-destructive/40 text-destructive"
                  : "border-border text-muted-foreground"
                }`}>
                  {p.pickedAt ? "↑ in" : p.noShow ? "↑ skip" : "↑ wait"}
                </span>
                <span className={`text-[10px] px-1.5 py-0 rounded border ${
                  p.droppedAt ? "border-success/40 text-success"
                  : p.pickedAt ? "border-gold/50 text-gold-dark"
                  : "border-border text-muted-foreground"
                }`}>
                  {p.droppedAt ? "↓ out" : p.pickedAt ? "↓ pend" : "↓ —"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Final destination card */}
      {dropAddress && (
        <div className="rounded-lg border border-foreground/20 bg-secondary p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            <MapPin className="h-3.5 w-3.5" />
            {isLogin ? "Final destination — office" : "Final destination"}
          </div>
          <div className="text-sm font-medium">{dropAddress}</div>
          {dropLat != null && dropLng != null && (
            <a
              href={mapsUrl(dropLat, dropLng)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 w-full rounded-md border border-foreground/20 py-2 text-sm font-medium hover:bg-foreground/5 transition-colors"
            >
              <Navigation className="h-4 w-4" />
              Navigate to destination
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Phase chip ───────────────────────────────────────────────────────────────

function PhaseChip({
  label,
  Icon,
  active,
  done,
  count,
}: {
  label: string;
  Icon: typeof LogIn;
  active: boolean;
  done: boolean;
  count: number;
}) {
  return (
    <div
      className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded border text-xs ${
        done
          ? "border-success/40 bg-success/5 text-success"
          : active
          ? "border-gold/50 bg-gold/5 text-gold-dark"
          : "border-border text-muted-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="font-medium">{label}</span>
      {!done && count > 0 && (
        <span className="ml-auto font-semibold">{count} left</span>
      )}
      {done && <CheckCircle2 className="ml-auto h-3.5 w-3.5" />}
    </div>
  );
}
