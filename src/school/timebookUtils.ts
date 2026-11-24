import type {
  TeacherRole,
  TimebookHoliday,
  TimebookSettings,
  TimebookUiStateCode,
} from './types';

export const DEFAULT_TIMEBOOK_TIMEZONE = 'Africa/Blantyre';
export const DEFAULT_TIMEBOOK_WINDOW_START = '05:30';
export const DEFAULT_TIMEBOOK_DEADLINE = '08:00';
export const DEFAULT_TIMEBOOK_RADIUS_METERS = 150;
export const DEFAULT_TIMEBOOK_MAX_ACCURACY_METERS = 100;
export const DEFAULT_TIMEBOOK_REMINDER_SLOTS = ['06:30', '07:00', '07:30', '07:50'];
export const DEFAULT_TIMEBOOK_WORKDAYS = [1, 2, 3, 4, 5]; // Monday - Friday

export interface ZonedDateTimeParts {
  epochMs: number;
  isoDate: string;
  hhmm: string;
  hhmmss: string;
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMinutes: number;
  totalSeconds: number;
  dayOfWeek: number; // 0 = Sun ... 6 = Sat
  timezone: string;
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getZonedDateTimeParts(
  epochMs: number = Date.now(),
  timeZone: string = DEFAULT_TIMEBOOK_TIMEZONE
): ZonedDateTimeParts {
  const safeTz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEBOOK_TIMEZONE;
  const date = new Date(epochMs);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || '';

  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  let hours = Number(get('hour'));
  if (hours === 24) hours = 0;
  const minutes = Number(get('minute'));
  const seconds = Number(get('second'));
  const weekdayShort = get('weekday');
  const dayOfWeek = WEEKDAY_MAP[weekdayShort] ?? date.getUTCDay();

  const pad = (n: number) => String(n).padStart(2, '0');
  const isoDate = `${year}-${pad(month)}-${pad(day)}`;
  const hhmm = `${pad(hours)}:${pad(minutes)}`;
  const hhmmss = `${hhmm}:${pad(seconds)}`;

  return {
    epochMs,
    isoDate,
    hhmm,
    hhmmss,
    year,
    month,
    day,
    hours,
    minutes,
    seconds,
    totalMinutes: hours * 60 + minutes,
    totalSeconds: hours * 3600 + minutes * 60 + seconds,
    dayOfWeek,
    timezone: safeTz,
  };
}

export function isValidTimeZone(tz?: string): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidHHMM(val?: string): boolean {
  if (!val || typeof val !== 'string') return false;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(val.trim());
}

export function parseHHMMToSeconds(hhmm: string, fallbackHHMM = DEFAULT_TIMEBOOK_DEADLINE): number {
  const clean = isValidHHMM(hhmm) ? hhmm.trim() : fallbackHHMM;
  const [hStr, mStr] = clean.split(':');
  return Number(hStr) * 3600 + Number(mStr) * 60;
}

export function getEffectiveDeadlineHHMM(
  settings: Pick<TimebookSettings, 'defaultDeadlineHHMM' | 'categoryDeadlines'>,
  roleTitle?: TeacherRole | string
): string {
  const fallback = isValidHHMM(settings.defaultDeadlineHHMM)
    ? settings.defaultDeadlineHHMM
    : DEFAULT_TIMEBOOK_DEADLINE;
  if (!roleTitle || !settings.categoryDeadlines) return fallback;
  const override = settings.categoryDeadlines[roleTitle];
  return isValidHHMM(override) ? override.trim() : fallback;
}

export function isHolidayOrWeekend(
  isoDate: string,
  dayOfWeek: number,
  settings: Pick<TimebookSettings, 'workdays' | 'holidays'>
): { isNonWorkingDay: boolean; reason: string } {
  const holidays = Array.isArray(settings.holidays) ? settings.holidays : [];
  const holiday = holidays.find((h) => h.date === isoDate);
  if (holiday) {
    return { isNonWorkingDay: true, reason: `Public / School Holiday: ${holiday.name}` };
  }
  const workdays =
    Array.isArray(settings.workdays) && settings.workdays.length > 0
      ? settings.workdays
      : DEFAULT_TIMEBOOK_WORKDAYS;
  if (!workdays.includes(dayOfWeek)) {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return { isNonWorkingDay: true, reason: `${dayNames[dayOfWeek] || 'Weekend'} (non-working day)` };
  }
  return { isNonWorkingDay: false, reason: '' };
}

export function isAttendanceWindowOpen(
  nowTotalSeconds: number,
  windowStartHHMM: string,
  deadlineHHMM: string
): { isBeforeOpen: boolean; isOpen: boolean; isClosed: boolean } {
  const startSec = parseHHMMToSeconds(windowStartHHMM, DEFAULT_TIMEBOOK_WINDOW_START);
  const endSec = parseHHMMToSeconds(deadlineHHMM, DEFAULT_TIMEBOOK_DEADLINE);

  if (nowTotalSeconds < startSec) {
    return { isBeforeOpen: true, isOpen: false, isClosed: false };
  }
  // Strictly before deadline (at 08:00:00, nowTotalSeconds === endSec -> CLOSED)
  if (nowTotalSeconds >= endSec) {
    return { isBeforeOpen: false, isOpen: false, isClosed: true };
  }
  return { isBeforeOpen: false, isOpen: true, isClosed: false };
}

export function isValidLatitude(lat: unknown): lat is number {
  return typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

export function isValidLongitude(lng: unknown): lng is number {
  return typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

export const MALAWI_GEO_BOUNDS = {
  minLat: -17.2,
  maxLat: -9.3,
  minLng: 32.6,
  maxLng: 36.0,
} as const;

export const MALAWI_DEFAULT_COORDS = {
  latitude: -15.7861,
  longitude: 35.0058,
} as const;

export interface MalawiBoundsCheckResult {
  inMalawi: boolean;
  validCoordinates: boolean;
  reason: string;
}

export function validateMalawiCoordinates(lat: unknown, lng: unknown): MalawiBoundsCheckResult {
  if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
    return {
      inMalawi: false,
      validCoordinates: false,
      reason: 'Coordinates must be a valid latitude (-90 to 90) and longitude (-180 to 180).',
    };
  }

  const latOk = lat >= MALAWI_GEO_BOUNDS.minLat && lat <= MALAWI_GEO_BOUNDS.maxLat;
  const lngOk = lng >= MALAWI_GEO_BOUNDS.minLng && lng <= MALAWI_GEO_BOUNDS.maxLng;

  if (!latOk || !lngOk) {
    return {
      inMalawi: false,
      validCoordinates: true,
      reason: `Selected coordinates (${lat.toFixed(4)}, ${lng.toFixed(4)}) appear outside Malawi (expected lat ${MALAWI_GEO_BOUNDS.minLat}° to ${MALAWI_GEO_BOUNDS.maxLat}°, lng ${MALAWI_GEO_BOUNDS.minLng}° to ${MALAWI_GEO_BOUNDS.maxLng}°).`,
    };
  }

  return {
    inMalawi: true,
    validCoordinates: true,
    reason: 'Coordinates are within Malawi geographical bounds.',
  };
}

export function calculateHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (!isValidLatitude(lat1) || !isValidLongitude(lon1) || !isValidLatitude(lat2) || !isValidLongitude(lon2)) {
    return Number.POSITIVE_INFINITY;
  }
  const R = 6371000; // Earth mean radius in metres
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const clampedA = Math.min(1, Math.max(0, a));
  const c = 2 * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));
  return Math.round(R * c * 10) / 10;
}

