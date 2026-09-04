/**
 * DriverOfferCard — compact broadcast card, styled after the ride-hailing
 * convention: fare up top, then two lines showing "how far to the pickup" and
 * "how long the trip is", then Accept/Decline.
 *
 * API cost: the distance from the driver to each pickup comes from a SINGLE
 * computeRouteMatrix call made once per offers-list render by the parent
 * (one origin = driver, destinations = every offer's pickup). That is one
 * billable call for the whole list, not one per card. Trip distance is already
 * stored on the ride, so it costs nothing. See DriverOffers below.
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Check, X, Users, Shield, Timer, LogIn, MapPin } from "lucide-react";
import type { RideRow } from "@/lib/queries";

/** Format an ISO datetime (or an HH:MM string) to HH:MM for display. */
function fmtTime(v?: string | null): string | null {
  if (!v) return null;
  // Already HH:MM
  if (/^\d{2}:\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export interface ApproachInfo {
  km: number | null;
  min: number | null;
}

export function DriverOfferCard({
  ride,
  approach,
  countdown,
  onAccept,
  onDecline,
  acceptDisabled,
  declineDisabled,
}: {
  ride: RideRow;
  approach?: ApproachInfo;
  countdown?: React.ReactNode;
  onAccept: () => void;
  onDecline: () => void;
  acceptDisabled?: boolean;
  declineDisabled?: boolean;
}) {
  // Driver keeps the fare plus any escort charge.
  const earnings = (ride.price ?? 0) + (ride.escortCharge ?? 0);
  const isLogin = ride.type !== "logout";
  const loginTime = fmtTime(ride.plannedStartTime);
  const firstPickup = fmtTime(ride.firstPickupTime);

  return (
    <Card className="overflow-hidden border-gold/30">
      {/* Fare header */}
      <div className="bg-foreground text-background px-3 py-2 flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-xl font-bold text-gold">₹{earnings}</span>
          {ride.escortRequired && ride.escortCharge != null && (
            <span className="text-[10px] text-gold/70">incl. ₹{ride.escortCharge} escort</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {ride.escortRequired && (
            <Badge className="bg-amber-500 text-white gap-1 text-[10px] px-1.5 py-0">
              <Shield className="h-2.5 w-2.5" /> Escort
            </Badge>
          )}
          <Badge variant="outline" className="capitalize text-[10px] px-1.5 py-0 border-background/30 text-background">
            {ride.type}
          </Badge>
        </div>
      </div>

      <CardContent className="p-3 space-y-2.5">
        {/* Two-stop summary: distance to pickup, then the trip itself */}
        <div className="relative pl-4">
          {/* connector line */}
          <span className="absolute left-[3px] top-[7px] bottom-[7px] w-px bg-border" />

          <div className="relative">
            <span className="absolute -left-4 top-1 h-1.5 w-1.5 rounded-full bg-gold ring-2 ring-gold/20" />
            <div className="flex items-baseline gap-1.5">
              <span className="text-sm font-bold">
                {approach?.km != null ? `${approach.km} km` : "—"}
              </span>
              {approach?.min != null && (
                <span className="text-[11px] text-muted-foreground">({approach.min} min away)</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground line-clamp-2 leading-snug">
              {ride.pickupAddress}
            </div>
          </div>

          <div className="relative mt-2.5">
            <span className="absolute -left-4 top-1 h-1.5 w-1.5 rounded-sm bg-foreground/60" />
            <div className="flex items-baseline gap-1.5">
              <span className="text-sm font-bold">
                {ride.distanceKm != null ? `${ride.distanceKm} km` : "—"}
              </span>
              <span className="text-[11px] text-muted-foreground">trip</span>
            </div>
            <div className="text-xs text-muted-foreground line-clamp-2 leading-snug">
              {ride.dropAddress}
            </div>
          </div>
        </div>

        {/* Times row — employee login/shift time and the first pickup time so
            the driver knows the schedule before accepting. */}
        {(loginTime || firstPickup) && (
          <div className="flex items-center gap-3 text-[11px] rounded-md bg-muted/50 px-2 py-1.5">
            {loginTime && (
              <span className="flex items-center gap-1">
                <LogIn className="h-3 w-3 text-gold-dark" />
                <span className="text-muted-foreground">{isLogin ? "Login" : "Logout"}</span>
                <span className="font-semibold text-foreground font-mono">{loginTime}</span>
              </span>
            )}
            {firstPickup && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3 text-gold-dark" />
                <span className="text-muted-foreground">1st pickup</span>
                <span className="font-semibold text-foreground font-mono">{firstPickup}</span>
              </span>
            )}
          </div>
        )}

        {/* Meta row */}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {ride.paxCount}
            {ride.escortRequired && "+1"}
          </span>
          {ride.capacity != null && <span>· {ride.capacity}-seater</span>}
          <span className="ml-auto flex items-center gap-1">
            {countdown ?? <Timer className="h-3 w-3 opacity-40" />}
          </span>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            className="flex-1 bg-gold text-gold-foreground hover:bg-gold/90 h-10"
            disabled={acceptDisabled}
            onClick={onAccept}
          >
            <Check className="h-4 w-4" /> Accept
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 shrink-0 text-muted-foreground"
            disabled={declineDisabled}
            onClick={onDecline}
            aria-label="Decline ride"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
