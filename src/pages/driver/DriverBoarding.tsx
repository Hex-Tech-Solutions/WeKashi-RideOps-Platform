/**
 * DriverBoarding — office boarding checklist for LOGOUT rides.
 *
 * On a logout ride every employee boards together at the office before the
 * cab departs, so boarding verification has to happen while the ride is still
 * `assigned` (i.e. BEFORE "Start trip"), not after. That's what this component
 * covers: a per-employee OTP checklist the driver works through at the office.
 *
 * Login rides don't use this — their pickups happen one-by-one at each
 * employee's home during the trip, which DriverTrip already handles.
 *
 * The backend gate lives in verifyDrop() (a passenger can't be dropped unless
 * they were boarded first); this component is what makes the driver do it at
 * the right moment rather than discovering it at the first drop-off.
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useRidePax,
  useVerifyPickup,
  useMarkNoShow,
  type RidePaxRow,
} from "@/lib/queries";
import {
  Check,
  UserX,
  Loader2,
  Phone,
  LogIn,
  Shield,
  UserCheck,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

export interface DriverBoardingProps {
  rideId: string;
  /** Reports up whether every employee is boarded (or marked no-show). */
  onAllBoarded?: (done: boolean) => void;
}

export default function DriverBoarding({ rideId, onAllBoarded }: DriverBoardingProps) {
  const { data, isLoading } = useRidePax(rideId);
  const verifyPickup = useVerifyPickup();
  const noShow = useMarkNoShow();
  const [otp, setOtp] = useState("");

  const pax = data?.pax ?? [];
  const escortRequired = data?.escortRequired ?? false;
  const escortName = data?.escortName ?? null;

  const isSettled = (p: RidePaxRow) => !!p.pickedAt || p.noShow;
  const current = pax.find((p) => !isSettled(p));
  const remaining = pax.filter((p) => !isSettled(p));
  const boardedCount = pax.filter((p) => p.pickedAt && !p.noShow).length;

  // Every employee accounted for — boarded or explicitly marked no-show.
  const allBoarded = pax.length > 0 && pax.every(isSettled);
  onAllBoarded?.(allBoarded);

  const submitOtp = () => {
    if (!current) return;
    if (otp.length < 4) { toast.error("Enter the 4-digit boarding OTP"); return; }
    verifyPickup.mutate(
      { rideId, paxId: current.id, otp },
      {
        onSuccess: () => { toast.success(`${current.name} boarded ✓`); setOtp(""); },
        onError: (e: any) => toast.error(e?.message ?? "Wrong OTP"),
      },
    );
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-gold" />
      </div>
    );
  }

  if (pax.length === 0) {
    return <div className="text-xs text-muted-foreground py-2 text-center">No passengers on this ride.</div>;
  }

  return (
    <div className="space-y-3">
      {/* Escort note — the escort boards here too, but has no boarding OTP.
          The supervisor vouched for them by name at booking time. */}
      {escortRequired && escortName && (
        <div className="rounded-lg border border-amber-400/60 bg-amber-50 p-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
            <Shield className="h-4 w-4 text-amber-700" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-wider font-semibold text-amber-700">Escort boards here</div>
            <div className="font-semibold text-sm text-amber-900 flex items-center gap-1.5 mt-0.5">
              <UserCheck className="h-3.5 w-3.5" /> {escortName}
            </div>
            <div className="text-[10px] text-amber-700 mt-0.5">
              No boarding OTP for the escort. You'll need an OTP from your supervisor when you drop
              them back at the office at the end.
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-gold/40 bg-gold/5 p-3 flex items-center gap-2">
        <LogIn className="h-4 w-4 text-gold-dark shrink-0" />
        <div className="text-xs text-gold-dark">
          <span className="font-semibold">Boarding at office.</span> Verify each employee's OTP as they
          get in — you can't start the trip until everyone is accounted for.
        </div>
      </div>

      {/* Progress */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5">
        <span>{boardedCount} of {pax.length} boarded</span>
        {remaining.length > 0 && <span>{remaining.length} left</span>}
      </div>

      {/* Active employee OTP entry */}
      {current ? (
        <div className="rounded-lg border border-gold/50 bg-gold/5 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wider text-gold-dark font-semibold">
              Boarding · {boardedCount + 1}/{pax.length}
            </div>
            <Badge variant="outline" className="border-gold/40 text-gold">
              {current.name}
            </Badge>
          </div>

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
              placeholder="Boarding OTP"
              inputMode="numeric"
              className="tracking-[0.3em] text-center"
            />
            <Button
              className="bg-gold text-gold-foreground hover:bg-gold/90 shrink-0"
              disabled={verifyPickup.isPending}
              onClick={submitOtp}
            >
              <Check className="h-4 w-4" /> Verify
            </Button>
          </div>

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
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2 text-sm text-success py-2">
          <CheckCircle2 className="h-4 w-4" />
          Everyone accounted for — you can start the trip.
        </div>
      )}

      {/* Roster */}
      <div className="space-y-1.5">
        {pax.map((p) => (
          <div
            key={p.id}
            className={`flex items-center gap-2 text-xs p-2 rounded border ${
              current?.id === p.id ? "border-gold/50 bg-gold/5" : "border-border"
            }`}
          >
            <span className="font-medium flex-1 min-w-0 truncate">
              {p.seq + 1}. {p.name}
            </span>
            <span className={`text-[10px] px-1.5 py-0 rounded border shrink-0 ${
              p.noShow ? "border-destructive/40 text-destructive"
              : p.pickedAt ? "border-success/40 text-success"
              : "border-border text-muted-foreground"
            }`}>
              {p.noShow ? "no-show" : p.pickedAt ? "boarded ✓" : "waiting"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
