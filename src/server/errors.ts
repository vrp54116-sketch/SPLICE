import type { ErrorCode, TypedError } from '@shared/types';

export const REMEDIES: Record<ErrorCode, string> = {
  INVALID_URL: 'Paste a single public http(s) video URL. Playlists are resolved to one video; live streams cannot be imported.',
  NOT_FOUND: 'The video may have been removed. Check the link in a browser, then paste the current URL.',
  PRIVATE: 'This video is private. Ask the owner for access, or upload the file directly instead.',
  LIVE_UNSUPPORTED: 'Live streams are not supported. Wait for the broadcast to end, then import the finished video.',
  AGE_RESTRICTED: 'Age sign-in is required. Add your YouTube cookies in Settings, or upload the file directly.',
  GEO_BLOCKED: 'This video is not available in the server region. Set YT_PROXY to a region where it is available, or upload directly.',
  BOT_BLOCKED: 'The site challenged the datacenter IP. Add YT_COOKIES_B64 (base64 Netscape cookies) in your environment, set YT_PROXY, or upload the file directly. Player clients tv → web_safari → android are tried automatically.',
  TOO_LARGE: 'The source exceeds the configured limit (2 GB / 120 min). Trim it locally or lower the resolution before uploading.',
  SERVER_BUSY: 'One render runs at a time on the free tier. Your job is queued; the position is shown live and it starts automatically.',
  ENGINE_UNAVAILABLE: 'The media engine is not installed in this container. Rebuild the image so ffmpeg and yt-dlp are present.',
  RIGHTS_BLOCKED: 'This clip is blocked by CLAIM SHIELD. Open the Rights tab to review the parameters and run a legal repair, or choose a different source you can prove you own.',
  EXTRACT_FAILED: 'Metadata could not be extracted. Verify the URL and try again; if it persists, upload the file directly.',
  VALIDATION: 'Check the highlighted field and its helper text, then try again.',
  RATE_LIMIT: 'Too many probes in one minute. Wait a moment and retry.',
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly remedy: string;
  readonly detail?: string;
  constructor(code: ErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.remedy = REMEDIES[code];
    this.detail = detail && process.env.NODE_ENV !== 'production' ? detail.slice(0, 300) : undefined;
  }
  toJSON(): TypedError {
    return { code: this.code, message: this.message, remedy: this.remedy, ...(this.detail ? { detail: this.detail } : {}) };
  }
}

export function typedError(err: unknown): TypedError {
  if (err instanceof AppError) return err.toJSON();
  const msg = err instanceof Error ? err.message : String(err);
  // Map common subprocess strings to specific, actionable codes.
  const m = msg.toLowerCase();
  if (m.includes('sign in to confirm') || m.includes('bot') || m.includes('http error 403')) return new AppError('BOT_BLOCKED', 'The site challenged this connection.', msg).toJSON();
  if (m.includes('video unavailable') || m.includes('http error 404')) return new AppError('NOT_FOUND', 'This video could not be found.', msg).toJSON();
  if (m.includes('private video')) return new AppError('PRIVATE', 'This video is private.', msg).toJSON();
  if (m.includes('live stream') || m.includes('is live')) return new AppError('LIVE_UNSUPPORTED', 'This is a live stream.', msg).toJSON();
  if (m.includes('age') && m.includes('confirm')) return new AppError('AGE_RESTRICTED', 'Age confirmation is required.', msg).toJSON();
  if (m.includes('not available in your country') || m.includes('geo')) return new AppError('GEO_BLOCKED', 'Blocked in this region.', msg).toJSON();
  return new AppError('EXTRACT_FAILED', 'The media operation failed.', msg).toJSON();
}

export function fail(code: ErrorCode, message: string, detail?: string): never {
  throw new AppError(code, message, detail);
}
