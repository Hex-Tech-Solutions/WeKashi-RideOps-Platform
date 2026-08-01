import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useInitiatePayment, useConfirmPayment, type PendingPaymentRide, type PaymentInitResult } from "@/lib/queries";
import {
  IndianRupee, CheckCircle2, Loader2, AlertCircle,
  Smartphone, CreditCard, Building2, Car,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface Props {
  ride: PendingPaymentRide | null;
  onClose: () => void;
}

declare global {
  interface Window { Razorpay: any; }
}

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) { resolve(true); return; }
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload  = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export function PayRideDialog({ ride, onClose }: Props) {
  const initiate = useInitiatePayment();
  const confirm  = useConfirmPayment();
  const [paid, setPaid]         = useState(false);
  const [initData, setInitData] = useState<PaymentInitResult | null>(null);

  // Use values from initiate response once available (includes fine deduction calc)
  const driverFare      = initData?.driverFare      ?? ride?.price         ?? 0;
  const escortFee        = initData?.escortFee       ?? ride?.escortCharge  ?? 0;
  const platformFee      = initData?.platformFee     ?? ride?.platformFee   ?? 20;
  const cancellationFee  = initData?.cancellationFee  ?? 0;
  const totalAmount      = initData?.totalAmount      ?? ride?.totalAmount  ?? (driverFare + escortFee + platformFee + cancellationFee);
  const fineDeduction    = initData?.fineDeduction    ?? 0;
  const driverReceives   = initData?.driverReceives   ?? (driverFare + escortFee);

  const handlePay = async () => {
    if (!ride) return;
    initiate.mutate(ride.id, {
      onSuccess: async (data) => {
        setInitData(data);
        if (data.isMock) {
          confirm.mutate(
            { rideId: ride.id, razorpayPaymentId: `pay_mock_${Date.now()}` },
            {
              onSuccess: () => setPaid(true),
              onError:   (e: any) => toast.error(e?.message ?? "Confirmation failed"),
            },
          );
          return;
        }
        const loaded = await loadRazorpay();
        if (!loaded) { toast.error("Could not load payment gateway"); return; }
        const rzp = new window.Razorpay({
          key:         data.keyId,
          amount:      data.amount,
          currency:    data.currency,
          order_id:    data.orderId,
          name:        "RideOps",
          description: `Ride payment · ${data.driverName}`,
          theme:       { color: "#D4AF37" },
          prefill:     {},
          notes:       { rideId: ride.id },
          handler: (resp: { razorpay_payment_id: string; razorpay_signature: string }) => {
            confirm.mutate(
              { rideId: ride.id, razorpayPaymentId: resp.razorpay_payment_id, razorpaySignature: resp.razorpay_signature },
              {
                onSuccess: () => setPaid(true),
                onError:   (e: any) => toast.error(e?.message ?? "Confirmation failed"),
              },
            );
          },
        });
        rzp.open();
      },
      onError: (e: any) => toast.error(e?.message ?? "Could not initiate payment"),
    });
  };

  const handleClose = () => { setPaid(false); setInitData(null); onClose(); };

  return (
    <Dialog open={!!ride} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-sm w-[calc(100vw-2rem)] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <IndianRupee className="h-4 w-4 text-gold" />
            Pay driver
          </DialogTitle>
        </DialogHeader>

        {ride && (
          <div className="space-y-3 w-full min-w-0">
            {paid ? (
              /* ── Success ────────────────────────────────────────────────── */
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <div className="h-14 w-14 rounded-full bg-success/10 flex items-center justify-center">
                  <CheckCircle2 className="h-7 w-7 text-success" />
                </div>
                <div>
                  <div className="font-bold">Payment successful</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    ₹{driverReceives.toLocaleString()} is on its way to {ride.driver?.fullName}
                  </div>
                </div>
                <Button className="w-full mt-2" onClick={handleClose}>Done</Button>
              </div>
            ) : (
              <>
                {/* ── Ride summary ─────────────────────────────────────────── */}
                <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider shrink-0">Ride</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{ride.id.slice(-8).toUpperCase()}</span>
                  </div>
                  <div className="font-medium text-sm leading-snug line-clamp-2">{ride.pickupAddress}</div>
                  <div className="text-xs text-muted-foreground line-clamp-1">→ {ride.dropAddress}</div>
                  {ride.completedAt && (
                    <div className="text-[11px] text-muted-foreground">
                      Completed {format(new Date(ride.completedAt), "dd MMM, HH:mm")}
                    </div>
                  )}
                </div>

                {/* ── Driver ───────────────────────────────────────────────── */}
                {ride.driver && (
                  <div className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-foreground text-background flex items-center justify-center font-bold text-sm shrink-0">
                      {ride.driver.fullName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{ride.driver.fullName}</div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Car className="h-3 w-3 shrink-0" />
                        {ride.driver.bankDetail?.upiId || ride.driver.bankDetail?.accountNo
                          ? <span className="text-success">Bank details on file</span>
                          : <span className="text-warning">No bank details — driver needs to add UPI/bank</span>
                        }
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Payment breakdown ────────────────────────────────────── */}
                <div className="rounded-xl border-2 border-gold/30 bg-gold/5 p-3 space-y-2.5 w-full">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Payment breakdown
                  </div>
                  <div className="space-y-1.5 text-sm w-full">
                    <div className="flex items-center justify-between gap-4 w-full">
                      <span className="text-muted-foreground shrink-0">Driver fare</span>
                      <span className="font-semibold">₹{driverFare.toLocaleString()}</span>
                    </div>
                    {escortFee > 0 && (
                      <div className="flex items-center justify-between gap-4 rounded bg-amber-50 border border-amber-200 px-2 py-1 text-amber-700 text-xs w-full">
                        <span className="shrink-0">Escort charge (50%)</span>
                        <span className="font-semibold">+₹{escortFee.toLocaleString()}</span>
                      </div>
                    )}
                    {fineDeduction > 0 && (
                      <div className="flex items-center justify-between gap-4 rounded bg-warning/10 border border-warning/20 px-2 py-1 text-warning text-xs w-full">
                        <span className="shrink-0">Fine recovery</span>
                        <span className="font-semibold">-₹{fineDeduction.toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-4 text-muted-foreground w-full">
                      <span className="shrink-0">Platform fee</span>
                      <span>₹{platformFee.toLocaleString()}</span>
                    </div>
                    {cancellationFee > 0 && (
                      <div className="flex items-center justify-between gap-4 rounded bg-warning/10 border border-warning/20 px-2 py-1 text-warning text-xs w-full">
                        <span className="shrink-0">Cancellation penalty (previous ride)</span>
                        <span className="font-semibold">+₹{cancellationFee.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between gap-4 w-full">
                    <span className="font-bold text-sm shrink-0">Total charged to you</span>
                    <span className="text-xl font-bold flex items-center gap-0.5 shrink-0">
                      <IndianRupee className="h-4 w-4" />{totalAmount.toLocaleString()}
                    </span>
                  </div>
                  <div className="rounded-md bg-success/10 border border-success/20 px-2.5 py-1.5 text-xs text-success flex items-center gap-1.5 w-full">
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                    <span>
                      Driver receives ₹{driverReceives.toLocaleString()}
                      {fineDeduction > 0 && <span className="text-warning ml-1">· ₹{fineDeduction} fine deducted</span>}
                    </span>
                  </div>
                </div>

                {/* ── Pay via ──────────────────────────────────────────────── */}
                <div className="grid grid-cols-3 gap-1.5 w-full">
                  {[
                    { icon: <Smartphone className="h-3.5 w-3.5" />, label: "UPI",         note: "Free",        green: true },
                    { icon: <CreditCard className="h-3.5 w-3.5" />,  label: "Card",        note: "~2% extra",   green: false },
                    { icon: <Building2  className="h-3.5 w-3.5" />,  label: "Net banking", note: "~1.5% extra", green: false },
                  ].map((m) => (
                    <div key={m.label} className="flex flex-col items-center gap-0.5 rounded-md border p-2 text-center">
                      <div className="text-muted-foreground">{m.icon}</div>
                      <div className="text-[11px] font-medium">{m.label}</div>
                      <div className={`text-[10px] ${m.green ? "text-success font-semibold" : "text-muted-foreground"}`}>{m.note}</div>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-muted-foreground flex items-start gap-1">
                  <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                  Card/netbanking fees are charged on top by Razorpay. Use UPI to avoid extra charges.
                </div>

                <Button
                  className="w-full bg-gold text-gold-foreground hover:bg-gold/90 h-11 text-sm font-semibold"
                  onClick={handlePay}
                  disabled={initiate.isPending || confirm.isPending}
                >
                  {initiate.isPending || confirm.isPending
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</>
                    : <><IndianRupee className="h-4 w-4" /> Pay ₹{totalAmount.toLocaleString()} now</>
                  }
                </Button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
