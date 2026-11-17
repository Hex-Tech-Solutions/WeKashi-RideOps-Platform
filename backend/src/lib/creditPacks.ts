// Ride-credit pack catalog — the single source of truth for what a driver can
// buy. The frontend fetches this via GET /driver/packs/catalog so prices never
// diverge between client and server.
//
// Every pack is valid for 365 days from activation and grants a fixed number of
// ride credits. Credits are consumed one-per-completed-ride and gate broadcast
// eligibility. See the driver-subscription-payments spec.

/** Days a pack stays valid after it becomes active. */
export const PACK_VALIDITY_DAYS = 365;

/** Free credits granted once to every newly onboarded driver. */
export const JOINING_BONUS_CREDITS = 5;

/**
 * The three purchasable packs. Keys are stored on PackOrder.packKey.
 * `price` is the BASE price before GST (#5); the driver pays price + GST.
 */
export const PACK_CATALOG = {
  p5: { key: 'p5', credits: 5, price: 100 },
  p10: { key: 'p10', credits: 10, price: 159 },
  p20: { key: 'p20', credits: 20, price: 249 },
} as const;

export type PackKey = keyof typeof PACK_CATALOG;

export type PackDefinition = (typeof PACK_CATALOG)[PackKey];

/** GST on credit packs, added on top of the base price (#5). */
export const GST_RATE_PERCENT = 18;

export interface GstBreakdown {
  base: number;   // rupees
  cgst: number;   // 9%
  sgst: number;   // 9%
  gst: number;    // cgst + sgst
  total: number;  // base + gst (what the driver pays)
}

/**
 * GST split for an intra-state (Karnataka) supply, computed in paise so the
 * rupee values are exact: ₹100 -> ₹118, ₹159 -> ₹187.62, ₹249 -> ₹293.82.
 */
export function gstBreakdown(baseRupees: number): GstBreakdown {
  const base = Math.round(baseRupees * 100);
  const half = Math.round((base * GST_RATE_PERCENT) / 2 / 100);
  const cgst = half;
  const sgst = half;
  const gst = cgst + sgst;
  return { base: base / 100, cgst: cgst / 100, sgst: sgst / 100, gst: gst / 100, total: (base + gst) / 100 };
}

/** Ordered list for display (cheapest first), with the GST-inclusive total. */
export function listPackCatalog(): Array<PackDefinition & { validityDays: number; gst: number; total: number; gstRatePercent: number }> {
  return (Object.values(PACK_CATALOG) as PackDefinition[]).map((p) => {
    const g = gstBreakdown(p.price);
    return { ...p, validityDays: PACK_VALIDITY_DAYS, gst: g.gst, total: g.total, gstRatePercent: GST_RATE_PERCENT };
  });
}

export function isPackKey(key: string): key is PackKey {
  return key in PACK_CATALOG;
}

/** Compute a pack's expiry from its activation time. */
export function packExpiry(activatedAt: Date): Date {
  return new Date(activatedAt.getTime() + PACK_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
}
