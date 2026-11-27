import type { BackupCadence, BackupSettings } from './types';

export const BACKUP_SCHOOL_SUBCOLLECTIONS = [
  'staffAccess',
  'students',
  'teachers',
  'assessments',
  'feeInvoices',
  'feePayments',
  'feeSubmissions',
  'attendance',
  'smsSettings',
  'smsLogs',
  'subjects',
  'libraryLoans',
  'libraryBooks',
  'libraryTransactions',
  'libraryReservations',
  'digitalLibrary',
  'announcements',
  'staffAttendance',
  'studentCases',
  'timebookSettings',
  'timebookEntries',
  'timebookCorrectionRequests',
  'timebookAuditLogs',
  'timebookSuspiciousLogs',
  'backupSettings',
] as const;

export const BACKUP_MIRROR_SUBCOLLECTIONS = [
  'books',
  'digitalResources',
  'announcements',
] as const;

export interface SchoolSnapshotDocumentRecord {
  id: string;
  data: Record<string, unknown>;
}

export interface SchoolSnapshotEnvelope {
  schemaVersion: 1;
  snapshotId: string;
  exportedAtIso: string;
  triggerType: 'manual' | 'automated';
  schoolId: string;
  ownerId: string;
  schoolName: string;
  triggeredByUid: string;
  triggeredByName: string;
  totalDocuments: number;
  collectionCount: number;
  collectionCounts: Record<string, number>;
  school: Record<string, unknown> | null;
  collections: Record<string, SchoolSnapshotDocumentRecord[]>;
}

const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export function isValidBackupIdentifier(value: string): boolean {
  return typeof value === 'string' && SAFE_ID_REGEX.test(value);
}

export function sanitizeBackupIdentifier(value: string, fallbackPrefix = 'snap'): string {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128);
  return cleaned || `${fallbackPrefix}_${Date.now().toString(36)}`;
}

export function createSnapshotId(nowMs = Date.now()): string {
  const isoCompact = new Date(nowMs)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const rand = Math.random().toString(36).slice(2, 7);
  return `snap_${isoCompact}_${rand}`;
}

function isTimestampLike(
  val: unknown
): val is { seconds: number; nanoseconds?: number; toDate?: () => Date } {
  if (!val || typeof val !== 'object') return false;
  const obj = val as Record<string, unknown>;
  if (typeof obj.toDate === 'function' && typeof obj.seconds === 'number') return true;
  return (
    typeof obj.seconds === 'number' &&
    typeof obj.nanoseconds === 'number' &&
    Object.keys(obj).length <= 3
  );
}

export function serializeFirestoreValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return {
      __type: 'date',
      iso: Number.isNaN(value.getTime()) ? '' : value.toISOString(),
    };
  }
  if (isTimestampLike(value)) {
    const ms =
      typeof value.toDate === 'function'
        ? value.toDate().getTime()
        : value.seconds * 1000 + Math.floor((value.nanoseconds ?? 0) / 1_000_000);
    return {
      __type: 'timestamp',
      iso: Number.isFinite(ms) ? new Date(ms).toISOString() : '',
      seconds: value.seconds,
      nanoseconds: value.nanoseconds ?? 0,
    };
  }
  if (value instanceof Uint8Array) {
    let binary = '';
    for (let i = 0; i < value.length; i += 1) {
      binary += String.fromCharCode(value[i]);
    }
    return {
      __type: 'bytes',
      base64: typeof btoa === 'function' ? btoa(binary) : Buffer.from(value).toString('base64'),
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeFirestoreValue(item));
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const next = record[key];
      if (next !== undefined && typeof next !== 'function') {
        out[key] = serializeFirestoreValue(next);
      }
    }
    return out;
  }
  return String(value);
}

