import { describe, it, expect } from 'vitest';
import { gstBreakdown, listPackCatalog } from '../src/lib/creditPacks';
import { financialYearCode, formatInvoiceNo, amountInWords, buildInvoice, SELLER } from '../src/lib/invoice';

describe('GST on credit packs (#5)', () => {
  it('adds 18% on top, split CGST 9% + SGST 9%', () => {
    expect(gstBreakdown(100)).toEqual({ base: 100, cgst: 9, sgst: 9, gst: 18, total: 118 });
    expect(gstBreakdown(159)).toEqual({ base: 159, cgst: 14.31, sgst: 14.31, gst: 28.62, total: 187.62 });
    expect(gstBreakdown(249)).toEqual({ base: 249, cgst: 22.41, sgst: 22.41, gst: 44.82, total: 293.82 });
  });

  it('catalog shows the base price and the GST-inclusive total', () => {
    expect(listPackCatalog().map((p) => [p.price, p.total])).toEqual([[100, 118], [159, 187.62], [249, 293.82]]);
  });
});

describe('tax invoice helpers', () => {
  it('uses the Indian financial year in IST', () => {
    expect(financialYearCode(new Date('2026-11-14T10:00:00Z'))).toBe('2627');
    expect(financialYearCode(new Date('2027-03-31T18:00:00Z'))).toBe('2627'); // 31 Mar 23:30 IST
    expect(financialYearCode(new Date('2027-03-31T18:31:00Z'))).toBe('2728'); // 1 Apr 00:01 IST
  });

  it('formats a consecutive number within 16 characters', () => {
    const no = formatInvoiceNo('2627', 42, 'WKC');
    expect(no).toBe('WKC/2627/000042');
    expect(no.length).toBeLessThanOrEqual(16);
  });

  it('writes the amount in words', () => {
    expect(amountInWords(118)).toBe('Rupees One Hundred Eighteen Only');
    expect(amountInWords(187.62)).toBe('Rupees One Hundred Eighty Seven and Sixty Two Paise Only');
    expect(amountInWords(293.82)).toBe('Rupees Two Hundred Ninety Three and Eighty Two Paise Only');
  });

  it('builds the invoice with the seller GSTIN and the tax split', () => {
    const inv = buildInvoice({
      invoiceNo: 'WKC/2627/000001', invoiceDate: new Date(), baseAmount: 159, credits: 10,
      gatewayOrderId: 'pack_p10_x', gatewayPaymentId: null, driver: { fullName: 'A Driver', phone: '+919811122233' },
    });
    expect(inv.seller.legalName).toBe('Shreeya Tours and Travels');
    expect(inv.seller.gstin).toBe(SELLER.gstin);
    expect(inv.amounts).toMatchObject({ taxable: 159, cgst: 14.31, sgst: 14.31, total: 187.62 });
  });
});
