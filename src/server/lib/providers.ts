import fs from 'node:fs';
import path from 'node:path';
import { config, modes } from '../config';
import type { AsrMode, LlmMode, Transcript, Word } from '@shared/types';
import { run, runChecked, uid } from './util';

const postJson = async (url: string, body: unknown, headers: Record<string, string>, timeoutMs = 45_000) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`${new URL(url).host} returned ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return await r.json() as Record<string, unknown>;
  } finally { clearTimeout(t); }
};

/* ------------------------------------------------------------------ LLM */

export interface MomentSuggestion {
  start: number; end: number; title: string; hook: string; why: string; score: number; improvements: string[];
}

const LLM_SYSTEM = `You are SPLICE's editorial engine. You receive a transcript with word timings and shot boundaries. Return ONLY strict JSON: {"moments":[{"start":number,"end":number,"title":string,"hook":string,"why":string,"score":number,"improvements":string[]}]}. Choose self-contained, speech-dominant moments. Never suggest transforms that evade content fingerprinting (no speed, pitch, mirroring, frame shuffling or audio distortion). "why" must explain virality in one sentence. "improvements" must be concrete editorial notes. No markdown.`;

function parseLlm(text: string): MomentSuggestion[] {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  if (start < 0) throw new Error('LLM returned no JSON');
  const parsed = JSON.parse(cleaned.slice(start)) as { moments?: MomentSuggestion[] };
  if (!Array.isArray(parsed.moments)) throw new Error('LLM returned no moments array');
  return parsed.moments.filter((m) => Number.isFinite(m.start) && Number.isFinite(m.end) && m.end > m.start);
}

