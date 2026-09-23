// UPI save service.
//
// Option 1 decision: we do NOT hard-depend on an external VPA validation API
// (Razorpay's is deprecated; Cashfree Reverse Penny Drop is RBI-restricted to
// certain industries and unlikely to be approved for a cab platform). Instead
// we accept a well-formed UPI ID and save it. The actual payment is a direct
// supervisor→driver UPI transfer, and the supervisor's UPI app shows the real
// payee name at scan time and rejects an invalid ID — so a working UPI ID is
// sufficient to be payable.
//
// If Cashfree later enables Reverse Penny Drop / Payouts VPA-verify for this
// account, name lookup can be layered on top without changing this contract.

import { prisma } from '../lib/prisma';
import { ValidationError } from '../types';

export interface SavedVpa {
  upiVpa: string;
  upiVpaName: string;
  upiVerified: boolean;
}

/**
 * Validate the UPI ID format and save it as the driver's payable VPA.
 * (Req 13.2 / 13.4 — stored and displayed; 13.3 — a malformed id is rejected.)
 */
export async function saveAndValidateVpa(driverId: string, vpaRaw: string): Promise<SavedVpa> {
  const vpa = vpaRaw.trim();
  // UPI VPA format: handle@psp (e.g. name@okaxis, 9876543210@ybl).
  if (!/^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/.test(vpa)) {
    throw new ValidationError('Enter a valid UPI ID (e.g. name@bank)');
  }

  const existing = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { fullName: true },
  });

  // Without a name-lookup provider we use the driver's own name as the payee
  // label; the payer's UPI app will show the bank-registered name on scan.
  const name = existing?.fullName ?? '';

  const driver = await prisma.driver.update({
    where: { id: driverId },
    data: {
      upiVpa: vpa,
      upiVpaName: name,
      upiVerified: true, // "payable" — a well-formed, saved UPI id
    },
    select: { upiVpa: true, upiVpaName: true, upiVerified: true },
  });

  return {
    upiVpa: driver.upiVpa ?? vpa,
    upiVpaName: driver.upiVpaName ?? name,
    upiVerified: driver.upiVerified,
  };
}
