import path from 'node:path';
import os from 'node:os';
import { emptyApiKeys, type ApiKeys, type CapabilityModes } from '@shared/types';

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const baseConfig = {
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
  acrcloud: {
    key: process.env.ACRCLOUD_ACCESS_KEY ?? '',
    secret: process.env.ACRCLOUD_ACCESS_SECRET ?? '',
    host: process.env.ACRCLOUD_HOST ?? '',
  },
  youtube: {
    cookiesB64: process.env.YT_COOKIES_B64 ?? '',
    proxy: process.env.YT_PROXY ?? '',
    clientId: process.env.YOUTUBE_CLIENT_ID ?? '',
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET ?? '',
  },
  apiToken: process.env.SPLICE_API_TOKEN ?? '',
  startedAt: Date.now(),
};

export type ServerConfig = typeof baseConfig;
export const config: ServerConfig = baseConfig;

/** Browser-entered keys override environment keys; environment is the fallback. */
export function effectiveConfig(keys: ApiKeys = emptyApiKeys()): ServerConfig {
  return {
    ...baseConfig,
    tokenHarbor: {
      key: keys.tokenHarborKey || baseConfig.tokenHarbor.key,
      base: keys.tokenHarborBase || baseConfig.tokenHarbor.base,
      model: keys.tokenHarborModel || baseConfig.tokenHarbor.model,
    },
    groq: keys.groq || baseConfig.groq,
    gemini: keys.gemini || baseConfig.gemini,
    openaiCompatible: keys.openaiCompatible || baseConfig.openaiCompatible,
    openaiBase: keys.openaiBase || baseConfig.openaiBase,
    deepgram: keys.deepgram || baseConfig.deepgram,
    assembly: keys.assembly || baseConfig.assembly,
    audd: keys.audd || baseConfig.audd,
    acrcloud: {
      key: keys.acrcloudKey || baseConfig.acrcloud.key,
      secret: keys.acrcloudSecret || baseConfig.acrcloud.secret,
      host: keys.acrcloudHost || baseConfig.acrcloud.host,
    },
  };
}

export function modes(keys: ApiKeys = emptyApiKeys()): CapabilityModes {
  const c = effectiveConfig(keys);
  return {
    llm: c.tokenHarbor.key && c.tokenHarbor.base ? 'tokenharbor'
      : c.groq ? 'groq'
      : c.gemini ? 'gemini'
      : c.openaiCompatible && c.openaiBase ? 'openai-compatible'
      : 'heuristic',
    asr: c.groq ? 'groq-whisper-large-v3-turbo'
      : c.deepgram ? 'deepgram'
      : c.assembly ? 'assemblyai'
      : 'local-basic',
    rights: c.audd ? 'audd'
      : c.acrcloud.key ? 'acrcloud'
      : 'dsp-heuristics',
  };
}

/** Never call this with values containing secrets. */
export function publicEnv(keys: ApiKeys = emptyApiKeys()) {
  return {
    ...modes(keys),
    hasYouTubeOAuth: Boolean(baseConfig.youtube.clientId && baseConfig.youtube.clientSecret),
    requiresToken: Boolean(baseConfig.apiToken),
  };
}
