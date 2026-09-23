/**
 * DriverUpiCard — save a payable UPI ID.
 *
 * The supervisor pays the driver directly by scanning a UPI QR after a ride, so
 * the driver must register a UPI ID. The payer's UPI app confirms the real
 * account-holder name at scan time.
 */
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDriverMe, useSaveDriverUpi } from "@/lib/queries";
import { BadgeCheck, Loader2, Check, IndianRupee } from "lucide-react";
import { toast } from "sonner";

export function DriverUpiCard() {
  const { data: me } = useDriverMe();
  const save = useSaveDriverUpi();
  const [vpa, setVpa] = useState("");

  useEffect(() => {
    if (me?.upiVpa) setVpa(me.upiVpa);
  }, [me?.upiVpa]);

  const submit = () => {
    const v = vpa.trim();
    if (!v) { toast.error("Enter your UPI ID"); return; }
    save.mutate(v, {
      onSuccess: () => toast.success("UPI ID saved"),
      onError: (e: any) => toast.error(e?.message ?? "Could not save UPI ID"),
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <IndianRupee className="h-4 w-4 text-gold" /> Payout UPI
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Supervisors pay you directly by scanning your UPI QR after a ride. Add your UPI ID here.
        </p>

        {me?.upiVerified && me?.upiVpa && (
          <div className="rounded-md bg-success/10 border border-success/30 px-3 py-2 flex items-center gap-2">
            <BadgeCheck className="h-4 w-4 text-success shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-mono truncate">{me.upiVpa}</div>
              <div className="text-[11px] text-muted-foreground">Saved · payable</div>
            </div>
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-xs">UPI ID</Label>
          <Input
            value={vpa}
            onChange={(e) => setVpa(e.target.value)}
            placeholder="name@bank or 9876543210@ybl"
            className="h-9 font-mono text-sm"
          />
        </div>
        <Button
          className="w-full bg-foreground text-background hover:bg-foreground/90"
          onClick={submit}
          disabled={save.isPending}
        >
          {save.isPending
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
            : <><Check className="h-3.5 w-3.5" /> Save UPI ID</>}
        </Button>
      </CardContent>
    </Card>
  );
}

export default DriverUpiCard;
