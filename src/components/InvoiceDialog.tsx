/**
 * GST tax invoice for a credit-pack purchase (#5). Used by the driver app
 * (Purchase history) and the admin purchases list. `path` is the API path of
 * the invoice; null closes the dialog.
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useInvoice } from "@/lib/queries";
import { Loader2, Printer } from "lucide-react";
import { format } from "date-fns";

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function InvoiceDialog({ path, onClose, canPrint = true }: { path: string | null; onClose: () => void; canPrint?: boolean }) {
  const { data: inv, isLoading, error } = useInvoice(path);

  return (
    <Dialog open={!!path} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto print:max-w-none print:shadow-none">
        <DialogHeader><DialogTitle>Tax invoice</DialogTitle></DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
        ) : error || !inv ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {(error as any)?.message ?? "Invoice not available. Purchases made before GST was added have no invoice."}
          </p>
        ) : (
          <div id="invoice-print" className="text-xs space-y-4">
            <div className="flex justify-between gap-4">
              <div>
                <div className="font-bold text-sm">{inv.seller.legalName}</div>
                {inv.seller.address && <div className="text-muted-foreground whitespace-pre-line">{inv.seller.address}</div>}
                <div>GSTIN: <span className="font-mono">{inv.seller.gstin}</span></div>
                <div>State: {inv.seller.state} ({inv.seller.stateCode})</div>
              </div>
              <div className="text-right">
                <div className="font-semibold">TAX INVOICE</div>
                <div>No: <span className="font-mono">{inv.invoiceNo}</span></div>
                <div>Date: {format(new Date(inv.invoiceDate), "dd MMM yyyy")}</div>
              </div>
            </div>

            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Billed to</div>
              <div className="font-medium">{inv.buyer.name}</div>
              <div>{inv.buyer.phone}</div>
              <div>Place of supply: {inv.placeOfSupply}</div>
            </div>

            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1.5 font-medium">Description</th>
                  {inv.item.sac && <th className="py-1.5 font-medium">SAC</th>}
                  <th className="py-1.5 font-medium text-right">Qty</th>
                  <th className="py-1.5 font-medium text-right">Taxable value</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="py-1.5">{inv.item.description}</td>
                  {inv.item.sac && <td className="py-1.5 font-mono">{inv.item.sac}</td>}
                  <td className="py-1.5 text-right">{inv.item.quantity}</td>
                  <td className="py-1.5 text-right">{inr(inv.amounts.taxable)}</td>
                </tr>
              </tbody>
            </table>

            <div className="ml-auto w-56 space-y-1">
              <Row label="Taxable value" value={inr(inv.amounts.taxable)} />
              <Row label={`CGST @ ${inv.amounts.cgstRate}%`} value={inr(inv.amounts.cgst)} />
              <Row label={`SGST @ ${inv.amounts.sgstRate}%`} value={inr(inv.amounts.sgst)} />
              <div className="border-t pt-1"><Row label="Total" value={inr(inv.amounts.total)} bold /></div>
            </div>
            <div className="italic">{inv.amountInWords}</div>

            <div className="text-muted-foreground border-t pt-2 space-y-0.5">
              <div>Paid online · Order {inv.payment.gatewayOrderId}{inv.payment.gatewayPaymentId ? ` · Payment ${inv.payment.gatewayPaymentId}` : ""}</div>
              <div>This is a computer-generated invoice and needs no signature.</div>
            </div>

            {canPrint && (
              <Button variant="outline" size="sm" className="print:hidden" onClick={() => window.print()}>
                <Printer className="h-3.5 w-3.5" /> Print / save as PDF
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold text-sm" : ""}`}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}
