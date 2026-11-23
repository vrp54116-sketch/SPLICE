import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';

export const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');
export const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;

export function safeName(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/')).replace(/\.[^.]+$/, '');
  const clean = base.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return (clean || 'video').slice(0, 64);
}

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export interface RunResult { stdout: string; stderr: string; code: number }
export interface RunningProcess { promise: Promise<RunResult>; kill: () => void }

/** Global registry so a cancel request can kill every ffmpeg/yt-dlp child. */
const activeKillers = new Set<() => void>();
export const registerKiller = (fn: () => void) => { activeKillers.add(fn); return () => activeKillers.delete(fn); };
export const killActiveProcesses = () => { for (const k of [...activeKillers]) { try { k(); } catch { /* ignore */ } } };

/** Spawn without shell. Kills the whole process group on cancel. */
export function run(cmd: string, args: string[], opts: { timeoutMs?: number; cwd?: string; signal?: AbortSignal } = {}): RunningProcess {
  const child: ChildProcess = spawn(cmd, args, {
    cwd: opts.cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); if (stdout.length > 2_000_000) stdout = stdout.slice(-1_000_000); });
  child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); if (stderr.length > 2_000_000) stderr = stderr.slice(-1_000_000); });
  let killed = false;
  const kill = () => {
    if (killed || !child.pid) return;
    killed = true;
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
  };
  const unregister = registerKiller(kill);
  const promise = new Promise<RunResult>((resolve, reject) => {
    const timer = opts.timeoutMs ? setTimeout(() => { kill(); reject(new Error(`timeout after ${opts.timeoutMs}ms`)); }, opts.timeoutMs) : null;
    const onAbort = () => { kill(); reject(new Error('canceled')); };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e) => { if (timer) clearTimeout(timer); opts.signal?.removeEventListener('abort', onAbort); unregister(); reject(e); });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      unregister();
      resolve({ stdout, stderr, code: code ?? -1 });
    });
  });
  return { promise, kill };
}

export async function runChecked(cmd: string, args: string[], opts: Parameters<typeof run>[2] = {}) {
  const r = run(cmd, args, opts);
  const res = await r.promise;
  if (res.code !== 0) throw new Error(`${path.basename(cmd)} exited ${res.code}: ${res.stderr.slice(-3000)}`);
  return res;
}

export async function ensureDirs() {
  await fsp.mkdir(path.join(config.scratch, 'uploads'), { recursive: true });
  await fsp.mkdir(path.join(config.scratch, 'jobs'), { recursive: true });
  await fsp.mkdir(path.join(config.scratch, 'assets'), { recursive: true });
  await fsp.mkdir(path.join(config.scratch, 'backgrounds'), { recursive: true });
}

/** Boot cleanup + TTL sweep. Never touches outside scratch. */
export async function cleanupScratch() {
  const now = Date.now();
  await ensureDirs();
  for (const sub of ['uploads', 'jobs', 'assets', 'backgrounds']) {
    const dir = path.join(config.scratch, sub);
    let entries: string[] = [];
    try { entries = await fsp.readdir(dir); } catch { continue; }
    for (const e of entries) {
      const p = path.join(dir, e);
      try {
        const st = await fsp.stat(p);
        if (now - st.mtimeMs > config.fileTtlMin * 60_000) await fsp.rm(p, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  }
}

export function touch(p: string) { try { const t = Date.now(); fs.utimesSync(p, t / 1000, t / 1000); } catch { /* ignore */ } }

export function clamp(v: number, min: number, max: number) { return Math.min(max, Math.max(min, v)); }

export function parseTimeLike(input: string): number | null {
  const v = input.trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v);
  const parts = v.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n)) || parts.length > 3) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}
