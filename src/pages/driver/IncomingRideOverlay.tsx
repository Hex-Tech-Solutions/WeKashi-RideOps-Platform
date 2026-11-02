/**
 * IncomingRideOverlay — full-screen takeover shown ONLY when the app is opened
 * from an incoming-ride push (the native `wekashi:openRide` deep-link). It
 * renders the REAL DriverOfferCard for that ride with working Accept/Reject.
 *
 * It does NOT auto-take-over while the driver is already using the app — in
 * that case offers appear in the broadcasts list (DriverHome) in their normal
 * place. The ride to show is picked from the live offers query, so the data is
 * always the authoritative offer model (fare, vehicle, distance, times).
 */

import { useEffect, useMemo, useState } from "react";
import { useDriverOffers, useAcceptOffer, useRejectOffer, type RideRow } from "@/lib/queries";
import { getDevicePosition } from "@/lib/deviceLocation";
import { useRouteMatrix } from "@/lib/queries";
import { DriverOfferCard, type ApproachInfo } from "./DriverOfferCard";
import { OfferCountdown } from "./OfferCountdown";
import { toast } from "sonner";

export function IncomingRideOverlay({ enabled }: { enabled: boolean }) {
  const { data: offersData } = useDriverOffers();
  const accept = useAcceptOffer();
  const reject = useRejectOffer();
  const routeMatrix = useRouteMatrix();

  const offers = useMemo(() => offersData?.offers ?? [], [offersData]);

  // The ride currently taken over by the overlay. null = overlay hidden.
  const [shownRideId, setShownRideId] = useState<string | null>(null);
  const [approach, setApproach] = useState<ApproachInfo | undefined>(undefined);

  // IMPORTANT: this full-screen overlay is shown ONLY when the app is opened
  // from an incoming-ride push (the native `wekashi:openRide` deep-link). It
  // must NOT auto-take-over the screen while the driver is already using the
  // app — in that case offers belong in the broadcasts list (DriverHome),
  // rendered in their designated place. (Previously it auto-showed on every
  // offer arrival, so it consumed the whole screen inside the app.)
  useEffect(() => {
    if (!enabled) { setShownRideId(null); return; }
    const onOpenRide = (e: Event) => {
      const rideId = (e as CustomEvent<{ rideId?: string }>).detail?.rideId;
      if (rideId) setShownRideId(rideId);
    };
    window.addEventListener("wekashi:openRide", onOpenRide as EventListener);
    return () => window.removeEventListener("wekashi:openRide", onOpenRide as EventListener);
  }, [enabled]);

  const ride: RideRow | undefined = useMemo(
    () => offers.find((o) => o.id === shownRideId),
    [offers, shownRideId],
  );

  // If the shown ride disappears from offers (cancelled / expired / taken),
  // close the overlay automatically.
  useEffect(() => {
    if (shownRideId && !ride) setShownRideId(null);
  }, [shownRideId, ride]);

  // Driver→pickup distance for the shown ride (one matrix call).
  useEffect(() => {
    if (!ride || ride.pickupLat == null || ride.pickupLng == null) { setApproach(undefined); return; }
    let cancelled = false;
    getDevicePosition()
      .then((pos) => {
        if (cancelled) return;
        routeMatrix.mutate(
          { origins: [{ lat: pos.lat, lng: pos.lng }], destinations: [{ lat: ride.pickupLat!, lng: ride.pickupLng! }] },
          {
            onSuccess: (res) => {
              if (cancelled) return;
              const el = res.elements[0];
              setApproach({
                km: el?.distanceMeters != null ? Math.round((el.distanceMeters / 1000) * 10) / 10 : null,
                min: el?.durationSeconds != null ? Math.max(1, Math.round(el.durationSeconds / 60)) : null,
              });
            },
            onError: () => setApproach(undefined),
          },
        );
      })
      .catch(() => setApproach(undefined));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride?.id]);

  if (!enabled || !ride) return null;

  const close = () => {
    setShownRideId(null);
    setApproach(undefined);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm flex flex-col justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-md mx-auto">
        <div className="text-center text-xs uppercase tracking-widest text-gold font-semibold mb-3 animate-pulse">
          New ride request
        </div>
        <DriverOfferCard
          ride={ride}
          approach={approach}
          countdown={ride.broadcastExpiresAt ? <OfferCountdown expiresAt={ride.broadcastExpiresAt} /> : undefined}
          acceptDisabled={accept.isPending}
          declineDisabled={reject.isPending}
          onAccept={() =>
            accept.mutate(ride.id, {
              onSuccess: (res) => {
                toast.success(res?.queued ? "Queued as your next ride" : "Ride accepted!");
                close();
              },
              onError: (e: any) => {
                toast.error(e?.message ?? "Ride already taken");
                close();
              },
            })
          }
          onDecline={() =>
            reject.mutate(ride.id, {
              onSuccess: () => { toast("Declined"); close(); },
              onError: () => close(),
            })
          }
        />
        <button
          onClick={close}
          className="mt-3 w-full text-center text-sm text-muted-foreground py-2"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
