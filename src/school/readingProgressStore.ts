import { useCallback, useEffect, useState } from 'react';
import type { LibraryReadingMode, LibraryReadingSession } from './types';

export interface LocalResourceProgress {
  resourceId: string;
  schoolId: string;
  isRead: boolean;
  readAt: string | null;
  lastReadPage: number;
  totalPages: number;
  lastReadAt: string | null;
  lastMode: LibraryReadingMode;
}

interface LocalActiveReadingEntry {
  sessionId: string;
  schoolId: string;
  resourceId: string;
  readerKey: string;
  mode: LibraryReadingMode;
  expiresAtMs: number;
}

export interface QueuedOfflineReadingSync {
  sessionId: string;
  schoolId: string;
  ownerId: string;
  resourceId: string;
  readerKey: string;
  registrationCode: string;
  isRead: boolean;
  lastReadPage: number;
  lastReadAtMs: number;
}

const PROGRESS_STORAGE_KEY = 'secschoolhub_reading_progress_v1';
const DEVICE_READER_KEY = 'secschoolhub_device_reader_id_v1';
const ACTIVE_LOCAL_SESSIONS_KEY = 'secschoolhub_local_active_sessions_v1';
const OFFLINE_SYNC_QUEUE_KEY = 'secschoolhub_offline_reading_sync_v1';
const CHANGE_EVENT_NAME = 'secschoolhub-reading-progress-change';
export const READING_SESSION_TTL_MS = 65_000;

function sanitizeIdPart(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
}

function readJsonMap<T>(storageKey: string): Record<string, T> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, T>) : {};
  } catch {
    return {};
  }
}

function writeJsonMap<T>(storageKey: string, map: Record<string, T>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT_NAME));
  } catch {
    // Ignore storage quota errors in restricted browsing modes
  }
}

