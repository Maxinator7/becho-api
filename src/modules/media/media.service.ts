import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { ApiError } from '../../common/errors/api-error.js';
import { env } from '../../config/env.js';
import { MediaType } from '../../common/types/enums.js';
import { storage } from './storage.js';

const MB = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Uploads never attached to a listing are deleted after this long. */
const PENDING_UPLOAD_TTL_MS = DAY_MS;

export const ALLOWED_TYPES: Record<string, { mediaType: 'IMAGE' | 'VIDEO'; ext: string }> = {
  'image/jpeg': { mediaType: MediaType.IMAGE, ext: 'jpg' },
  'image/png': { mediaType: MediaType.IMAGE, ext: 'png' },
  'image/webp': { mediaType: MediaType.IMAGE, ext: 'webp' },
  'video/mp4': { mediaType: MediaType.VIDEO, ext: 'mp4' },
  'video/webm': { mediaType: MediaType.VIDEO, ext: 'webm' },
  'video/quicktime': { mediaType: MediaType.VIDEO, ext: 'mov' },
};

export const UploadStatus = { PENDING: 'PENDING', ATTACHED: 'ATTACHED' } as const;

/** Limits shown to clients so they can validate before uploading. */
export function mediaLimits() {
  return {
    allowedTypes: Object.keys(ALLOWED_TYPES),
    maxImageBytes: env.MEDIA_MAX_IMAGE_MB * MB,
    maxVideoBytes: env.MEDIA_MAX_VIDEO_MB * MB,
    maxVideoSeconds: env.MEDIA_MAX_VIDEO_SECONDS,
    maxImagesPerListing: env.MEDIA_MAX_IMAGES_PER_LISTING,
    maxVideosPerListing: env.MEDIA_MAX_VIDEOS_PER_LISTING,
    uploadsPerDay: env.MEDIA_UPLOADS_PER_DAY,
    listingsPerDay: env.LISTINGS_PER_DAY,
  };
}

const maxBytes = (mediaType: string) => (mediaType === MediaType.VIDEO ? env.MEDIA_MAX_VIDEO_MB : env.MEDIA_MAX_IMAGE_MB) * MB;

export interface CreateUploadInput {
  contentType: string;
  size: number;
  /** Reported by the client for videos; enforced against MEDIA_MAX_VIDEO_SECONDS. */
  durationSeconds?: number;
}

/** A media reference in a listing create/update request. */
export type ListingMediaInput = { uploadId: string } | { url: string; mimeType?: string; storageKey?: string };

export interface ListingMediaRow {
  mediaType: string;
  storageKey: string;
  url: string;
  mimeType: string;
  fileSize: number;
  sortOrder: number;
}

export class MediaService {
  /** Step 1: client asks for an upload URL. Validates type, size and the daily quota. */
  static async createUpload(userId: string, input: CreateUploadInput) {
    const type = ALLOWED_TYPES[input.contentType];
    if (!type) {
      throw ApiError.badRequest('Only JPEG, PNG and WebP photos or MP4, WebM and MOV videos are allowed', 'MEDIA_TYPE_NOT_ALLOWED');
    }
    const limit = maxBytes(type.mediaType);
    if (input.size > limit) {
      throw ApiError.badRequest(
        `${type.mediaType === MediaType.VIDEO ? 'Videos' : 'Photos'} can be at most ${limit / MB} MB`,
        'MEDIA_TOO_LARGE'
      );
    }
    if (type.mediaType === MediaType.VIDEO && input.durationSeconds !== undefined && input.durationSeconds > env.MEDIA_MAX_VIDEO_SECONDS) {
      throw ApiError.badRequest(`Videos can be at most ${env.MEDIA_MAX_VIDEO_SECONDS} seconds long`, 'VIDEO_TOO_LONG');
    }

    const recent = await prisma.mediaUpload.count({ where: { userId, createdAt: { gte: new Date(Date.now() - DAY_MS) } } });
    if (recent >= env.MEDIA_UPLOADS_PER_DAY) {
      throw ApiError.tooManyRequests(`You can upload at most ${env.MEDIA_UPLOADS_PER_DAY} files per day`, 'UPLOAD_DAILY_LIMIT');
    }

    const id = crypto.randomUUID();
    const storageKey = `listings/${userId}/${id}.${type.ext}`;
    const upload = await prisma.mediaUpload.create({
      data: { id, userId, storageKey, mediaType: type.mediaType, mimeType: input.contentType, fileSize: input.size },
    });
    const presigned = await storage.createUploadUrl(storageKey, input.contentType, input.size, upload.id);

    return {
      uploadId: upload.id,
      mediaType: upload.mediaType,
      publicUrl: storage.publicUrl(storageKey),
      ...presigned,
    };
  }

