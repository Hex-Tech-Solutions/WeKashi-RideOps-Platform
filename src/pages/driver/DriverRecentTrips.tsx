/**
 * Recent trips list for the driver account side panel (#16). Filters Today /
 * Last 7 days / 8–14 days ago (IST) with Trips + Earnings tiles from the
 * server; only completed rides and rentals (cancelled are hidden and not
 * counted). Tapping a ride opens the completed-ride detail sheet. Moved
 * here out of DriverHome so the home screen stays focused on going online and
 * live broadcasts.
 *
 * For a completed ride the supervisor has paid directly by UPI, the driver sees
 * the last-4 UTR the supervisor entered and can confirm receipt after matching
 * it against their bank credit.
 */
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronRight, CheckCircle2, Loader2, BadgeIndianRupee, CarFront } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useMarkRideReceived,
  useDriverTrips, useMarkRentalReceived,
  type DriverTripRide, type RentalHistoryRow, type TripRange,
} from "@/lib/queries";
import { CompletedRideDetailSheet } from "@/components/CompletedRideDetailSheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { format } from "date-fns";

const RANGE_LABELS: Record<TripRange, string> = {
  today: "Today",
  last7: "Last 7 days",
  prev7: "8–14 days ago",
};

const money = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function DriverRecentTrips() {
  // #16: periods + totals come from the server; cancelled rides are excluded.
  const [range, setRange] = useState<TripRange>("today");
  const { data, isLoading } = useDriverTrips(range);
  const history = data?.rides ?? [];
  const rentals = data?.rentals ?? [];
  const [detailRideId, setDetailRideId] = useState<string | undefined>(undefined);
  const [openRental, setOpenRental] = useState<string | undefined>(undefined);

  const empty = history.length === 0 && rentals.length === 0;

  return (
    <div className="space-y-2">
      <Tabs value={range} onValueChange={(v) => setRange(v as TripRange)}>
        <TabsList className="grid grid-cols-3 w-full">
          {(Object.keys(RANGE_LABELS) as TripRange[]).map((k) => (
            <TabsTrigger key={k} value={k} className="text-xs px-1">{RANGE_LABELS[k]}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border p-3">
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Trips</div>
          <div className="text-2xl font-bold">{data?.summary.trips ?? (isLoading ? "…" : 0)}</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Earnings</div>
          <div className="text-2xl font-bold">{data ? money(data.summary.earnings) : isLoading ? "…" : money(0)}</div>
        </div>
      </div>

      {isLoading && (
        <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-gold" /></div>
      )}
      {/* Completed rentals — shown as their own cards with a trip summary. */}
      {rentals.map((r) => (
        <RentalHistoryCard
          key={r.id}
          rental={r}
          expanded={openRental === r.id}
          onToggle={() => setOpenRental(openRental === r.id ? undefined : r.id)}
        />
      ))}

      {isLoading ? null : empty ? (
        <div className="text-xs text-muted-foreground text-center py-8 border-2 border-dashed rounded-lg">
          No completed trips {range === "today" ? "today" : `in ${RANGE_LABELS[range].toLowerCase()}`}.
        </div>
      ) : (
        history.map((r) => (
          <Card
            key={r.id}
            className="hover:border-gold/50 transition-colors"
          >
            <CardContent className="p-3 space-y-2">
              <div
                className="flex items-center justify-between text-sm cursor-pointer"
                onClick={() => setDetailRideId(r.id)}
              >
                <div className="min-w-0">
                  <div className="truncate">{r.pickupAddress} → {r.dropAddress}</div>
                  <div className="text-xs text-muted-foreground">
                    Completed · {format(new Date(r.completedAt ?? r.createdAt), "dd MMM, h:mm a")}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-semibold">
                    {r.price != null ? money((r.price ?? 0) + (r.escortCharge ?? 0)) : "—"}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>

              {r.status === "completed" && r.paymentStatus === "paid" && r.paymentRef && (
                <PaymentReceipt ride={r} />
              )}
            </CardContent>
          </Card>
        ))
      )}

      <CompletedRideDetailSheet
        rideId={detailRideId}
        onClose={() => setDetailRideId(undefined)}
      />
    </div>
  );
}

// Format minutes into "Hh Mm".
function fmtDur(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** A completed rental — tappable to reveal the full trip summary + receipt. */
function RentalHistoryCard({ rental: r, expanded, onToggle }: { rental: RentalHistoryRow; expanded: boolean; onToggle: () => void }) {
  const markReceived = useMarkRentalReceived();
  const received = !!r.paymentReceivedAt;
  const distanceKm = Math.round((r.distanceM / 1000) * 10) / 10;
  const elapsedMin = r.startedAt && r.completedAt
    ? Math.max(0, Math.round((new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) / 60000))
    : 0;
  const total = r.totalAmount ?? (r.basePrice + r.overageAmount);

  return (
    <Card className="hover:border-gold/50 transition-colors">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between text-sm cursor-pointer" onClick={onToggle}>
          <div className="min-w-0">
            <div className="truncate flex items-center gap-1.5">
              <CarFront className="h-3.5 w-3.5 text-gold shrink-0" />
              {r.customerName}
              <Badge variant="outline" className="capitalize text-[9px] px-1.5">{r.vehicleType}</Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              Rental · {r.hours}h/{r.km}km · {r.noShow ? "customer no-show (half fare)" : "completed"}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-semibold">₹{total}</span>
            <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
          </div>
        </div>

        {/* Trip summary — the detail the supervisor needs for billing/claims. */}
        {expanded && (
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-xs">
            <div className="text-muted-foreground">{r.pickupAddress}</div>
            <div className="grid grid-cols-2 gap-2">
              <div><span className="text-muted-foreground">Duration</span><div className="font-semibold">{fmtDur(elapsedMin)} <span className="text-muted-foreground font-normal">/ {r.hours}h pack</span></div></div>
              <div><span className="text-muted-foreground">Distance</span><div className="font-semibold">{distanceKm} km <span className="text-muted-foreground font-normal">/ {r.km} km pack</span></div></div>
            </div>
            <div className="border-t pt-1.5 space-y-1">
              <div className="flex justify-between text-muted-foreground"><span>Base package</span><span>₹{r.basePrice}</span></div>
              {r.overageAmount > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Overage{r.overageHours > 0 ? ` (+${r.overageHours}h` : ""}{r.overageKm > 0 ? `${r.overageHours > 0 ? ", " : " ("}+${r.overageKm}km` : ""}{(r.overageHours > 0 || r.overageKm > 0) ? ")" : ""}</span>
                  <span>₹{r.overageAmount}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-sm border-t pt-1"><span>Total</span><span>₹{total}</span></div>
            </div>
            {r.startedAt && r.completedAt && (
              <div className="text-[11px] text-muted-foreground">
                {new Date(r.startedAt).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                {" → "}
                {new Date(r.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            )}
          </div>
        )}

        {/* Payment receipt — same UTR flow as rides. */}
        {r.paymentStatus === "paid" && r.paymentRef && (
          <div className="rounded-lg border bg-muted/30 p-2.5 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-muted-foreground"><BadgeIndianRupee className="h-3.5 w-3.5" /> Paid by supervisor</span>
              <span className="font-mono">UTR ••••{r.paymentRef}</span>
            </div>
            {received ? (
              <div className="flex items-center gap-1.5 text-success font-medium"><CheckCircle2 className="h-3.5 w-3.5" /> Payment received</div>
            ) : (
              <Button
                size="sm"
                className="w-full bg-success text-success-foreground hover:bg-success/90 h-8"
                onClick={() => markReceived.mutate(r.id, {
                  onSuccess: () => toast.success("Marked as received"),
                  onError: (e: any) => toast.error(e?.message ?? "Could not update"),
                })}
                disabled={markReceived.isPending}
              >
                {markReceived.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> …</> : <><CheckCircle2 className="h-3.5 w-3.5" /> Verify UTR & mark received</>}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** UTR receipt + "mark as received" for a supervisor-paid ride. */
function PaymentReceipt({ ride }: { ride: Pick<DriverTripRide, "id" | "paymentRef" | "paymentReceivedAt"> }) {
  const markReceived = useMarkRideReceived();
  const received = !!ride.paymentReceivedAt;

  return (
    <div className="rounded-lg border bg-muted/30 p-2.5 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <BadgeIndianRupee className="h-3.5 w-3.5" />
          Paid by supervisor
        </span>
        <span className="font-mono">UTR ••••{ride.paymentRef}</span>
      </div>
      {received ? (
        <div className="flex items-center gap-1.5 text-success font-medium">
          <CheckCircle2 className="h-3.5 w-3.5" /> Payment received
        </div>
      ) : (
        <Button
          size="sm"
          className="w-full bg-success text-success-foreground hover:bg-success/90 h-8"
          onClick={() =>
            markReceived.mutate(ride.id, {
              onSuccess: () => toast.success("Marked as received"),
              onError: (e: any) => toast.error(e?.message ?? "Could not update"),
            })
          }
          disabled={markReceived.isPending}
        >
          {markReceived.isPending
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> …</>
            : <><CheckCircle2 className="h-3.5 w-3.5" /> Verify UTR & mark received</>}
        </Button>
      )}
    </div>
  );
}
