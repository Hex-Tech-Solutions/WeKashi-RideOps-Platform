import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useRidePax,
  useVerifyPickup,
  useVerifyDrop,
  useMarkNoShow,
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
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

type PaxPhase =
  | "awaiting_pickup"
  | "awaiting_drop"
  | "completed"
  | "no_show";

function getPaxPhase(p: RidePaxRow): PaxPhase {
  if (p.noShow) return "no_show";
  if (p.droppedAt) return "completed";
  if (p.pickedAt) return "awaiting_drop";
  return "awaiting_pickup";
}

function getLogoutPhase(p: RidePaxRow): "awaiting_drop" | "completed" | "no_show" {
  if (p.noShow) return "no_show";
  if (p.droppedAt) return "completed";
  return "awaiting_drop";
}

const PHASE_LABEL: Record<string, string> = {
  awaiting_pickup: "waiting",
  awaiting_drop: "on board",
  completed: "dropped",
  no_show: "no-show",
};

const PHASE_COLOR: Record<string, string> = {
  awaiting_pickup: "border-border text-muted-foreground",
  awaiting_drop: "border-gold/50 text-gold-dark bg-gold/5",
  completed: "border-success/40 text-success",
  no_show: "border-destructive/40 text-destructive",
};

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
  const [otp, setOtp] = useState("");

  const pax = data?.pax ?? [];

  const currentPickup = isLogin
    ? pax.find((p) => getPaxPhase(p) === "awaiting_pickup")
    : undefined;
  const currentDrop = isLogin
    ? pax.find((p) => getPaxPhase(p) === "awaiting_drop")
    : pax.find((p) => getLogoutPhase(p) === "awaiting_drop");

  const allPickupsDone =
    !isLogin || pax.every((p) => getPaxPhase(p) !== "awaiting_pickup");

  const current = isLogin
    ? allPickupsDone
      ? currentDrop
      : currentPickup
    : currentDrop;

  const phase: "pickup" | "drop" =
    isLogin && !allPickupsDone ? "pickup" : "drop";

  const boardedPax = pax.filter((p) => !p.noShow && (p.pickedAt || !isLogin));
  const allDropsDone =
    boardedPax.length > 0 && boardedPax.every((p) => !!p.droppedAt);

  onAllDropsDone?.(allDropsDone);

  const remainingPickups = isLogin
    ? pax.filter((p) => getPaxPhase(p) === "awaiting_pickup")
    : [];
  const remainingDrops = isLogin
    ? pax.filter((p) => getPaxPhase(p) === "awaiting_drop")
    : pax.filter((p) => getLogoutPhase(p) === "awaiting_drop");

  const navStops = phase === "pickup" ? remainingPickups : remainingDrops;

  const submitOtp = () => {
    if (!current) return;
    if (otp.length < 4) { toast.error("Enter the 4-digit OTP"); return; }
    const args = { rideId, paxId: current.id, otp };
    const clear = () => setOtp("");
    if (phase === "pickup") {
      verifyPickup.mutate(args, {
        onSuccess: () => { toast.success(`${current.name} picked up ✓`); clear(); },
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
      {isLogin && pax.length > 0 && (
        <div className="flex gap-2">
          <PhaseChip
            label="Pickup phase"
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

      {/* Status messages */}
      {allDropsDone ? (
        <div className="flex items-center justify-center gap-2 text-sm text-success py-2">
          <CheckCircle2 className="h-4 w-4" />
          All passengers dropped — you can complete the trip.
        </div>
      ) : allPickupsDone && !currentDrop && isLogin ? (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
          <CheckCircle2 className="h-4 w-4" />
          No passengers boarded.
        </div>
      ) : current ? (
        /* Active stop card */
        <div className="rounded-lg border border-gold/50 bg-gold/5 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wider text-gold-dark font-semibold flex items-center gap-1.5">
              {phase === "pickup" ? (
                <><LogIn className="h-3.5 w-3.5" /> Pickup · stop {current.seq + 1}/{pax.length}</>
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

          <a
            href={mapsUrl(current.lat, current.lng)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 w-full rounded-md bg-foreground text-background py-2.5 text-sm font-medium"
          >
            <Navigation className="h-4 w-4" />
            {phase === "pickup" ? "Go to pickup" : "Go to drop-off"} — open maps
          </a>

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
              placeholder={phase === "pickup" ? "Pickup OTP" : "Drop OTP"}
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

              {isLogin && (
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
              )}

              {!isLogin && (
                <Badge variant="outline" className={`ml-auto text-[10px] py-0 ${PHASE_COLOR[ph]}`}>
                  {PHASE_LABEL[ph]}
                </Badge>
              )}
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
