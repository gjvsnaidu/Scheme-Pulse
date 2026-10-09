import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { Config } from '../config';

export interface Storage {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

const safe = (key: string) => key.replace(/[^a-zA-Z0-9/_.-]/g, '_').replace(/\.\./g, '_');

export function createStorage(cfg: Config): Storage {
  if (cfg.STORAGE_DRIVER === 's3') {
    // Works with AWS S3, Cloudflare R2, MinIO, etc. Requires: npm i @aws-sdk/client-s3 (not bundled by default).
    let client: any, mod: any;
    const init = async () => {
      if (client) return;
      const pkg = '@aws-sdk/client-s3';
      mod = await import(/* @vite-ignore */ pkg);
      client = new mod.S3Client({ region: cfg.S3_REGION, endpoint: cfg.S3_ENDPOINT, forcePathStyle: !!cfg.S3_ENDPOINT,
        credentials: cfg.S3_ACCESS_KEY_ID ? { accessKeyId: cfg.S3_ACCESS_KEY_ID, secretAccessKey: cfg.S3_SECRET_ACCESS_KEY } : undefined });
    };
    return {
      async put(key, data, mime) { await init(); await client.send(new mod.PutObjectCommand({ Bucket: cfg.S3_BUCKET, Key: safe(key), Body: data, ContentType: mime })); },
      async get(key) { await init(); const r = await client.send(new mod.GetObjectCommand({ Bucket: cfg.S3_BUCKET, Key: safe(key) })); return Buffer.from(await r.Body.transformToByteArray()); },
      async remove(key) { await init(); await client.send(new mod.DeleteObjectCommand({ Bucket: cfg.S3_BUCKET, Key: safe(key) })); },
    };
  }
  const path = (key: string) => join(cfg.UPLOAD_DIR, safe(key));
  return {
    async put(key, data) { await mkdir(dirname(path(key)), { recursive: true }); await writeFile(path(key), data); },
    get: (key) => readFile(path(key)),
    remove: (key) => rm(path(key), { force: true }),
  };
}
