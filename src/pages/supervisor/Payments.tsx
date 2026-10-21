import { useState } from "react";
import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { usePendingPayments, usePaymentHistory, type PendingPaymentRide, type PaidPaymentRow } from "@/lib/queries";
import { PayRideDialog } from "@/components/PayRideDialog";
import { IndianRupee, CheckCircle2, Loader2, Car, History } from "lucide-react";

export default function SupervisorPayments() {
  const { data, isLoading } = usePendingPayments();
  const [payRide, setPayRide] = useState<PendingPaymentRide | null>(null);

  const rides = data?.rides ?? [];
  const total = rides.reduce((s, r) => s + (r.amount ?? (r.price ?? 0) + (r.escortCharge ?? 0)), 0);

  return (
    <div>
      <PageHeader
        title="Payments"
        description="Pay drivers directly for completed rides by scanning their UPI QR."
      />

      <Tabs defaultValue="pending">
        <TabsList className="mb-4">
          <TabsTrigger value="pending">
            <IndianRupee className="h-3.5 w-3.5 mr-1.5" /> Pending{rides.length ? ` (${rides.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="h-3.5 w-3.5 mr-1.5" /> Paid
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          {isLoading && (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading…
            </div>
          )}

          {!isLoading && rides.length === 0 && (
            <Card className="shadow-card">
              <CardContent className="py-16 text-center space-y-2">
                <CheckCircle2 className="h-10 w-10 mx-auto text-success/40" />
                <div className="font-medium">All caught up</div>
                <div className="text-sm text-muted-foreground">
                  No pending payments. Completed rides awaiting payment will appear here.
                </div>
              </CardContent>
            </Card>
          )}

          {!isLoading && rides.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-4 px-1">
                <span className="text-sm text-muted-foreground">
                  {rides.length} ride{rides.length === 1 ? "" : "s"} awaiting payment
                </span>
                <span className="font-semibold flex items-center gap-1">
                  Total: <IndianRupee className="h-3.5 w-3.5" />{total.toLocaleString()}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {rides.map((r) => (
                  <PaymentCard key={r.id} ride={r} onPay={() => setPayRide(r)} />
                ))}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="history">
          <PaymentHistory />
        </TabsContent>
      </Tabs>

      <PayRideDialog ride={payRide} onClose={() => setPayRide(null)} />
    </div>
  );
}

function PaymentHistory() {
  const { data, isLoading } = usePaymentHistory();
  const rows = data?.rides ?? [];
  const total = rows.reduce((s, r) => s + (r.amount ?? 0), 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <Card className="shadow-card">
        <CardContent className="py-16 text-center space-y-2">
          <History className="h-10 w-10 mx-auto text-muted-foreground/30" />
          <div className="font-medium">No paid rides yet</div>
          <div className="text-sm text-muted-foreground">Rides you've paid for will be kept here.</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4 px-1">
        <span className="text-sm text-muted-foreground">{rows.length} paid</span>
        <span className="font-semibold flex items-center gap-1">
          Total paid: <IndianRupee className="h-3.5 w-3.5" />{total.toLocaleString()}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {rows.map((r) => (
          <PaidCard key={`${r.kind}-${r.id}`} row={r} />
        ))}
      </div>
    </>
  );
}

function PaidCard({ row: r }: { row: PaidPaymentRow }) {
  return (
    <Card className="shadow-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono">{r.id.slice(-8).toUpperCase()}</CardTitle>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="capitalize text-[10px]">{r.type}</Badge>
            <Badge variant="outline" className="border-success/40 text-success bg-success/5 text-[10px]">Paid</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <div className="font-medium line-clamp-1">{r.pickupAddress}</div>
          <div className="text-muted-foreground text-xs line-clamp-1">→ {r.dropAddress}</div>
        </div>
        {r.driver && (
          <div className="text-xs text-muted-foreground">
            Driver: <span className="text-foreground font-medium">{r.driver.fullName}</span> · {r.driver.phone}
          </div>
        )}
        <div className="rounded-lg border bg-muted/30 p-2.5 space-y-1.5 text-xs">
          <div className="flex justify-between font-semibold text-sm">
            <span>Paid</span>
            <span className="flex items-center gap-0.5"><IndianRupee className="h-3.5 w-3.5" />{(r.amount ?? 0).toLocaleString()}</span>
          </div>
          {r.paidAt && (
            <div className="flex justify-between text-muted-foreground">
              <span>On</span>
              <span>{new Date(r.paidAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          )}
          {r.paymentRef && (
            <div className="flex justify-between text-muted-foreground">
              <span>UTR</span>
              <span className="font-mono">••••{r.paymentRef}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Driver receipt</span>
            <span className={r.paymentReceivedAt ? "text-success" : "text-muted-foreground"}>
              {r.paymentReceivedAt ? "confirmed ✓" : "awaiting"}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PaymentCard({ ride, onPay }: { ride: PendingPaymentRide; onPay: () => void }) {
  const driverFare  = ride.price ?? 0;
  const escortFee   = ride.escortCharge ?? 0;
  const totalAmount = ride.amount ?? ride.totalAmount ?? (driverFare + escortFee);

  return (
    <Card className="shadow-card border-warning/20 hover:border-warning/50 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono">{ride.id.slice(-8).toUpperCase()}</CardTitle>
          <Badge variant="outline" className="border-warning/40 text-warning bg-warning/5 text-[10px]">
            Unpaid
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {/* Route */}
        <div>
          <div className="font-medium line-clamp-1">{ride.pickupAddress}</div>
          <div className="text-muted-foreground text-xs line-clamp-1">→ {ride.dropAddress}</div>
          {ride.completedAt && (
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Completed {new Date(ride.completedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </div>
          )}
        </div>

        {/* Driver */}
        {ride.driver && (
          <div className="flex items-center gap-2 p-2 rounded-md bg-secondary text-xs">
            <div className="h-7 w-7 rounded-full bg-foreground text-background flex items-center justify-center font-bold shrink-0 text-[10px]">
              {ride.driver.fullName.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{ride.driver.fullName}</div>
              <div className={`flex items-center gap-1 mt-0.5 ${ride.driver.upiVerified ? "text-success" : "text-warning"}`}>
                <Car className="h-3 w-3 shrink-0" />
                {ride.driver.upiVerified ? "UPI on file" : "No payable UPI — driver needs to add one"}
              </div>
            </div>
          </div>
        )}

        {/* Fare breakdown */}
        <div className="rounded-lg border bg-muted/30 p-2.5 space-y-1.5 text-xs">
          <div className="flex justify-between text-muted-foreground">
            <span>Driver fare</span>
            <span>₹{driverFare.toLocaleString()}</span>
          </div>
          {escortFee > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Escort charge</span>
              <span>₹{escortFee.toLocaleString()}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold border-t pt-1.5 text-sm">
            <span>You pay</span>
            <span className="flex items-center gap-0.5">
              <IndianRupee className="h-3.5 w-3.5" />{totalAmount.toLocaleString()}
            </span>
          </div>
        </div>

        <Button
          className="w-full bg-gold text-gold-foreground hover:bg-gold/90"
          onClick={onPay}
        >
          <IndianRupee className="h-4 w-4" /> Pay ₹{totalAmount.toLocaleString()}
        </Button>
      </CardContent>
    </Card>
  );
}