export interface RecentGpsPing {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  timestampMs: number;
  date: string;
}

export interface SpoofingAnalysisResult {
  isSuspicious: boolean;
  flags: string[];
  reasonCode: string;
  detail: string;
}

export function detectGpsSpoofingSignals(params: {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  distanceMeters: number;
  radiusMeters: number;
  clientTimestampMs?: number;
  serverNowMs: number;
  clientDate?: string;
  serverDate: string;
  recentPings?: RecentGpsPing[];
}): SpoofingAnalysisResult {
  const flags: string[] = [];
  const details: string[] = [];

  if (params.latitude === 0 && params.longitude === 0) {
    flags.push('NULL_ISLAND_COORDS');
    details.push('Coordinates reported as (0, 0).');
  }

  if (!Number.isFinite(params.accuracyMeters) || params.accuracyMeters <= 0) {
    flags.push('MOCK_ZERO_ACCURACY');
    details.push(`Suspicious GPS accuracy value (${params.accuracyMeters}m).`);
  }

  if (
    typeof params.clientTimestampMs === 'number' &&
    Number.isFinite(params.clientTimestampMs) &&
    Math.abs(params.serverNowMs - params.clientTimestampMs) > 90_000
  ) {
    const driftSec = Math.round((params.clientTimestampMs - params.serverNowMs) / 1000);
    flags.push('CLIENT_CLOCK_TAMPER');
    details.push(`Device clock differs from server time by ${driftSec}s.`);
  }

  if (params.clientDate && params.clientDate !== params.serverDate) {
    flags.push('RETROSPECTIVE_OR_DATE_MISMATCH');
    details.push(`Client requested date ${params.clientDate} while school server date is ${params.serverDate}.`);
  }

  if (params.distanceMeters > Math.max(params.radiusMeters * 5, 2500)) {
    flags.push('FAR_OUTSIDE_GEOFENCE');
    details.push(`Attempted check-in ${Math.round(params.distanceMeters)}m from school premises.`);
  }

  const recent = params.recentPings || [];
  if (recent.length > 0) {
    const latest = recent[recent.length - 1];
    const dtSeconds = Math.max(1, (params.serverNowMs - latest.timestampMs) / 1000);
    if (dtSeconds <= 600) {
      const jumpMeters = calculateHaversineDistanceMeters(
        latest.latitude,
        latest.longitude,
        params.latitude,
        params.longitude
      );
      const speedMps = jumpMeters / dtSeconds;
      if (jumpMeters > 300 && speedMps > 35) {
        flags.push('IMPOSSIBLE_VELOCITY');
        details.push(
          `Teleported ${Math.round(jumpMeters)}m in ${Math.round(dtSeconds)}s (${Math.round(speedMps * 3.6)} km/h).`
        );
      }
    }

    const exactPriorDayMatch = recent.find(
      (p) =>
        p.date !== params.serverDate &&
        p.latitude.toFixed(7) === params.latitude.toFixed(7) &&
        p.longitude.toFixed(7) === params.longitude.toFixed(7) &&
        params.accuracyMeters <= 12
    );
    if (exactPriorDayMatch) {
      flags.push('STATIC_REPEATED_COORDINATES');
      details.push('Exact 7-decimal coordinates repeated across separate dates.');
    }
  }

  return {
    isSuspicious: flags.length > 0,
    flags,
    reasonCode: flags[0] || '',
    detail: details.join(' '),
  };
}

