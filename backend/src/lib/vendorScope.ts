import { prisma } from './prisma';
import { ForbiddenError } from '../types';
import type { AuthRequest } from '../types';

/**
 * Resolve the caller's vendor id for ownership scoping — FAIL CLOSED.
 *
 *   - admin  → undefined (intentionally unscoped: admin sees all)
 *   - vendor → their vendor id, or THROW if no Vendor row is linked
 *   - anyone else → undefined
 *
 * The critical property is that a vendor-role user with no linked Vendor row
 * must NEVER yield `undefined` and be treated like an admin. Prisma drops an
 * `undefined` where-filter, so an undefined vendor id on a list query returns
 * EVERY tenant's rows. Throwing here guarantees a vendor is always scoped to
 * their own data (or rejected), never silently unscoped.
 */
export async function resolveVendorId(req: AuthRequest): Promise<string | undefined> {
  if (req.user?.role !== 'vendor') return undefined;
  const vendor = await prisma.vendor.findUnique({
    where: { userId: req.user.id },
    select: { id: true },
  });
  if (!vendor) throw new ForbiddenError('No vendor account is associated with this user');
  return vendor.id;
}