export function getBrowserDeviceToken(): string {
  if (typeof window === 'undefined') return 'server';
  try {
    const existing = window.localStorage.getItem(DEVICE_READER_KEY);
    if (existing && /^[a-zA-Z0-9_-]{4,40}$/.test(existing)) {
      return existing;
    }
    const generated = `d_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    window.localStorage.setItem(DEVICE_READER_KEY, generated);
    return generated;
  } catch {
    return 'browser_fallback';
  }
}

export function getBrowserReaderKey(scopeKey: string): string {
  const safeScope = sanitizeIdPart(scopeKey || 'reader').slice(0, 48) || 'reader';
  const device = sanitizeIdPart(getBrowserDeviceToken()).slice(0, 24) || 'dev';
  return `${safeScope}_${device}`.slice(0, 80);
}

export function buildReadingSessionId(resourceId: string, readerKey: string): string {
  const resPart = sanitizeIdPart(resourceId).slice(0, 42) || 'res';
  const keyPart = sanitizeIdPart(readerKey).slice(0, 80) || 'reader';
  return `${resPart}__${keyPart}`.slice(0, 128);
}

function makeProgressKey(scopeKey: string, resourceId: string): string {
  return `${scopeKey}:${resourceId}`;
}

export function getSchoolProgressMap(
  scopeKey: string,
  schoolId: string
): Record<string, LocalResourceProgress> {
  const all = readJsonMap<LocalResourceProgress>(PROGRESS_STORAGE_KEY);
  const prefix = `${scopeKey}:`;
  const result: Record<string, LocalResourceProgress> = {};
  for (const [key, entry] of Object.entries(all)) {
    if (!key.startsWith(prefix)) continue;
    if (schoolId && entry.schoolId && entry.schoolId !== schoolId) continue;
    result[entry.resourceId] = entry;
  }
  return result;
}

export function getResourceProgress(
  scopeKey: string,
  schoolId: string,
  resourceId: string
): LocalResourceProgress {
  const all = readJsonMap<LocalResourceProgress>(PROGRESS_STORAGE_KEY);
  const existing = all[makeProgressKey(scopeKey, resourceId)];
  if (existing) return existing;
  return {
    resourceId,
    schoolId,
    isRead: false,
    readAt: null,
    lastReadPage: 0,
    totalPages: 0,
    lastReadAt: null,
    lastMode: 'online',
  };
}

export function toggleResourceMarkAsRead(
  scopeKey: string,
  schoolId: string,
  resourceId: string,
  nextRead?: boolean
): LocalResourceProgress {
  const all = readJsonMap<LocalResourceProgress>(PROGRESS_STORAGE_KEY);
  const key = makeProgressKey(scopeKey, resourceId);
  const current = all[key] ?? {
    resourceId,
    schoolId,
    isRead: false,
    readAt: null,
    lastReadPage: 0,
    totalPages: 0,
    lastReadAt: null,
    lastMode: 'online' as LibraryReadingMode,
  };
  const resolvedRead = typeof nextRead === 'boolean' ? nextRead : !current.isRead;
  const nowIso = new Date().toISOString();
  const updated: LocalResourceProgress = {
    ...current,
    schoolId: schoolId || current.schoolId,
    isRead: resolvedRead,
    readAt: resolvedRead ? nowIso : null,
  };
  all[key] = updated;
  writeJsonMap(PROGRESS_STORAGE_KEY, all);
  return updated;
}

export function recordResourceReadingPage(
  scopeKey: string,
  schoolId: string,
  resourceId: string,
  page: number,
  totalPages: number,
  mode: LibraryReadingMode
): LocalResourceProgress {
  const all = readJsonMap<LocalResourceProgress>(PROGRESS_STORAGE_KEY);
  const key = makeProgressKey(scopeKey, resourceId);
  const current = all[key] ?? {
    resourceId,
    schoolId,
    isRead: false,
    readAt: null,
    lastReadPage: 0,
    totalPages: 0,
    lastReadAt: null,
    lastMode: mode,
  };
  const nowIso = new Date().toISOString();
  const cleanPage = Math.max(1, Math.round(page));
  const cleanTotal = Math.max(cleanPage, Math.round(totalPages || current.totalPages || 1));
  const updated: LocalResourceProgress = {
    ...current,
    schoolId: schoolId || current.schoolId,
    lastReadPage: cleanPage,
    totalPages: cleanTotal,
    lastReadAt: nowIso,
    lastMode: mode,
  };
  all[key] = updated;
  writeJsonMap(PROGRESS_STORAGE_KEY, all);
  return updated;
}

export function setLocalActiveReadingSession(params: {
  schoolId: string;
  resourceId: string;
  readerKey: string;
  mode: LibraryReadingMode;
  active: boolean;
}): void {
  const all = readJsonMap<LocalActiveReadingEntry>(ACTIVE_LOCAL_SESSIONS_KEY);
  const now = Date.now();
  const sessionId = buildReadingSessionId(params.resourceId, params.readerKey);

  // Prune stale local sessions before saving
  for (const [id, item] of Object.entries(all)) {
    if (!item || item.expiresAtMs <= now) {
      delete all[id];
    }
  }

  if (params.active && params.schoolId && params.resourceId) {
    all[sessionId] = {
      sessionId,
      schoolId: params.schoolId,
      resourceId: params.resourceId,
      readerKey: params.readerKey,
      mode: params.mode,
      expiresAtMs: now + READING_SESSION_TTL_MS,
    };
  } else {
    delete all[sessionId];
  }

  writeJsonMap(ACTIVE_LOCAL_SESSIONS_KEY, all);
}

export function queueOfflineReadingSync(entry: QueuedOfflineReadingSync): void {
  const all = readJsonMap<QueuedOfflineReadingSync>(OFFLINE_SYNC_QUEUE_KEY);
  all[entry.sessionId] = entry;
  writeJsonMap(OFFLINE_SYNC_QUEUE_KEY, all);
}

export function getPendingOfflineReadingSyncs(schoolId?: string): QueuedOfflineReadingSync[] {
  const all = readJsonMap<QueuedOfflineReadingSync>(OFFLINE_SYNC_QUEUE_KEY);
  return Object.values(all).filter((item) => !schoolId || item.schoolId === schoolId);
}

export function removeQueuedOfflineReadingSync(sessionId: string): void {
  const all = readJsonMap<QueuedOfflineReadingSync>(OFFLINE_SYNC_QUEUE_KEY);
  if (sessionId in all) {
    delete all[sessionId];
    writeJsonMap(OFFLINE_SYNC_QUEUE_KEY, all);
  }
}

export interface RealReadingCounts {
  onlineActiveTotal: number;
  offlineActiveTotal: number;
  onlineByResource: Record<string, number>;
  offlineByResource: Record<string, number>;
}

export function computeRealReadingCounts(
  schoolId: string,
  remoteSessions: LibraryReadingSession[],
  nowMs: number = Date.now()
): RealReadingCounts {
  const localMap = readJsonMap<LocalActiveReadingEntry>(ACTIVE_LOCAL_SESSIONS_KEY);

  // Deduplicate active reader sessions per (resourceId, readerKey) across local + Firestore
  const activeByKey = new Map<
    string,
    { resourceId: string; readerKey: string; mode: LibraryReadingMode }
  >();

  for (const session of remoteSessions) {
    if (session.schoolId !== schoolId) continue;
    if (!session.isReading || session.expiresAtMs <= nowMs) continue;
    activeByKey.set(`${session.resourceId}::${session.readerKey}`, {
      resourceId: session.resourceId,
      readerKey: session.readerKey,
      mode: session.mode,
    });
  }

  for (const local of Object.values(localMap)) {
    if (!local || local.schoolId !== schoolId || local.expiresAtMs <= nowMs) continue;
    activeByKey.set(`${local.resourceId}::${local.readerKey}`, {
      resourceId: local.resourceId,
      readerKey: local.readerKey,
      mode: local.mode,
    });
  }

  const onlineByResource: Record<string, number> = {};
  const offlineByResource: Record<string, number> = {};
  const onlineReaders = new Set<string>();
  const offlineReaders = new Set<string>();

  for (const item of activeByKey.values()) {
    if (item.mode === 'offline') {
      offlineByResource[item.resourceId] = (offlineByResource[item.resourceId] ?? 0) + 1;
      offlineReaders.add(item.readerKey);
    } else {
      onlineByResource[item.resourceId] = (onlineByResource[item.resourceId] ?? 0) + 1;
      onlineReaders.add(item.readerKey);
    }
  }

  return {
    onlineActiveTotal: onlineReaders.size,
    offlineActiveTotal: offlineReaders.size,
    onlineByResource,
    offlineByResource,
  };
}

export function formatLastReadLabel(iso?: string | null): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const diffMs = Date.now() - ts;
  if (diffMs < 60_000) return 'Just now';
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `${diffMin}m ago`;
  const date = new Date(ts);
  const now = new Date();
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  ) {
    return `Today ${timeStr}`;
  }
  const dayStr = date.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return `${dayStr}, ${timeStr}`;
}

export function useLibraryReadingProgress(
  scopeKey: string,
  schoolId: string,
  remoteSessions: LibraryReadingSession[] = []
) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const refresh = () => setTick((t) => t + 1);
    window.addEventListener('storage', refresh);
    window.addEventListener(CHANGE_EVENT_NAME, refresh);
    const timer = window.setInterval(refresh, 15_000);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener(CHANGE_EVENT_NAME, refresh);
      window.clearInterval(timer);
    };
  }, []);

  const progressMap = getSchoolProgressMap(scopeKey, schoolId);
  const counts = computeRealReadingCounts(schoolId, remoteSessions);

  const toggleMarkAsRead = useCallback(
    (resourceId: string, nextRead?: boolean) => {
      const updated = toggleResourceMarkAsRead(scopeKey, schoolId, resourceId, nextRead);
      setTick((t) => t + 1);
      return updated;
    },
    [scopeKey, schoolId]
  );

  const recordPageProgress = useCallback(
    (resourceId: string, page: number, totalPages: number, mode: LibraryReadingMode) => {
      const updated = recordResourceReadingPage(
        scopeKey,
        schoolId,
        resourceId,
        page,
        totalPages,
        mode
      );
      setTick((t) => t + 1);
      return updated;
    },
    [scopeKey, schoolId]
  );

  // Use tick in return tuple dependency via fresh computation above
  void tick;

  return {
    progressMap,
    counts,
    toggleMarkAsRead,
    recordPageProgress,
  };
}
