import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorage } from '../lib/db';
import { demoClips, demoProjects } from '../data/demo';
import type { BrandConfig, ClipRecord, JobState, ProjectConfig, ProjectRecord, RightsPolicy } from '@shared/types';

export type Page = 'home' | 'configure' | 'processing' | 'results' | 'editor' | 'library' | 'brand' | 'scheduler' | 'stats' | 'settings';

export interface Settings {
  profileName: string;
  avatar: string;
  notifications: boolean;
  sound: boolean;
  reducedMotion: boolean;
  rightsPolicy: RightsPolicy;
  selfHostToken: string;
  soundEnabled: boolean;
  lastView: Page;
  gameBest: number;
}

export interface SavedView { id: string; name: string; filter: string; sort: string }

export const defaultConfig = (): ProjectConfig => ({
  source: { kind: 'upload', ref: '', filename: '' },
  attestation: '' as ProjectConfig['attestation'],
  clipType: 'viral', clipCount: 3, duration: 'auto', aspect: '9:16', language: 'auto',
  timeframe: { start: 0, end: 60 }, captions: true, captionStyle: 'classic',
  autoHook: true, hookTone: 'bold', reframe: 'face', music: false, musicMood: 'lofi',
  musicVolume: 0.25, splitScreen: false, backgrounds: [], splitRatio: 0.55,
  rightsPolicy: 'balanced', resolution: 1080, filenameTemplate: 'splice-{rank}-{title}',
});

interface AppState {
  page: Page;
  previousPage: Page;
  projects: ProjectRecord[];
  clips: ClipRecord[];
  settings: Settings;
  brand: BrandConfig;
  savedViews: SavedView[];
  config: ProjectConfig;
  activeJobId: string | null;
  jobState: JobState | null;
  activeClipId: string | null;
  activeProjectId: string | null;
  drawer: 'shortcuts' | 'help' | 'palette' | null;
  collapsedRail: boolean;
  mobileNav: boolean;
  pendingUndo: { clips: ClipRecord[]; projects: ProjectRecord[]; timeout?: number } | null;
  navigate: (p: Page) => void;
  openDrawer: (d: AppState['drawer']) => void;
  setConfig: (patch: Partial<ProjectConfig>) => void;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  setBrand: (patch: Partial<BrandConfig>) => void;
  addProject: (p: ProjectRecord) => void;
  updateProject: (id: string, patch: Partial<ProjectRecord>) => void;
  addClips: (c: ClipRecord[]) => void;
  updateClip: (id: string, patch: Partial<ClipRecord>) => void;
  deleteClips: (ids: string[]) => void;
  undoDelete: () => void;
  restoreDemos: () => void;
  clearLocalData: () => void;
  setJob: (id: string | null, state?: JobState | null) => void;
  setActiveProject: (id: string | null) => void;
  setActiveClip: (id: string | null) => void;
  toggleRail: () => void;
  setMobileNav: (v: boolean) => void;
  addView: (v: SavedView) => void;
  removeView: (id: string) => void;
  resetConfig: () => void;
}

const initialSettings: Settings = {
  profileName: 'Local editor', avatar: 'SE', notifications: false, sound: true,
  reducedMotion: false, rightsPolicy: 'balanced', selfHostToken: '', soundEnabled: true,
  lastView: 'home', gameBest: 0,
};

export const useApp = create<AppState>()(persist((set) => ({
  page: 'home', previousPage: 'home',
  projects: demoProjects, clips: demoClips,
  settings: initialSettings,
  brand: { name: 'SPLICE', primary: '#FF4D2E', accent: '#22D3EE', captionPreset: 'classic' },
  savedViews: [
    { id: 'view_high', name: 'High score', filter: 'All', sort: 'Score' },
    { id: 'view_clear', name: 'Cleared only', filter: 'All', sort: 'Newest' },
  ],
  config: defaultConfig(),
  activeJobId: null, jobState: null, activeClipId: null, activeProjectId: null,
  drawer: null, collapsedRail: false, mobileNav: false, pendingUndo: null,

  navigate: (p) => set((s) => ({ page: p, previousPage: s.page, drawer: null, mobileNav: false, settings: { ...s.settings, lastView: p } })),
  openDrawer: (d) => set({ drawer: d }),
  setConfig: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
  setSetting: (k, v) => set((s) => ({ settings: { ...s.settings, [k]: v } })),
  setBrand: (patch) => set((s) => ({ brand: { ...s.brand, ...patch } })),
  addProject: (p) => set((s) => ({ projects: [p, ...s.projects] })),
  updateProject: (id, patch) => set((s) => ({ projects: s.projects.map((p) => p.id === id ? { ...p, ...patch } : p) })),
  addClips: (c) => set((s) => ({ clips: [...c, ...s.clips] })),
  updateClip: (id, patch) => set((s) => ({ clips: s.clips.map((c) => c.id === id ? { ...c, ...patch } : c) })),
  deleteClips: (ids) => set((s) => {
    const removed = s.clips.filter((c) => ids.includes(c.id));
    const projects = s.projects.map((p) => ({ ...p, clipIds: p.clipIds.filter((id) => !ids.includes(id)) }));
    return { clips: s.clips.filter((c) => !ids.includes(c.id)), projects, pendingUndo: { clips: removed, projects: s.projects } };
  }),
  undoDelete: () => set((s) => s.pendingUndo ? {
    clips: [...s.pendingUndo.clips, ...s.clips], projects: s.pendingUndo.projects, pendingUndo: null,
  } : {}),
  restoreDemos: () => set((s) => ({
    projects: [...demoProjects, ...s.projects.filter((p) => !p.demo)],
    clips: [...demoClips, ...s.clips.filter((c) => !c.demo)],
  })),
  clearLocalData: () => set({ projects: [], clips: [], savedViews: [], activeJobId: null, jobState: null, activeClipId: null, pendingUndo: null }),
  setJob: (id, state) => set({ activeJobId: id, jobState: state ?? null }),
  setActiveProject: (id) => set({ activeProjectId: id }),
  setActiveClip: (id) => set({ activeClipId: id }),
  toggleRail: () => set((s) => ({ collapsedRail: !s.collapsedRail })),
  setMobileNav: (v) => set({ mobileNav: v }),
  addView: (v) => set((s) => ({ savedViews: [...s.savedViews, v] })),
  removeView: (id) => set((s) => ({ savedViews: s.savedViews.filter((v) => v.id !== id) })),
  resetConfig: () => set({ config: defaultConfig() }),
}), {
  name: 'splice-state',
  storage: createJSONStorage(() => asyncStorage),
  partialize: (s) => ({
    projects: s.projects, clips: s.clips, settings: s.settings, brand: s.brand,
    savedViews: s.savedViews, config: s.config,
  }),
}));

export const canDownload = (c: ClipRecord) => c.status === 'ready' || (c.status === 'review');