  /**
   * Turns a listing's media input into rows, checking ownership, that each file was really
   * uploaded (and isn't bigger than allowed), and the per-listing photo/video limits.
   * `listingId` is set on updates so files already attached to this listing can be kept.
   */
  static async resolveListingMedia(userId: string, items: ListingMediaInput[], listingId?: string) {
    const uploadIds = items.flatMap((m) => ('uploadId' in m ? [m.uploadId] : []));
    const uploads = uploadIds.length
      ? await prisma.mediaUpload.findMany({ where: { id: { in: uploadIds }, userId } })
      : [];
    const byId = new Map(uploads.map((u) => [u.id, u]));

    const rows: ListingMediaRow[] = [];
    for (const [i, item] of items.entries()) {
      if (!('uploadId' in item)) {
        // Legacy/external image link (older mobile builds). Images only.
        rows.push({ mediaType: MediaType.IMAGE, storageKey: item.storageKey || item.url, url: item.url, mimeType: item.mimeType || 'image/jpeg', fileSize: 0, sortOrder: i + 1 });
        continue;
      }
      const upload = byId.get(item.uploadId);
      if (!upload) throw ApiError.badRequest('One of the files was not found. Please upload it again.', 'UPLOAD_NOT_FOUND');
      const reusable = upload.status === UploadStatus.PENDING || (listingId !== undefined && upload.listingId === listingId);
      if (!reusable) throw ApiError.badRequest('One of the files is already used by another listing', 'UPLOAD_ALREADY_USED');

      const stored = await storage.head(upload.storageKey);
      if (!stored) throw ApiError.badRequest('One of the files has not finished uploading', 'UPLOAD_INCOMPLETE');
      if (stored.size > maxBytes(upload.mediaType)) {
        throw ApiError.badRequest('One of the files is larger than allowed', 'MEDIA_TOO_LARGE');
      }
      rows.push({
        mediaType: upload.mediaType,
        storageKey: upload.storageKey,
        url: storage.publicUrl(upload.storageKey),
        mimeType: upload.mimeType,
        fileSize: stored.size,
        sortOrder: i + 1,
      });
    }

    const images = rows.filter((r) => r.mediaType === MediaType.IMAGE).length;
    const videos = rows.filter((r) => r.mediaType === MediaType.VIDEO).length;
    if (images > env.MEDIA_MAX_IMAGES_PER_LISTING) {
      throw ApiError.badRequest(`A listing can have at most ${env.MEDIA_MAX_IMAGES_PER_LISTING} photos`, 'TOO_MANY_PHOTOS');
    }
    if (videos > env.MEDIA_MAX_VIDEOS_PER_LISTING) {
      throw ApiError.badRequest(`A listing can have at most ${env.MEDIA_MAX_VIDEOS_PER_LISTING} video(s)`, 'TOO_MANY_VIDEOS');
    }
    return { rows, uploadIds };
  }

  /** Marks uploads as used by a listing (inside the listing's transaction). */
  static async markAttached(tx: Prisma.TransactionClient, uploadIds: string[], listingId: string) {
    if (!uploadIds.length) return;
    await tx.mediaUpload.updateMany({
      where: { id: { in: uploadIds } },
      data: { status: UploadStatus.ATTACHED, listingId, attachedAt: new Date() },
    });
  }

  /** Deletes files a listing no longer uses (after an edit replaced its media). Best effort. */
  static async releaseRemoved(listingId: string, keepUploadIds: string[]) {
    const removed = await prisma.mediaUpload.findMany({
      where: { listingId, status: UploadStatus.ATTACHED, id: { notIn: keepUploadIds } },
    });
    for (const upload of removed) {
      await storage.delete(upload.storageKey).catch(() => {});
      await prisma.mediaUpload.delete({ where: { id: upload.id } }).catch(() => {});
    }
  }

  /** Background job: remove uploads that were never attached to a listing. */
  static async cleanupAbandonedUploads() {
    const stale = await prisma.mediaUpload.findMany({
      where: { status: UploadStatus.PENDING, createdAt: { lt: new Date(Date.now() - PENDING_UPLOAD_TTL_MS) } },
      take: 500,
    });
    for (const upload of stale) {
      await storage.delete(upload.storageKey).catch(() => {});
      await prisma.mediaUpload.delete({ where: { id: upload.id } }).catch(() => {});
    }
    return { deletedCount: stale.length };
  }
}
