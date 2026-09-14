/**
 * DriverCredits — ride-credit balance + pack purchase.
 *
 * Shows total available credits, each active pack's remaining count and expiry,
 * and the three-pack catalog with a Buy button that opens Razorpay Checkout.
 * A driver needs at least one credit to receive ride broadcasts.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  useDriverCredits,
  usePackCatalog,
  useCreatePackOrder,
  useVerifyPackPayment,
  type PackDefinition,
} from "@/lib/queries";
import { Ticket, IndianRupee, Loader2, CheckCircle2, CalendarClock } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

declare global {
  interface Window { Razorpay: any }
}

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) { resolve(true); return; }
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export function DriverCredits() {
  const { data: creditsData } = useDriverCredits();
  const { data: catalogData } = usePackCatalog();
  const createOrder = useCreatePackOrder();
  const verify = useVerifyPackPayment();
  const [buying, setBuying] = useState<string | null>(null);

  const available = creditsData?.available ?? 0;
  const packs = creditsData?.packs ?? [];
  const activePacks = packs.filter((p) => p.status === "active" && p.creditsRemaining > 0);
  const catalog = catalogData?.packs ?? [];

  const buy = async (pack: PackDefinition) => {
    setBuying(pack.key);
    try {
      const order = await createOrder.mutateAsync(pack.key);
      const loaded = await loadRazorpay();
      if (!loaded) { toast.error("Could not load payment gateway"); return; }

      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "WeKashi RideOps",
        description: `${pack.credits} ride credits`,
        order_id: order.orderId,
        prefill: {},
        handler: (resp: { razorpay_payment_id: string; razorpay_signature: string }) => {
          verify.mutate(
            { orderId: order.orderId, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature },
            {
              onSuccess: (r) => toast.success(`${r.credits} credits added`),
              onError: (e: any) => toast.error(e?.message ?? "Could not verify payment"),
            },
          );
        },
      });
      rzp.open();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not start purchase");
    } finally {
      setBuying(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Ticket className="h-4 w-4 text-gold" /> Ride Credits
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Balance */}
        <div className="rounded-xl border-2 border-gold/30 bg-gold/5 p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Available credits</div>
          <div className="text-4xl font-bold">{available}</div>
          {available === 0 && (
            <div className="text-[11px] text-destructive mt-1">
              0 credits — buy a pack to start receiving ride broadcasts.
            </div>
          )}
        </div>

        {/* Active packs */}
        {activePacks.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Active packs ({activePacks.length})
            </div>
            {activePacks.map((p) => (
              <div key={p.id} className="flex items-center gap-3 p-3 rounded-lg border text-xs">
                <div className="h-8 w-8 rounded-full bg-success/10 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">
                    {p.creditsRemaining} / {p.creditsTotal} credits left
                    {p.source === "joining_bonus" && <span className="ml-1 text-gold">· bonus</span>}
                  </div>
                  <div className="text-muted-foreground flex items-center gap-1 mt-0.5">
                    <CalendarClock className="h-3 w-3" />
                    Expires {format(new Date(p.expiresAt), "dd MMM yyyy")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <Separator />

        {/* Catalog */}
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Buy a pack</div>
          <div className="grid grid-cols-1 gap-2">
            {catalog.map((pack) => (
              <div key={pack.key} className="flex items-center gap-3 p-3 rounded-lg border">
                <div className="flex-1">
                  <div className="font-semibold text-sm">{pack.credits} ride credits</div>
                  <div className="text-[11px] text-muted-foreground">Valid {pack.validityDays} days</div>
                </div>
                <div className="text-right">
                  <div className="font-bold flex items-center gap-0.5 justify-end">
                    <IndianRupee className="h-3.5 w-3.5" />{pack.price}
                  </div>
                </div>
                <Button
                  size="sm"
                  className="bg-gold text-gold-foreground hover:bg-gold/90 shrink-0"
                  onClick={() => buy(pack)}
                  disabled={buying === pack.key || createOrder.isPending}
                >
                  {buying === pack.key
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> …</>
                    : "Buy"}
                </Button>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            One credit is used each time you complete a ride. Credits closest to expiring are used first.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default DriverCredits;
