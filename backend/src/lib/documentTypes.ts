/**
 * Driver document types and the details each one must carry.
 *
 * Single source of truth for the backend: the upload route validates against
 * it, and KYC approval uses REQUIRED_DOC_TYPES. Keep it in step with the
 * REQUIRED list in src/pages/driver/DriverDocuments.tsx.
 */
export interface DocTypeRule {
  label: string;
  needsNumber: boolean;
  needsExpiry: boolean;
}

export const DOC_TYPE_RULES: Record<string, DocTypeRule> = {
  aadhaar:             { label: 'Aadhaar Card',        needsNumber: true,  needsExpiry: false },
  dl:                  { label: 'Driving Licence',     needsNumber: true,  needsExpiry: true  },
  rc:                  { label: 'Vehicle RC',          needsNumber: true,  needsExpiry: false },
  puc:                 { label: 'PUC Certificate',     needsNumber: false, needsExpiry: true  },
  insurance:           { label: 'Insurance',           needsNumber: false, needsExpiry: true  },
  fitness_certificate: { label: 'Fitness Certificate', needsNumber: true,  needsExpiry: true  },
  commercial_permit:   { label: 'Commercial Permit',   needsNumber: true,  needsExpiry: true  },
  road_tax:            { label: 'Road Tax',            needsNumber: true,  needsExpiry: true  },
  photo:               { label: 'Profile Photo',       needsNumber: false, needsExpiry: false },
};

/**
 * A verified document is locked. The driver may only upload a replacement when
 * it expires within this many days (or has expired). The vendor can also ask
 * for a new one by rejecting it.
 */
export const RENEWAL_WINDOW_DAYS = 30;

/** Is this verified document due for renewal (expired or expiring soon)? */
export function isInRenewalWindow(expiry: Date | null | undefined, now = new Date()): boolean {
  if (!expiry) return false;
  return expiry.getTime() - now.getTime() <= RENEWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Why a driver can't upload a new version of this type right now, or null if
 * they can. Based on their latest upload of the type.
 */
export function replaceBlockedReason(
  latest: { status: string; expiry: Date | null } | null,
  label: string,
): string | null {
  if (!latest) return null;                       // first upload
  if (latest.status !== 'verified') return null;  // pending or rejected
  if (isInRenewalWindow(latest.expiry)) return null;
  return `Your ${label} is verified and locked. You can upload a new one when it is within ${RENEWAL_WINDOW_DAYS} days of expiry, or if your vendor asks for it.`;
}

/** Every type a driver must have verified for KYC to be approved. */
export const REQUIRED_DOC_TYPES = Object.keys(DOC_TYPE_RULES);

export function isDocType(type: string): boolean {
  return type in DOC_TYPE_RULES;
}

/**
 * Check the details sent with an upload. Returns an error message, or null if
 * the upload is valid. Expiry must be a real date and not already in the past.
 */
export function validateDocDetails(
  type: string,
  number: string | undefined,
  expiry: string | undefined,
): string | null {
  const rule = DOC_TYPE_RULES[type];
  if (!rule) return 'Unknown document type';

  if (rule.needsNumber && !number?.trim()) {
    return `${rule.label} number is required`;
  }
  if (number && number.trim().length > 50) {
    return `${rule.label} number is too long`;
  }

  if (rule.needsExpiry) {
    if (!expiry) return `${rule.label} expiry date is required`;
    const d = new Date(expiry);
    if (Number.isNaN(d.getTime())) return `${rule.label} expiry date is not a valid date`;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d < today) return `${rule.label} has already expired — upload a valid document`;
  }
  return null;
}
