import { useState } from "react";
import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePendingPayments, type PendingPaymentRide } from "@/lib/queries";
import { PayRideDialog } from "@/components/PayRideDialog";
import { IndianRupee, Wallet, CheckCircle2, Loader2, Car } from "lucide-react";

export default function SupervisorPayments() {
  const { data, isLoading } = usePendingPayments();
  const [payRide, setPayRide] = useState<PendingPaymentRide | null>(null);

  const rides = data?.rides ?? [];
  const total = rides.reduce((s, r) => s + (r.price ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Payments"
        description="Pay drivers for completed rides. Payments are processed via Razorpay."
      />

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
          {/* Summary strip */}
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

      <PayRideDialog ride={payRide} onClose={() => setPayRide(null)} />
    </div>
  );
}

function PaymentCard({ ride, onPay }: { ride: PendingPaymentRide; onPay: () => void }) {
  const driverFare  = ride.price ?? 0;
  const platformFee = ride.platformFee ?? 20;
  const totalAmount = ride.totalAmount ?? (driverFare + platformFee);

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
              <div className={`flex items-center gap-1 mt-0.5 ${ride.driver.razorpayAccountVerified ? "text-success" : "text-warning"}`}>
                <Car className="h-3 w-3 shrink-0" />
                {ride.driver.razorpayAccountVerified ? "Payout verified" : "Payout not set up"}
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
          <div className="flex justify-between text-muted-foreground">
            <span>Platform fee</span>
            <span>₹{platformFee.toLocaleString()}</span>
          </div>
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
