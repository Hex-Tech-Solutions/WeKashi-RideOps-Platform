/**
 * Account notices pushed to a driver's phone (not ride alerts).
 * Best-effort: never throws into the caller. With the app open, the in-app
 * banners (driver /me -> kycStatus) show the same thing.
 */
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { isFcmEnabled, sendDriverNoticePush } from '../lib/fcm';
import { DOC_TYPE_RULES } from '../lib/documentTypes';

async function pushNotice(driverId: string, notice: { title: string; body: string; kind: string }): Promise<void> {
  if (!isFcmEnabled()) return;
  const d = await prisma.driver.findUnique({ where: { id: driverId }, select: { fcmToken: true } });
  if (!d?.fcmToken) return;
  const { stale } = await sendDriverNoticePush(d.fcmToken, notice);
  if (stale) {
    // App uninstalled / data cleared — same handling as ride pushes.
    await prisma.driver.updateMany({ where: { id: driverId, fcmToken: d.fcmToken }, data: { fcmToken: null, isOnline: false } });
  }
}

/** #13: a verified document expires in `daysLeft` days (30 / 15 / 7 / 1). */
export async function notifyDocumentExpiring(driverId: string, docType: string, daysLeft: number): Promise<void> {
  const label = DOC_TYPE_RULES[docType]?.label ?? 'document';
  const when = daysLeft <= 1 ? 'tomorrow' : `in ${daysLeft} days`;
  try {
    await pushNotice(driverId, {
      kind: 'document_expiring',
      title: `${label} expires ${when}`,
      body: `Upload your renewed ${label} in the Documents tab before it expires, or you won't get rides.`,
    });
  } catch (err) {
    logger.error({ err, driverId, docType }, 'Document-expiring notice failed');
  }
}

/** #13: a verified document has expired — rides are blocked until a new copy is verified. */
export async function notifyDocumentExpired(driverId: string, docType: string): Promise<void> {
  const label = DOC_TYPE_RULES[docType]?.label ?? 'document';
  try {
    await pushNotice(driverId, {
      kind: 'document_expired',
      title: `${label} expired — rides blocked`,
      body: `Your ${label} has expired. Upload a valid copy in the Documents tab. You won't get rides until it's verified.`,
    });
  } catch (err) {
    logger.error({ err, driverId, docType }, 'Document-expired notice failed');
  }
}

/** Vendor/admin rejected a document: KYC is now rejected until a new copy is verified. */
export async function notifyDocumentRejected(driverId: string, docType: string, note?: string | null): Promise<void> {
  const label = DOC_TYPE_RULES[docType]?.label ?? 'document';
  const reason = note?.trim() ? ` Reason: ${note.trim().slice(0, 120)}.` : '';
  try {
    await pushNotice(driverId, {
      kind: 'document_rejected',
      title: `${label} rejected — update needed`,
      body: `Your ${label} was rejected by your vendor.${reason} Upload a new one in the Documents tab. You won't get rides until it's verified.`,
    });
  } catch (err) {
    logger.error({ err, driverId, docType }, 'Document-rejected notice failed');
  }
}
