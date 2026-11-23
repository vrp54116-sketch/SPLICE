import path from 'node:path';
import os from 'node:os';
import type { CapabilityModes } from '@shared/types';

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export const config = {
  port: num(process.env.PORT, 3001),
  host: '0.0.0.0',
  scratch: process.env.SPLICE_SCRATCH ?? path.join(os.tmpdir(), 'splice'),
  fileTtlMin: num(process.env.FILE_TTL_MIN, 45),
  maxUploadGb: num(process.env.MAX_UPLOAD_GB, 2),
  maxConcurrent: Math.max(1, num(process.env.MAX_CONCURRENT, 1)),
  chunkSize: 8 * 1024 * 1024,
  probeRate: 10,
  tokenHarbor: {
    key: process.env.TOKENHARBOR_API_KEY ?? '',
    base: process.env.TOKENHARBOR_BASE_URL ?? '',
    model: process.env.TOKENHARBOR_MODEL ?? '',
  },
  groq: process.env.GROQ_API_KEY ?? '',
  gemini: process.env.GEMINI_API_KEY ?? '',
  openaiCompatible: process.env.OPENAI_COMPATIBLE_API_KEY ?? '',
  openaiBase: process.env.OPENAI_COMPATIBLE_BASE_URL ?? '',
  deepgram: process.env.DEEPGRAM_API_KEY ?? '',
  assembly: process.env.ASSEMBLYAI_API_KEY ?? '',
  audd: process.env.AUDD_API_KEY ?? '',
  acrcloud: { key: process.env.ACRCLOUD_ACCESS_KEY ?? '', secret: process.env.ACRCLOUD_ACCESS_SECRET ?? '', host: process.env.ACRCLOUD_HOST ?? '' },
  youtube: {
    cookiesB64: process.env.YT_COOKIES_B64 ?? '',
    proxy: process.env.YT_PROXY ?? '',
    clientId: process.env.YOUTUBE_CLIENT_ID ?? '',
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET ?? '',
  },
  apiToken: process.env.SPLICE_API_TOKEN ?? '',
  startedAt: Date.now(),
};

export const modes = (): CapabilityModes => ({
  llm: config.tokenHarbor.key && config.tokenHarbor.base ? 'tokenharbor'
    : config.groq ? 'groq'
    : config.gemini ? 'gemini'
    : config.openaiCompatible && config.openaiBase ? 'openai-compatible'
    : 'heuristic',
  asr: config.groq ? 'groq-whisper-large-v3-turbo'
    : config.deepgram ? 'deepgram'
    : config.assembly ? 'assemblyai'
    : 'local-basic',
  rights: config.audd ? 'audd' : config.acrcloud.key ? 'acrcloud' : 'dsp-heuristics',
});

/** Never call this with values containing secrets. */
export const publicEnv = () => ({
  llm: modes().llm,
  asr: modes().asr,
  rights: modes().rights,
  hasYouTubeOAuth: Boolean(config.youtube.clientId && config.youtube.clientSecret),
  requiresToken: Boolean(config.apiToken),
});
