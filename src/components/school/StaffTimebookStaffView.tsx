import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellOff,
  CheckCircle2,
  Clock,
  Crosshair,
  History,
  Info,
  Lock,
  MapPin,
  Navigation,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import {
  calculateHaversineDistanceMeters,
  DEFAULT_TIMEBOOK_DEADLINE,
  DEFAULT_TIMEBOOK_MAX_ACCURACY_METERS,
  DEFAULT_TIMEBOOK_RADIUS_METERS,
  DEFAULT_TIMEBOOK_TIMEZONE,
  DEFAULT_TIMEBOOK_WINDOW_START,
  getEffectiveDeadlineHHMM,
  getZonedDateTimeParts,
  isAttendanceWindowOpen,
  isHolidayOrWeekend,
  resolveStaffTimebookUiState,
} from '../../school/timebookUtils';
import {
  disableTimebookWebPush,
  enableTimebookWebPush,
  fetchAuthoritativeServerClock,
  fetchServerTimebookState,
  fetchTimebookNotifications,
  isWebPushSupported,
  markTimebookNotificationsReadOnServer,
  requestTimebookChallenge,
  verifyTimebookCheckInOnServer,
} from '../../school/timebookApi';
import {
  logTimebookSuspiciousAttempt,
  saveVerifiedTimebookEntry,
  submitTimebookCorrectionRequest,
} from '../../school/firestoreService';
import type {
  School,
  StaffTimebookEntry,
  Teacher,
  TimebookCorrectionRequest,
  TimebookNotification,
  TimebookSettings,
} from '../../school/types';
import { DraftRestoredNotice, ModalBackdrop } from './ModalBackdrop';

interface StaffTimebookStaffViewProps {
  school: School;
  user: User;
  matchedTeacher: Teacher | null;
  timebookSettings: TimebookSettings | null;
  entries: StaffTimebookEntry[];
  correctionRequests: TimebookCorrectionRequest[];
}

interface GpsReadingState {
  checked: boolean;
  permissionDenied: boolean;
  unavailable: boolean;
  errorMessage: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  distanceMeters: number | null;
  capturedAtMs: number | null;
  clockDriftSeconds: number;
}

const INITIAL_GPS_STATE: GpsReadingState = {
  checked: false,
  permissionDenied: false,
  unavailable: false,
  errorMessage: '',
  latitude: null,
  longitude: null,
  accuracyMeters: null,
  distanceMeters: null,
  capturedAtMs: null,
  clockDriftSeconds: 0,
};

