import PQueue from 'p-queue';
import type { JobEvent, JobState, ClipRecord, TypedError } from '@shared/types';
import { config } from '../config';
import { killActiveProcesses, uid } from './util';

export interface Job {
  id: string;
  state: JobState;
  controller: AbortController;
  killers: Set<() => void>;
  listeners: Set<(e: JobEvent) => void>;
  createdAt: number;
}

const jobs = new Map<string, Job>();
export const queue = new PQueue({ concurrency: config.maxConcurrent });

export function createJob(projectId?: string): Job {
  const id = `job_${uid()}`;
  const state: JobState = {
    id, phase: 'queued', pct: 0, speed: 0, eta: 0, step: 0, steps: 7,
    message: 'Waiting for the editor bay', queuePosition: queue.size + 1,
    ...(projectId ? { projectId } : {}),
  };
  const job: Job = { id, state, controller: new AbortController(), killers: new Set(), listeners: new Set(), createdAt: Date.now() };
  jobs.set(id, job);
  emit(id, { type: 'state', state });
  return job;
}

export function getJob(id: string): Job | undefined { return jobs.get(id); }
export function listJobs() { return [...jobs.values()].map((j) => j.state); }

export function emit(id: string, event: JobEvent) {
  const job = jobs.get(id);
  if (!job) return;
  if (event.type === 'state') job.state = event.state;
  for (const fn of [...(job?.listeners ?? [])]) {
    try { fn(event); } catch { /* dead subscriber */ }
  }
}

export function progress(id: string, patch: Partial<JobState>) {
  const job = jobs.get(id);
  if (!job || job.controller.signal.aborted) return;
  emit(id, { type: 'state', state: { ...job.state, ...patch } });
}

export function step(id: string, phase: JobState['phase'], step: number, message: string, pct?: number) {
  const job = jobs.get(id);
  if (!job) return;
  const total = job.state.steps;
  progress(id, { phase, step, message, pct: pct ?? Math.round((step / total) * 100), queuePosition: 0 });
}

export function subscribe(id: string, fn: (e: JobEvent) => void): () => void {
  const job = jobs.get(id);
  if (!job) return () => {};
  job.listeners.add(fn);
  fn({ type: 'state', state: job.state });
  return () => job.listeners.delete(fn);
}

export function addKiller(id: string, fn: () => void) {
  const job = jobs.get(id);
  if (job) job.killers.add(fn);
}
export function removeKiller(id: string, fn: () => void) { jobs.get(id)?.killers.delete(fn); }

export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job) return false;
  job.controller.abort();
  for (const kill of job.killers) { try { kill(); } catch { /* ignore */ } }
  job.killers.clear();
  killActiveProcesses();
  emit(id, { type: 'state', state: { ...job.state, phase: 'canceled', pct: 100, message: 'Stopped — no background processes left running' } });
  return true;
}

export function errorJob(id: string, error: TypedError) {
  emit(id, { type: 'state', state: { ...(jobs.get(id)?.state ?? { id, phase: 'error', pct: 0, speed: 0, eta: 0, step: 0, steps: 7, message: '', queuePosition: 0 }), phase: 'error', message: error.message, error } });
}

export function finishJob(id: string, clips: ClipRecord[]) {
  emit(id, { type: 'state', state: { ...(jobs.get(id)?.state ?? { id, phase: 'ready', pct: 0, speed: 0, eta: 0, step: 7, steps: 7, message: '', queuePosition: 0 }), phase: 'ready', pct: 100, step: 7, message: `${clips.length} clip${clips.length === 1 ? '' : 's'} ready`, clips } });
  emit(id, { type: 'done', state: jobs.get(id)!.state, payload: clips });
}

export function sweepJobs() {
  const cutoff = Date.now() - config.fileTtlMin * 60_000;
  for (const [id, job] of jobs) if (job.createdAt < cutoff && !['queued', 'ingest', 'transcribe', 'analyze', 'score', 'render', 'rights'].includes(job.state.phase)) jobs.delete(id);
}
