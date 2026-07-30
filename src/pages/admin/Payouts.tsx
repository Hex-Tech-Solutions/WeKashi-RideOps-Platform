import { useState } from "react";
import { PageHeader, StatCard } from "@/components/RoleLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { usePayouts, useCreatePayout, useMarkPayoutPaid, useAttachPayoutFile, useVendors, useVendorRideCount, type PayoutRow } from "@/lib/queries";
import { Plus, Loader2, Paperclip, FileText } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

export default function Payouts() {
  const { data, isLoading } = usePayouts();
  const { data: vendorsData } = useVendors();
  const createPayout = useCreatePayout();
  const markPaid = useMarkPayoutPaid();

  const payouts = data?.payouts ?? [];
  const vendors = vendorsData?.vendors ?? [];
  const pendingTotal = payouts.filter((p) => p.status === "pending").reduce((s, p) => s + p.amount, 0);
  const paidTotal = payouts.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);

  const attachFile = useAttachPayoutFile();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ vendorId: "", period: new Date().toISOString().slice(0, 7), perRide: "" });

  // Period-scoped completed rides — the count for THIS month, not all-time.
  const { data: rideCount } = useVendorRideCount(form.vendorId || null, form.period);
  const completedRides = rideCount?.rides ?? 0;
  const perRide = Number(form.perRide) || 0;
  const amount = perRide * completedRides;

  const submit = () => {
    if (!form.vendorId || !/^\d{4}-\d{2}$/.test(form.period)) { toast.error("Pick a vendor and period (YYYY-MM)"); return; }
    if (!(perRide > 0)) { toast.error("Enter a pay-per-ride amount"); return; }
    createPayout.mutate({ vendorId: form.vendorId, period: form.period, ratePerRide: perRide }, {
      onSuccess: () => { toast.success(`Payout created at ₹${perRide}/ride`); setOpen(false); setForm({ ...form, perRide: "" }); },
      onError: (e: any) => toast.error(e?.message ?? "Failed"),
    });
  };

  return (
    <div>
      <PageHeader title="Vendor Payouts" description="Settle vendors by pay-per-ride × completed rides."
        actions={<Button className="bg-foreground text-background hover:bg-foreground/90" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New payout</Button>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Pending payouts" value={`₹${(pendingTotal / 1000).toFixed(1)}k`} accent />
        <StatCard label="Paid total" value={`₹${(paidTotal / 1000).toFixed(1)}k`} />
        <StatCard label="Vendors" value={vendors.length} />
        <StatCard label="Payout records" value={payouts.length} />
      </div>
      <Card className="shadow-card">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground border-b bg-muted/40">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Vendor</th>
                  <th className="text-left font-medium px-6 py-3">Period</th>
                  <th className="text-right font-medium px-6 py-3">Amount</th>
                  <th className="text-left font-medium px-6 py-3">File</th>
                  <th className="text-left font-medium px-6 py-3">Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {payouts.length === 0 && (
                  <tr><td colSpan={6} className="px-6 py-10 text-center text-muted-foreground">No payouts yet — create one.</td></tr>
                )}
                {payouts.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-6 py-3 font-medium">{p.vendor?.name ?? p.vendorId.slice(0, 8)}</td>
                    <td className="px-6 py-3">{p.period}</td>
                    <td className="px-6 py-3 text-right">
                      <div className="font-bold">₹{p.amount.toLocaleString()}</div>
                      {p.ratePerRide != null && (
                        <div className="text-[11px] text-muted-foreground">
                          ₹{p.ratePerRide}/ride × {p.rideCount ?? Math.round(p.amount / p.ratePerRide)}{p.status === "pending" ? " · live" : ""}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <PayoutFileCell payout={p} />
                    </td>
                    <td className="px-6 py-3">
                      <Badge variant="outline" className={p.status === "paid" ? "border-success/40 text-success" : "border-warning/40 text-warning"}>{p.status}</Badge>
                    </td>
                    <td className="px-6 py-3 text-right">
                      {p.status === "pending" && (
                        <Button size="sm" className="bg-foreground text-background hover:bg-foreground/90" disabled={markPaid.isPending}
                          onClick={() => markPaid.mutate(p.id, { onSuccess: () => toast.success("Marked paid"), onError: (e: any) => toast.error(e?.message ?? "Failed") })}>
                          Mark paid
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New payout</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 gap-3 py-2">
            <div>
              <Label>Vendor</Label>
              <Select value={form.vendorId} onValueChange={(v) => setForm({ ...form, vendorId: v })}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select vendor" /></SelectTrigger>
                <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Period (YYYY-MM)</Label><Input className="mt-1" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} placeholder="2026-07" /></div>
            <div><Label>Pay per ride (₹)</Label><Input type="number" className="mt-1" value={form.perRide} onChange={(e) => setForm({ ...form, perRide: e.target.value })} placeholder="e.g. 200" /></div>

            {form.vendorId && (
              <div className="rounded-md bg-secondary p-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Completed rides · {form.period}</span><span className="font-medium">{completedRides}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Pay per ride</span><span className="font-medium">₹{perRide.toLocaleString()}</span></div>
                <div className="flex justify-between border-t pt-1.5 text-base"><span className="font-semibold">Total (now)</span><span className="font-bold">₹{amount.toLocaleString()}</span></div>
                <div className="text-[11px] text-muted-foreground pt-1">Stays at ₹{perRide || "—"}/ride — the total auto-updates as more rides complete this month, and locks in when you mark it paid.</div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="bg-foreground text-background hover:bg-foreground/90" onClick={submit} disabled={createPayout.isPending}>{createPayout.isPending ? "Creating…" : `Create payout · ₹${amount.toLocaleString()}`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Per-row invoice/proof: admin uploads (or replaces) the file manually.
function PayoutFileCell({ payout }: { payout: PayoutRow }) {
  const attach = useAttachPayoutFile();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const onPick = (file: File | undefined) => {
    if (!file) return;
    attach.mutate({ id: payout.id, file }, {
      onSuccess: () => toast.success("File attached"),
      onError: (e: any) => toast.error(e?.message ?? "Upload failed"),
    });
  };

  return (
    <div className="flex items-center gap-2">
      {payout.fileUrl && (
        <a href={payout.fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-gold hover:underline text-xs"><FileText className="h-3.5 w-3.5" /> View</a>
      )}
      <input ref={inputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ""; }} />
      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={attach.isPending} onClick={() => inputRef.current?.click()}>
        {attach.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
        {payout.fileUrl ? "Replace" : "Upload"}
      </Button>
    </div>
  );
}
