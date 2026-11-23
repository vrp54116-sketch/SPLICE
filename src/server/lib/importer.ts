import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { fail } from '../errors';
import { runChecked, uid, run } from './util';

export const YTDLP = process.env.YTDLP_BIN ?? '/usr/local/bin/yt-dlp';
const ALLOWED_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com', 'www.youtube-nocookie.com'];

export interface ImportResult {
  path: string; ref: string; title: string; channel: string; duration: number;
  thumbnail: string; license: string; description: string; note?: string;
}

export function validateVideoUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { fail('INVALID_URL', 'That does not look like a video URL. Paste a http(s) link to a YouTube video or Short.'); }
  if (!['http:', 'https:'].includes(u!.protocol)) fail('INVALID_URL', 'Only http(s) video URLs are supported.');
  const host = u!.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.includes(host)) fail('INVALID_URL', `Only YouTube links are imported directly (${ALLOWED_HOSTS[0]}). For other sites, upload the file instead.`);
  if (u!.username || u!.password) fail('INVALID_URL', 'Credentials in URLs are not accepted.');
  return u!;
}

function cookieArgs(): string[] {
  if (!config.youtube.cookiesB64) return [];
  const file = path.join(config.scratch, `cookies-${uid()}.txt`);
  try {
    fs.writeFileSync(file, Buffer.from(config.youtube.cookiesB64, 'base64').toString('utf8'), { mode: 0o600 });
    return ['--cookies', file];
  } catch { return []; }
}

function proxyArgs(): string[] { return config.youtube.proxy ? ['--proxy', config.youtube.proxy] : []; }

export async function ytdlpAvailable(): Promise<boolean> {
  try { await runChecked(YTDLP, ['--version'], { timeoutMs: 10_000 }); return true; } catch { return false; }
}

export async function ytdlpVersion(): Promise<string> {
  try { return (await runChecked(YTDLP, ['--version'], { timeoutMs: 10_000 })).stdout.trim(); } catch { return 'unavailable'; }
}

/** Resolve metadata without downloading. Handles playlists by taking the first video. */
export async function probeUrl(raw: string): Promise<Omit<ImportResult, 'path' | 'ref'>> {
  const url = validateVideoUrl(raw);
  if (!(await ytdlpAvailable())) fail('ENGINE_UNAVAILABLE', 'yt-dlp is missing from this container. Rebuild the Docker image, or upload your file directly.');
  const isPlaylist = url.searchParams.has('list') || url.pathname.includes('/playlist') || /[?&]index=/.test(url.search);
  const args = ['--dump-single-json', '--skip-download', '--no-warnings', ...proxyArgs(), ...cookieArgs()];
  if (isPlaylist) args.push('--playlist-end', '1', '--flat-playlist');
  args.push(url.toString());

  let last = '';
  for (const client of ['tv', 'web_safari', 'android']) {
    try {
      const r = await runChecked(YTDLP, [...args, '--extractor-args', `youtube:player_client=${client}`], { timeoutMs: 90_000 });
      const j = JSON.parse(r.stdout) as Record<string, unknown>;
      const live = j.live_status === 'is_live' || j.live_status === 'is_upcoming';
      if (live) fail('LIVE_UNSUPPORTED', 'This is a live stream or upcoming broadcast. Live streams cannot be imported.');
      const duration = Number(j.duration ?? 0) || 0;
      if (duration > 120 * 60) fail('TOO_LARGE', 'This video is longer than 120 minutes. Upload a trimmed copy instead.');
      const entries = (j.entries as Array<Record<string, unknown>> | undefined) ?? [];
      const e = entries[0] ?? j;
      const thumbnails = (e.thumbnails as Array<{ url?: string }> | undefined) ?? [];
      return {
        title: String(e.title ?? 'Untitled video'),
        channel: String(e.channel ?? e.uploader ?? 'Unknown channel'),
        duration: Number(e.duration ?? duration ?? 0),
        thumbnail: String(e.thumbnail ?? thumbnails.at(-1)?.url ?? ''),
        license: String(e.license ?? ''),
        description: String(e.description ?? '').slice(0, 4000),
        ...(isPlaylist ? { note: 'Playlist detected — resolving the first video only.' } : {}),
      };
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
      if (last.includes('LIVE_UNSUPPORTED') || last.includes('TOO_LARGE') || last.includes('INVALID_URL')) throw e;
    }
  }
  const m = last.toLowerCase();
  if (m.includes('private')) fail('PRIVATE', 'This video is private.', last);
  if (m.includes('age') || m.includes('18+')) fail('AGE_RESTRICTED', 'Age confirmation is required.', last);
  if (m.includes('not available in your country') || m.includes('geo')) fail('GEO_BLOCKED', 'Blocked in the server region.', last);
  if (m.includes('404') || m.includes('unavailable')) fail('NOT_FOUND', 'This video could not be found.', last);
  fail('BOT_BLOCKED', 'The site challenged the datacenter connection.', last);
}

export async function downloadVideo(raw: string): Promise<ImportResult> {
  const meta = await probeUrl(raw);
  const id = `yt_${uid()}`;
  const outDir = path.join(config.scratch, 'uploads', id);
  fs.mkdirSync(outDir, { recursive: true });
  const templ = path.join(outDir, 'video.%(ext)s');
  let last = '';
  for (const client of ['tv', 'web_safari', 'android']) {
    const p = run(YTDLP, [
      '--no-playlist', '--no-warnings', '-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/b',
      '--merge-output-format', 'mp4', '-o', templ, ...proxyArgs(), ...cookieArgs(),
      '--extractor-args', `youtube:player_client=${client}`, raw,
    ]);
    try {
      const res = await p.promise;
      if (res.code !== 0) throw new Error(res.stderr.slice(-500));
      const file = fs.readdirSync(outDir).find((f) => f.startsWith('video.') && /\.(mp4|mkv|webm)$/i.test(f));
      if (!file) throw new Error('yt-dlp produced no file');
      return { ...meta, path: path.join(outDir, file), ref: id };
    } catch (e) { last = e instanceof Error ? e.message : String(e); }
  }
  fail('BOT_BLOCKED', 'Download was challenged after three player-client attempts.', last);
}
