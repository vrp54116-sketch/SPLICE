// SPLICE shared contract. Imported by both the Vite client and the Fastify server.

export interface Span { start: number; end: number }
export type Attestation = 'owned' | 'licensed' | 'public_domain' | 'cc' | 'unknown';
export type RightsPolicy = 'strict' | 'balanced' | 'own_content';
export type ShieldTier = 'CLEAR' | 'REVIEW' | 'BLOCKED';
export type ClipType =
  | 'viral' | 'phrase' | 'topic' | 'trailer' | 'funny' | 'podcast'
  | 'tutorial' | 'motivational' | 'storytime' | 'product' | 'speaker' | 'custom';
export type Aspect = '9:16' | '16:9' | '1:1';
export type Language =
  | 'auto' | 'en' | 'hi' | 'hinglish' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'ja' | 'ko' | 'ar';
export type DurationBucket = 'auto' | 'short' | 'medium' | 'long' | 'extended';
export type Reframe = 'face' | 'center' | 'manual';
export type CaptionStyle =
  | 'classic' | 'cyan-slide' | 'italic-red' | 'cream-blue' | 'red-spin'
  | 'violet-glow' | 'blue-glow' | 'toxic-green' | 'neon-punch'
  | 'karaoke-pop' | 'minimal-mono' | 'hinglish-bold';
export type BackgroundId =
  | 'plasma' | 'mandelbrot' | 'life' | 'cellauto' | 'starfield'
  | 'kinetic' | 'inkbloom' | 'tapenoise';
export type MusicId = 'lofi' | 'cinematic' | 'upbeat' | 'ambient' | 'tension' | 'comedy';

export interface Source {
  kind: 'upload' | 'youtube';
  /** Upload token from /api/upload/complete, or the original URL. */
  ref: string;
  filename?: string;
  url?: string;
  title?: string;
  channel?: string;
  license?: string;
  duration?: number;
  thumbnail?: string;
  /** Browser offload results cached per source. */
  offload?: OffloadResult;
}

export interface ProjectConfig {
  source: Source;
  attestation: Attestation;
  attestationProof?: string;
  clipType: ClipType;
  customPrompt?: string;
  clipCount: number;
  duration: DurationBucket;
  aspect: Aspect;
  language: Language;
  timeframe: { start: number; end: number };
  captions: boolean;
  captionStyle: CaptionStyle;
  autoHook: boolean;
  hookTone: string;
  reframe: Reframe;
  manualCrop?: { x: number; y: number; zoom: number };
  music: boolean;
  musicMood: MusicId;
  musicVolume: number;
  splitScreen: boolean;
  backgrounds: BackgroundId[];
  splitRatio: number;
  rightsPolicy: RightsPolicy;
  resolution: 1080 | 720 | 480;
  filenameTemplate: string;
  brand?: BrandConfig;
  voiceoverRef?: string;
  feedbackWeights?: { energy: number; speech: number; novelty: number };
}

export interface BrandConfig {
  name: string;
  logoDataUrl?: string;
  primary: string;
  accent: string;
  captionPreset: CaptionStyle;
  introText?: string;
  outroText?: string;
}

export interface Word { w: string; start: number; end: number; conf?: number }
export interface Transcript { words: Word[]; text: string; mode: AsrMode }

export interface Shot { start: number; end: number; score: number }

export interface OffloadFrame {
  t: number;
  faces: Array<{ x: number; y: number; w: number; h: number; score: number }>;
  ocr: string[];
  phash: string;
  saliency: { x: number; y: number };
  /** Measured pixel statistics from the browser canvas — detectors read these, never guesses. */
  chrome?: { bottomBar: number; rightRail: number; handleChip: number };
  roi?: { corners: number; lowerThird: number; frameChange: number; staticCorner: number };
  bars?: { letterbox: number; pillarbox: number };
}
export interface OffloadResult {
  frames: OffloadFrame[];
  engine: 'browser' | 'fallback';
  faceEngine: string;
  ocrEngine: string;
}

export type AsrMode = 'groq-whisper-large-v3-turbo' | 'deepgram' | 'assemblyai' | 'local-basic' | 'none';
export type LlmMode = 'tokenharbor' | 'groq' | 'gemini' | 'openai-compatible' | 'heuristic';
export type RightsMode = 'audd' | 'acrcloud' | 'dsp-heuristics';

export interface CapabilityModes {
  llm: LlmMode;
  asr: AsrMode;
  rights: RightsMode;
}

export interface Moment {
  id: string;
  start: number;
  end: number;
  title: string;
  hook: string;
  why: string;
  score: number;
  safety: number;
  improvements: string[];
  source: 'llm' | 'heuristic';
  metrics: { speechDensity: number; energy: number; novelty: number; laughter: number; completeness: number };
}