export async function suggestMoments(input: {
  transcript: Transcript; shots: Array<{ start: number; end: number }>;
  duration: number; count: number; targetSeconds: number; clipType: string; language: string;
}): Promise<{ source: 'llm' | 'heuristic'; moments: MomentSuggestion[]; mode: LlmMode }> {
  const mode = modes().llm;
  const transcript = input.transcript.words.slice(0, 900).map((w) => `${w.start.toFixed(1)}:${w.w}`).join(' ').slice(0, 20_000);
  const user = JSON.stringify({
    duration: input.duration, count: input.count, targetSeconds: input.targetSeconds,
    clipType: input.clipType, language: input.language,
    shots: input.shots.slice(0, 200),
    transcript: transcript || '(no transcript available — use shot/energy metadata only)',
  });
  try {
    let content = '';
    if (mode === 'tokenharbor' || mode === 'groq' || mode === 'openai-compatible') {
      const base = mode === 'tokenharbor' ? config.tokenHarbor.base.replace(/\/$/, '')
        : mode === 'groq' ? 'https://api.groq.com/openai/v1'
        : config.openaiBase.replace(/\/$/, '');
      const key = mode === 'tokenharbor' ? config.tokenHarbor.key : mode === 'groq' ? config.groq : config.openaiCompatible;
      const model = mode === 'tokenharbor' ? config.tokenHarbor.model : mode === 'groq' ? 'llama-3.3-70b-versatile' : (process.env.OPENAI_COMPATIBLE_MODEL ?? 'gpt-4o-mini');
      const res = await postJson(`${base}/chat/completions`, {
        model, temperature: 0.3, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: LLM_SYSTEM }, { role: 'user', content: user }],
      }, { authorization: `Bearer ${key}` });
      content = String((res.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content ?? '');
    } else if (mode === 'gemini') {
      const res = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(config.gemini)}`, {
        systemInstruction: { parts: [{ text: LLM_SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
      }, {});
      content = String((res.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined)?.[0]?.content?.parts?.[0]?.text ?? '');
    } else {
      throw new Error('heuristic mode');
    }
    return { source: 'llm', moments: parseLlm(content), mode };
  } catch {
    // Heuristic engine is the guaranteed zero-key path. Never fabricate LLM output.
    return { source: 'heuristic', moments: [], mode: modes().llm === 'heuristic' ? 'heuristic' : mode };
  }
}

/* ------------------------------------------------------------------ ASR */

export function asrMode(): AsrMode { return modes().asr; }

async function localWhisper(audio: string, language: string): Promise<Transcript> {
  const bin = process.env.WHISPER_CPP_BIN ?? '/opt/whisper/main';
  const model = process.env.WHISPER_MODEL ?? '/opt/whisper/models/ggml-tiny.bin';
  if (!fs.existsSync(bin) || !fs.existsSync(model)) throw new Error('whisper.cpp engine not installed');
  const outDir = path.join(path.dirname(audio), `asr-${uid()}`);
  fs.mkdirSync(outDir, { recursive: true });
  await runChecked(bin, [
    '-m', model, '-f', audio, '-oj', '-of', path.join(outDir, 't'),
    '-l', language === 'auto' ? 'auto' : language, '--no-prints', '-t', '2',
  ], { timeoutMs: 20 * 60_000 });
  const jsonPath = path.join(outDir, 't.json');
  if (!fs.existsSync(jsonPath)) throw new Error('whisper produced no transcript');
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as { transcription?: Array<{ offsets?: { from?: string; to?: string }; text?: string }> };
  const parseOffset = (s?: string) => s ? Number(s.replace('ms', '')) / 1000 : 0;
  const words: Word[] = (data.transcription ?? []).map((seg) => ({
    w: (seg.text ?? '').trim(), start: parseOffset(seg.offsets?.from), end: parseOffset(seg.offsets?.to), conf: 0.7,
  })).filter((w) => w.w.length > 0 && w.end > w.start);
  return { words, text: words.map((w) => w.w).join(' '), mode: 'local-basic' };
}

export async function transcribe(audio: string, language: string, signal?: AbortSignal): Promise<Transcript> {
  const mode = asrMode();
  if (mode === 'groq-whisper-large-v3-turbo') {
    const ctl = new AbortController();
    signal?.addEventListener('abort', () => ctl.abort(), { once: true });
    const form = new FormData();
    form.append('file', new Blob([await import('node:fs/promises').then((m) => m.readFile(audio))], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', 'whisper-large-v3-turbo');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    if (language !== 'auto') form.append('language', language);
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { authorization: `Bearer ${config.groq}` }, body: form, signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`Groq ASR ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json() as { words?: Array<{ word: string; start: number; end: number; confidence?: number }>; text?: string };
    const words = (j.words ?? []).map((w) => ({ w: w.word.trim(), start: w.start, end: w.end, conf: w.confidence }));
    return { words, text: j.text ?? words.map((w) => w.w).join(' '), mode };
  }
  if (mode === 'deepgram') {
    const bytes = await import('node:fs/promises').then((m) => m.readFile(audio));
    const r = await fetch(`https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true&diarize=false&language=${language === 'auto' ? 'multi' : language}`, {
      method: 'POST', headers: { authorization: `Token ${config.deepgram}`, 'content-type': 'audio/wav' }, body: bytes, signal,
    });
    if (!r.ok) throw new Error(`Deepgram ${r.status}`);
    const j = await r.json() as { results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string; words?: Array<{ word: string; start: number; end: number; confidence: number }> }> }> } };
    const alt = j.results?.channels?.[0]?.alternatives?.[0];
    const words = (alt?.words ?? []).map((w) => ({ w: w.word, start: w.start, end: w.end, conf: w.confidence }));
    return { words, text: alt?.transcript ?? '', mode };
  }
  if (mode === 'assemblyai') {
    const bytes = await import('node:fs/promises').then((m) => m.readFile(audio));
    const up = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST', headers: { authorization: config.assembly, 'content-type': 'application/octet-stream' }, body: bytes, signal,
    });
    if (!up.ok) throw new Error(`AssemblyAI upload ${up.status}`);
    const { upload_url } = await up.json() as { upload_url: string };
    const req = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST', headers: { authorization: config.assembly, 'content-type': 'application/json' },
      body: JSON.stringify({ audio_url: upload_url, language_code: language === 'auto' ? undefined : language }), signal,
    });
    const { id } = await req.json() as { id: string };
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, { headers: { authorization: config.assembly }, signal });
      const j = await poll.json() as { status: string; text?: string; words?: Array<{ text: string; start: number; end: number; confidence: number }> };
      if (j.status === 'completed') {
        const words = (j.words ?? []).map((w) => ({ w: w.text, start: w.start / 1000, end: w.end / 1000, conf: w.confidence }));
        return { words, text: j.text ?? '', mode };
      }
      if (j.status === 'error') throw new Error('AssemblyAI transcript failed');
    }
    throw new Error('AssemblyAI timeout');
  }
  // local-basic: real whisper.cpp when present; otherwise no transcript (never invented).
  return localWhisper(audio, language);
}

