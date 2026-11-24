/**
 * ActiveRideHeader - the one-line summary shown at the top of an accepted ride.
 *
 * The full RideSummary (addresses, fare, seats, times) is tucked behind
 * "Details" so the driver's attention goes to the single step in front of them.
 * "Can't take this ride" lives in the menu, not as a button competing with Start.
 */
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RideTypeBadge } from "@/components/RideTypeLabel";
import { ChevronDown, IndianRupee, MoreVertical, Shield, Users, X } from "lucide-react";
import type { RideRow } from "@/lib/queries";

export default function ActiveRideHeader({
  ride,
  firstPickupLabel,
  details,
  onCantTake,
}: {
  ride: RideRow;
  /** e.g. "06:30", shown as "1st pickup 06:30" */
  firstPickupLabel?: string | null;
  /** Full ride summary, shown when the driver taps Details. */
  details: ReactNode;
  /** Only passed while the ride can still be handed back (not started). */
  onCantTake?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const earnings = (ride.price ?? 0) + (ride.escortCharge ?? 0);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <RideTypeBadge type={ride.type} />
        <span className="flex items-center gap-1 text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          {ride.paxCount}
        </span>
        {ride.escortRequired && (
          <span className="flex items-center gap-1 text-amber-700">
            <Shield className="h-3.5 w-3.5" /> Escort
          </span>
        )}
        {ride.price != null && (
          <span className="flex items-center font-semibold">
            <IndianRupee className="h-3 w-3" />{earnings}
          </span>
        )}
        {firstPickupLabel && (
          <span className="text-muted-foreground">
            1st pickup <span className="font-mono font-semibold text-foreground">{firstPickupLabel}</span>
          </span>
        )}
        <div className="ml-auto flex items-center">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => setOpen((o) => !o)}
          >
            Details <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </Button>
          {onCantTake && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" aria-label="More">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="text-destructive" onSelect={onCantTake}>
                  <X className="h-3.5 w-3.5 mr-2" /> Can't take this ride
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      {open && <div className="rounded-md border bg-muted/30 p-3">{details}</div>}
    </div>
  );
}
