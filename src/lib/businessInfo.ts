/**
 * Single source of truth for legal/business identity shown on the public
 * policy pages (About, Privacy, Refund, Shipping & Return).
 *
 * These details are what a payment gateway (PayU) verifies during onboarding,
 * so they must exactly match the GST registration and the bank account the
 * settlements land in. Keep them here rather than inline in each page so a
 * correction can't be applied to one page and missed on another.
 */

export const BUSINESS = {
  /** Proprietor's legal name, as registered for GST. */
  legalName: "Padma Priya R",
  /** Trading/brand name the business operates under. */
  tradeName: "Shreeya Tours and Travels",
  /** Consumer-facing product brand. */
  productName: "WeKashi RideOps",

  gstin: "29GVBPP3987H1ZU",

  /** Sole proprietorship — no CIN, since it isn't a registered company. */
  entityType: "Sole Proprietorship",

  address: {
    line1: "Ground Floor, No 002, H Block",
    line2: "Thunga Vallegerhali, Phase 1 BDA Apartment, RV Niketan",
    city: "Bengaluru",
    district: "Bengaluru Urban",
    state: "Karnataka",
    pincode: "560059",
    country: "India",
  },

  support: {
    email: "info@wekashi.in",
    phone: "+91 80504 41392",
    /** IST, for response-time expectations on the policy pages. */
    hours: "Monday to Saturday, 9:30 AM to 6:30 PM IST",
  },

  /** Required under the Consumer Protection (E-Commerce) Rules, 2020. */
  grievanceOfficer: {
    name: "Srinivas",
    email: "grievance@wekashi.in",
  },

  websiteUrl: "https://wekashi.in",

  jurisdictionCity: "Bengaluru",

  /** Working days from refund approval to money leaving the gateway. */
  refundTurnaroundDays: 14,

  /** Kept in one place so "last updated" stamps can't drift between pages. */
  policiesLastUpdated: "1 September 2026",
} as const;

/** Full postal address on one line, for compact footers/contact blocks. */
export function formattedAddress(): string {
  const a = BUSINESS.address;
  return `${a.line1}, ${a.line2}, ${a.city}, ${a.district}, ${a.state} ${a.pincode}, ${a.country}`;
}
