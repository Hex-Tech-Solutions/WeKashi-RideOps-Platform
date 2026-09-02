/**
 * File storage abstraction.
 *
 * In development (AZURE_STORAGE_CONNECTION_STRING not set):
 *   Files are stored on local disk in UPLOAD_DIR.
 *   Served via GET /api/files/:filename.
 *
 * In production (AZURE_STORAGE_CONNECTION_STRING set):
 *   Files are stored in Azure Blob Storage.
 *   Container: AZURE_STORAGE_CONTAINER (default: "rideops-uploads")
 *   Served via the blob URL (private — access token appended by frontend).
 *
 * Both modes use multer — the difference is where the file ends up
 * after upload. For Azure, we use memoryStorage and stream to Blob.
 */

import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger';

// ─── Constants ────────────────────────────────────────────────────────────────

export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.resolve(process.cwd(), 'uploads');
const AZURE_CONN  = process.env.AZURE_STORAGE_CONNECTION_STRING;
const AZURE_CONT  = process.env.AZURE_STORAGE_CONTAINER ?? 'rideops-uploads';
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

export const USE_AZURE_STORAGE = !!AZURE_CONN;

// ─── Azure Blob client (lazy — only created if env var is set) ────────────────

let _blobServiceClient: import('@azure/storage-blob').BlobServiceClient | null = null;

async function getBlobContainerClient() {
  if (!_blobServiceClient) {
    const { BlobServiceClient } = await import('@azure/storage-blob');
    _blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_CONN!);
  }
  const container = _blobServiceClient.getContainerClient(AZURE_CONT);
  // Create container if it doesn't exist (idempotent)
  await container.createIfNotExists();
  return container;
}

// ─── Upload a file buffer to Azure Blob Storage ───────────────────────────────

export async function uploadToAzureBlob(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
): Promise<string> {
  const ext      = path.extname(originalName).toLowerCase();
  const filename = `${uuidv4()}${ext}`;
  const container = await getBlobContainerClient();
  const blockBlob = container.getBlockBlobClient(filename);

  await blockBlob.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: mimeType },
  });

  // Return the blob URL (without SAS — access is controlled by the API token check)
  logger.debug({ filename, mimeType }, 'File uploaded to Azure Blob Storage');
  return `/api/files/${filename}`;
}

// ─── Delete a blob from Azure Blob Storage ────────────────────────────────────

export async function deleteFromAzureBlob(filename: string): Promise<void> {
  if (!USE_AZURE_STORAGE) {
    const filePath = path.join(UPLOAD_DIR, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return;
  }
  const container = await getBlobContainerClient();
  await container.deleteBlob(filename, { deleteSnapshots: 'include' });
}

// ─── Stream a blob to the HTTP response ──────────────────────────────────────

export async function streamBlobToResponse(
  filename: string,
  res: import('express').Response,
): Promise<void> {
  const container = await getBlobContainerClient();
  const blockBlob = container.getBlockBlobClient(filename);

  const exists = await blockBlob.exists();
  if (!exists) {
    res.status(404).json({ error: 'File not found', code: 'NOT_FOUND' });
    return;
  }

  const props = await blockBlob.getProperties();
  res.setHeader('Content-Type', props.contentType ?? 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=3600');

  const download = await blockBlob.download();
  download.readableStreamBody!.pipe(res);
}

// ─── Ensure local upload dir exists (dev mode) ───────────────────────────────
//
// This runs at import time, so an unhandled throw here takes down the whole
// process before the server ever listens. The container runs as a non-root user
// and cannot create directories under /app, so mkdir fails with EACCES when
// AZURE_STORAGE_CONNECTION_STRING is unset. Log and continue instead: uploads
// will fail with a clear per-request error, which is far better than the API
// refusing to boot for a feature that may not even be in use.

if (!USE_AZURE_STORAGE && !fs.existsSync(UPLOAD_DIR)) {
  try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  } catch (err) {
    logger.error(
      { err, uploadDir: UPLOAD_DIR },
      'Could not create local upload directory — file uploads will fail. ' +
        'Set AZURE_STORAGE_CONNECTION_STRING to use Blob Storage, or point ' +
        'UPLOAD_DIR at a writable path.',
    );
  }
}

// ─── Multer configuration ─────────────────────────────────────────────────────
// In Azure mode: use memoryStorage — the buffer is streamed to Blob in the route.
// In local mode: use diskStorage — file lands directly on disk.

const storage = USE_AZURE_STORAGE
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
      filename:    (_req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`),
    });

export const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG, WEBP or PDF up to 5 MB are allowed'));
  },
});
