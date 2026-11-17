/**
 * Admin: successful credit-pack purchases (#15) with GST split (#5).
 * Periods are in IST: this week (from Monday), this month, this year
 * (calendar), or a custom date range. Totals row + CSV export + invoices.
 */
import { useMemo, useState } from "react";
import { PageHeader, StatCard } from "@/components/RoleLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePackSales, type PackSaleRow } from "@/lib/queries";
import { InvoiceDialog } from "@/components/InvoiceDialog";
import { Download, IndianRupee, Loader2, Receipt, Ticket } from "lucide-react";
import { format } from "date-fns";

type Period = "week" | "month" | "year" | "custom";

const IST = "+05:30";

/** Today's date in IST as YYYY-MM-DD. */
function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/** Start of the period in IST, as a YYYY-MM-DD date. */
function periodStart(p: Exclude<Period, "custom">): string {
  const today = istToday();
  const [y, m, d] = today.split("-").map(Number);
  if (p === "year") return `${y}-01-01`;
  if (p === "month") return `${y}-${String(m).padStart(2, "0")}-01`;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const back = (dt.getUTCDay() + 6) % 7; // days since Monday
  dt.setUTCDate(dt.getUTCDate() - back);
  return dt.toISOString().slice(0, 10);
}

/** IST day boundaries -> UTC ISO strings for the API. */
const startIso = (day: string) => new Date(`${day}T00:00:00${IST}`).toISOString();
const endIso = (day: string) => new Date(`${day}T23:59:59.999${IST}`).toISOString();

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const istTime = (iso: string) => format(new Date(iso), "dd MMM yyyy, h:mm a");

function toCsv(rows: PackSaleRow[], totals: { base: number; gst: number; total: number; credits: number }): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    // Quote, and neutralise spreadsheet formulas from user-entered names.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const header = ["Paid at", "Invoice no", "Driver", "Phone", "Vendor", "Credits", "Base (₹)", "GST (₹)", "Total (₹)", "Order id", "Payment id"];
  const lines = rows.map((r) => [
    r.paidAt ? istTime(r.paidAt) : "", r.invoiceNo ?? "", r.driverName ?? "", r.driverPhone ?? "", r.vendorName ?? "",
    r.credits, r.baseAmount.toFixed(2), r.gstAmount.toFixed(2), r.amount.toFixed(2), r.gatewayOrderId, r.gatewayPaymentId ?? "",
  ].map(esc).join(","));
  lines.push(["Total", "", "", "", "", totals.credits, totals.base.toFixed(2), totals.gst.toFixed(2), totals.total.toFixed(2), "", ""].map(esc).join(","));
  return [header.map(esc).join(","), ...lines].join("\n");
}

