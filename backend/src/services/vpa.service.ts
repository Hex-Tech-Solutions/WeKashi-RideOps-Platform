// VPA_Validation_Service — validates a driver's UPI VPA via Razorpay and stores
// it (with the returned account-holder name) so a supervisor can pay the driver
// directly. On failure nothing is stored and the driver keeps no verified VPA.

import { prisma } from '../lib/prisma';
import { validateVpa } from '../lib/razorpay';
import { ValidationError } from '../types';

export interface SavedVpa {
  upiVpa: string;
  upiVpaName: string;
  upiVerified: boolean;
}

/**
 * Validate and persist a driver's payable UPI VPA. (Req 13.1, 13.2, 13.3)
 * Throws a descriptive ValidationError if the VPA fails validation, leaving the
 * driver's existing verified VPA (if any) untouched.
 */
export async function saveAndValidateVpa(driverId: string, vpaRaw: string): Promise<SavedVpa> {
  const vpa = vpaRaw.trim();
  if (!/^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/.test(vpa)) {
    throw new ValidationError('Enter a valid UPI ID (e.g. name@bank)');
  }

  const result = await validateVpa(vpa);
  if (!result.valid) {
    throw new ValidationError('That UPI ID could not be verified. Check it and try again.');
  }

  const name = result.customerName ?? '';
  const driver = await prisma.driver.update({
    where: { id: driverId },
    data: {
      upiVpa: vpa,
      upiVpaName: name,
      upiVerified: true,
    },
    select: { upiVpa: true, upiVpaName: true, upiVerified: true },
  });

  return {
    upiVpa: driver.upiVpa ?? vpa,
    upiVpaName: driver.upiVpaName ?? name,
    upiVerified: driver.upiVerified,
  };
}
