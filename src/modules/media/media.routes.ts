import express, { Router } from 'express';
import { z } from 'zod';
import { asyncHandler as wrap } from '../../common/async-handler.js';
import { authenticateToken, requireActiveStatus } from '../../common/middleware/auth-guard.js';
import { ApiError } from '../../common/errors/api-error.js';
import { prisma } from '../../common/prisma.js';
import { env } from '../../config/env.js';
import { id } from '../../common/validation.js';
import { MediaService, UploadStatus, mediaLimits } from './media.service.js';
import { localDiskStorage, verifyLocalUploadToken } from './storage.js';

export const mediaRouter = Router();

const createUploadSchema = z.object({
  contentType: z.string().min(1).max(100),
  size: z.number().int().positive(),
  durationSeconds: z.number().nonnegative().optional(),
});

// Public: current limits so clients can validate before uploading.
mediaRouter.get('/limits', (_req, res) => {
  res.json({ success: true, data: mediaLimits() });
});

// Step 1: get a short-lived upload URL. Step 2: PUT the file there. Step 3: reference uploadId in the listing.
mediaRouter.post('/uploads', authenticateToken, requireActiveStatus, wrap(async (req, res) => {
  const upload = await MediaService.createUpload(req.user!.userId, createUploadSchema.parse(req.body));
  res.status(201).json({ success: true, data: upload });
}));

// Local-disk driver only: receives the file body (the "presigned URL" for development and tests).
if (env.STORAGE_DRIVER === 'local') {
  mediaRouter.put(
    '/local-upload/:id',
    express.raw({ type: () => true, limit: env.MEDIA_MAX_VIDEO_MB * 1024 * 1024 }),
    wrap(async (req, res) => {
      const uploadId = id.parse(req.params.id);
      if (verifyLocalUploadToken(String(req.query.token ?? '')) !== uploadId) {
        throw ApiError.forbidden('Upload link is invalid or has expired', 'UPLOAD_URL_INVALID');
      }
      const upload = await prisma.mediaUpload.findUnique({ where: { id: uploadId } });
      if (!upload || upload.status !== UploadStatus.PENDING) throw ApiError.notFound('Upload not found', 'UPLOAD_NOT_FOUND');
      if (req.headers['content-type'] !== upload.mimeType) {
        throw ApiError.badRequest('Content-Type does not match the requested upload', 'UPLOAD_TYPE_MISMATCH');
      }
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (body.length === 0 || body.length > upload.fileSize) {
        throw ApiError.badRequest('File size does not match the requested upload', 'UPLOAD_SIZE_MISMATCH');
      }
      await localDiskStorage.write(upload.storageKey, body);
      res.json({ success: true, data: { uploadId } });
    })
  );
}
