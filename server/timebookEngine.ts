import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as webpush from 'web-push';
import {
  buildDefaultTimebookSettings,
  calculateHaversineDistanceMeters,
  DEFAULT_TIMEBOOK_DEADLINE,
  DEFAULT_TIMEBOOK_MAX_ACCURACY_METERS,
  DEFAULT_TIMEBOOK_RADIUS_METERS,
  DEFAULT_TIMEBOOK_REMINDER_SLOTS,
  DEFAULT_TIMEBOOK_TIMEZONE,
  DEFAULT_TIMEBOOK_WINDOW_START,
  DEFAULT_TIMEBOOK_WORKDAYS,
  detectGpsSpoofingSignals,
  getEffectiveDeadlineHHMM,
  getZonedDateTimeParts,
  isAttendanceWindowOpen,
  isHolidayOrWeekend,
  isValidHHMM,
  isValidLatitude,
  isValidLongitude,
  isValidTimeZone,
  parseHHMMToSeconds,
  type RecentGpsPing,
} from '../src/school/timebookUtils.ts';
import type {
  TeacherRole,
  TimebookEntryStatus,
  TimebookHoliday,
  TimebookNotification,
  TimebookSettings,
} from '../src/school/types.ts';
import { isPlatformAdminEmail, type VerifiedFirebaseUser } from './firebaseAuth.ts';

export interface SyncedStaffRosterItem {
  teacherId: string;
  staffCode: string;
  fullName: string;
  roleTitle: TeacherRole;
  staffEmail: string;
  status: 'Active' | 'On Leave';
}

export interface StoredSchoolRecord {
  schoolId: string;
  ownerUid: string;
  ownerEmail: string;
  schoolName: string;
  settings: Omit<TimebookSettings, 'createdAt' | 'updatedAt'>;
  staffRoster: SyncedStaffRosterItem[];
  updatedAtMs: number;
}

export interface StoredPushSubscription {
  id: string;
  uid: string;
  email: string;
  schoolId: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent: string;
  updatedAtMs: number;
}

export interface StoredSuspiciousEvent {
  id: string;
  schoolId: string;
  date: string;
  teacherId: string;
  staffUid: string;
  staffName: string;
  roleTitle: TeacherRole;
  reasonCode: string;
  detail: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  accuracyMeters: number;
  clientTimestampIso: string;
  serverTimeIso: string;
  createdAtMs: number;
}

interface DailyLockRecord {
  teacherId: string;
  staffUid: string;
  status: TimebookEntryStatus;
  recordingMethod: 'GPS Auto' | 'Admin Recorded';
  timeInDisplay: string;
  serverIso: string;
  distanceMeters: number;
  accuracyMeters: number;
  deadlineHHMM: string;
  serverReceiptSignature: string;
}

interface NonceChallengeRecord {
  nonce: string;
  schoolId: string;
  uid: string;
  teacherId: string;
  issuedAtMs: number;
  expiresAtMs: number;
  used: boolean;
}

interface PersistedTimebookStore {
  version: 1;
  hmacSecret: string;
  vapidKeys: {
    publicKey: string;
    privateKey: string;
    subject: string;
  };
  schools: Record<string, StoredSchoolRecord>;
  dailyLocks: Record<string, DailyLockRecord>; // key: `${schoolId}:${date}:${teacherId}`
  recentPings: Record<string, RecentGpsPing[]>; // key: `${schoolId}:${teacherId}`
  sentReminderSlots: Record<string, number>; // key: `${schoolId}:${date}:${teacherId}:${slot}`
  notifications: TimebookNotification[];
  pushSubscriptions: Record<string, StoredPushSubscription>; // key: `${uid}:${endpointHash}`
  suspiciousEvents: StoredSuspiciousEvent[];
}

export type PushSenderFn = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string
) => Promise<void>;

export interface TimebookEngineOptions {
  storeFilePath?: string;
  nowFn?: () => number;
  pushSender?: PushSenderFn;
  hmacSecret?: string;
  maxRequestsPerMinute?: number;
}

export interface TimebookApiError {
  status: number;
  code: string;
  error: string;
  flags?: string[];
  distanceMeters?: number;
  accuracyMeters?: number;
  suspiciousEvent?: StoredSuspiciousEvent;
}

const NONCE_TTL_MS = 120_000;
const DEFAULT_MAX_REQUESTS_PER_MINUTE = 30;
const HARD_SPOOF_FLAGS = new Set([
  'NULL_ISLAND_COORDS',
  'MOCK_ZERO_ACCURACY',
  'CLIENT_CLOCK_TAMPER',
  'RETROSPECTIVE_OR_DATE_MISMATCH',
  'IMPOSSIBLE_VELOCITY',
  'STATIC_REPEATED_COORDINATES',
]);

function clampStr(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function sanitizeReminders(slots: unknown): string[] {
  if (!Array.isArray(slots)) return [...DEFAULT_TIMEBOOK_REMINDER_SLOTS];
  const valid = slots
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => isValidHHMM(s));
  const unique = Array.from(new Set(valid)).sort();
  return unique.length > 0 ? unique.slice(0, 8) : [...DEFAULT_TIMEBOOK_REMINDER_SLOTS];
}

function sanitizeWorkdays(days: unknown): number[] {
  if (!Array.isArray(days)) return [...DEFAULT_TIMEBOOK_WORKDAYS];
  const valid = days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6);
  const unique = Array.from(new Set(valid)).sort((a, b) => a - b);
  return unique.length > 0 ? unique : [...DEFAULT_TIMEBOOK_WORKDAYS];
}

function sanitizeHolidays(raw: unknown): TimebookHoliday[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: TimebookHoliday[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Partial<TimebookHoliday>;
    const date = typeof obj.date === 'string' ? obj.date.trim() : '';
    const name = clampStr(obj.name, 80);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name || seen.has(date)) continue;
    seen.add(date);
    out.push({ date, name });
  }
  return out.slice(0, 60);
}

function sanitizeCategoryDeadlines(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [role, hhmm] of Object.entries(raw as Record<string, unknown>)) {
    const cleanRole = clampStr(role, 40);
    const cleanTime = typeof hhmm === 'string' ? hhmm.trim() : '';
    if (cleanRole && isValidHHMM(cleanTime)) {
      out[cleanRole] = cleanTime;
    }
  }
  return out;
}