export function buildDefaultTimebookSettings(
  schoolId: string,
  ownerId: string
): TimebookSettings {
  return {
    id: 'default',
    ownerId,
    schoolId,
    enabled: true,
    locationConfigured: false,
    locationLabel: 'School Main Campus',
    schoolLatitude: -15.7861,
    schoolLongitude: 35.0058,
    radiusMeters: DEFAULT_TIMEBOOK_RADIUS_METERS,
    maxAccuracyMeters: DEFAULT_TIMEBOOK_MAX_ACCURACY_METERS,
    timezone: DEFAULT_TIMEBOOK_TIMEZONE,
    windowStartHHMM: DEFAULT_TIMEBOOK_WINDOW_START,
    defaultDeadlineHHMM: DEFAULT_TIMEBOOK_DEADLINE,
    categoryDeadlines: {},
    workdays: [...DEFAULT_TIMEBOOK_WORKDAYS],
    holidays: [],
    reminderSlots: [...DEFAULT_TIMEBOOK_REMINDER_SLOTS],
    remindersEnabled: true,
    updatedBy: 'System Default',
  };
}

export function resolveStaffTimebookUiState(params: {
  alreadyRecorded: boolean;
  justRecorded: boolean;
  windowOpen: { isBeforeOpen: boolean; isOpen: boolean; isClosed: boolean };
  gpsPermissionDenied: boolean;
  gpsUnavailable: boolean;
  locationChecked: boolean;
  accuracyMeters: number | null;
  maxAccuracyMeters: number;
  distanceMeters: number | null;
  radiusMeters: number;
  locationConfigured: boolean;
}): {
  code: TimebookUiStateCode;
  canTimeIn: boolean;
  headline: string;
  detail: string;
} {
  if (params.justRecorded) {
    return {
      code: 'F_ATTENDANCE_RECORDED',
      canTimeIn: false,
      headline: 'Attendance Recorded',
      detail: 'Your daily Time In has been verified by the server and saved.',
    };
  }
  if (params.alreadyRecorded) {
    return {
      code: 'H_ALREADY_RECORDED',
      canTimeIn: false,
      headline: 'Attendance Already Recorded',
      detail: 'You have already recorded your attendance for today. Further check-ins are locked.',
    };
  }
  if (params.windowOpen.isClosed || params.windowOpen.isBeforeOpen) {
    return {
      code: 'G_WINDOW_CLOSED',
      canTimeIn: false,
      headline: params.windowOpen.isBeforeOpen ? 'Attendance Window Not Open Yet' : 'Attendance Window Closed',
      detail: params.windowOpen.isBeforeOpen
        ? 'The daily Time In window has not opened yet based on official school server time.'
        : 'The official reporting deadline has passed. Contact your school administrator for an authorized attendance correction.',
    };
  }
  if (!params.locationConfigured) {
    return {
      code: 'A_LOCATION_NOT_VERIFIED',
      canTimeIn: false,
      headline: 'School Geofence Not Configured',
      detail: 'Ask your school administrator to register the school GPS coordinates before using Time In.',
    };
  }
  if (params.gpsPermissionDenied) {
    return {
      code: 'C_GPS_PERMISSION_DENIED',
      canTimeIn: false,
      headline: 'GPS Permission Denied',
      detail: 'Location access was denied or GPS is disabled. Enable device location permission and tap Retry.',
    };
  }
  if (params.gpsUnavailable || !params.locationChecked || params.distanceMeters === null || params.accuracyMeters === null) {
    return {
      code: 'A_LOCATION_NOT_VERIFIED',
      canTimeIn: false,
      headline: 'Location Not Verified',
      detail: 'Tap Verify My Location to check your GPS position inside school premises.',
    };
  }
  if (params.accuracyMeters > params.maxAccuracyMeters || params.accuracyMeters <= 0) {
    return {
      code: 'D_GPS_ACCURACY_INSUFFICIENT',
      canTimeIn: false,
      headline: 'GPS Accuracy Insufficient',
      detail: `Current GPS accuracy (${Math.round(params.accuracyMeters)}m) does not meet the required ${params.maxAccuracyMeters}m threshold. Move to an open area and retry.`,
    };
  }
  if (params.distanceMeters > params.radiusMeters) {
    return {
      code: 'B_OUTSIDE_PREMISES',
      canTimeIn: false,
      headline: 'Outside School Premises',
      detail: `You are ${Math.round(params.distanceMeters)}m away (permitted radius: ${params.radiusMeters}m). Attendance can only be recorded within school premises.`,
    };
  }
  return {
    code: 'E_LOCATION_VERIFIED',
    canTimeIn: true,
    headline: 'Location Verified — Ready for Time In',
    detail: `Within school premises (${Math.round(params.distanceMeters)}m from campus, GPS accuracy ±${Math.round(params.accuracyMeters)}m).`,
  };
}
