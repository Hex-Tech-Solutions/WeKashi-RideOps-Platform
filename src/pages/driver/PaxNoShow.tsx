/**
 * PaxNoShow - the "employee did not turn up" controls for one passenger.
 *
 * Flow: (1) driver confirms arrival at the stop (server checks GPS is within
 * 150 m) -> (2) wait until `noShowOpensAt` (5 min after the later of arrival
 * and the employee's scheduled pickup) -> (3) driver types their own vehicle
 * number instead of an OTP to mark the no-show.
 *
 * For logout rides arrival is confirmed once for the whole office stop by the
 * "I've arrived" slider on the ride card, so no per-employee arrival button is
 * shown there (`canConfirmArrival` false).
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserX, MapPin, Timer } from "lucide-react";
import { toast } from "sonner";
import { useMarkNoShow, useMarkPaxArrived, type RidePaxRow } from "@/lib/queries";

export interface PaxNoShowProps {
  rideId: string;
  pax: RidePaxRow;
  canConfirmArrival: boolean;
  onDone: () => void;
}

export default function PaxNoShow({ rideId, pax, canConfirmArrival, onDone }: PaxNoShowProps) {
  const arrive = useMarkPaxArrived();
  const noShow = useMarkNoShow();
  const [plate, setPlate] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const opensAt = pax.noShowOpensAt ? new Date(pax.noShowOpensAt).getTime() : null;
  useEffect(() => {
    if (opensAt == null || Date.now() >= opensAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [opensAt]);

  if (!pax.arrivedAt) {
    if (!canConfirmArrival) {
      return (
        <p className="text-[11px] text-muted-foreground text-center">
          Confirm arrival with the slider first. No-show opens 5 minutes after.
        </p>
      );
    }
    return (
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        disabled={arrive.isPending}
        onClick={() =>
          arrive.mutate(
            { rideId, paxId: pax.id },
            {
              onSuccess: () => toast.success("Arrival confirmed. No-show opens after 5 minutes."),
              onError: (e: any) => toast.error(e?.message ?? "Could not confirm arrival"),
            },
          )
        }
      >
        <MapPin className="h-3.5 w-3.5" /> I've arrived at this stop
      </Button>
    );
  }

  const msLeft = opensAt != null ? Math.max(0, opensAt - now) : 0;
  if (msLeft > 0) {
    const s = Math.ceil(msLeft / 1000);
    return (
      <div className="flex items-center justify-center gap-1.5 rounded-md border border-dashed py-2 text-xs text-muted-foreground">
        <Timer className="h-3.5 w-3.5" />
        No-show opens in {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Input
        value={plate}
        onChange={(e) => setPlate(e.target.value.toUpperCase().slice(0, 20))}
        placeholder="Type your vehicle number"
        autoCapitalize="characters"
        className="text-center tracking-wider"
      />
      <Button
        variant="outline"
        size="sm"
        className="w-full text-destructive border-destructive/40"
        disabled={noShow.isPending || plate.trim().length < 4}
        onClick={() =>
          noShow.mutate(
            { rideId, paxId: pax.id, vehicleNo: plate },
            {
              onSuccess: () => { toast(`${pax.name} marked no-show`); onDone(); },
              onError: (e: any) => toast.error(e?.message ?? "Failed"),
            },
          )
        }
      >
        <UserX className="h-3.5 w-3.5" /> Mark no-show (didn't turn up)
      </Button>
    </div>
  );
}
