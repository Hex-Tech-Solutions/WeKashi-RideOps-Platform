import { Router, Request, Response } from 'express';
import path from 'path';
import { UPLOAD_DIR } from '../lib/storage';
import { verifyAccessToken } from '../lib/jwt';

// Serves uploaded document files. Auth via Authorization header OR ?token=
// (so files can be shown in <img>/<a> with a short-lived access token).
const router = Router();

router.get('/:filename', (req: Request, res: Response) => {
  const token =
    (req.query.token as string | undefined) ??
    (req.headers.authorization ?? '').replace('Bearer ', '');
  try {
    verifyAccessToken(token);
  } catch {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }

  const filename = path.basename(req.params.filename); // prevent path traversal
  res.sendFile(path.join(UPLOAD_DIR, filename), (err) => {
    if (err) res.status(404).json({ error: 'File not found', code: 'NOT_FOUND' });
  });
});

export default router;