export class TimebookEngine {
  private storeFilePath: string;
  private readonly nowFn: () => number;
  private readonly maxRequestsPerMinute: number;
  private readonly customPushSender?: PushSenderFn;
  private store: PersistedTimebookStore;
  private nonces = new Map<string, NonceChallengeRecord>();
  private rateBuckets = new Map<string, number[]>();

  constructor(options: TimebookEngineOptions = {}) {
    this.storeFilePath =
      options.storeFilePath || path.resolve(process.cwd(), '.data', 'timebook-store.json');
    this.nowFn = options.nowFn || (() => Date.now());
    this.maxRequestsPerMinute = options.maxRequestsPerMinute ?? DEFAULT_MAX_REQUESTS_PER_MINUTE;
    this.customPushSender = options.pushSender;
    this.store = this.loadOrInitStore(options.hmacSecret);
    this.configureVapid();
  }

  private loadOrInitStore(overrideHmacSecret?: string): PersistedTimebookStore {
    const dir = path.dirname(this.storeFilePath);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch {
      this.storeFilePath = path.join(os.tmpdir(), 'secschoolhub-timebook-store.json');
    }

    if (fs.existsSync(this.storeFilePath)) {
      try {
        const raw = fs.readFileSync(this.storeFilePath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<PersistedTimebookStore>;
        const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
        const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
        const envSubj = process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@secschoolhub.local';
        const generated =
          parsed.vapidKeys?.publicKey && parsed.vapidKeys?.privateKey
            ? parsed.vapidKeys
            : envPub && envPriv
            ? { publicKey: envPub, privateKey: envPriv, subject: envSubj }
            : { ...webpush.generateVAPIDKeys(), subject: envSubj };

        return {
          version: 1,
          hmacSecret:
            overrideHmacSecret ||
            process.env.TIMEBOOK_HMAC_SECRET?.trim() ||
            parsed.hmacSecret ||
            crypto.randomBytes(32).toString('hex'),
          vapidKeys: generated,
          schools: parsed.schools || {},
          dailyLocks: parsed.dailyLocks || {},
          recentPings: parsed.recentPings || {},
          sentReminderSlots: parsed.sentReminderSlots || {},
          notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
          pushSubscriptions: parsed.pushSubscriptions || {},
          suspiciousEvents: Array.isArray(parsed.suspiciousEvents) ? parsed.suspiciousEvents : [],
        };
      } catch {
        // Fall through to clean store init
      }
    }

    const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
    const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
    const envSubj = process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@secschoolhub.local';
    const vapidKeys =
      envPub && envPriv
        ? { publicKey: envPub, privateKey: envPriv, subject: envSubj }
        : { ...webpush.generateVAPIDKeys(), subject: envSubj };

    const fresh: PersistedTimebookStore = {
      version: 1,
      hmacSecret:
        overrideHmacSecret ||
        process.env.TIMEBOOK_HMAC_SECRET?.trim() ||
        crypto.randomBytes(32).toString('hex'),
      vapidKeys,
      schools: {},
      dailyLocks: {},
      recentPings: {},
      sentReminderSlots: {},
      notifications: [],
      pushSubscriptions: {},
      suspiciousEvents: [],
    };
    this.persistStore(fresh);
    return fresh;
  }

  private configureVapid(): void {
    if (this.customPushSender) return;
    try {
      webpush.setVapidDetails(
        this.store.vapidKeys.subject || 'mailto:admin@secschoolhub.local',
        this.store.vapidKeys.publicKey,
        this.store.vapidKeys.privateKey
      );
    } catch {
      const fresh = webpush.generateVAPIDKeys();
      this.store.vapidKeys = {
        ...fresh,
        subject: 'mailto:admin@secschoolhub.local',
      };
      webpush.setVapidDetails(
        this.store.vapidKeys.subject,
        this.store.vapidKeys.publicKey,
        this.store.vapidKeys.privateKey
      );
      this.persistStore();
    }
  }

  private persistStore(target: PersistedTimebookStore = this.store): void {
    const writeToPath = (filePath: string) => {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpPath = `${filePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(target, null, 2), 'utf8');
      fs.renameSync(tmpPath, filePath);
    };

    try {
      writeToPath(this.storeFilePath);
    } catch {
      const fallbackPath = path.join(os.tmpdir(), 'secschoolhub-timebook-store.json');
      if (this.storeFilePath !== fallbackPath) {
        this.storeFilePath = fallbackPath;
        try {
          writeToPath(fallbackPath);
        } catch {
          // Keep operating in-memory if filesystem is strictly read-only
        }
      }
    }
  }

  public getVapidPublicKey(): string {
    return this.store.vapidKeys.publicKey;
  }

  public getAuthoritativeClock(timezone: string = DEFAULT_TIMEBOOK_TIMEZONE) {
    const nowMs = this.nowFn();
    const safeTz = isValidTimeZone(timezone) ? timezone : DEFAULT_TIMEBOOK_TIMEZONE;
    const zoned = getZonedDateTimeParts(nowMs, safeTz);
    return {
      serverNowMs: nowMs,
      serverIso: new Date(nowMs).toISOString(),
      timezone: safeTz,
      zoned,
    };
  }

  public enforceRateLimit(key: string): { allowed: true } | { allowed: false; retryAfterSec: number } {
    const now = this.nowFn();
    const windowMs = 60_000;
    const history = (this.rateBuckets.get(key) || []).filter((ts) => now - ts < windowMs);
    if (history.length >= this.maxRequestsPerMinute) {
      const oldest = history[0] || now;
      const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
      this.rateBuckets.set(key, history);
      return { allowed: false, retryAfterSec };
    }
    history.push(now);
    this.rateBuckets.set(key, history);
    return { allowed: true };
  }

  private signReceipt(payload: string): string {
    return crypto.createHmac('sha256', this.store.hmacSecret).update(payload).digest('hex');
  }

  private isCallerAuthorizedOwner(school: StoredSchoolRecord | undefined, caller: VerifiedFirebaseUser): boolean {
    if (isPlatformAdminEmail(caller.email)) return true;
    if (!school) return true; // First registration binds ownerUid to caller
    return school.ownerUid === caller.uid || Boolean(school.ownerEmail && school.ownerEmail === caller.email);
  }

  private resolveStaffForSchool(
    school: StoredSchoolRecord,
    caller: VerifiedFirebaseUser
  ): SyncedStaffRosterItem | null {
    const email = caller.email.trim().toLowerCase();
    return (
      school.staffRoster.find(
        (member) => member.staffEmail.trim().toLowerCase() === email
      ) || null
    );
  }

  public syncSchoolPolicyAndRoster(params: {
    caller: VerifiedFirebaseUser;
    schoolId: string;
    schoolName?: string;
    ownerId?: string;
    settings?: Partial<TimebookSettings>;
    staffRoster?: SyncedStaffRosterItem[];
  }): { ok: true; school: StoredSchoolRecord } | { ok: false; error: TimebookApiError } {
    const schoolId = clampStr(params.schoolId, 128);
    if (!schoolId || !/^[a-zA-Z0-9_-]+$/.test(schoolId)) {
      return {
        ok: false,
        error: { status: 400, code: 'INVALID_SCHOOL_ID', error: 'Invalid school identifier.' },
      };
    }

    const existing = this.store.schools[schoolId];
    if (!this.isCallerAuthorizedOwner(existing, params.caller)) {
      return {
        ok: false,
        error: {
          status: 403,
          code: 'OWNER_REQUIRED',
          error: 'Only the school administrator may update geofence or staff timebook policy.',
        },
      };
    }

    // Prevent non-platform admin from setting a different ownerId when creating initial record
    const effectiveOwnerUid =
      existing?.ownerUid ||
      (isPlatformAdminEmail(params.caller.email) && params.ownerId
        ? clampStr(params.ownerId, 128)
        : params.caller.uid);

    const defaults = buildDefaultTimebookSettings(schoolId, effectiveOwnerUid);
    const prevSettings = existing?.settings || defaults;
    const incomingSettings = params.settings || {};

    const nextLat = isValidLatitude(incomingSettings.schoolLatitude)
      ? incomingSettings.schoolLatitude
      : prevSettings.schoolLatitude;
    const nextLng = isValidLongitude(incomingSettings.schoolLongitude)
      ? incomingSettings.schoolLongitude
      : prevSettings.schoolLongitude;

    const nextRadius =
      typeof incomingSettings.radiusMeters === 'number' &&
      Number.isFinite(incomingSettings.radiusMeters) &&
      incomingSettings.radiusMeters >= 20 &&
      incomingSettings.radiusMeters <= 5000
        ? Math.round(incomingSettings.radiusMeters)
        : prevSettings.radiusMeters || DEFAULT_TIMEBOOK_RADIUS_METERS;

    const nextAccuracy =
      typeof incomingSettings.maxAccuracyMeters === 'number' &&
      Number.isFinite(incomingSettings.maxAccuracyMeters) &&
      incomingSettings.maxAccuracyMeters >= 10 &&
      incomingSettings.maxAccuracyMeters <= 1000
        ? Math.round(incomingSettings.maxAccuracyMeters)
        : prevSettings.maxAccuracyMeters || DEFAULT_TIMEBOOK_MAX_ACCURACY_METERS;

    const nextTimezone =
      typeof incomingSettings.timezone === 'string' && isValidTimeZone(incomingSettings.timezone)
        ? incomingSettings.timezone
        : prevSettings.timezone || DEFAULT_TIMEBOOK_TIMEZONE;

    const nextWindowStart = isValidHHMM(incomingSettings.windowStartHHMM)
      ? incomingSettings.windowStartHHMM!.trim()
      : prevSettings.windowStartHHMM || DEFAULT_TIMEBOOK_WINDOW_START;

    const nextDeadline = isValidHHMM(incomingSettings.defaultDeadlineHHMM)
      ? incomingSettings.defaultDeadlineHHMM!.trim()
      : prevSettings.defaultDeadlineHHMM || DEFAULT_TIMEBOOK_DEADLINE;

    const nextLocationConfigured =
      typeof incomingSettings.locationConfigured === 'boolean'
        ? incomingSettings.locationConfigured
        : prevSettings.locationConfigured;

    const mergedSettings: Omit<TimebookSettings, 'createdAt' | 'updatedAt'> = {
      id: 'default',
      ownerId: effectiveOwnerUid,
      schoolId,
      enabled:
        typeof incomingSettings.enabled === 'boolean'
          ? incomingSettings.enabled
          : prevSettings.enabled,
      locationConfigured: nextLocationConfigured,
      locationLabel: clampStr(
        incomingSettings.locationLabel ?? prevSettings.locationLabel,
        120
      ) || 'School Main Campus',
      schoolLatitude: nextLat,
      schoolLongitude: nextLng,
      radiusMeters: nextRadius,
      maxAccuracyMeters: nextAccuracy,
      timezone: nextTimezone,
      windowStartHHMM: nextWindowStart,
      defaultDeadlineHHMM: nextDeadline,
      categoryDeadlines:
        incomingSettings.categoryDeadlines !== undefined
          ? sanitizeCategoryDeadlines(incomingSettings.categoryDeadlines)
          : prevSettings.categoryDeadlines,
      workdays:
        incomingSettings.workdays !== undefined
          ? sanitizeWorkdays(incomingSettings.workdays)
          : prevSettings.workdays,
      holidays:
        incomingSettings.holidays !== undefined
          ? sanitizeHolidays(incomingSettings.holidays)
          : prevSettings.holidays,
      reminderSlots:
        incomingSettings.reminderSlots !== undefined
          ? sanitizeReminders(incomingSettings.reminderSlots)
          : prevSettings.reminderSlots,
      remindersEnabled:
        typeof incomingSettings.remindersEnabled === 'boolean'
          ? incomingSettings.remindersEnabled
          : prevSettings.remindersEnabled,
      updatedBy: clampStr(incomingSettings.updatedBy || params.caller.name, 120),
    };

    const nextRoster: SyncedStaffRosterItem[] = Array.isArray(params.staffRoster)
      ? params.staffRoster
          .filter((item) => item && item.teacherId && item.staffEmail)
          .map((item) => ({
            teacherId: clampStr(item.teacherId, 128),
            staffCode: clampStr(item.staffCode, 30),
            fullName: clampStr(item.fullName, 120),
            roleTitle: item.roleTitle,
            staffEmail: clampStr(item.staffEmail, 160).toLowerCase(),
            status: item.status === 'On Leave' ? 'On Leave' : 'Active',
          }))
      : existing?.staffRoster || [];

    const updated: StoredSchoolRecord = {
      schoolId,
      ownerUid: effectiveOwnerUid,
      ownerEmail:
        existing?.ownerEmail ||
        (effectiveOwnerUid === params.caller.uid ? params.caller.email : ''),
      schoolName: clampStr(params.schoolName || existing?.schoolName || 'SecSchoolHub School', 120),
      settings: mergedSettings,
      staffRoster: nextRoster,
      updatedAtMs: this.nowFn(),
    };

    this.store.schools[schoolId] = updated;
    this.persistStore();
    return { ok: true, school: updated };
  }

  public getStaffTimebookState(params: {
    caller: VerifiedFirebaseUser;
    schoolId: string;
  }) {
    const school = this.store.schools[params.schoolId];
    const tz = school?.settings.timezone || DEFAULT_TIMEBOOK_TIMEZONE;
    const clock = this.getAuthoritativeClock(tz);
    const staffMember = school ? this.resolveStaffForSchool(school, params.caller) : null;
    const lockKey = staffMember
      ? `${params.schoolId}:${clock.zoned.isoDate}:${staffMember.teacherId}`
      : '';
    const todayEntry = lockKey ? this.store.dailyLocks[lockKey] || null : null;
    const effectiveDeadlineHHMM = school
      ? getEffectiveDeadlineHHMM(school.settings, staffMember?.roleTitle)
      : DEFAULT_TIMEBOOK_DEADLINE;
    const holidayStatus = school
      ? isHolidayOrWeekend(clock.zoned.isoDate, clock.zoned.dayOfWeek, school.settings)
      : { isNonWorkingDay: false, reason: '' };
    const windowOpen = school
      ? isAttendanceWindowOpen(
          clock.zoned.totalSeconds,
          school.settings.windowStartHHMM,
          effectiveDeadlineHHMM
        )
      : isAttendanceWindowOpen(
          clock.zoned.totalSeconds,
          DEFAULT_TIMEBOOK_WINDOW_START,
          DEFAULT_TIMEBOOK_DEADLINE
        );

    return {
      ok: true as const,
      schoolConfigured: Boolean(school),
      policy: school ? school.settings : null,
      staffMember,
      clock,
      effectiveDeadlineHHMM,
      holidayStatus,
      windowOpen,
      alreadyRecorded: Boolean(todayEntry),
      todayEntry,
    };
  }

  public issueChallenge(params: {
    caller: VerifiedFirebaseUser;
    schoolId: string;
  }):
    | {
        ok: true;
        nonce: string;
        expiresAtMs: number;
        serverNowMs: number;
        serverIso: string;
        timezone: string;
        zoned: ReturnType<typeof getZonedDateTimeParts>;
        deadlineHHMM: string;
        windowStartHHMM: string;
        radiusMeters: number;
        maxAccuracyMeters: number;
        locationConfigured: boolean;
        alreadyRecorded: boolean;
      }
    | { ok: false; error: TimebookApiError } {
    const school = this.store.schools[params.schoolId];
    if (!school) {
      return {
        ok: false,
        error: {
          status: 404,
          code: 'SCHOOL_NOT_SYNCED',
          error: 'School geofence policy is not configured yet. Ask your administrator to configure School Timebook location.',
        },
      };
    }

    const staffMember = this.resolveStaffForSchool(school, params.caller);
    if (!staffMember) {
      return {
        ok: false,
        error: {
          status: 403,
          code: 'NOT_SCHOOL_STAFF',
          error: 'Your signed-in account is not linked to an active staff profile in this school.',
        },
      };
    }

    if (staffMember.status !== 'Active') {
      return {
        ok: false,
        error: {
          status: 403,
          code: 'STAFF_ON_LEAVE',
          error: 'Your staff profile is currently marked On Leave. Contact the school administrator.',
        },
      };
    }

    const clock = this.getAuthoritativeClock(school.settings.timezone);
    const deadlineHHMM = getEffectiveDeadlineHHMM(school.settings, staffMember.roleTitle);
    const lockKey = `${params.schoolId}:${clock.zoned.isoDate}:${staffMember.teacherId}`;

    // Prune expired nonces periodically
    for (const [k, rec] of this.nonces.entries()) {
      if (clock.serverNowMs > rec.expiresAtMs + 60_000) {
        this.nonces.delete(k);
      }
    }

    const nonce = crypto.randomBytes(24).toString('hex');
    const expiresAtMs = clock.serverNowMs + NONCE_TTL_MS;
    this.nonces.set(nonce, {
      nonce,
      schoolId: params.schoolId,
      uid: params.caller.uid,
      teacherId: staffMember.teacherId,
      issuedAtMs: clock.serverNowMs,
      expiresAtMs,
      used: false,
    });

    return {
      ok: true,
      nonce,
      expiresAtMs,
      serverNowMs: clock.serverNowMs,
      serverIso: clock.serverIso,
      timezone: clock.timezone,
      zoned: clock.zoned,
      deadlineHHMM,
      windowStartHHMM: school.settings.windowStartHHMM,
      radiusMeters: school.settings.radiusMeters,
      maxAccuracyMeters: school.settings.maxAccuracyMeters,
      locationConfigured: school.settings.locationConfigured,
      alreadyRecorded: Boolean(this.store.dailyLocks[lockKey]),
    };
  }

  private recordSuspiciousEvent(event: Omit<StoredSuspiciousEvent, 'id' | 'createdAtMs'>): StoredSuspiciousEvent {
    const full: StoredSuspiciousEvent = {
      ...event,
      id: `susp_${this.nowFn().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      createdAtMs: this.nowFn(),
    };
    this.store.suspiciousEvents.unshift(full);
    if (this.store.suspiciousEvents.length > 500) {
      this.store.suspiciousEvents.length = 500;
    }
    this.persistStore();
    return full;
  }

  public verifyAndRecordCheckIn(params: {
    caller: VerifiedFirebaseUser;
    schoolId: string;
    nonce: string;
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    clientTimestampMs?: number;
    requestedDate?: string;
    targetTeacherId?: string;
  }):
    | {
        ok: true;
        entry: {
          schoolId: string;
          date: string;
          teacherId: string;
          staffUid: string;
          staffCode: string;
          staffName: string;
          roleTitle: TeacherRole;
          status: 'Present';
          recordingMethod: 'GPS Auto';
          timeInDisplay: string;
          serverIso: string;
          serverNowMs: number;
          gpsVerificationStatus: 'Verified';
          latitude: number;
          longitude: number;
          distanceMeters: number;
          accuracyMeters: number;
          deadlineHHMM: string;
          isSuspicious: boolean;
          spoofingFlags: string[];
          serverReceiptSignature: string;
        };
      }
    | { ok: false; error: TimebookApiError } {
    const school = this.store.schools[params.schoolId];
    if (!school) {
      return {
        ok: false,
        error: {
          status: 404,
          code: 'SCHOOL_NOT_SYNCED',
          error: 'School timebook policy has not been configured yet.',
        },
      };
    }

    if (!school.settings.enabled) {
      return {
        ok: false,
        error: {
          status: 403,
          code: 'TIMEBOOK_DISABLED',
          error: 'Staff Timebook is currently disabled by the school administrator.',
        },
      };
    }

    const staffMember = this.resolveStaffForSchool(school, params.caller);
    if (!staffMember) {
      return {
        ok: false,
        error: {
          status: 403,
          code: 'NOT_SCHOOL_STAFF',
          error: 'Your account is not listed on the active staff roster for this school.',
        },
      };
    }

    const clock = this.getAuthoritativeClock(school.settings.timezone);
    const serverDate = clock.zoned.isoDate;

    // Prevent submitting attendance on behalf of another staff member
    if (params.targetTeacherId && params.targetTeacherId !== staffMember.teacherId) {
      const susp = this.recordSuspiciousEvent({
        schoolId: params.schoolId,
        date: serverDate,
        teacherId: staffMember.teacherId,
        staffUid: params.caller.uid,
        staffName: staffMember.fullName,
        roleTitle: staffMember.roleTitle,
        reasonCode: 'STAFF_IMPERSONATION_ATTEMPT',
        detail: `Attempted to submit Time In for staff ID ${params.targetTeacherId}.`,
        latitude: Number(params.latitude) || 0,
        longitude: Number(params.longitude) || 0,
        distanceMeters: 0,
        accuracyMeters: Number(params.accuracyMeters) || 0,
        clientTimestampIso: params.clientTimestampMs
          ? new Date(params.clientTimestampMs).toISOString()
          : '',
        serverTimeIso: clock.serverIso,
      });
      return {
        ok: false,
        error: {
          status: 403,
          code: 'IMPERSONATION_BLOCKED',
          error: 'You may only record attendance for your own staff account.',
          flags: ['STAFF_IMPERSONATION_ATTEMPT'],
          suspiciousEvent: susp,
        },
      };
    }

    if (staffMember.status !== 'Active') {
      return {
        ok: false,
        error: {
          status: 403,
          code: 'STAFF_ON_LEAVE',
          error: 'Staff marked On Leave cannot submit Time In. Contact the school administrator.',
        },
      };
    }

    // Validate anti-replay nonce
    const nonceRecord = this.nonces.get(clampStr(params.nonce, 128));
    if (!nonceRecord || nonceRecord.schoolId !== params.schoolId || nonceRecord.uid !== params.caller.uid) {
      return {
        ok: false,
        error: {
          status: 400,
          code: 'INVALID_CHALLENGE',
          error: 'Security verification challenge is missing or invalid. Refresh location verification and retry.',
        },
      };
    }
    if (nonceRecord.used) {
      const susp = this.recordSuspiciousEvent({
        schoolId: params.schoolId,
        date: serverDate,
        teacherId: staffMember.teacherId,
        staffUid: params.caller.uid,
        staffName: staffMember.fullName,
        roleTitle: staffMember.roleTitle,
        reasonCode: 'NONCE_REPLAY_ATTEMPT',
        detail: 'Attempted to reuse an already consumed attendance verification challenge.',
        latitude: Number(params.latitude) || 0,
        longitude: Number(params.longitude) || 0,
        distanceMeters: 0,
        accuracyMeters: Number(params.accuracyMeters) || 0,
        clientTimestampIso: params.clientTimestampMs
          ? new Date(params.clientTimestampMs).toISOString()
          : '',
        serverTimeIso: clock.serverIso,
      });
      return {
        ok: false,
        error: {
          status: 403,
          code: 'NONCE_REPLAY',
          error: 'Security challenge already used. Re-verify GPS location before submitting Time In.',
          flags: ['NONCE_REPLAY_ATTEMPT'],
          suspiciousEvent: susp,
        },
      };
    }
    if (clock.serverNowMs > nonceRecord.expiresAtMs) {
      return {
        ok: false,
        error: {
          status: 400,
          code: 'CHALLENGE_EXPIRED',
          error: 'GPS verification challenge expired. Re-verify your location and try again.',
        },
      };
    }
    // Consume nonce immediately so replays fail
    nonceRecord.used = true;

    // Validate raw coordinates
    if (!isValidLatitude(params.latitude) || !isValidLongitude(params.longitude)) {
      return {
        ok: false,
        error: {
          status: 400,
          code: 'INVALID_COORDINATES',
          error: 'Valid GPS latitude and longitude are required.',
        },
      };
    }
    if (typeof params.accuracyMeters !== 'number' || !Number.isFinite(params.accuracyMeters)) {
      return {
        ok: false,
        error: {
          status: 400,
          code: 'INVALID_ACCURACY',
          error: 'Valid GPS accuracy in metres is required.',
        },
      };
    }

    if (!school.settings.locationConfigured) {
      return {
        ok: false,
        error: {
          status: 400,
          code: 'GEOFENCE_NOT_CONFIGURED',
          error: 'School GPS coordinates have not been configured by the administrator yet.',
        },
      };
    }

    const distanceMeters = calculateHaversineDistanceMeters(
      params.latitude,
      params.longitude,
      school.settings.schoolLatitude,
      school.settings.schoolLongitude
    );

    const pingKey = `${params.schoolId}:${staffMember.teacherId}`;
    const recentPings = this.store.recentPings[pingKey] || [];
    const spoofing = detectGpsSpoofingSignals({
      latitude: params.latitude,
      longitude: params.longitude,
      accuracyMeters: params.accuracyMeters,
      distanceMeters,
      radiusMeters: school.settings.radiusMeters,
      clientTimestampMs: params.clientTimestampMs,
      serverNowMs: clock.serverNowMs,
      clientDate: params.requestedDate,
      serverDate,
      recentPings,
    });

    // Retrospective or future date check (critical security rule)
    if (params.requestedDate && params.requestedDate !== serverDate) {
      const susp = this.recordSuspiciousEvent({
        schoolId: params.schoolId,
        date: serverDate,
        teacherId: staffMember.teacherId,
        staffUid: params.caller.uid,
        staffName: staffMember.fullName,
        roleTitle: staffMember.roleTitle,
        reasonCode: 'RETROSPECTIVE_OR_DATE_MISMATCH',
        detail: `Submitted requestedDate=${params.requestedDate} against authoritative school date ${serverDate}.`,
        latitude: params.latitude,
        longitude: params.longitude,
        distanceMeters,
        accuracyMeters: params.accuracyMeters,
        clientTimestampIso: params.clientTimestampMs
          ? new Date(params.clientTimestampMs).toISOString()
          : '',
        serverTimeIso: clock.serverIso,
      });
      return {
        ok: false,
        error: {
          status: 403,
          code: 'RETROSPECTIVE_ATTENDANCE_BLOCKED',
          error: `Retrospective or mismatched date (${params.requestedDate}) is strictly prohibited. Contact your administrator if you missed an earlier day.`,
          flags: spoofing.flags,
          distanceMeters,
          accuracyMeters: params.accuracyMeters,
          suspiciousEvent: susp,
        },
      };
    }

    // Log any detected spoofing indicators regardless of whether window/geofence also fail
    let recordedSuspicious: StoredSuspiciousEvent | undefined;
    if (spoofing.isSuspicious) {
      recordedSuspicious = this.recordSuspiciousEvent({
        schoolId: params.schoolId,
        date: serverDate,
        teacherId: staffMember.teacherId,
        staffUid: params.caller.uid,
        staffName: staffMember.fullName,
        roleTitle: staffMember.roleTitle,
        reasonCode: spoofing.reasonCode,
        detail: spoofing.detail,
        latitude: params.latitude,
        longitude: params.longitude,
        distanceMeters,
        accuracyMeters: params.accuracyMeters,
        clientTimestampIso: params.clientTimestampMs
          ? new Date(params.clientTimestampMs).toISOString()
          : '',
        serverTimeIso: clock.serverIso,
      });
    }

    // Non-working day / public holiday check
    const holidayCheck = isHolidayOrWeekend(serverDate, clock.zoned.dayOfWeek, school.settings);
    if (holidayCheck.isNonWorkingDay) {
      return {
        ok: false,
        error: {
          status: 403,
          code: 'NON_WORKING_DAY',
          error: `Time In is not required today: ${holidayCheck.reason}.`,
        },
      };
    }

    // Authoritative strict Time-In window check (Africa/Blantyre)
    const deadlineHHMM = getEffectiveDeadlineHHMM(school.settings, staffMember.roleTitle);
    const windowState = isAttendanceWindowOpen(
      clock.zoned.totalSeconds,
      school.settings.windowStartHHMM,
      deadlineHHMM
    );
    if (windowState.isBeforeOpen) {
      return {
        ok: false,
        error: {
          status: 403,
          code: 'WINDOW_NOT_OPEN',
          error: `Attendance window opens at ${school.settings.windowStartHHMM} (${school.settings.timezone}). Server time is ${clock.zoned.hhmmss}.`,
          flags: spoofing.flags,
          suspiciousEvent: recordedSuspicious,
        },
      };
    }
    if (windowState.isClosed) {
      return {
        ok: false,
        error: {
          status: 403,
          code: 'WINDOW_CLOSED',
          error: `Attendance deadline (${deadlineHHMM} ${school.settings.timezone}) has passed (server time: ${clock.zoned.hhmmss}). Contact your administrator for an authorized attendance correction.`,
          flags: spoofing.flags,
          suspiciousEvent: recordedSuspicious,
        },
      };
    }

    // Duplicate check-in protection
    const lockKey = `${params.schoolId}:${serverDate}:${staffMember.teacherId}`;
    if (this.store.dailyLocks[lockKey]) {
      return {
        ok: false,
        error: {
          status: 409,
          code: 'ALREADY_RECORDED',
          error: 'Attendance has already been recorded for you today.',
        },
      };
    }

    // Block hard spoofing attempts (mock 0 accuracy, null island, >90s clock tamper, teleport velocity, identical multi-day 7-decimal coords)
    const hardFlags = spoofing.flags.filter((f) => HARD_SPOOF_FLAGS.has(f));
    if (hardFlags.length > 0) {
      return {
        ok: false,
        error: {
          status: 403,
          code: 'SPOOFING_DETECTED',
          error: `Security check blocked attendance: ${spoofing.detail}`,
          flags: hardFlags,
          distanceMeters,
          accuracyMeters: params.accuracyMeters,
          suspiciousEvent: recordedSuspicious,
        },
      };
    }

    // Enforce GPS accuracy threshold
    if (params.accuracyMeters > school.settings.maxAccuracyMeters) {
      return {
        ok: false,
        error: {
          status: 403,
          code: 'GPS_ACCURACY_INSUFFICIENT',
          error: `GPS accuracy (±${Math.round(params.accuracyMeters)}m) exceeds the maximum permitted ±${school.settings.maxAccuracyMeters}m. Move to an open area and retry.`,
          accuracyMeters: params.accuracyMeters,
          distanceMeters,
        },
      };
    }

    // Enforce geofence radius
    if (distanceMeters > school.settings.radiusMeters) {
      return {
        ok: false,
        error: {
          status: 403,
          code: 'OUTSIDE_GEOFENCE',
          error: `You are ${Math.round(distanceMeters)}m from ${school.settings.locationLabel} (permitted radius: ${school.settings.radiusMeters}m). Attendance can only be recorded within school premises.`,
          distanceMeters,
          accuracyMeters: params.accuracyMeters,
          flags: spoofing.flags,
          suspiciousEvent: recordedSuspicious,
        },
      };
    }

    // Success: compute HMAC receipt & atomically lock today's attendance
    const timeInDisplay = clock.zoned.hhmmss;
    const receiptPayload = [
      params.schoolId,
      serverDate,
      staffMember.teacherId,
      params.caller.uid,
      params.latitude.toFixed(6),
      params.longitude.toFixed(6),
      distanceMeters.toFixed(1),
      params.accuracyMeters.toFixed(1),
      clock.serverIso,
    ].join('|');
    const serverReceiptSignature = this.signReceipt(receiptPayload);

    this.store.dailyLocks[lockKey] = {
      teacherId: staffMember.teacherId,
      staffUid: params.caller.uid,
      status: 'Present',
      recordingMethod: 'GPS Auto',
      timeInDisplay,
      serverIso: clock.serverIso,
      distanceMeters,
      accuracyMeters: params.accuracyMeters,
      deadlineHHMM,
      serverReceiptSignature,
    };

    const updatedPings = [
      ...recentPings.slice(-9),
      {
        latitude: params.latitude,
        longitude: params.longitude,
        accuracyMeters: params.accuracyMeters,
        timestampMs: clock.serverNowMs,
        date: serverDate,
      },
    ];
    this.store.recentPings[pingKey] = updatedPings;
    this.persistStore();

    return {
      ok: true,
      entry: {
        schoolId: params.schoolId,
        date: serverDate,
        teacherId: staffMember.teacherId,
        staffUid: params.caller.uid,
        staffCode: staffMember.staffCode,
        staffName: staffMember.fullName,
        roleTitle: staffMember.roleTitle,
        status: 'Present',
        recordingMethod: 'GPS Auto',
        timeInDisplay,
        serverIso: clock.serverIso,
        serverNowMs: clock.serverNowMs,
        gpsVerificationStatus: 'Verified',
        latitude: params.latitude,
        longitude: params.longitude,
        distanceMeters,
        accuracyMeters: params.accuracyMeters,
        deadlineHHMM,
        isSuspicious: spoofing.isSuspicious,
        spoofingFlags: spoofing.flags,
        serverReceiptSignature,
      },
    };
  }

  public adminSyncEntry(params: {
    caller: VerifiedFirebaseUser;
    schoolId: string;
    date: string;
    teacherId: string;
    status: TimebookEntryStatus;
    timeInDisplay?: string;
  }): { ok: true } | { ok: false; error: TimebookApiError } {
    const school = this.store.schools[params.schoolId];
    if (!this.isCallerAuthorizedOwner(school, params.caller)) {
      return {
        ok: false,
        error: {
          status: 403,
          code: 'OWNER_REQUIRED',
          error: 'Only the school administrator may record administrative attendance overrides.',
        },
      };
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date) || !params.teacherId) {
      return {
        ok: false,
        error: { status: 400, code: 'INVALID_PAYLOAD', error: 'Invalid date or staff ID.' },
      };
    }

    const lockKey = `${params.schoolId}:${params.date}:${params.teacherId}`;
    if (
      params.status === 'Present' ||
      params.status === 'Late' ||
      params.status === 'Administratively Recorded' ||
      params.status === 'On Leave'
    ) {
      const clock = this.getAuthoritativeClock(school?.settings.timezone || DEFAULT_TIMEBOOK_TIMEZONE);
      this.store.dailyLocks[lockKey] = {
        teacherId: params.teacherId,
        staffUid: '',
        status: params.status,
        recordingMethod: 'Admin Recorded',
        timeInDisplay: params.timeInDisplay || clock.zoned.hhmmss,
        serverIso: clock.serverIso,
        distanceMeters: 0,
        accuracyMeters: 0,
        deadlineHHMM: school?.settings.defaultDeadlineHHMM || DEFAULT_TIMEBOOK_DEADLINE,
        serverReceiptSignature: this.signReceipt(`${lockKey}|ADMIN|${params.status}|${clock.serverIso}`),
      };
    } else if (params.status === 'Absent') {
      // Admin resolved today as Absent — remove lock only if previously absent? Wait: keeping Absent stops nagging for today unless reopened.
      const clock = this.getAuthoritativeClock(school?.settings.timezone || DEFAULT_TIMEBOOK_TIMEZONE);
      this.store.dailyLocks[lockKey] = {
        teacherId: params.teacherId,
        staffUid: '',
        status: 'Absent',
        recordingMethod: 'Admin Recorded',
        timeInDisplay: '',
        serverIso: clock.serverIso,
        distanceMeters: 0,
        accuracyMeters: 0,
        deadlineHHMM: school?.settings.defaultDeadlineHHMM || DEFAULT_TIMEBOOK_DEADLINE,
        serverReceiptSignature: this.signReceipt(`${lockKey}|ADMIN_ABSENT|${clock.serverIso}`),
      };
    }

    this.persistStore();
    return { ok: true };
  }

  public savePushSubscription(params: {
    caller: VerifiedFirebaseUser;
    schoolId: string;
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
    userAgent?: string;
  }): { ok: true; subscriptionId: string } | { ok: false; error: TimebookApiError } {
    const endpoint = clampStr(params.subscription?.endpoint, 1000);
    const p256dh = clampStr(params.subscription?.keys?.p256dh, 300);
    const authKey = clampStr(params.subscription?.keys?.auth, 300);
    if (!endpoint.startsWith('https://') || !p256dh || !authKey) {
      return {
        ok: false,
        error: {
          status: 400,
          code: 'INVALID_PUSH_SUBSCRIPTION',
          error: 'Valid HTTPS Web Push endpoint and encryption keys are required.',
        },
      };
    }

    const endpointHash = crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 16);
    const id = `${params.caller.uid}:${endpointHash}`;
    this.store.pushSubscriptions[id] = {
      id,
      uid: params.caller.uid,
      email: params.caller.email,
      schoolId: clampStr(params.schoolId, 128),
      endpoint,
      keys: { p256dh, auth: authKey },
      userAgent: clampStr(params.userAgent, 160),
      updatedAtMs: this.nowFn(),
    };
    this.persistStore();
    return { ok: true, subscriptionId: id };
  }

