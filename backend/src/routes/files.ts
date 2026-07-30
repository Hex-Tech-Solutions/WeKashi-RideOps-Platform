import { Router, Request, Response } from 'express';
import path from 'path';
import { UPLOAD_DIR, USE_AZURE_STORAGE, streamBlobToResponse } from '../lib/storage';
import { verifyAccessToken } from '../lib/jwt';

/**
 * Serves uploaded document files.
 * Auth via Authorization header OR ?token= (so files can render in <img>/<a>).
 *
 * Local dev:  reads from UPLOAD_DIR on disk.
 * Production: streams from Azure Blob Storage.
 */
const router = Router();

router.get('/:filename', async (req: Request, res: Response) => {
  // ── Auth check ────────────────────────────────────────────────────────────
  const token =
    (req.query.token as string | undefined) ??
    (req.headers.authorization ?? '').replace('Bearer ', '');
  try {
    verifyAccessToken(token);
  } catch {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }

  // Sanitize filename — prevent path traversal
  const filename = path.basename(req.params.filename);

  // ── Azure Blob Storage (production) ─────────────────────────────────────
  if (USE_AZURE_STORAGE) {
    await streamBlobToResponse(filename, res);
    return;
  }

  // ── Local disk (development) ─────────────────────────────────────────────
  res.sendFile(path.join(UPLOAD_DIR, filename), (err) => {
    if (err) res.status(404).json({ error: 'File not found', code: 'NOT_FOUND' });
  });
});

export default router;
