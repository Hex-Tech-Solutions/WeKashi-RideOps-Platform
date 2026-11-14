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
