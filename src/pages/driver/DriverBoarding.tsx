/**
 * DriverBoarding — office boarding checklist for LOGOUT rides.
 *
 * On a logout ride every employee boards together at the office before the
 * cab departs, so boarding verification has to happen while the ride is still
 * `assigned` (i.e. BEFORE "Start trip"), not after.
 *
 * Layout note: this is a compact list of names only. Tapping a name opens a
 * dialog for the OTP. An earlier version rendered the active passenger's OTP
 * form inline AND repeated the roster underneath, which pushed "Start trip"
 * well below the fold on a phone — the driver had to scroll to do the one thing
 * the screen is for.
 *
 * Login rides don't use this — their pickups happen one-by-one at each
 * employee's home during the trip, which DriverTrip already handles.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  useRidePax,
  useVerifyPickup,
  useMarkNoShow,
  type RidePaxRow,
} from "@/lib/queries";
import {
  Check, UserX, Loader2, Phone, LogIn, Shield, UserCheck, CheckCircle2, ChevronRight,
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
  const [openPaxId, setOpenPaxId] = useState<string | null>(null);

  const pax = data?.pax ?? [];
  const escortRequired = data?.escortRequired ?? false;
  const escortName = data?.escortName ?? null;

  const isSettled = (p: RidePaxRow) => !!p.pickedAt || p.noShow;
  const boardedCount = pax.filter((p) => p.pickedAt && !p.noShow).length;
  const allBoarded = pax.length > 0 && pax.every(isSettled);
  onAllBoarded?.(allBoarded);

  const activePax = pax.find((p) => p.id === openPaxId) ?? null;

  const close = () => { setOpenPaxId(null); setOtp(""); };

  const submitOtp = () => {
    if (!activePax) return;
    if (otp.length < 4) { toast.error("Enter the 4-digit boarding OTP"); return; }
    verifyPickup.mutate(
      { rideId, paxId: activePax.id, otp },
      {
        onSuccess: () => { toast.success(`${activePax.name} boarded ✓`); close(); },
        onError: (e: any) => toast.error(e?.message ?? "Wrong OTP"),
      },
    );
  };

  const markNoShow = () => {
    if (!activePax) return;
    noShow.mutate(
      { rideId, paxId: activePax.id },
      {
        onSuccess: () => { toast(`${activePax.name} marked no-show`); close(); },
        onError: (e: any) => toast.error(e?.message ?? "Failed"),
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
    <div className="space-y-2">
      {/* Escort note — the escort boards here too, but has no boarding OTP. */}
      {escortRequired && escortName && (
        <div className="rounded-md border border-amber-400/60 bg-amber-50 px-2.5 py-2 flex items-center gap-2">
          <Shield className="h-3.5 w-3.5 text-amber-700 shrink-0" />
          <div className="text-[11px] text-amber-900 min-w-0">
            <span className="font-semibold">Escort:</span> {escortName}
            <span className="text-amber-700"> · no OTP now, needed at office drop</span>
          </div>
        </div>
      )}

      {/* Header + progress on one line to save vertical space */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-gold-dark min-w-0">
          <LogIn className="h-3.5 w-3.5 shrink-0" />
          <span className="font-semibold truncate">Boarding at office</span>
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0">
          {boardedCount}/{pax.length} boarded
        </span>
      </div>

      {/* Tap a name to verify — no inline form, no duplicated roster */}
      <div className="space-y-1.5">
        {pax.map((p) => {
          const settled = isSettled(p);
          return (
            <button
              key={p.id}
              type="button"
              disabled={settled}
              onClick={() => { setOpenPaxId(p.id); setOtp(""); }}
              className={`w-full flex items-center gap-2 text-sm px-3 py-2.5 rounded-md border text-left transition-colors ${
                p.noShow
                  ? "border-destructive/30 bg-destructive/5"
                  : p.pickedAt
                  ? "border-success/30 bg-success/5"
                  : "border-gold/40 bg-gold/5 active:bg-gold/10"
              }`}
            >
              <span className="font-medium flex-1 min-w-0 truncate">
                {p.seq + 1}. {p.name}
              </span>
              {p.noShow ? (
                <span className="text-[10px] text-destructive shrink-0">no-show</span>
              ) : p.pickedAt ? (
                <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
              ) : (
                <>
                  <span className="text-[10px] text-gold-dark shrink-0">Verify</span>
                  <ChevronRight className="h-4 w-4 text-gold-dark shrink-0" />
                </>
              )}
            </button>
          );
        })}
      </div>

      {allBoarded && (
        <div className="flex items-center justify-center gap-1.5 text-xs text-success pt-0.5">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Everyone accounted for
        </div>
      )}

      {/* OTP dialog */}
      <Dialog open={!!activePax} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-base">
              {activePax ? `Board ${activePax.name}` : "Board passenger"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {activePax?.contactPhone && (
              <a
                href={`tel:${activePax.contactPhone}`}
                className="flex items-center justify-center gap-2 w-full rounded-md border py-2 text-sm"
              >
                <Phone className="h-4 w-4" />
                Call {activePax.contactLabel}
              </a>
            )}

            <Input
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="Boarding OTP"
              inputMode="numeric"
              autoFocus
              className="tracking-[0.3em] text-center text-lg"
            />

            <Button
              className="w-full bg-gold text-gold-foreground hover:bg-gold/90"
              disabled={verifyPickup.isPending}
              onClick={submitOtp}
            >
              <Check className="h-4 w-4" /> Verify
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="w-full text-muted-foreground"
              disabled={noShow.isPending}
              onClick={markNoShow}
            >
              <UserX className="h-3.5 w-3.5" /> No-show (didn't board)
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