  public removePushSubscription(caller: VerifiedFirebaseUser, endpoint?: string): void {
    if (endpoint) {
      const endpointHash = crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 16);
      delete this.store.pushSubscriptions[`${caller.uid}:${endpointHash}`];
    } else {
      for (const [id, sub] of Object.entries(this.store.pushSubscriptions)) {
        if (sub.uid === caller.uid) {
          delete this.store.pushSubscriptions[id];
        }
      }
    }
    this.persistStore();
  }

  public getNotificationsForUser(caller: VerifiedFirebaseUser, schoolId: string): TimebookNotification[] {
    const email = caller.email.trim().toLowerCase();
    return this.store.notifications
      .filter(
        (n) =>
          n.schoolId === schoolId &&
          (n.staffUid === caller.uid || n.staffEmail.trim().toLowerCase() === email)
      )
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .slice(0, 40);
  }

  public markNotificationsRead(caller: VerifiedFirebaseUser, schoolId: string, notificationIds?: string[]): number {
    const now = this.nowFn();
    const email = caller.email.trim().toLowerCase();
    const idSet = notificationIds && notificationIds.length > 0 ? new Set(notificationIds) : null;
    let updated = 0;

    for (const n of this.store.notifications) {
      const belongsToUser =
        n.schoolId === schoolId &&
        (n.staffUid === caller.uid || n.staffEmail.trim().toLowerCase() === email);
      if (belongsToUser && n.readAtMs === 0 && (!idSet || idSet.has(n.id))) {
        n.readAtMs = now;
        updated += 1;
      }
    }
    if (updated > 0) {
      this.persistStore();
    }
    return updated;
  }

  public getSuspiciousEvents(caller: VerifiedFirebaseUser, schoolId: string): StoredSuspiciousEvent[] {
    const school = this.store.schools[schoolId];
    if (!this.isCallerAuthorizedOwner(school, caller)) {
      return [];
    }
    return this.store.suspiciousEvents.filter((e) => e.schoolId === schoolId).slice(0, 100);
  }

  private describeReminderSlot(
    slot: string,
    deadlineHHMM: string,
    slotIndex: number,
    isClosedNotice: boolean
  ): { title: string; message: string; urgency: TimebookNotification['urgency'] } {
    if (isClosedNotice) {
      return {
        title: `Timebook Window Closed (${deadlineHHMM})`,
        message: `The ${deadlineHHMM} attendance deadline has passed without a recorded Time In. Contact your school administrator for an authorized correction.`,
        urgency: 'closed',
      };
    }
    if (slot === '06:30' || slotIndex === 0) {
      return {
        title: `Morning Timebook Reminder (${slot})`,
        message: `Please record your Staff Time In on campus before the ${deadlineHHMM} deadline.`,
        urgency: 'info',
      };
    }
    if (slot === '07:00' || slotIndex === 1) {
      return {
        title: `Second Timebook Reminder (${slot})`,
        message: `You have not signed in yet today. Ensure GPS is enabled on campus before ${deadlineHHMM}.`,
        urgency: 'info',
      };
    }
    if (slot === '07:30' || slotIndex === 2) {
      return {
        title: `Urgent Timebook Reminder (${slot})`,
        message: `Timebook deadline is approaching at ${deadlineHHMM}. Record your GPS Time In on school premises now.`,
        urgency: 'warning',
      };
    }
    return {
      title: `Final Timebook Warning (${slot})`,
      message: `Final call: Staff Time In closes strictly at ${deadlineHHMM}. Sign in immediately on campus.`,
      urgency: 'urgent',
    };
  }

  public async runReminderTick(explicitNowMs?: number): Promise<{
    dispatchedCount: number;
    pushAttempted: number;
    pushDelivered: number;
  }> {
    const nowMs = explicitNowMs ?? this.nowFn();
    let dispatchedCount = 0;
    let pushAttempted = 0;
    let pushDelivered = 0;
    let storeDirty = false;

    for (const school of Object.values(this.store.schools)) {
      if (!school.settings.enabled || !school.settings.remindersEnabled) {
        continue;
      }

      const zoned = getZonedDateTimeParts(nowMs, school.settings.timezone);
      const holidayStatus = isHolidayOrWeekend(zoned.isoDate, zoned.dayOfWeek, school.settings);
      if (holidayStatus.isNonWorkingDay) {
        continue;
      }

      const slots = sanitizeReminders(school.settings.reminderSlots);
      const windowStartSec = parseHHMMToSeconds(
        school.settings.windowStartHHMM,
        DEFAULT_TIMEBOOK_WINDOW_START
      );

      for (const staff of school.staffRoster) {
        if (staff.status !== 'Active') {
          continue;
        }

        const lockKey = `${school.schoolId}:${zoned.isoDate}:${staff.teacherId}`;
        if (this.store.dailyLocks[lockKey]) {
          continue;
        }

        const effectiveDeadline = getEffectiveDeadlineHHMM(school.settings, staff.roleTitle);
        const deadlineSec = parseHHMMToSeconds(effectiveDeadline, DEFAULT_TIMEBOOK_DEADLINE);

        if (zoned.totalSeconds < windowStartSec) {
          continue;
        }

        // Collect all reminder slots due right now (either reminder slot before deadline, or CLOSED slot at/after deadline)
        let targetSlot: string | null = null;
        let targetIndex = 0;
        let isClosedNotice = false;

        if (zoned.totalSeconds >= deadlineSec) {
          targetSlot = `CLOSED_${effectiveDeadline}`;
          isClosedNotice = true;
        } else {
          // Trigger latest reminder slot that has been reached
          for (let i = 0; i < slots.length; i += 1) {
            const slotSec = parseHHMMToSeconds(slots[i]);
            if (zoned.totalSeconds >= slotSec && slotSec < deadlineSec) {
              targetSlot = slots[i];
              targetIndex = i;
            }
          }
        }

        if (!targetSlot) {
          continue;
        }

        const dedupKey = `${school.schoolId}:${zoned.isoDate}:${staff.teacherId}:${targetSlot}`;
        if (this.store.sentReminderSlots[dedupKey]) {
          continue;
        }

        const copy = this.describeReminderSlot(
          targetSlot,
          effectiveDeadline,
          targetIndex,
          isClosedNotice
        );

        const notification: TimebookNotification = {
          id: `tnotif_${nowMs.toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
          ownerId: school.ownerUid,
          schoolId: school.schoolId,
          date: zoned.isoDate,
          teacherId: staff.teacherId,
          staffUid: '',
          staffEmail: staff.staffEmail.toLowerCase(),
          slot: targetSlot,
          title: copy.title,
          message: copy.message,
          urgency: copy.urgency,
          readAtMs: 0,
          createdAtMs: nowMs,
        };

        this.store.sentReminderSlots[dedupKey] = nowMs;
        this.store.notifications.unshift(notification);
        if (this.store.notifications.length > 1000) {
          this.store.notifications.length = 1000;
        }
        dispatchedCount += 1;
        storeDirty = true;

        // Dispatch Web Push notifications for this staff member's registered devices
        const matchingSubs = Object.values(this.store.pushSubscriptions).filter(
          (sub) =>
            sub.schoolId === school.schoolId &&
            sub.email.trim().toLowerCase() === staff.staffEmail.trim().toLowerCase()
        );

        for (const sub of matchingSubs) {
          pushAttempted += 1;
          const payload = JSON.stringify({
            title: copy.title,
            body: copy.message,
            tag: `timebook-${school.schoolId}-${zoned.isoDate}-${targetSlot}`,
            url: '/?section=timebook',
            urgency: copy.urgency,
          });
          try {
            if (this.customPushSender) {
              await this.customPushSender({ endpoint: sub.endpoint, keys: sub.keys }, payload);
            } else {
              await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
            }
            pushDelivered += 1;
          } catch (err: unknown) {
            const statusCode =
              typeof err === 'object' && err !== null && 'statusCode' in err
                ? Number((err as { statusCode?: number }).statusCode)
                : 0;
            if (statusCode === 404 || statusCode === 410) {
              delete this.store.pushSubscriptions[sub.id];
              storeDirty = true;
            }
          }
        }
      }
    }

    if (storeDirty) {
      this.persistStore();
    }

    return { dispatchedCount, pushAttempted, pushDelivered };
  }
}
