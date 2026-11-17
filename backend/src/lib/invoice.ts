/**
 * GST tax invoices for credit-pack purchases (#5).
 *
 * Seller: Shreeya Tours and Travels, GSTIN 29GVBPP3987H1ZU (Karnataka, state
 * code 29). Drivers are unregistered (B2C) buyers in Karnataka, so the supply
 * is intra-state: CGST 9% + SGST 9%.
 *
 * Optional env (printed on the invoice when set; ask the accountant):
 *   INVOICE_SELLER_ADDRESS  registered business address
 *   INVOICE_SAC_CODE        SAC code for the service
 *   INVOICE_PREFIX          invoice number prefix (default 'WKC')
 */
import { Prisma } from '@prisma/client';
import { gstBreakdown, GST_RATE_PERCENT } from './creditPacks';

export const SELLER = {
  legalName: 'Shreeya Tours and Travels',
  gstin: '29GVBPP3987H1ZU',
  state: 'Karnataka',
  stateCode: '29',
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Indian financial year code for a date, e.g. 2026-11-14 -> '2627' (FY 2026-27, April–March, IST). */
export function financialYearCode(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1; // April = month 3
  return `${String(start).slice(2)}${String(start + 1).slice(2)}`;
}

/** Invoice number, max 16 characters as GST rules require: WKC/2627/000001. */
export function formatInvoiceNo(fy: string, seq: number, prefix = process.env.INVOICE_PREFIX || 'WKC'): string {
  return `${prefix.slice(0, 4)}/${fy}/${String(seq).padStart(6, '0')}`;
}

/** Allocate the next consecutive invoice number. Run inside the activation transaction. */
export async function nextInvoiceNo(tx: Prisma.TransactionClient, at: Date): Promise<string> {
  const fy = financialYearCode(at);
  const rows = await tx.$queryRaw<Array<{ last: number }>>`
    INSERT INTO invoice_counters (fy, last) VALUES (${fy}, 1)
    ON CONFLICT (fy) DO UPDATE SET last = invoice_counters.last + 1
    RETURNING last
  `;
  return formatInvoiceNo(fy, rows[0].last);
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function words(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' + words(n % 100) : ''}`;
  if (n < 100000) return `${words(Math.floor(n / 1000))} Thousand${n % 1000 ? ' ' + words(n % 1000) : ''}`;
  return `${words(Math.floor(n / 100000))} Lakh${n % 100000 ? ' ' + words(n % 100000) : ''}`;
}

/** "Rupees One Hundred Eighty Seven and Sixty Two Paise Only". */
export function amountInWords(rupees: number): string {
  const paise = Math.round(rupees * 100);
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  return `Rupees ${r === 0 ? 'Zero' : words(r)}${p ? ` and ${words(p)} Paise` : ''} Only`;
}

export interface InvoiceView {
  invoiceNo: string;
  invoiceDate: Date;
  seller: typeof SELLER & { address: string | null };
  buyer: { name: string; phone: string; state: string };
  placeOfSupply: string;
  item: { description: string; sac: string | null; quantity: number; credits: number };
  amounts: { taxable: number; cgstRate: number; cgst: number; sgstRate: number; sgst: number; total: number };
  amountInWords: string;
  payment: { gatewayOrderId: string; gatewayPaymentId: string | null };
}

export function buildInvoice(order: {
  invoiceNo: string; invoiceDate: Date; baseAmount: number; credits: number;
  gatewayOrderId: string; gatewayPaymentId: string | null;
  driver: { fullName: string; phone: string };
}): InvoiceView {
  const g = gstBreakdown(order.baseAmount);
  const half = GST_RATE_PERCENT / 2;
  return {
    invoiceNo: order.invoiceNo,
    invoiceDate: order.invoiceDate,
    seller: { ...SELLER, address: process.env.INVOICE_SELLER_ADDRESS?.trim() || null },
    buyer: { name: order.driver.fullName, phone: order.driver.phone, state: 'Karnataka (29)' },
    placeOfSupply: 'Karnataka (29)',
    item: {
      description: `Ride credit pack — ${order.credits} credits (valid 365 days)`,
      sac: process.env.INVOICE_SAC_CODE?.trim() || null,
      quantity: 1,
      credits: order.credits,
    },
    amounts: { taxable: g.base, cgstRate: half, cgst: g.cgst, sgstRate: half, sgst: g.sgst, total: g.total },
    amountInWords: amountInWords(g.total),
    payment: { gatewayOrderId: order.gatewayOrderId, gatewayPaymentId: order.gatewayPaymentId },
  };
}
