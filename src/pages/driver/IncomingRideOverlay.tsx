/**
 * IncomingRideOverlay — the full-screen "a ride is here" takeover, shown inside
 * the web app (Option Y). When a broadcast arrives (socket) or the native layer
 * hands us a ride via the `wekashi:openRide` event (push → wake screen → open
 * app), this covers the screen with the REAL DriverOfferCard for that ride —
 * the exact card the driver sees in the broadcasts list, with working
 * Accept/Reject. No native card, no lookalike.
 *
 * It picks the ride to show from the live offers query, so the data is always
 * the authoritative offer model (fare, vehicle, distance, times, countdown).
 */

import { useEffect, useMemo, useRef, useState } from "react";
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
  // Rides the driver already acted on / that we've auto-shown, so we don't
  // re-pop the overlay for the same ride after they dismiss it.
  const handledRef = useRef<Set<string>>(new Set());

  // Auto-show the newest pending offer when one arrives (and the driver hasn't
  // already handled it). This fires both for socket broadcasts (offers refetch)
  // and when the app is opened from a push.
  useEffect(() => {
    if (!enabled) { setShownRideId(null); return; }
    if (shownRideId) return; // already showing one
    const next = offers.find((o) => !handledRef.current.has(o.id));
    if (next) setShownRideId(next.id);
  }, [enabled, offers, shownRideId]);

  // Native deep-link: when the driver opens the app from the incoming-ride
  // push, show that specific ride's overlay.
  useEffect(() => {
    const onOpenRide = (e: Event) => {
      const rideId = (e as CustomEvent<{ rideId?: string }>).detail?.rideId;
      if (rideId) {
        handledRef.current.delete(rideId);
        setShownRideId(rideId);
      }
    };
    window.addEventListener("wekashi:openRide", onOpenRide as EventListener);
    return () => window.removeEventListener("wekashi:openRide", onOpenRide as EventListener);
  }, []);

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
    if (shownRideId) handledRef.current.add(shownRideId);
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
