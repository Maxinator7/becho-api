import fs from 'node:fs/promises';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env, publicApiUrl } from '../../config/env.js';

const UPLOAD_URL_TTL_SECONDS = 15 * 60;

export interface PresignedUpload {
  uploadUrl: string;
  method: 'PUT';
  /** Headers the client must send with the PUT (they are part of the signature). */
  headers: Record<string, string>;
}

export interface StoredObject {
  size: number;
  contentType?: string;
}

export interface MediaStorage {
  createUploadUrl(key: string, contentType: string, size: number, uploadId: string): Promise<PresignedUpload>;
  head(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}

// ───────────────────────── Cloudflare R2 (S3-compatible) ─────────────────────────

class R2Storage implements MediaStorage {
  private client = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! },
  });
  private bucket = env.R2_BUCKET!;

  async createUploadUrl(key: string, contentType: string, size: number): Promise<PresignedUpload> {
    // Content-Type and Content-Length are signed, so the client can't upload a different type or size.
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: size });
    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: UPLOAD_URL_TTL_SECONDS,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return { uploadUrl, method: 'PUT', headers: { 'Content-Type': contentType } };
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0, contentType: res.ContentType };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw err;
    }
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  publicUrl(key: string) {
    return `${env.R2_PUBLIC_URL!.replace(/\/$/, '')}/${key}`;
  }
}

// ───────────────────────── Local disk (development & tests) ─────────────────────────

export const LOCAL_FILES_ROUTE = '/media-files';
const localRoot = path.resolve(env.LOCAL_UPLOAD_DIR);

/** Resolves a storage key inside the upload dir, refusing anything that escapes it. */
export function localPath(key: string) {
  const full = path.resolve(localRoot, key);
  if (!full.startsWith(localRoot + path.sep)) throw new Error('Invalid storage key');
  return full;
}

export function signLocalUploadToken(uploadId: string) {
  return jwt.sign({ uploadId, purpose: 'local-upload' }, env.JWT_SECRET, { expiresIn: UPLOAD_URL_TTL_SECONDS });
}

export function verifyLocalUploadToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { uploadId?: string; purpose?: string };
    return payload.purpose === 'local-upload' && payload.uploadId ? payload.uploadId : null;
  } catch {
    return null;
  }
}

class LocalStorage implements MediaStorage {
  async createUploadUrl(_key: string, contentType: string, _size: number, uploadId: string): Promise<PresignedUpload> {
    const token = signLocalUploadToken(uploadId);
    return {
      uploadUrl: `${publicApiUrl}/api/v1/media/local-upload/${uploadId}?token=${encodeURIComponent(token)}`,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
    };
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const stat = await fs.stat(localPath(key));
      return { size: stat.size };
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    await fs.rm(localPath(key), { force: true });
  }

  publicUrl(key: string) {
    return `${publicApiUrl}${LOCAL_FILES_ROUTE}/${key}`;
  }

  /** Called by the local upload route. */
  async write(key: string, body: Buffer) {
    const file = localPath(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  }
}

export const localDiskStorage = new LocalStorage();
export const storage: MediaStorage = env.STORAGE_DRIVER === 'r2' ? new R2Storage() : localDiskStorage;
export const localUploadRoot = localRoot;