export interface AudioParam {
  id: 'A1' | 'A2' | 'A3' | 'A4';
  value: number;
  coverage: number;
  weight: number;
  evidence: string;
  hardBlock?: boolean;
  mitigation?: boolean;
}
export interface VisualParam {
  id: 'V1' | 'V2' | 'V3' | 'V4' | 'V5';
  value: number;
  coverage: number;
  weight: number;
  evidence: string;
  hardBlock?: boolean;
  mitigation?: boolean;
  roi?: { x: number; y: number; w: number; h: number };
}
export interface TextParam {
  id: 'T1' | 'T2' | 'T3';
  value: number;
  coverage: number;
  weight: number;
  evidence: string;
  hardBlock?: boolean;
  mitigation?: boolean;
}
export interface SourceParam {
  id: 'S1' | 'S2' | 'S3';
  value: number;
  coverage: number;
  weight: number;
  evidence: string;
  hardBlock?: boolean;
  mitigation?: boolean;
}
export interface TransformParam {
  id: 'X1';
  value: number;
  coverage: number;
  weight: number;
  evidence: string;
  hardBlock?: boolean;
  mitigation?: boolean;
}
export type ShieldParam = AudioParam | VisualParam | TextParam | SourceParam | TransformParam;
export type ParamId = ShieldParam['id'];

export interface ShieldReport {
  id: string;
  clipId: string;
  version: number;
  pass: number;
  risk: number;
  tier: ShieldTier;
  params: ShieldParam[];
  mitigations: number;
  createdAt: number;
  audioHeatmap: Array<{ start: number; end: number; level: number; flagged: boolean }>;
  forcedAttribution?: string;
  explanation: string;
}

export type RepairAction =
  | 'mute_music' | 'replace_music' | 'trim_span' | 'blur_roi'
  | 'crop_overlay' | 'add_attribution' | 'add_voiceover' | 'regenerate_meta';

export interface RepairPlan {
  action: RepairAction;
  reason: string;
  requiresConfirmation?: boolean;
  clears: ParamId[];
}

export interface ClipRecord {
  id: string;
  jobId: string;
  version: number;
  rank: number;
  title: string;
  hook: string;
  why: string;
  improvements: string[];
  virality: number;
  start: number;
  end: number;
  duration: number;
  aspect: Aspect;
  captionStyle: CaptionStyle;
  assetId: string;
  thumbId: string;
  transcript: Transcript;
  report: ShieldReport;
  status: 'ready' | 'blocked' | 'review';
  confirmation?: boolean;
  favorite: boolean;
  published: boolean;
  demo: boolean;
  createdAt: number;
  sourceTitle: string;
  configSnapshot: ProjectConfig;
  versions: Array<{ version: number; assetId: string; reportId: string; createdAt: number }>;
}

export interface ProjectRecord {
  id: string;
  title: string;
  createdAt: number;
  sourceTitle: string;
  status: 'draft' | 'processing' | 'done' | 'error';
  config?: ProjectConfig;
  clipIds: string[];
  demo: boolean;
}

export interface JobState {
  id: string;
  phase: 'queued' | 'ingest' | 'transcribe' | 'analyze' | 'score' | 'render' | 'rights' | 'ready' | 'error' | 'canceled';
  pct: number;
  speed: number;
  eta: number;
  step: number;
  steps: number;
  message: string;
  queuePosition: number;
  error?: TypedError;
  clips?: ClipRecord[];
  projectId?: string;
}
export interface JobEvent {
  type: 'state' | 'asset' | 'clip' | 'done' | 'error';
  state: JobState;
  payload?: unknown;
}

export type ProviderId = 'tokenharbor' | 'groq' | 'gemini' | 'openai-compatible' | 'deepgram' | 'assemblyai' | 'audd' | 'acrcloud';

/** Keys entered in Settings. Stored in the browser only and sent per request. */
export interface ApiKeys {
  tokenHarborKey: string;
  tokenHarborBase: string;
  tokenHarborModel: string;
  groq: string;
  gemini: string;
  openaiCompatible: string;
  openaiBase: string;
  deepgram: string;
  assembly: string;
  audd: string;
  acrcloudKey: string;
  acrcloudSecret: string;
  acrcloudHost: string;
}

export const emptyApiKeys = (): ApiKeys => ({
  tokenHarborKey: '', tokenHarborBase: '', tokenHarborModel: '',
  groq: '', gemini: '', openaiCompatible: '', openaiBase: '',
  deepgram: '', assembly: '', audd: '', acrcloudKey: '', acrcloudSecret: '', acrcloudHost: '',
});