export function buildSchoolSnapshotEnvelope(params: {
  snapshotId: string;
  exportedAtIso: string;
  triggerType: 'manual' | 'automated';
  schoolId: string;
  ownerId: string;
  schoolName: string;
  triggeredByUid: string;
  triggeredByName: string;
  schoolDoc: Record<string, unknown> | null;
  collections: Record<string, SchoolSnapshotDocumentRecord[]>;
}): SchoolSnapshotEnvelope {
  const normalizedCollections: Record<string, SchoolSnapshotDocumentRecord[]> = {};
  const collectionCounts: Record<string, number> = {};
  let totalDocuments = params.schoolDoc ? 1 : 0;

  for (const key of Object.keys(params.collections).sort()) {
    const docs = params.collections[key] || [];
    const serializedDocs = docs
      .map((entry) => ({
        id: entry.id,
        data: serializeFirestoreValue(entry.data) as Record<string, unknown>,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    normalizedCollections[key] = serializedDocs;
    collectionCounts[key] = serializedDocs.length;
    totalDocuments += serializedDocs.length;
  }

  return {
    schemaVersion: 1,
    snapshotId: sanitizeBackupIdentifier(params.snapshotId, 'snap'),
    exportedAtIso: params.exportedAtIso,
    triggerType: params.triggerType,
    schoolId: params.schoolId,
    ownerId: params.ownerId,
    schoolName: params.schoolName,
    triggeredByUid: params.triggeredByUid,
    triggeredByName: params.triggeredByName,
    totalDocuments,
    collectionCount: Object.keys(normalizedCollections).length + (params.schoolDoc ? 1 : 0),
    collectionCounts,
    school: params.schoolDoc
      ? (serializeFirestoreValue(params.schoolDoc) as Record<string, unknown>)
      : null,
    collections: normalizedCollections,
  };
}

export async function computeSha256Hex(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.subtle) {
    throw new Error('WebCrypto SHA-256 digest is unavailable in this environment.');
  }
  const digest = await cryptoObj.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function clampPreferredHourUtc(hour: number): number {
  const n = Math.round(Number(hour));
  if (!Number.isFinite(n)) return 2;
  return Math.max(0, Math.min(23, n));
}

export function clampRetentionCount(count: number): number {
  const n = Math.round(Number(count));
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(60, n));
}

export function computeNextScheduledBackupIso(
  cadence: BackupCadence,
  preferredHourUTC: number,
  fromMs = Date.now(),
  justCompleted = false
): string {
  const hour = clampPreferredHourUtc(preferredHourUTC);
  const base = new Date(fromMs);
  const candidate = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour, 0, 0, 0)
  );

  if (cadence === 'weekly') {
    const daysToAdd = justCompleted ? 7 : candidate.getTime() <= fromMs ? 7 : 0;
    candidate.setUTCDate(candidate.getUTCDate() + daysToAdd);
    return candidate.toISOString();
  }

  // Daily cadence: if a backup just completed or today's preferred hour already passed, advance by 1 day
  if (justCompleted || candidate.getTime() <= fromMs) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  // Ensure at least 12h buffer when a backup just finished right before the preferred UTC hour
  if (justCompleted && candidate.getTime() - fromMs < 12 * 60 * 60 * 1000) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate.toISOString();
}

export function isScheduledBackupDue(
  settings: Pick<
    BackupSettings,
    'autoBackupEnabled' | 'cadence' | 'lastBackupAtIso' | 'nextBackupDueIso'
  > | null | undefined,
  nowMs = Date.now()
): boolean {
  if (!settings || !settings.autoBackupEnabled) return false;

  if (settings.nextBackupDueIso) {
    const dueMs = Date.parse(settings.nextBackupDueIso);
    if (Number.isFinite(dueMs)) {
      return nowMs >= dueMs;
    }
  }

  if (!settings.lastBackupAtIso) return true;
  const lastMs = Date.parse(settings.lastBackupAtIso);
  if (!Number.isFinite(lastMs)) return true;

  const intervalMs =
    settings.cadence === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return nowMs - lastMs >= intervalMs;
}

export function formatBackupBytes(bytes: number): string {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}