export default function PackSales() {
  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState(periodStart("month"));
  const [customTo, setCustomTo] = useState(istToday());
  const [invoiceFor, setInvoiceFor] = useState<string | null>(null);

  const range = useMemo(() => {
    if (period === "custom") {
      if (!customFrom || !customTo || customFrom > customTo) return null;
      return { from: startIso(customFrom), to: endIso(customTo), label: `${customFrom} to ${customTo}` };
    }
    const from = periodStart(period);
    return { from: startIso(from), to: endIso(istToday()), label: `${from} to ${istToday()}` };
  }, [period, customFrom, customTo]);

  const { data, isLoading } = usePackSales(range?.from, range?.to);
  const rows = data?.rows ?? [];
  const agg = data?.aggregates;

  const downloadCsv = () => {
    if (!agg) return;
    const csv = toCsv(rows, { base: agg.totalBase, gst: agg.totalGst, total: agg.totalRevenue, credits: agg.totalCredits });
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `credit-pack-sales_${range?.label.replace(/ /g, "_") ?? "all"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="Credit Pack Sales"
        description="Successful ride-credit pack purchases. Dates are in IST."
        actions={
          <Button variant="outline" onClick={downloadCsv} disabled={!rows.length}>
            <Download className="h-4 w-4" /> Download CSV
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-4 mb-6">
        <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <TabsList>
            <TabsTrigger value="week">This week</TabsTrigger>
            <TabsTrigger value="month">This month</TabsTrigger>
            <TabsTrigger value="year">This year</TabsTrigger>
            <TabsTrigger value="custom">Custom</TabsTrigger>
          </TabsList>
        </Tabs>
        {period === "custom" && (
          <div className="flex items-end gap-2">
            <div>
              <Label htmlFor="sales-from" className="text-xs">From</Label>
              <Input id="sales-from" type="date" className="mt-1 h-9" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="sales-to" className="text-xs">To</Label>
              <Input id="sales-to" type="date" className="mt-1 h-9" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          </div>
        )}
      </div>

      {!range ? (
        <p className="text-sm text-destructive">Pick a valid date range (From must be on or before To).</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="Packs sold" value={agg?.packCount ?? 0} icon={Receipt} />
            <StatCard label="Credits sold" value={agg?.totalCredits ?? 0} icon={Ticket} />
            <StatCard label="Base amount" value={inr(agg?.totalBase ?? 0)} icon={IndianRupee} />
            <StatCard label="GST collected" value={inr(agg?.totalGst ?? 0)} hint={`Total collected ${inr(agg?.totalRevenue ?? 0)}`} icon={IndianRupee} accent />
          </div>

          <Card className="shadow-card">
            <CardContent className="p-0 overflow-x-auto">
              {isLoading ? (
                <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
              ) : rows.length === 0 ? (
                <div className="py-16 text-center text-sm text-muted-foreground">No purchases in this period.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-secondary/60 text-xs text-muted-foreground">
                    <tr>
                      <th className="text-left font-medium px-4 py-3">Paid at</th>
                      <th className="text-left font-medium px-4 py-3">Driver</th>
                      <th className="text-left font-medium px-4 py-3">Vendor</th>
                      <th className="text-right font-medium px-4 py-3">Credits</th>
                      <th className="text-right font-medium px-4 py-3">Base</th>
                      <th className="text-right font-medium px-4 py-3">GST</th>
                      <th className="text-right font-medium px-4 py-3">Total</th>
                      <th className="text-left font-medium px-4 py-3">Invoice</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="px-4 py-2.5 whitespace-nowrap">{r.paidAt ? istTime(r.paidAt) : "—"}</td>
                        <td className="px-4 py-2.5">
                          <div className="font-medium">{r.driverName ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{r.driverPhone}</div>
                        </td>
                        <td className="px-4 py-2.5">{r.vendorName ?? "—"}</td>
                        <td className="px-4 py-2.5 text-right">{r.credits}</td>
                        <td className="px-4 py-2.5 text-right">{inr(r.baseAmount)}</td>
                        <td className="px-4 py-2.5 text-right">{inr(r.gstAmount)}</td>
                        <td className="px-4 py-2.5 text-right font-medium">{inr(r.amount)}</td>
                        <td className="px-4 py-2.5">
                          {r.invoiceNo ? (
                            <button type="button" className="font-mono text-xs text-gold-dark hover:underline" onClick={() => setInvoiceFor(r.id)}>
                              {r.invoiceNo}
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Pre-GST</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 bg-secondary/40 font-semibold">
                    <tr>
                      <td className="px-4 py-3" colSpan={3}>Total · {agg?.packCount} packs</td>
                      <td className="px-4 py-3 text-right">{agg?.totalCredits}</td>
                      <td className="px-4 py-3 text-right">{inr(agg?.totalBase ?? 0)}</td>
                      <td className="px-4 py-3 text-right">{inr(agg?.totalGst ?? 0)}</td>
                      <td className="px-4 py-3 text-right">{inr(agg?.totalRevenue ?? 0)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <InvoiceDialog path={invoiceFor ? `/admin/pack-sales/${invoiceFor}/invoice` : null} onClose={() => setInvoiceFor(null)} />
    </div>
  );
}