export const StaffTimebookStaffView: React.FC<StaffTimebookStaffViewProps> = ({
  school,
  user,
  matchedTeacher,
  timebookSettings,
  entries,
  correctionRequests,
}) => {
  const effectiveTimezone = timebookSettings?.timezone || DEFAULT_TIMEBOOK_TIMEZONE;
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [serverTickMs, setServerTickMs] = useState(() => Date.now());
  const [clockSynced, setClockSynced] = useState(false);

  const [gpsState, setGpsState] = useState<GpsReadingState>(INITIAL_GPS_STATE);
  const [verifyingGps, setVerifyingGps] = useState(false);
  const [submittingTimeIn, setSubmittingTimeIn] = useState(false);
  const [justRecordedEntry, setJustRecordedEntry] = useState<StaffTimebookEntry | null>(null);
  const [actionMessage, setActionMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const [notifications, setNotifications] = useState<TimebookNotification[]>([]);
  const [pushSupported] = useState(() => isWebPushSupported());
  const [pushPermission, setPushPermission] = useState<NotificationPermission>(() =>
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default'
  );
  const [pushBusy, setPushBusy] = useState(false);

  // Correction Request Modal + Draft Persistence
  const draftKey = `timebook_corr_draft_${school.id}_${user.uid}`;
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [corrDate, setCorrDate] = useState('');
  const [corrRequestedStatus, setCorrRequestedStatus] = useState<'Present' | 'Late' | 'On Leave'>('Present');
  const [corrExplanation, setCorrExplanation] = useState('');
  const [corrBusy, setCorrBusy] = useState(false);
  const [corrError, setCorrError] = useState('');

  const activeNonceRef = useRef<{ nonce: string; expiresAtMs: number } | null>(null);

  // Authoritative server clock synchronization (prevents client clock tampering)
  const syncClock = useCallback(async () => {
    try {
      const serverClock = await fetchAuthoritativeServerClock(effectiveTimezone);
      const localNow = Date.now();
      setClockOffsetMs(serverClock.serverNowMs - localNow);
      setServerTickMs(serverClock.serverNowMs);
      setClockSynced(true);
    } catch {
      setClockSynced(false);
    }
  }, [effectiveTimezone]);

  useEffect(() => {
    syncClock();
    const resyncTimer = window.setInterval(syncClock, 60_000);
    const tickTimer = window.setInterval(() => {
      setServerTickMs(Date.now() + clockOffsetMs);
    }, 1000);
    return () => {
      window.clearInterval(resyncTimer);
      window.clearInterval(tickTimer);
    };
  }, [clockOffsetMs, syncClock]);

  // Fetch notifications and server state
  const refreshNotifications = useCallback(async () => {
    try {
      const items = await fetchTimebookNotifications(school.id);
      setNotifications(items);
    } catch {
      // Ignore notification polling failure silently
    }
  }, [school.id]);

  useEffect(() => {
    refreshNotifications();
    const timer = window.setInterval(refreshNotifications, 30_000);
    return () => window.clearInterval(timer);
  }, [refreshNotifications]);

  // Also check server state once on mount to keep lock consistent if Firestore cache lags
  const [serverAlreadyRecorded, setServerAlreadyRecorded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchServerTimebookState(school.id)
      .then((res) => {
        if (!cancelled) {
          setServerAlreadyRecorded(Boolean(res.alreadyRecorded));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [school.id, entries.length]);

  const zonedNow = useMemo(
    () => getZonedDateTimeParts(serverTickMs, effectiveTimezone),
    [serverTickMs, effectiveTimezone]
  );

  useEffect(() => {
    if (!corrDate) {
      setCorrDate(zonedNow.isoDate);
    }
  }, [corrDate, zonedNow.isoDate]);

  // Restore correction draft if saved
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          date?: string;
          requestedStatus?: 'Present' | 'Late' | 'On Leave';
          explanation?: string;
        };
        if (parsed.explanation && parsed.explanation.trim().length > 0) {
          if (parsed.date) setCorrDate(parsed.date);
          if (parsed.requestedStatus) setCorrRequestedStatus(parsed.requestedStatus);
          setCorrExplanation(parsed.explanation);
          setDraftRestored(true);
        }
      }
    } catch {
      // Ignore storage error
    }
  }, [draftKey]);

  const persistCorrectionDraft = (
    nextDate: string,
    nextStatus: 'Present' | 'Late' | 'On Leave',
    nextExplanation: string
  ) => {
    try {
      if (!nextExplanation.trim()) {
        window.localStorage.removeItem(draftKey);
      } else {
        window.localStorage.setItem(
          draftKey,
          JSON.stringify({ date: nextDate, requestedStatus: nextStatus, explanation: nextExplanation })
        );
      }
    } catch {
      // Ignore storage error
    }
  };

  const myEntries = useMemo(() => {
    return entries
      .filter(
        (e) =>
          (matchedTeacher && e.teacherId === matchedTeacher.id) || e.staffUid === user.uid
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [entries, matchedTeacher, user.uid]);

  const myTodayEntry = useMemo(
    () => myEntries.find((e) => e.date === zonedNow.isoDate) || justRecordedEntry,
    [justRecordedEntry, myEntries, zonedNow.isoDate]
  );

  const myCorrectionRequests = useMemo(() => {
    return correctionRequests
      .filter(
        (r) =>
          (matchedTeacher && r.teacherId === matchedTeacher.id) || r.staffUid === user.uid
      )
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  }, [correctionRequests, matchedTeacher, user.uid]);

  const effectiveDeadlineHHMM = useMemo(() => {
    if (!timebookSettings) return DEFAULT_TIMEBOOK_DEADLINE;
    return getEffectiveDeadlineHHMM(timebookSettings, matchedTeacher?.roleTitle);
  }, [matchedTeacher?.roleTitle, timebookSettings]);

  const windowStartHHMM = timebookSettings?.windowStartHHMM || DEFAULT_TIMEBOOK_WINDOW_START;
  const radiusMeters = timebookSettings?.radiusMeters || DEFAULT_TIMEBOOK_RADIUS_METERS;
  const maxAccuracyMeters =
    timebookSettings?.maxAccuracyMeters || DEFAULT_TIMEBOOK_MAX_ACCURACY_METERS;
  const locationConfigured = Boolean(timebookSettings?.locationConfigured);

  const holidayStatus = useMemo(
    () =>
      isHolidayOrWeekend(zonedNow.isoDate, zonedNow.dayOfWeek, {
        workdays: timebookSettings?.workdays || [1, 2, 3, 4, 5],
        holidays: timebookSettings?.holidays || [],
      }),
    [timebookSettings?.holidays, timebookSettings?.workdays, zonedNow.dayOfWeek, zonedNow.isoDate]
  );

  const windowOpen = useMemo(
    () => isAttendanceWindowOpen(zonedNow.totalSeconds, windowStartHHMM, effectiveDeadlineHHMM),
    [effectiveDeadlineHHMM, windowStartHHMM, zonedNow.totalSeconds]
  );

  const alreadyRecorded = Boolean(myTodayEntry) || serverAlreadyRecorded;

  const uiState = useMemo(() => {
    return resolveStaffTimebookUiState({
      alreadyRecorded,
      justRecorded: Boolean(justRecordedEntry),
      windowOpen,
      gpsPermissionDenied: gpsState.permissionDenied,
      gpsUnavailable: gpsState.unavailable,
      locationChecked: gpsState.checked,
      accuracyMeters: gpsState.accuracyMeters,
      maxAccuracyMeters,
      distanceMeters: gpsState.distanceMeters,
      radiusMeters,
      locationConfigured,
    });
  }, [
    alreadyRecorded,
    gpsState.accuracyMeters,
    gpsState.checked,
    gpsState.distanceMeters,
    gpsState.permissionDenied,
    gpsState.unavailable,
    justRecordedEntry,
    locationConfigured,
    maxAccuracyMeters,
    radiusMeters,
    windowOpen,
  ]);

  const unreadNotifications = useMemo(
    () => notifications.filter((n) => n.readAtMs === 0),
    [notifications]
  );

  const handleVerifyLocation = async () => {
    setActionMessage(null);
    if (!matchedTeacher) {
      setActionMessage({
        type: 'error',
        text: 'Your signed-in email is not linked to an active staff record in this school.',
      });
      return;
    }
    if (matchedTeacher.status === 'On Leave') {
      setActionMessage({
        type: 'info',
        text: 'Your staff profile is currently marked On Leave. Contact the administrator if you have resumed duty.',
      });
      return;
    }
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGpsState({
        ...INITIAL_GPS_STATE,
        checked: true,
        unavailable: true,
        errorMessage: 'This device or browser does not support GPS Geolocation.',
      });
      return;
    }

    setVerifyingGps(true);
    try {
      // Refresh authoritative server challenge + clock before GPS check
      try {
        const challenge = await requestTimebookChallenge(school.id);
        activeNonceRef.current = { nonce: challenge.nonce, expiresAtMs: challenge.expiresAtMs };
        setClockOffsetMs(challenge.serverNowMs - Date.now());
        setServerTickMs(challenge.serverNowMs);
        setClockSynced(true);
      } catch {
        // Fallback to server-time sync so location preview still checks campus distance cleanly
        await syncClock();
      }

      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15_000,
          maximumAge: 0,
        });
      });

      const { latitude, longitude, accuracy } = position.coords;
      const measuredDistance = timebookSettings
        ? calculateHaversineDistanceMeters(
            latitude,
            longitude,
            timebookSettings.schoolLatitude,
            timebookSettings.schoolLongitude
          )
        : Number.POSITIVE_INFINITY;

      const driftSec = Math.round((Date.now() - (Date.now() + clockOffsetMs)) / 1000);

      setGpsState({
        checked: true,
        permissionDenied: false,
        unavailable: false,
        errorMessage: '',
        latitude,
        longitude,
        accuracyMeters: accuracy,
        distanceMeters: measuredDistance,
        capturedAtMs: Date.now(),
        clockDriftSeconds: driftSec,
      });

      // Log egregious client-side suspicious GPS events if detected right away
      if ((latitude === 0 && longitude === 0) || accuracy <= 0 || Math.abs(driftSec) > 90) {
        await logTimebookSuspiciousAttempt({
          schoolId: school.id,
          ownerId: school.ownerId,
          date: zonedNow.isoDate,
          teacherId: matchedTeacher.id,
          staffUid: user.uid,
          staffName: matchedTeacher.fullName,
          roleTitle: matchedTeacher.roleTitle,
          reasonCode:
            Math.abs(driftSec) > 90
              ? 'CLIENT_CLOCK_TAMPER'
              : accuracy <= 0
              ? 'MOCK_ZERO_ACCURACY'
              : 'NULL_ISLAND_COORDS',
          detail:
            Math.abs(driftSec) > 90
              ? `Device clock drift of ${driftSec}s detected during GPS verification.`
              : `Suspicious GPS sensor reading (lat=${latitude}, lng=${longitude}, accuracy=${accuracy}m).`,
          latitude,
          longitude,
          distanceMeters: Number.isFinite(measuredDistance) ? measuredDistance : 0,
          accuracyMeters: accuracy,
          clientTimestampIso: new Date().toISOString(),
          serverTimeIso: new Date(Date.now() + clockOffsetMs).toISOString(),
        });
      }
    } catch (err) {
      const geoErr = err as GeolocationPositionError | undefined;
      const isDenied = geoErr?.code === 1;
      setGpsState({
        ...INITIAL_GPS_STATE,
        checked: true,
        permissionDenied: isDenied,
        unavailable: !isDenied,
        errorMessage: isDenied
          ? 'Location access was denied. Enable browser location permission for this site and tap Retry.'
          : geoErr?.message || 'Unable to acquire a GPS signal. Ensure GPS/Location Services are enabled and retry.',
      });
    } finally {
      setVerifyingGps(false);
    }
  };

  const handleTimeIn = async () => {
    if (
      !matchedTeacher ||
      !uiState.canTimeIn ||
      gpsState.latitude === null ||
      gpsState.longitude === null ||
      gpsState.accuracyMeters === null
    ) {
      return;
    }

    setSubmittingTimeIn(true);
    setActionMessage(null);
    try {
      let nonce = activeNonceRef.current?.nonce || '';
      if (!nonce || Date.now() + clockOffsetMs >= (activeNonceRef.current?.expiresAtMs || 0) - 5000) {
        const challenge = await requestTimebookChallenge(school.id);
        nonce = challenge.nonce;
        activeNonceRef.current = { nonce: challenge.nonce, expiresAtMs: challenge.expiresAtMs };
      }

      const verified = await verifyTimebookCheckInOnServer({
        schoolId: school.id,
        nonce,
        latitude: gpsState.latitude,
        longitude: gpsState.longitude,
        accuracyMeters: gpsState.accuracyMeters,
        clientTimestampMs: Date.now(),
        requestedDate: zonedNow.isoDate,
      });

      // Clear consumed nonce
      activeNonceRef.current = null;

      await saveVerifiedTimebookEntry({
        ownerId: school.ownerId,
        verifiedEntry: verified.entry,
      });

      const recordedLocal: StaffTimebookEntry = {
        id: `${verified.entry.date}_${verified.entry.teacherId}`,
        ownerId: school.ownerId,
        schoolId: verified.entry.schoolId,
        date: verified.entry.date,
        teacherId: verified.entry.teacherId,
        staffUid: verified.entry.staffUid,
        staffCode: verified.entry.staffCode,
        staffName: verified.entry.staffName,
        roleTitle: verified.entry.roleTitle,
        status: 'Present',
        recordingMethod: 'GPS Auto',
        timeInDisplay: verified.entry.timeInDisplay,
        gpsVerificationStatus: 'Verified',
        latitude: verified.entry.latitude,
        longitude: verified.entry.longitude,
        distanceMeters: verified.entry.distanceMeters,
        accuracyMeters: verified.entry.accuracyMeters,
        deadlineHHMM: verified.entry.deadlineHHMM,
        isSuspicious: verified.entry.isSuspicious,
        spoofingFlags: verified.entry.spoofingFlags,
        correctionStatus: 'None',
        correctionReason: '',
        authorizedByUid: '',
        authorizedByName: '',
        serverReceiptSignature: verified.entry.serverReceiptSignature,
      };

      setJustRecordedEntry(recordedLocal);
      setServerAlreadyRecorded(true);
      await markTimebookNotificationsReadOnServer(school.id).catch(() => undefined);
      await refreshNotifications();
      setActionMessage({
        type: 'success',
        text: `Time In verified and saved at ${verified.entry.timeInDisplay} (${Math.round(verified.entry.distanceMeters)}m from campus).`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to record Time In.';
      const errWithMeta = err as Error & { code?: string; status?: number };

      // Mirror suspicious attempt into Firestore if teacher record exists
      if (
        gpsState.latitude !== null &&
        gpsState.longitude !== null &&
        gpsState.accuracyMeters !== null &&
        errWithMeta.code &&
        ['SPOOFING_DETECTED', 'NONCE_REPLAY', 'RETROSPECTIVE_ATTENDANCE_BLOCKED', 'OUTSIDE_GEOFENCE'].includes(
          errWithMeta.code
        )
      ) {
        await logTimebookSuspiciousAttempt({
          schoolId: school.id,
          ownerId: school.ownerId,
          date: zonedNow.isoDate,
          teacherId: matchedTeacher.id,
          staffUid: user.uid,
          staffName: matchedTeacher.fullName,
          roleTitle: matchedTeacher.roleTitle,
          reasonCode: errWithMeta.code,
          detail: msg,
          latitude: gpsState.latitude,
          longitude: gpsState.longitude,
          distanceMeters: gpsState.distanceMeters || 0,
          accuracyMeters: gpsState.accuracyMeters,
          clientTimestampIso: new Date().toISOString(),
          serverTimeIso: new Date(Date.now() + clockOffsetMs).toISOString(),
        });
      }

      if (errWithMeta.code === 'ALREADY_RECORDED') {
        setServerAlreadyRecorded(true);
      }
      setActionMessage({ type: 'error', text: msg });
      // Force fresh GPS check on next attempt
      activeNonceRef.current = null;
    } finally {
      setSubmittingTimeIn(false);
    }
  };

  const handleToggleWebPush = async () => {
    setPushBusy(true);
    setActionMessage(null);
    try {
      if (pushPermission === 'granted') {
        await disableTimebookWebPush();
        setActionMessage({
          type: 'info',
          text: 'Device push reminders unsubscribed. You will still receive in-app notifications.',
        });
      } else {
        const res = await enableTimebookWebPush(school.id);
        setPushPermission(res.permission);
        if (res.ok) {
          setActionMessage({
            type: 'success',
            text: 'Background Web Push attendance reminders enabled for this device.',
          });
        } else if (res.error) {
          setActionMessage({ type: 'error', text: res.error });
        }
      }
    } finally {
      setPushBusy(false);
    }
  };

  const handleSubmitCorrectionRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matchedTeacher) return;
    setCorrError('');
    setCorrBusy(true);
    try {
      await submitTimebookCorrectionRequest({
        schoolId: school.id,
        ownerId: school.ownerId,
        date: corrDate || zonedNow.isoDate,
        teacherId: matchedTeacher.id,
        staffUid: user.uid,
        staffCode: matchedTeacher.staffCode,
        staffName: matchedTeacher.fullName,
        roleTitle: matchedTeacher.roleTitle,
        currentStatus: myTodayEntry?.status || 'Not Signed In',
        requestedStatus: corrRequestedStatus,
        explanation: corrExplanation,
      });
      setCorrExplanation('');
      setDraftRestored(false);
      try {
        window.localStorage.removeItem(draftKey);
      } catch {
        // Ignore storage error
      }
      setCorrectionOpen(false);
      setActionMessage({
        type: 'success',
        text: 'Attendance correction request submitted to your school administrator for review.',
      });
    } catch (err) {
      setCorrError(err instanceof Error ? err.message : 'Unable to submit correction request.');
    } finally {
      setCorrBusy(false);
    }
  };

  const stateTone = useMemo(() => {
    switch (uiState.code) {
      case 'E_LOCATION_VERIFIED':
      case 'F_ATTENDANCE_RECORDED':
      case 'H_ALREADY_RECORDED':
        return {
          border: 'border-emerald-200 dark:border-emerald-900/60',
          bg: 'bg-emerald-50/70 dark:bg-emerald-950/25',
          badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300',
          icon: <ShieldCheck className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />,
        };
      case 'B_OUTSIDE_PREMISES':
      case 'C_GPS_PERMISSION_DENIED':
      case 'G_WINDOW_CLOSED':
        return {
          border: 'border-rose-200 dark:border-rose-900/60',
          bg: 'bg-rose-50/70 dark:bg-rose-950/25',
          badge: 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300',
          icon: <ShieldAlert className="w-5 h-5 text-rose-700 dark:text-rose-400" />,
        };
      case 'D_GPS_ACCURACY_INSUFFICIENT':
        return {
          border: 'border-amber-200 dark:border-amber-900/60',
          bg: 'bg-amber-50/70 dark:bg-amber-950/25',
          badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
          icon: <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-400" />,
        };
      default:
        return {
          border: 'border-slate-200 dark:border-slate-800',
          bg: 'bg-slate-50/80 dark:bg-slate-900/40',
          badge: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
          icon: <MapPin className="w-5 h-5 text-slate-600 dark:text-slate-300" />,
        };
    }
  }, [uiState.code]);

  return (
    <div className="space-y-5">
      {/* Header Identity + Authoritative Server Clock Card */}
      <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Staff Timebook
              </h1>
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400 font-mono tabular-nums">
                {effectiveTimezone}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
              <span>
                Staff:{' '}
                <strong className="text-slate-900 dark:text-slate-100">
                  {matchedTeacher?.fullName || user.displayName || user.email}
                </strong>
              </span>
              {matchedTeacher && (
                <>
                  <span className="font-mono tabular-nums">{matchedTeacher.staffCode}</span>
                  <span>{matchedTeacher.roleTitle}</span>
                </>
              )}
              <span>
                Campus:{' '}
                <strong className="text-slate-800 dark:text-slate-200">
                  {timebookSettings?.locationLabel || school.name}
                </strong>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 shrink-0">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 px-3 py-2">
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                School Date
              </p>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 font-mono tabular-nums mt-0.5">
                {zonedNow.isoDate}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 px-3 py-2">
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Server Time {clockSynced ? '' : '(Syncing)'}
              </p>
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 font-mono tabular-nums mt-0.5">
                {zonedNow.hhmmss}
              </p>
            </div>
            <div className="col-span-2 sm:col-span-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 px-3 py-2">
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Deadline (Window {windowStartHHMM})
              </p>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 font-mono tabular-nums mt-0.5">
                Before {effectiveDeadlineHHMM}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Unlinked Staff Warning if Admin tests Role Mode without Staff Record */}
      {!matchedTeacher && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-900/70 bg-amber-50/80 dark:bg-amber-950/30 p-4 flex items-start gap-3 text-sm text-amber-900 dark:text-amber-200">
          <Info className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-semibold">Staff Profile Email Link Required</p>
            <p className="text-xs mt-1">
              Your signed-in account ({user.email}) is not currently listed in the Staff Directory for {school.name}. Ask your administrator to add or link your staff email under Staff &amp; Settings before recording GPS Time In.
            </p>
          </div>
        </div>
      )}

      {/* Unread Automated Reminders + Web Push Toggle */}
      {(unreadNotifications.length > 0 || pushSupported) && (
        <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <Bell className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0">
              {unreadNotifications.length > 0 ? (
                <>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {unreadNotifications[0].title}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    {unreadNotifications[0].message}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Automated Morning Reminders
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    Alerts trigger at 06:30, 07:00, 07:30, and 07:50 until you record Time In before {effectiveDeadlineHHMM}.
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {unreadNotifications.length > 0 && (
              <button
                type="button"
                onClick={async () => {
                  await markTimebookNotificationsReadOnServer(school.id).catch(() => undefined);
                  await refreshNotifications();
                }}
                className="min-h-[36px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Dismiss Alerts
              </button>
            )}
            {pushSupported && (
              <button
                type="button"
                disabled={pushBusy}
                onClick={handleToggleWebPush}
                className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {pushPermission === 'granted' ? (
                  <>
                    <BellOff className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                    <span>Push Active</span>
                  </>
                ) : (
                  <>
                    <Bell className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                    <span>{pushBusy ? 'Enabling...' : 'Enable Push Alerts'}</span>
                  </>
                )}
              </button>
            )}
          </div>
        </section>
      )}

      {/* Feedback Banner */}
      {actionMessage && (
        <div
          className={`rounded-2xl border p-4 flex items-center justify-between gap-3 text-sm ${
            actionMessage.type === 'success'
              ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200'
              : actionMessage.type === 'error'
              ? 'border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200'
              : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-slate-800 dark:text-slate-200'
          }`}
        >
          <span>{actionMessage.text}</span>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
            aria-label="Close notice"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Primary GPS Verification & Time In Action Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <section className={`lg:col-span-7 rounded-2xl border p-5 sm:p-6 ${stateTone.border} ${stateTone.bg}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 flex items-center justify-center shrink-0">
                {stateTone.icon}
              </div>
              <div>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${stateTone.badge}`}>
                  {uiState.code.replace(/_/g, ' ')}
                </span>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-1.5">
                  {holidayStatus.isNonWorkingDay
                    ? 'Non-Working Day / Holiday'
                    : uiState.headline}
                </h2>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                  {holidayStatus.isNonWorkingDay
                    ? `${holidayStatus.reason}. Staff Time In is not required today.`
                    : gpsState.errorMessage || uiState.detail}
                </p>
              </div>
            </div>
          </div>

          {/* Live GPS Telemetry Grid */}
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded-xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-3">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Distance to Campus</p>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 font-mono tabular-nums mt-0.5">
                {gpsState.distanceMeters !== null && Number.isFinite(gpsState.distanceMeters)
                  ? `${Math.round(gpsState.distanceMeters)} m`
                  : myTodayEntry
                  ? `${Math.round(myTodayEntry.distanceMeters)} m`
                  : 'Not checked'}
              </p>
            </div>
            <div className="rounded-xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-3">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Permitted Radius</p>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 font-mono tabular-nums mt-0.5">
                {radiusMeters} m
              </p>
            </div>
            <div className="rounded-xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-3">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">GPS Accuracy</p>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 font-mono tabular-nums mt-0.5">
                {gpsState.accuracyMeters !== null
                  ? `±${Math.round(gpsState.accuracyMeters)} m`
                  : myTodayEntry
                  ? `±${Math.round(myTodayEntry.accuracyMeters)} m`
                  : `Req ≤ ${maxAccuracyMeters}m`}
              </p>
            </div>
            <div className="rounded-xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-3">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Today&apos;s Status</p>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {myTodayEntry ? myTodayEntry.status : 'Not Signed In'}
              </p>
            </div>
          </div>

          {/* Recorded Receipt Details if already signed in today */}
          {myTodayEntry && (
            <div className="mt-4 rounded-xl bg-white dark:bg-[#161B22] border border-emerald-200 dark:border-emerald-900/60 p-3.5 text-xs space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  Recorded ({myTodayEntry.recordingMethod})
                </span>
                <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                  Time In: {myTodayEntry.timeInDisplay || '—'} · Date: {myTodayEntry.date}
                </span>
              </div>
              {myTodayEntry.correctionReason && (
                <p className="text-slate-600 dark:text-slate-400">
                  Admin Note: {myTodayEntry.correctionReason}
                </p>
              )}
            </div>
          )}

          {/* Action Controls */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {!alreadyRecorded && !holidayStatus.isNonWorkingDay && (
              <button
                type="button"
                disabled={verifyingGps || !matchedTeacher || matchedTeacher.status === 'On Leave'}
                onClick={handleVerifyLocation}
                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#161B22] text-sm font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {verifyingGps ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                    <span>Checking GPS...</span>
                  </>
                ) : gpsState.checked ? (
                  <>
                    <RefreshCw className="w-4 h-4" aria-hidden="true" />
                    <span>Retry GPS Verification</span>
                  </>
                ) : (
                  <>
                    <Crosshair className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                    <span>Verify My Location</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              disabled={
                !uiState.canTimeIn ||
                submittingTimeIn ||
                holidayStatus.isNonWorkingDay ||
                !matchedTeacher ||
                matchedTeacher.status === 'On Leave'
              }
              onClick={handleTimeIn}
              className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            >
              {alreadyRecorded ? (
                <>
                  <Lock className="w-4 h-4" aria-hidden="true" />
                  <span>Time In Locked for Today</span>
                </>
              ) : submittingTimeIn ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                  <span>Recording Time In...</span>
                </>
              ) : (
                <>
                  <Navigation className="w-4 h-4" aria-hidden="true" />
                  <span>Time In Now</span>
                </>
              )}
            </button>
          </div>
        </section>

        {/* Attendance Correction Instructions & Request Launcher */}
        <section className="lg:col-span-5 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Missed Deadline or GPS Issue?
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                Staff cannot record attendance after {effectiveDeadlineHHMM} or select past dates. If you encountered a technical or urgent administrative issue, submit an explanation for administrator verification. All approved adjustments are permanently logged.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={!matchedTeacher}
            onClick={() => {
              setCorrError('');
              if (!corrDate) setCorrDate(zonedNow.isoDate);
              setCorrectionOpen(true);
            }}
            className="w-full inline-flex items-center justify-center gap-2 min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            <Send className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
            <span>Request Admin Attendance Correction</span>
          </button>

          {/* Recent Correction Requests */}
          {myCorrectionRequests.length > 0 && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                My Correction Requests ({myCorrectionRequests.length})
              </p>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {myCorrectionRequests.slice(0, 5).map((req) => (
                  <div
                    key={req.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200">
                        {req.date} · {req.requestedStatus}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md font-semibold text-[11px] ${
                          req.status === 'Approved'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : req.status === 'Rejected'
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                        }`}
                      >
                        {req.status}
                      </span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400 line-clamp-2">{req.explanation}</p>
                    {req.adminNote && (
                      <p className="text-slate-700 dark:text-slate-300 font-medium">
                        Admin: {req.adminNote}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Personal Attendance History (Non-editable by staff) */}
      <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              My Attendance History ({myEntries.length})
            </h2>
          </div>
        </div>

        {myEntries.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
            No Staff Timebook records recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 pr-3 font-medium">Date</th>
                  <th className="py-2.5 pr-3 font-medium">Time In</th>
                  <th className="py-2.5 pr-3 font-medium">Status</th>
                  <th className="py-2.5 pr-3 font-medium">Method</th>
                  <th className="py-2.5 pr-3 font-medium">Campus Distance</th>
                  <th className="py-2.5 font-medium">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {myEntries.slice(0, 30).map((entry) => (
                  <tr key={entry.id}>
                    <td className="py-2.5 pr-3 font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {entry.date}
                    </td>
                    <td className="py-2.5 pr-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {entry.timeInDisplay || '—'}
                    </td>
                    <td className="py-2.5 pr-3 font-semibold text-slate-900 dark:text-slate-100">
                      {entry.status}
                    </td>
                    <td className="py-2.5 pr-3 text-xs">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-md font-medium ${
                          entry.recordingMethod === 'GPS Auto'
                            ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                            : 'bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300'
                        }`}
                      >
                        {entry.recordingMethod}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 font-mono tabular-nums text-xs text-slate-600 dark:text-slate-400">
                      {entry.recordingMethod === 'GPS Auto'
                        ? `${Math.round(entry.distanceMeters)} m (±${Math.round(entry.accuracyMeters)}m)`
                        : 'Admin Entry'}
                    </td>
                    <td className="py-2.5 text-xs text-slate-600 dark:text-slate-400">
                      {entry.correctionReason || entry.gpsVerificationStatus}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Staff Correction Request Modal (with Draft Persistence) */}
      <ModalBackdrop
        open={correctionOpen}
        onClose={() => setCorrectionOpen(false)}
        disabled={corrBusy}
        ariaLabel="Request Administrative Attendance Correction"
      >
        <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 shadow-xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Request Attendance Correction
            </h3>
            <button
              type="button"
              onClick={() => setCorrectionOpen(false)}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <DraftRestoredNotice
            visible={draftRestored}
            onDiscard={() => {
              setCorrExplanation('');
              setDraftRestored(false);
              try {
                window.localStorage.removeItem(draftKey);
              } catch {
                // Ignore
              }
            }}
          />

          <form onSubmit={handleSubmitCorrectionRequest} className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Date Requiring Review
              </label>
              <input
                type="date"
                max={zonedNow.isoDate}
                value={corrDate}
                onChange={(e) => {
                  setCorrDate(e.target.value);
                  persistCorrectionDraft(e.target.value, corrRequestedStatus, corrExplanation);
                }}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] text-sm text-slate-900 dark:text-slate-100"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Requested Status
              </label>
              <select
                value={corrRequestedStatus}
                onChange={(e) => {
                  const val = e.target.value as 'Present' | 'Late' | 'On Leave';
                  setCorrRequestedStatus(val);
                  persistCorrectionDraft(corrDate, val, corrExplanation);
                }}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] text-sm text-slate-900 dark:text-slate-100"
              >
                <option value="Present">Present (Signed in late / GPS failure)</option>
                <option value="Late">Late Arrival (With reason)</option>
                <option value="On Leave">On Leave (Authorized absence)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Explanation for School Administrator
              </label>
              <textarea
                rows={4}
                required
                minLength={5}
                maxLength={600}
                placeholder="Explain why GPS Time In could not be completed before the deadline..."
                value={corrExplanation}
                onChange={(e) => {
                  setCorrExplanation(e.target.value);
                  persistCorrectionDraft(corrDate, corrRequestedStatus, e.target.value);
                }}
                className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] text-sm text-slate-900 dark:text-slate-100"
              />
            </div>

            {corrError && (
              <p className="text-xs text-rose-600 dark:text-rose-400">{corrError}</p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setCorrectionOpen(false)}
                className="min-h-[40px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={corrBusy}
                className="min-h-[40px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
              >
                {corrBusy ? 'Submitting...' : 'Submit for Review'}
              </button>
            </div>
          </form>
        </div>
      </ModalBackdrop>
    </div>
  );
};
