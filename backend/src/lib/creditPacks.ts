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
export const JOINING_BONUS_CREDITS = 1;

/** The three purchasable packs. Keys are stored on PackOrder.packKey. */
export const PACK_CATALOG = {
  p5: { key: 'p5', credits: 5, price: 100 },
  p10: { key: 'p10', credits: 10, price: 159 },
  p20: { key: 'p20', credits: 20, price: 249 },
} as const;

export type PackKey = keyof typeof PACK_CATALOG;

export type PackDefinition = (typeof PACK_CATALOG)[PackKey];

/** Ordered list for display (cheapest first). */
export function listPackCatalog(): Array<PackDefinition & { validityDays: number }> {
  return (Object.values(PACK_CATALOG) as PackDefinition[]).map((p) => ({
    ...p,
    validityDays: PACK_VALIDITY_DAYS,
  }));
}

export function isPackKey(key: string): key is PackKey {
  return key in PACK_CATALOG;
}

/** Compute a pack's expiry from its activation time. */
export function packExpiry(activatedAt: Date): Date {
  return new Date(activatedAt.getTime() + PACK_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
}
