import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { config } from '../config';
import { fail } from '../errors';
import { safeName, sha256, uid, touch } from './util';

interface Upload {
  id: string; name: string; size: number; hash: string; received: number; chunks: Map<number, string>; createdAt: number; final?: string;
}
const uploads = new Map<string, Upload>();
const dir = () => path.join(config.scratch, 'uploads');

export function initUpload(name: string, size: number, hash: string) {
  if (!Number.isFinite(size) || size <= 0 || size > config.maxUploadGb * 1024 ** 3) fail('TOO_LARGE', `Uploads are limited to ${config.maxUploadGb} GB.`);
  const id = `u_${uid()}`;
  uploads.set(id, { id, name: safeName(name), size, hash, received: 0, chunks: new Map(), createdAt: Date.now() });
  return { id, chunkSize: config.chunkSize, received: 0 };
}

export function getUpload(id: string) {
  const u = uploads.get(id);
  if (!u) fail('NOT_FOUND', 'Upload session expired. Start the upload again.', id);
  touch(path.join(dir(), u!.id));
  return u!;
}

export async function writeChunk(id: string, index: number, hash: string, data: Buffer) {
  const u = getUpload(id);
  if (data.length > config.chunkSize) fail('VALIDATION', 'Chunk exceeds the 8 MB limit.');
  if (data.length === 0) fail('VALIDATION', 'Empty chunk.');
  if (sha256(data) !== hash) fail('VALIDATION', 'Chunk checksum mismatch. Re-send this chunk.');
  await fsp.mkdir(path.join(dir(), id), { recursive: true });
  const p = path.join(dir(), id, `${index}.part`);
  await fsp.writeFile(p, data);
  u.chunks.set(index, p);
  u.received = [...u.chunks.keys()].reduce((a, i) => a + Math.min(config.chunkSize, Math.max(0, u.size - i * config.chunkSize)), 0);
  return { received: Math.min(u.size, u.received), total: u.size, done: u.received >= u.size };
}

export async function completeUpload(id: string): Promise<{ ref: string; path: string; name: string }> {
  const u = getUpload(id);
  const totalChunks = Math.ceil(u.size / config.chunkSize);
  for (let i = 0; i < totalChunks; i++) if (!u.chunks.has(i)) fail('VALIDATION', `Missing chunk ${i + 1} of ${totalChunks}. Resume the upload.`);
  const ext = path.extname(u.name).toLowerCase() || '.mp4';
  const final = path.join(dir(), `${id}${ext}`);
  const out = fs.createWriteStream(final);
  for (let i = 0; i < totalChunks; i++) {
    const buf = await fsp.readFile(u.chunks.get(i)!);
    if (!out.write(buf)) await new Promise<void>((r) => out.once('drain', () => r()));
  }
  await new Promise<void>((resolve, reject) => { out.end(() => resolve()); out.on('error', reject); });
  // Stream the file so a large upload never has to fit in the container's memory.
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const input = fs.createReadStream(final);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve());
    input.on('error', reject);
  });
  const digest = hash.digest('hex');
  if (digest !== u.hash) fail('VALIDATION', 'Whole-file checksum mismatch. Re-upload the file.');
  // Chunks are no longer needed — free the disk space before processing starts.
  await fsp.rm(path.join(dir(), id), { recursive: true, force: true });
  u.final = final;
  return { ref: id, path: final, name: u.name };
}

export async function fileForRef(ref: string): Promise<string> {
  if (!/^u_[a-z0-9]+$/i.test(ref)) fail('VALIDATION', 'Invalid upload reference.');
  const u = uploads.get(ref);
  if (!u?.final) fail('NOT_FOUND', 'Upload not found or not completed.');
  return u!.final!;
}

export async function sweepUploads() {
  const cutoff = Date.now() - config.fileTtlMin * 60_000;
  for (const [id, u] of uploads) if (u.createdAt < cutoff) {
    await fsp.rm(path.join(dir(), id), { recursive: true, force: true });
    if (u.final) await fsp.rm(u.final, { force: true });
    uploads.delete(id);
  }
}