export interface KeyFailure { provider: ProviderId; message: string; at: number }

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  tokenharbor: 'TokenHarbor', groq: 'Groq', gemini: 'Gemini', 'openai-compatible': 'OpenAI-compatible',
  deepgram: 'Deepgram', assemblyai: 'AssemblyAI', audd: 'AudD', acrcloud: 'ACRCloud',
};

export type ErrorCode =
  | 'INVALID_URL' | 'NOT_FOUND' | 'PRIVATE' | 'LIVE_UNSUPPORTED'
  | 'AGE_RESTRICTED' | 'GEO_BLOCKED' | 'BOT_BLOCKED' | 'TOO_LARGE'
  | 'SERVER_BUSY' | 'ENGINE_UNAVAILABLE' | 'RIGHTS_BLOCKED' | 'EXTRACT_FAILED'
  | 'VALIDATION' | 'RATE_LIMIT' | 'KEY_INVALID';
export interface TypedError {
  code: ErrorCode;
  message: string;
  remedy: string;
  detail?: string;
}

export const CAPTION_STYLES: Array<{ id: CaptionStyle; label: string; description: string }> = [
  { id: 'classic', label: 'Classic', description: 'Ivory on a soft shadow. Always reads.' },
  { id: 'cyan-slide', label: 'Cyan Slide', description: 'Words slide in on a cyan underline.' },
  { id: 'italic-red', label: 'Italic Red', description: 'Splice-red italics with a hard edge.' },
  { id: 'cream-blue', label: 'Cream Blue', description: 'Cream type on a deep blue plate.' },
  { id: 'red-spin', label: 'Red Spin', description: 'Each line rotates into place.' },
  { id: 'violet-glow', label: 'Violet Glow', description: 'Soft violet bloom, late-night feel.' },
  { id: 'blue-glow', label: 'Blue Glow', description: 'Cold cyan bloom for tech topics.' },
  { id: 'toxic-green', label: 'Toxic Green', description: 'Acid green with a jittery baseline.' },
  { id: 'neon-punch', label: 'Neon Punch', description: 'Magenta pop with a scale hit.' },
  { id: 'karaoke-pop', label: 'Karaoke Pop', description: 'Word-by-word karaoke fill.' },
  { id: 'minimal-mono', label: 'Minimal Mono', description: 'Monospaced, no plate, pure type.' },
  { id: 'hinglish-bold', label: 'Hinglish Bold', description: 'Heavy mixed-script treatment.' },
];

export const BACKGROUNDS: Array<{ id: BackgroundId; label: string; category: 'Satisfying' | 'Abstract' | 'Retro' }> = [
  { id: 'plasma', label: 'Plasma Drift', category: 'Satisfying' },
  { id: 'mandelbrot', label: 'Mandelbrot Zoom', category: 'Abstract' },
  { id: 'life', label: 'Game of Life', category: 'Retro' },
  { id: 'cellauto', label: 'Cellular Waves', category: 'Abstract' },
  { id: 'starfield', label: 'Starfield', category: 'Satisfying' },
  { id: 'kinetic', label: 'Kinetic Bars', category: 'Retro' },
  { id: 'inkbloom', label: 'Ink Bloom', category: 'Abstract' },
  { id: 'tapenoise', label: 'Tape Noise', category: 'Retro' },
];

export const MUSIC: Array<{ id: MusicId; label: string; description: string }> = [
  { id: 'lofi', label: 'Lo-fi', description: 'Dusty keys, slow pulse.' },
  { id: 'cinematic', label: 'Cinematic', description: 'Wide, patient, widescreen.' },
  { id: 'upbeat', label: 'Upbeat', description: 'Bright, bouncy, 150 BPM-ish.' },
  { id: 'ambient', label: 'Ambient', description: 'No beat, just air.' },
  { id: 'tension', label: 'Tension', description: 'Low, unresolved, uneasy.' },
  { id: 'comedy', label: 'Comedy', description: 'Pizzicato and rubber bones.' },
];

export const RIGHTS_HUE: Record<string, string> = {
  A1: '#FF5C5C', A2: '#FFB020', A3: '#22D3EE', A4: '#FF3DBE',
  V1: '#FF4D2E', V2: '#A8E635', V3: '#8B94A7', V4: '#F4F1EA', V5: '#7DD3FC',
  T1: '#FBBF24', T2: '#C084FC', T3: '#F472B6',
  S1: '#34D399', S2: '#F59E0B', S3: '#FB7185', X1: '#22D3EE',
};
