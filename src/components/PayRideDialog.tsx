import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { QRCodeSVG } from "qrcode.react";
import { useRidePayQr, type PendingPaymentRide } from "@/lib/queries";
import {
  IndianRupee, CheckCircle2, Loader2, AlertCircle, Smartphone, Car,
} from "lucide-react";
import { format } from "date-fns";

interface Props {
  ride: PendingPaymentRide | null;
  onClose: () => void;
}

/**
 * PayRideDialog — direct supervisor → driver payment.
 *
 * The supervisor scans the driver's UPI QR to pay the fare + escort directly.
 * This settlement happens outside the platform (untracked). "Mark as paid" is
 * local bookkeeping only. If the driver hasn't added a verified UPI ID, the
 * pay-QR endpoint returns 409 and we show a clear message instead.
 */
export function PayRideDialog({ ride, onClose }: Props) {
  const { data: qr, isLoading, error } = useRidePayQr(ride?.id);
  const [markedPaid, setMarkedPaid] = useState(false);

  const amount = qr?.amount ?? ride?.amount ?? ((ride?.price ?? 0) + (ride?.escortCharge ?? 0));
  const noUpi = !!error; // 409 when driver has no verified UPI

  const handleClose = () => { setMarkedPaid(false); onClose(); };

  return (
    <Dialog open={!!ride} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-sm w-[calc(100vw-2rem)] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <IndianRupee className="h-4 w-4 text-gold" />
            Pay driver directly
          </DialogTitle>
        </DialogHeader>

        {ride && (
          <div className="space-y-3 w-full min-w-0">
            {markedPaid ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <div className="h-14 w-14 rounded-full bg-success/10 flex items-center justify-center">
                  <CheckCircle2 className="h-7 w-7 text-success" />
                </div>
                <div>
                  <div className="font-bold">Marked as paid</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    You settled ₹{amount.toLocaleString()} with {ride.driver?.fullName} directly.
                  </div>
                </div>
                <Button className="w-full mt-2" onClick={handleClose}>Done</Button>
              </div>
            ) : (
              <>
                {/* Ride summary */}
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

                {/* Driver */}
                {ride.driver && (
                  <div className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-foreground text-background flex items-center justify-center font-bold text-sm shrink-0">
                      {ride.driver.fullName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{ride.driver.fullName}</div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Car className="h-3 w-3 shrink-0" />
                        {ride.driver.upiVerified
                          ? <span className="text-success">UPI on file</span>
                          : <span className="text-warning">No payable UPI yet</span>}
                      </div>
                    </div>
                  </div>
                )}

                {isLoading && (
                  <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" /> Loading QR…
                  </div>
                )}

                {noUpi && (
                  <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      {ride.driver?.fullName ?? "The driver"} hasn't added a payable UPI ID yet. Ask them to add
                      one in the driver app under Ride Credits · Payout UPI, then try again.
                    </span>
                  </div>
                )}

                {qr && !isLoading && (
                  <>
                    <div className="rounded-xl border-2 border-gold/30 bg-gold/5 p-4 flex flex-col items-center gap-3">
                      <div className="bg-white p-3 rounded-lg">
                        <QRCodeSVG value={qr.upiIntent} size={180} includeMargin={false} />
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-muted-foreground uppercase tracking-wider">Pay to</div>
                        <div className="font-semibold">{qr.payeeName}</div>
                        <div className="text-2xl font-bold flex items-center justify-center gap-0.5 mt-1">
                          <IndianRupee className="h-5 w-5" />{qr.amount.toLocaleString()}
                        </div>
                      </div>
                    </div>

                    <div className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                      <Smartphone className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      Scan with any UPI app (GPay, PhonePe, Paytm) to pay the driver directly. This payment is
                      settled between you and the driver.
                    </div>

                    <Separator />

                    <Button
                      className="w-full bg-gold text-gold-foreground hover:bg-gold/90 h-11 text-sm font-semibold"
                      onClick={() => setMarkedPaid(true)}
                    >
                      <CheckCircle2 className="h-4 w-4" /> Mark as paid
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