/** No-key engines may be absent: report honestly instead of inventing words. */
export function localAsrAvailable(): boolean {
  const bin = process.env.WHISPER_CPP_BIN ?? '/opt/whisper/main';
  const model = process.env.WHISPER_MODEL ?? '/opt/whisper/models/ggml-tiny.bin';
  return fs.existsSync(bin) && fs.existsSync(model);
}

/* ------------------------------------------------------- fingerprinting */

export interface FingerprintHit { confidence: number; coveredSeconds: number; title?: string }

export async function fingerprint(audio: string, range?: { start: number; end: number }): Promise<FingerprintHit | null> {
  const mode = modes().rights;
  try {
    if (mode === 'audd') {
      const form = new FormData();
      form.append('api_token', config.audd);
      form.append('file', new Blob([await import('node:fs/promises').then((m) => m.readFile(audio))]), 'audio.wav');
      const r = await fetch('https://api.audd.io/', { method: 'POST', body: form });
      const j = await r.json() as { status?: string; result?: { title?: string; artist?: string }; score?: number };
      if (j.status === 'success' && j.result) {
        return { confidence: Number(j.score ?? 0.8), coveredSeconds: range ? range.end - range.start : 30, title: `${j.result.title ?? 'Unknown'} — ${j.result.artist ?? ''}` };
      }
      return null;
    }
    if (mode === 'acrcloud') {
      // ACRCloud requires a signed request; sign with its documented HMAC scheme.
      const crypto = await import('node:crypto');
      const method = 'POST', uri = '/v1/identify', dataType = 'audio', dataVersion = '1';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const stringToSign = `${method}\n${uri}\n${config.acrcloud.key}\n${dataType}\n${dataVersion}\n${timestamp}`;
      const signature = crypto.createHmac('sha1', config.acrcloud.secret).update(stringToSign).digest('base64');
      const form = new FormData();
      form.append('access_key', config.acrcloud.key);
      form.append('timestamp', timestamp);
      form.append('signature', signature);
      form.append('data_type', dataType);
      form.append('data_version', dataVersion);
      form.append('sample', new Blob([await import('node:fs/promises').then((m) => m.readFile(audio))]), 'sample.wav');
      const host = config.acrcloud.host || 'identify-us-west-2.acrcloud.com';
      const r = await fetch(`https://${host}/v1/identify`, { method: 'POST', body: form });
      const j = await r.json() as { status?: { code?: number }; result?: { music?: Array<{ title?: string; artists?: Array<{ name?: string }>; score?: number }> } };
      const m = j.result?.music?.[0];
      if (m) return { confidence: Number(m.score ?? 0.8), coveredSeconds: range ? range.end - range.start : 30, title: `${m.title ?? 'Unknown'} — ${m.artists?.[0]?.name ?? ''}` };
      return null;
    }
  } catch { /* fall through: zero-key heuristics still run */ }
  return null;
}

export function disposeProcess(kill: () => void) { try { kill(); } catch { /* ignore */ } }
export const makeId = uid;
export const spawnRun = run;
