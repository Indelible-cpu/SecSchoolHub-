import { auth } from '../firebase';
import type { ZonedDateTimeParts } from './timebookUtils';
import type {
  Teacher,
  TeacherRole,
  TimebookEntryStatus,
  TimebookNotification,
  TimebookSettings,
} from './types';

async function getBearerToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('You must sign in first.');
  }
  return user.getIdToken();
}

async function apiJson<T>(url: string, init: RequestInit = {}, requireAuth = true): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (requireAuth) {
    const token = await getBearerToken();
    headers.set('Authorization', `Bearer ${token}`);
  }
  const res = await fetch(url, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as T & {
    ok?: boolean;
    error?: string;
    code?: string;
  };
  if (!res.ok) {
    const message = data?.error || `Request failed (HTTP ${res.status}).`;
    const err = new Error(message) as Error & { code?: string; status?: number; payload?: unknown };
    err.code = data?.code;
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

export interface ServerClockResponse {
  ok: true;
  serverNowMs: number;
  serverIso: string;
  timezone: string;
  zoned: ZonedDateTimeParts;
}

export interface TimebookChallengeResponse {
  ok: true;
  nonce: string;
  expiresAtMs: number;
  serverNowMs: number;
  serverIso: string;
  timezone: string;
  zoned: ZonedDateTimeParts;
  deadlineHHMM: string;
  windowStartHHMM: string;
  radiusMeters: number;
  maxAccuracyMeters: number;
  locationConfigured: boolean;
  alreadyRecorded: boolean;
}

export interface VerifyCheckInResponse {
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

export interface ServerTimebookStateResponse {
  ok: true;
  schoolConfigured: boolean;
  policy: Omit<TimebookSettings, 'createdAt' | 'updatedAt'> | null;
  staffMember: {
    teacherId: string;
    staffCode: string;
    fullName: string;
    roleTitle: TeacherRole;
    staffEmail: string;
    status: 'Active' | 'On Leave';
  } | null;
  clock: {
    serverNowMs: number;
    serverIso: string;
    timezone: string;
    zoned: ZonedDateTimeParts;
  };
  effectiveDeadlineHHMM: string;
  holidayStatus: { isNonWorkingDay: boolean; reason: string };
  windowOpen: { isBeforeOpen: boolean; isOpen: boolean; isClosed: boolean };
  alreadyRecorded: boolean;
  todayEntry: {
    teacherId: string;
    status: TimebookEntryStatus;
    recordingMethod: 'GPS Auto' | 'Admin Recorded';
    timeInDisplay: string;
    distanceMeters: number;
    accuracyMeters: number;
    deadlineHHMM: string;
  } | null;
}

export async function fetchAuthoritativeServerClock(timezone?: string): Promise<ServerClockResponse> {
  const qs = timezone ? `?tz=${encodeURIComponent(timezone)}` : '';
  return apiJson<ServerClockResponse>(`/api/timebook/server-time${qs}`, { method: 'GET' }, false);
}

export async function fetchServerTimebookState(schoolId: string): Promise<ServerTimebookStateResponse> {
  return apiJson<ServerTimebookStateResponse>(
    `/api/timebook/state?schoolId=${encodeURIComponent(schoolId)}`,
    { method: 'GET' },
    true
  );
}

export async function syncTimebookPolicyToServer(params: {
  schoolId: string;
  schoolName: string;
  ownerId: string;
  settings: Partial<TimebookSettings>;
  teachers: Teacher[];
}): Promise<void> {
  const staffRoster = params.teachers
    .filter((t) => Boolean(t.staffEmail?.trim()))
    .map((t) => ({
      teacherId: t.id,
      staffCode: t.staffCode,
      fullName: t.fullName,
      roleTitle: t.roleTitle,
      staffEmail: (t.staffEmail || '').trim().toLowerCase(),
      status: t.status,
    }));

  await apiJson('/api/timebook/sync-policy', {
    method: 'POST',
    body: JSON.stringify({
      schoolId: params.schoolId,
      schoolName: params.schoolName,
      ownerId: params.ownerId,
      settings: {
        enabled: params.settings.enabled,
        locationConfigured: params.settings.locationConfigured,
        locationLabel: params.settings.locationLabel,
        schoolLatitude: params.settings.schoolLatitude,
        schoolLongitude: params.settings.schoolLongitude,
        radiusMeters: params.settings.radiusMeters,
        maxAccuracyMeters: params.settings.maxAccuracyMeters,
        timezone: params.settings.timezone,
        windowStartHHMM: params.settings.windowStartHHMM,
        defaultDeadlineHHMM: params.settings.defaultDeadlineHHMM,
        categoryDeadlines: params.settings.categoryDeadlines,
        workdays: params.settings.workdays,
        holidays: params.settings.holidays,
        reminderSlots: params.settings.reminderSlots,
        remindersEnabled: params.settings.remindersEnabled,
        updatedBy: params.settings.updatedBy,
      },
      staffRoster,
    }),
  });
}

export async function requestTimebookChallenge(schoolId: string): Promise<TimebookChallengeResponse> {
  return apiJson<TimebookChallengeResponse>('/api/timebook/challenge', {
    method: 'POST',
    body: JSON.stringify({ schoolId }),
  });
}

export async function verifyTimebookCheckInOnServer(params: {
  schoolId: string;
  nonce: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  clientTimestampMs: number;
  requestedDate: string;
}): Promise<VerifyCheckInResponse> {
  return apiJson<VerifyCheckInResponse>('/api/timebook/verify-checkin', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function syncAdminEntryToServer(params: {
  schoolId: string;
  date: string;
  teacherId: string;
  status: TimebookEntryStatus;
  timeInDisplay?: string;
}): Promise<void> {
  await apiJson('/api/timebook/admin-sync-entry', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function fetchTimebookNotifications(
  schoolId: string
): Promise<TimebookNotification[]> {
  const res = await apiJson<{ ok: true; notifications: TimebookNotification[] }>(
    `/api/timebook/notifications?schoolId=${encodeURIComponent(schoolId)}`,
    { method: 'GET' }
  );
  return res.notifications || [];
}

export async function markTimebookNotificationsReadOnServer(
  schoolId: string,
  notificationIds?: string[]
): Promise<void> {
  await apiJson('/api/timebook/notifications/read', {
    method: 'POST',
    body: JSON.stringify({ schoolId, notificationIds }),
  });
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

export async function enableTimebookWebPush(schoolId: string): Promise<{
  ok: boolean;
  permission: NotificationPermission;
  error?: string;
}> {
  if (!isWebPushSupported()) {
    return {
      ok: false,
      permission: 'denied',
      error: 'Web Push notifications are not supported by this browser.',
    };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return {
      ok: false,
      permission,
      error:
        permission === 'denied'
          ? 'Browser notification permission is blocked. Enable notifications in browser site settings.'
          : 'Notification permission was dismissed.',
    };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const vapid = await apiJson<{ ok: true; publicKey: string }>(
      '/api/timebook/vapid-public-key',
      { method: 'GET' }
    );

    let sub = await registration.pushManager.getSubscription();
    if (!sub) {
      const appServerKey = urlBase64ToUint8Array(vapid.publicKey);
      sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey.buffer as ArrayBuffer,
      });
    }

    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      throw new Error('Browser failed to create push encryption keys.');
    }

    await apiJson('/api/timebook/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        schoolId,
        subscription: {
          endpoint: json.endpoint,
          keys: {
            p256dh: json.keys.p256dh,
            auth: json.keys.auth,
          },
        },
      }),
    });

    return { ok: true, permission };
  } catch (err) {
    return {
      ok: false,
      permission,
      error: err instanceof Error ? err.message : 'Unable to register background push notifications.',
    };
  }
}

export async function disableTimebookWebPush(): Promise<void> {
  if (!isWebPushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      await apiJson('/api/timebook/push/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint }),
      });
    }
  } catch {
    // Ignore unsubscribe errors
  }
}
