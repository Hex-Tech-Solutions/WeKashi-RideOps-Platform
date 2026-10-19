/**
 * DriverRentalBrowse — the "browse & claim" rentals marketplace, shown on the
 * driver's Scheduled tab. Rentals are a secondary service: when a driver is
 * free (no active ride, opted in, eligible) they can pick one up here. Accepting
 * one moves it to the Rides tab as their live in-progress rental.
 *
 * Cards mirror the broadcast style and are shown as a capped card deck so a long
 * list doesn't scroll forever. Declining just dismisses the card for the session
 * (rentals broadcast fleet-wide — there's no per-driver reject row).
 */
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useDriverRentalsAvailable, useAcceptRental,
  mapsUrlForAddress, type RentalRow,
} from "@/lib/queries";
import { rideArea } from "@/lib/rideArea";
import { CarFront, Phone, MapPin, Check, X, Timer } from "lucide-react";
import { toast } from "sonner";

function rentalPickup(scheduledFor?: string | null): string {
  if (!scheduledFor) return "Now";
  const d = new Date(scheduledFor);
  if (isNaN(d.getTime())) return "Now";
  return d.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function DriverRentalBrowse() {
  const { data } = useDriverRentalsAvailable();
  const acceptRental = useAcceptRental();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const available = (data?.rentals ?? []).filter((r) => !dismissed.has(r.id));

  return (
    <section>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
        <CarFront className="h-3.5 w-3.5 text-gold" /> Rentals to claim
        {available.length > 0 && (
          <span className="ml-0.5 inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-gold text-gold-foreground text-[11px] font-bold">
            {available.length}
          </span>
        )}
      </div>
      {available.length === 0 ? (
        <Card><CardContent className="p-5 text-center text-sm text-muted-foreground">
          No rentals to claim right now. Opt in under Account · Vehicle to receive them.
        </CardContent></Card>
      ) : (
        <RentalStack
          rentals={available}
          accepting={acceptRental.isPending}
          onAccept={(id) => acceptRental.mutate(id, {
            onSuccess: () => toast.success("Rental accepted — see it under Rides"),
            onError: (e: any) => toast.error(e?.message ?? "Rental no longer available"),
          })}
          onDecline={(id) => { setDismissed((s) => new Set(s).add(id)); toast("Rental dismissed"); }}
        />
      )}
    </section>
  );
}

// Card deck — top card interactive, up to two peeking behind (max 3 layers).
function RentalStack({
  rentals, onAccept, onDecline, accepting,
}: {
  rentals: RentalRow[];
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  accepting?: boolean;
}) {
  const top = rentals[0];
  if (!top) return null;
  const peek = Math.min(rentals.length - 1, 2);
  return (
    <div className="relative" style={{ paddingBottom: peek * 10 }}>
      {Array.from({ length: peek }).map((_, i) => {
        const depth = peek - i;
        return (
          <div
            key={`peek-${depth}`}
            aria-hidden
            className="absolute inset-x-0 top-0 rounded-xl border border-gold/20 bg-card shadow-card"
            style={{
              height: 56,
              transform: `translateY(${depth * 10}px) scale(${1 - depth * 0.04})`,
              zIndex: 0,
              opacity: 1 - depth * 0.25,
            }}
          />
        );
      })}
      <div className="relative" style={{ zIndex: 1 }}>
        <RentalCard rental={top} onAccept={() => onAccept(top.id)} onDecline={() => onDecline(top.id)} accepting={accepting} />
      </div>
    </div>
  );
}

function RentalCard({
  rental: r, onAccept, onDecline, accepting,
}: {
  rental: RentalRow;
  onAccept?: () => void;
  onDecline?: () => void;
  accepting?: boolean;
}) {
  return (
    <Card className="overflow-hidden border-gold/30">
      <div className="bg-foreground text-background px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-background/50 font-medium">You earn</div>
            <div className="flex items-baseline gap-1 leading-none">
              <span className="text-4xl font-extrabold text-gold tracking-tight">₹{r.basePrice}</span>
            </div>
            <div className="text-[11px] text-background/70 mt-0.5">
              ₹{r.extraPerKm}/extra km · ₹{r.extraPerHr}/extra hr
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0 max-w-[55%]">
            <Badge className="bg-gold/20 text-gold border border-gold/40 gap-1 text-[10px] px-2 py-0.5 font-semibold">
              <CarFront className="h-2.5 w-2.5" /> Rental
            </Badge>
            <Badge variant="outline" className="capitalize text-[10px] px-2 py-0.5 border-background/30 text-background">{r.vehicleType}</Badge>
            <Badge variant="outline" className="text-[10px] px-2 py-0.5 border-background/30 text-background">{r.hours}h · {r.km}km</Badge>
          </div>
        </div>
      </div>

      <CardContent className="p-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold text-sm">{r.customerName}</div>
          <a href={`tel:${r.customerPhone}`} className="text-xs text-gold-dark flex items-center gap-1">
            <Phone className="h-3 w-3" /> {r.customerPhone}
          </a>
        </div>

        <div className="flex items-center gap-2 text-sm rounded-md bg-muted/50 px-3 py-2">
          <Timer className="h-4 w-4 text-gold-dark" />
          <span className="text-muted-foreground">Pickup</span>
          <span className="font-bold text-foreground font-mono text-base">{rentalPickup(r.scheduledFor)}</span>
        </div>

        <a href={mapsUrlForAddress(r.pickupAddress)} target="_blank" rel="noreferrer" className="relative pl-4 block">
          <MapPin className="absolute left-0 top-0.5 h-3.5 w-3.5 text-gold" />
          {rideArea(r.pickupAddress) && (
            <div className="text-sm font-semibold text-foreground leading-tight pl-1">{rideArea(r.pickupAddress)}</div>
          )}
          <div className="text-xs text-muted-foreground leading-snug break-words pl-1">{r.pickupAddress}</div>
        </a>

        {r.notes && <div className="text-xs text-muted-foreground italic">“{r.notes}”</div>}

        <div className="flex gap-2">
          <Button className="flex-1 bg-gold text-gold-foreground hover:bg-gold/90 h-10" disabled={accepting} onClick={onAccept}>
            <Check className="h-4 w-4" /> Accept rental (1 credit)
          </Button>
          <Button variant="outline" size="icon" className="h-10 w-10 shrink-0 text-muted-foreground" onClick={onDecline} aria-label="Decline rental">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

