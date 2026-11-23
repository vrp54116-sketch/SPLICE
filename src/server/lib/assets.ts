import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ShieldReport } from '@shared/types';
import { config } from '../config';
import { fail } from '../errors';
import { uid, touch } from './util';

export interface AssetRecord {
  id: string;
  path: string;
  kind: 'video' | 'thumb' | 'audio' | 'caption' | 'report';
  mime: string;
  createdAt: number;
  rights?: { tier: ShieldReport['tier']; confirmation?: boolean; clipId: string };
  name?: string;
}
const assets = new Map<string, AssetRecord>();

export async function putAsset(file: string, kind: AssetRecord['kind'], opts: Partial<AssetRecord> = {}): Promise<AssetRecord> {
  const id = `a_${uid()}`;
  const dest = path.join(config.scratch, 'assets', `${id}${path.extname(file) || ''}`);
  await fsp.copyFile(file, dest);
  const rec: AssetRecord = {
    id, path: dest, kind, mime: kind === 'video' ? 'video/mp4' : kind === 'thumb' ? 'image/jpeg' : kind === 'audio' ? 'audio/wav' : kind === 'caption' ? 'text/plain' : 'application/json',
    createdAt: Date.now(), ...opts,
  };
  assets.set(id, rec);
  return rec;
}

export function putBufferAsset(buf: Buffer, kind: AssetRecord['kind'], ext: string, opts: Partial<AssetRecord> = {}): AssetRecord {
  const id = `a_${uid()}`;
  const dest = path.join(config.scratch, 'assets', `${id}${ext}`);
  fs.writeFileSync(dest, buf);
  const rec: AssetRecord = {
    id, path: dest, kind,
    mime: kind === 'thumb' ? 'image/jpeg' : kind === 'caption' ? 'text/plain' : 'application/json',
    createdAt: Date.now(), ...opts,
  };
  assets.set(id, rec);
  return rec;
}

export function getAsset(id: string): AssetRecord {
  const rec = assets.get(id);
  if (!rec || !fs.existsSync(rec.path)) fail('NOT_FOUND', 'This asset is no longer on the server. Re-render the clip to get a fresh copy.', id);
  touch(rec.path);
  return rec!;
}

/** Server-side enforcement: the UI cannot bypass this gate. */
export function assertDownloadable(rec: AssetRecord) {
  if (rec.rights?.tier === 'BLOCKED') fail('RIGHTS_BLOCKED', 'This clip is blocked by CLAIM SHIELD and cannot be downloaded or published. Open the Rights tab to review and repair it.', rec.rights.clipId);
  if (rec.rights?.tier === 'REVIEW' && rec.rights.confirmation !== true) fail('RIGHTS_BLOCKED', 'This clip needs a stored review confirmation before it can be downloaded or published. Open the Rights tab to confirm.', rec.rights.clipId);
}

export function deleteAsset(id: string) {
  const rec = assets.get(id);
  if (!rec) return;
  try { fs.unlinkSync(rec.path); } catch { /* ignore */ }
  assets.delete(id);
}

export async function sweepAssets() {
  const cutoff = Date.now() - config.fileTtlMin * 60_000;
  for (const [id, rec] of assets) {
    if (rec.createdAt < cutoff) deleteAsset(id);
  }
}
