import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Crosshair,
  Download,
  FileText,
  Filter,
  History,
  MapPin,
  Plus,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  buildDefaultTimebookSettings,
  DEFAULT_TIMEBOOK_DEADLINE,
  DEFAULT_TIMEBOOK_MAX_ACCURACY_METERS,
  DEFAULT_TIMEBOOK_RADIUS_METERS,
  DEFAULT_TIMEBOOK_REMINDER_SLOTS,
  DEFAULT_TIMEBOOK_TIMEZONE,
  DEFAULT_TIMEBOOK_WINDOW_START,
  DEFAULT_TIMEBOOK_WORKDAYS,
  getEffectiveDeadlineHHMM,
  getZonedDateTimeParts,
  isValidHHMM,
} from '../../school/timebookUtils';
import {
  adminRejectTimebookCorrectionRequest,
  adminSaveTimebookCorrection,
  saveTimebookSettings,
} from '../../school/firestoreService';
import { syncTimebookPolicyToServer } from '../../school/timebookApi';
import { downloadStaffTimebookPdfReport } from '../../school/pdfReports';
import type {
  School,
  StaffTimebookEntry,
  Teacher,
  TeacherRole,
  TimebookAuditLog,
  TimebookCorrectionRequest,
  TimebookEntryStatus,
  TimebookHoliday,
  TimebookSettings,
  TimebookSuspiciousLog,
} from '../../school/types';
import { ModalBackdrop } from './ModalBackdrop';

const STAFF_ROLE_OPTIONS: TeacherRole[] = [
  'Head Teacher',
  'Deputy Head',
  'Head of Department',
  'Form Teacher',
  'Subject Teacher',
  'School Librarian',
  'School Bursar',
];

interface StaffTimebookAdminDashboardProps {
  school: School;
  teachers: Teacher[];
  timebookSettings: TimebookSettings | null;
  entries: StaffTimebookEntry[];
  correctionRequests: TimebookCorrectionRequest[];
  auditLogs: TimebookAuditLog[];
  suspiciousLogs: TimebookSuspiciousLog[];
  canManageTimebook: boolean;
  recordedByName: string;
}

type AdminTimebookTab = 'register' | 'corrections' | 'audit' | 'settings';

const WORKDAY_LABELS: { day: number; label: string }[] = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 0, label: 'Sun' },
];

const TIMEZONE_OPTIONS = [
  'Africa/Blantyre',
  'Africa/Johannesburg',
  'Africa/Lusaka',
  'Africa/Nairobi',
  'UTC',
];

function csvEscape(val: unknown): string {
  const s = String(val ?? '');
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export const StaffTimebookAdminDashboard: React.FC<StaffTimebookAdminDashboardProps> = ({
  school,
  teachers,
  timebookSettings,
  entries,
  correctionRequests,
  auditLogs,
  suspiciousLogs,
  canManageTimebook,
  recordedByName,
}) => {
  const effectiveTimezone = timebookSettings?.timezone || DEFAULT_TIMEBOOK_TIMEZONE;
  const todayIso = useMemo(
    () => getZonedDateTimeParts(Date.now(), effectiveTimezone).isoDate,
    [effectiveTimezone]
  );

  const [activeTab, setActiveTab] = useState<AdminTimebookTab>('register');
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [methodFilter, setMethodFilter] = useState<
    'ALL' | 'GPS Auto' | 'Admin Recorded' | 'Not Signed In'
  >('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Admin Correction / Manual Entry Modal
  const [editModal, setEditModal] = useState<{
    teacher: Teacher;
    existingEntry: StaffTimebookEntry | null;
    correctionRequest?: TimebookCorrectionRequest;
  } | null>(null);
  const [editStatus, setEditStatus] = useState<TimebookEntryStatus>('Administratively Recorded');
  const [editTimeIn, setEditTimeIn] = useState('07:55:00');
  const [editExplanation, setEditExplanation] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');

  // Reject Correction Modal
  const [rejectModal, setRejectModal] = useState<TimebookCorrectionRequest | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectBusy, setRejectBusy] = useState(false);
  const [rejectError, setRejectError] = useState('');

  // Geofence & Policy Form State
  const defaults = useMemo(
    () => buildDefaultTimebookSettings(school.id, school.ownerId),
    [school.id, school.ownerId]
  );
  const basePolicy = timebookSettings || defaults;

  const [policyEnabled, setPolicyEnabled] = useState(basePolicy.enabled);
  const [locationConfigured, setLocationConfigured] = useState(basePolicy.locationConfigured);
  const [locationLabel, setLocationLabel] = useState(basePolicy.locationLabel);
  const [schoolLat, setSchoolLat] = useState(String(basePolicy.schoolLatitude));
  const [schoolLng, setSchoolLng] = useState(String(basePolicy.schoolLongitude));
  const [radiusMeters, setRadiusMeters] = useState(String(basePolicy.radiusMeters));
  const [maxAccuracyMeters, setMaxAccuracyMeters] = useState(String(basePolicy.maxAccuracyMeters));
  const [timezone, setTimezone] = useState(basePolicy.timezone);
  const [windowStartHHMM, setWindowStartHHMM] = useState(basePolicy.windowStartHHMM);
  const [defaultDeadlineHHMM, setDefaultDeadlineHHMM] = useState(basePolicy.defaultDeadlineHHMM);
  const [categoryDeadlines, setCategoryDeadlines] = useState<Record<string, string>>(
    basePolicy.categoryDeadlines || {}
  );
  const [workdays, setWorkdays] = useState<number[]>(basePolicy.workdays || DEFAULT_TIMEBOOK_WORKDAYS);
  const [holidays, setHolidays] = useState<TimebookHoliday[]>(basePolicy.holidays || []);
  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [newHolidayName, setNewHolidayName] = useState('');
  const [reminderSlotsText, setReminderSlotsText] = useState(
    (basePolicy.reminderSlots || DEFAULT_TIMEBOOK_REMINDER_SLOTS).join(', ')
  );
  const [remindersEnabled, setRemindersEnabled] = useState(basePolicy.remindersEnabled);
  const [detectingGps, setDetectingGps] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);

  useEffect(() => {
    const src = timebookSettings || buildDefaultTimebookSettings(school.id, school.ownerId);
    setPolicyEnabled(src.enabled);
    setLocationConfigured(src.locationConfigured);
    setLocationLabel(src.locationLabel);
    setSchoolLat(String(src.schoolLatitude));
    setSchoolLng(String(src.schoolLongitude));
    setRadiusMeters(String(src.radiusMeters));
    setMaxAccuracyMeters(String(src.maxAccuracyMeters));
    setTimezone(src.timezone);
    setWindowStartHHMM(src.windowStartHHMM);
    setDefaultDeadlineHHMM(src.defaultDeadlineHHMM);
    setCategoryDeadlines(src.categoryDeadlines || {});
    setWorkdays(src.workdays || DEFAULT_TIMEBOOK_WORKDAYS);
    setHolidays(src.holidays || []);
    setReminderSlotsText((src.reminderSlots || DEFAULT_TIMEBOOK_REMINDER_SLOTS).join(', '));
    setRemindersEnabled(src.remindersEnabled);
  }, [school.id, school.ownerId, timebookSettings]);

  const entriesForDate = useMemo(() => {
    const map = new Map<string, StaffTimebookEntry>();
    for (const e of entries) {
      if (e.date === selectedDate) {
        map.set(e.teacherId, e);
      }
    }
    return map;
  }, [entries, selectedDate]);

  const registerRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return teachers
      .map((teacher) => {
        const entry = entriesForDate.get(teacher.id) || null;
        const derivedStatus: string =
          entry?.status || (teacher.status === 'On Leave' ? 'On Leave' : 'Not Signed In');
        const derivedMethod = entry?.recordingMethod || 'Not Signed In';
        return { teacher, entry, derivedStatus, derivedMethod };
      })
      .filter(({ teacher, entry }) => {
        if (roleFilter !== 'ALL' && teacher.roleTitle !== roleFilter) return false;
        if (methodFilter === 'GPS Auto' && entry?.recordingMethod !== 'GPS Auto') return false;
        if (methodFilter === 'Admin Recorded' && entry?.recordingMethod !== 'Admin Recorded')
          return false;
        if (methodFilter === 'Not Signed In' && (entry || teacher.status === 'On Leave'))
          return false;
        if (q) {
          const matches =
            teacher.fullName.toLowerCase().includes(q) ||
            teacher.staffCode.toLowerCase().includes(q) ||
            teacher.roleTitle.toLowerCase().includes(q);
          if (!matches) return false;
        }
        return true;
      })
      .sort((a, b) => a.teacher.fullName.localeCompare(b.teacher.fullName));
  }, [entriesForDate, methodFilter, roleFilter, searchQuery, teachers]);

  const kpis = useMemo(() => {
    const activeTeachers = teachers.filter((t) => t.status === 'Active');
    let presentGps = 0;
    let adminRecorded = 0;
    let absentCount = 0;
    let notSignedIn = 0;

    for (const teacher of teachers) {
      const entry = entriesForDate.get(teacher.id);
      if (!entry) {
        if (teacher.status !== 'On Leave') {
          notSignedIn += 1;
        }
        continue;
      }
      if (entry.recordingMethod === 'Admin Recorded') {
        adminRecorded += 1;
      } else if (entry.status === 'Present' || entry.status === 'Late') {
        presentGps += 1;
      }
      if (entry.status === 'Absent') {
        absentCount += 1;
      }
    }

    const pendingCorrections = correctionRequests.filter((r) => r.status === 'Pending').length;
    return {
      totalStaff: teachers.length,
      activeStaff: activeTeachers.length,
      presentGps,
      adminRecorded,
      absentCount,
      notSignedIn,
      pendingCorrections,
    };
  }, [correctionRequests, entriesForDate, teachers]);

  // Build 7-day trend chart data from entries
  const trendData = useMemo(() => {
    const byDate = new Map<
      string,
      { date: string; gpsAuto: number; adminRecorded: number; absent: number }
    >();
    const allDates = Array.from(new Set([selectedDate, ...entries.map((e) => e.date)])).sort();
    const recentDates = allDates.slice(-7);
    for (const d of recentDates) {
      byDate.set(d, { date: d.slice(5), gpsAuto: 0, adminRecorded: 0, absent: 0 });
    }
    for (const e of entries) {
      const bucket = byDate.get(e.date);
      if (!bucket) continue;
      if (e.status === 'Absent') {
        bucket.absent += 1;
      } else if (e.recordingMethod === 'Admin Recorded') {
        bucket.adminRecorded += 1;
      } else {
        bucket.gpsAuto += 1;
      }
    }
    return Array.from(byDate.values());
  }, [entries, selectedDate]);

  const openCorrectionModal = (
    teacher: Teacher,
    existingEntry: StaffTimebookEntry | null,
    correctionRequest?: TimebookCorrectionRequest
  ) => {
    setEditError('');
    setEditModal({ teacher, existingEntry, correctionRequest });
    setEditStatus(
      correctionRequest?.requestedStatus ||
        existingEntry?.status ||
        'Administratively Recorded'
    );
    setEditTimeIn(existingEntry?.timeInDisplay || '07:55:00');
    setEditExplanation(
      correctionRequest ? `Approved request: ${correctionRequest.explanation}` : ''
    );
  };

  const handleSaveAdminCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModal) return;
    setEditError('');
    setEditBusy(true);
    try {
      const targetDate = editModal.correctionRequest?.date || selectedDate;
      const deadlineHHMM = getEffectiveDeadlineHHMM(
        timebookSettings || defaults,
        editModal.teacher.roleTitle
      );
      await adminSaveTimebookCorrection({
        schoolId: school.id,
        ownerId: school.ownerId,
        teacher: editModal.teacher,
        date: targetDate,
        existingEntry: editModal.existingEntry,
        newStatus: editStatus,
        timeInDisplay: editStatus === 'Absent' || editStatus === 'On Leave' ? '' : editTimeIn,
        explanation: editExplanation,
        authorizedByName: recordedByName,
        deadlineHHMM,
        correctionRequestId: editModal.correctionRequest?.id,
      });
      setEditModal(null);
      setNotice({
        type: 'success',
        text: `Attendance updated for ${editModal.teacher.fullName} and immutable audit log recorded.`,
      });
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Unable to save attendance correction.');
    } finally {
      setEditBusy(false);
    }
  };

  const handleConfirmRejectRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectModal) return;
    setRejectError('');
    setRejectBusy(true);
    try {
      await adminRejectTimebookCorrectionRequest({
        schoolId: school.id,
        ownerId: school.ownerId,
        requestId: rejectModal.id,
        teacherId: rejectModal.teacherId,
        staffCode: rejectModal.staffCode,
        staffName: rejectModal.staffName,
        attendanceDate: rejectModal.date,
        originalStatus: rejectModal.currentStatus,
        adminNote: rejectNote,
        authorizedByName: recordedByName,
      });
      setRejectModal(null);
      setRejectNote('');
      setNotice({
        type: 'success',
        text: `Correction request rejected and recorded in audit trail.`,
      });
    } catch (err) {
      setRejectError(err instanceof Error ? err.message : 'Unable to reject request.');
    } finally {
      setRejectBusy(false);
    }
  };

  const handleDetectCurrentCampusGps = () => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setNotice({
        type: 'error',
        text: 'GPS geolocation is not supported on this device/browser.',
      });
      return;
    }
    setDetectingGps(true);
    setNotice(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setSchoolLat(pos.coords.latitude.toFixed(6));
        setSchoolLng(pos.coords.longitude.toFixed(6));
        setLocationConfigured(true);
        setDetectingGps(false);
        setNotice({
          type: 'success',
          text: `Captured campus coordinates (${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}, accuracy ±${Math.round(pos.coords.accuracy)}m). Click Save Policy to apply.`,
        });
      },
      (err) => {
        setDetectingGps(false);
        setNotice({
          type: 'error',
          text: err.message || 'Unable to detect current campus GPS coordinates.',
        });
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
  };

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageTimebook) return;
    setSavingPolicy(true);
    setNotice(null);

    try {
      const parsedLat = Number(schoolLat);
      const parsedLng = Number(schoolLng);
      const parsedRadius = Number(radiusMeters) || DEFAULT_TIMEBOOK_RADIUS_METERS;
      const parsedAccuracy = Number(maxAccuracyMeters) || DEFAULT_TIMEBOOK_MAX_ACCURACY_METERS;
      const parsedSlots = reminderSlotsText
        .split(',')
        .map((s) => s.trim())
        .filter((s) => isValidHHMM(s));

      const nextSettings: Omit<
        TimebookSettings,
        'id' | 'ownerId' | 'schoolId' | 'createdAt' | 'updatedAt'
      > = {
        enabled: policyEnabled,
        locationConfigured: true,
        locationLabel: locationLabel.trim() || school.name,
        schoolLatitude: parsedLat,
        schoolLongitude: parsedLng,
        radiusMeters: parsedRadius,
        maxAccuracyMeters: parsedAccuracy,
        timezone,
        windowStartHHMM: isValidHHMM(windowStartHHMM)
          ? windowStartHHMM
          : DEFAULT_TIMEBOOK_WINDOW_START,
        defaultDeadlineHHMM: isValidHHMM(defaultDeadlineHHMM)
          ? defaultDeadlineHHMM
          : DEFAULT_TIMEBOOK_DEADLINE,
        categoryDeadlines,
        workdays: workdays.length > 0 ? workdays : DEFAULT_TIMEBOOK_WORKDAYS,
        holidays,
        reminderSlots:
          parsedSlots.length > 0 ? parsedSlots : DEFAULT_TIMEBOOK_REMINDER_SLOTS,
        remindersEnabled,
        updatedBy: recordedByName,
      };

      await saveTimebookSettings({
        schoolId: school.id,
        ownerId: school.ownerId,
        settings: nextSettings,
      });

      await syncTimebookPolicyToServer({
        schoolId: school.id,
        schoolName: school.name,
        ownerId: school.ownerId,
        settings: nextSettings,
        teachers,
      });

      setLocationConfigured(true);
      setNotice({
        type: 'success',
        text: 'School GPS geofence, reporting deadlines, and automated reminder schedule saved and synced to server.',
      });
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to save Timebook settings.',
      });
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleExportCsv = () => {
    const headers = [
      'Date',
      'Staff Code',
      'Staff Name',
      'Role',
      'Status',
      'Recording Method',
      'Time In',
      'GPS Distance (m)',
      'GPS Accuracy (m)',
      'Reason / Notes',
    ];
    const lines = [headers.map(csvEscape).join(',')];
    for (const row of registerRows) {
      lines.push(
        [
          selectedDate,
          row.teacher.staffCode,
          row.teacher.fullName,
          row.teacher.roleTitle,
          row.derivedStatus,
          row.derivedMethod,
          row.entry?.timeInDisplay || '—',
          row.entry?.recordingMethod === 'GPS Auto' ? Math.round(row.entry.distanceMeters) : '',
          row.entry?.recordingMethod === 'GPS Auto' ? Math.round(row.entry.accuracyMeters) : '',
          row.entry?.correctionReason || row.entry?.gpsVerificationStatus || '',
        ]
          .map(csvEscape)
          .join(',')
      );
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `staff-timebook-${selectedDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = () => {
    const list: StaffTimebookEntry[] = registerRows.map(
      ({ teacher, entry, derivedStatus }) =>
        entry || {
          id: `${selectedDate}_${teacher.id}`,
          ownerId: school.ownerId,
          schoolId: school.id,
          date: selectedDate,
          teacherId: teacher.id,
          staffUid: '',
          staffCode: teacher.staffCode,
          staffName: teacher.fullName,
          roleTitle: teacher.roleTitle,
          status: derivedStatus as TimebookEntryStatus,
          recordingMethod: 'Admin Recorded',
          timeInDisplay: '—',
          gpsVerificationStatus: 'Unavailable',
          latitude: 0,
          longitude: 0,
          distanceMeters: 0,
          accuracyMeters: 0,
          deadlineHHMM: timebookSettings?.defaultDeadlineHHMM || DEFAULT_TIMEBOOK_DEADLINE,
          isSuspicious: false,
          spoofingFlags: [],
          correctionStatus: 'None',
          correctionReason: 'No Time In recorded',
          authorizedByUid: '',
          authorizedByName: '',
          serverReceiptSignature: '',
        }
    );

    downloadStaffTimebookPdfReport({
      school,
      dateLabel: selectedDate,
      entries: list,
      totalStaffCount: kpis.totalStaff,
      gpsAutoCount: kpis.presentGps,
      adminRecordedCount: kpis.adminRecorded,
      absentOrUnsignedCount: kpis.absentCount + kpis.notSignedIn,
    });
  };

  return (
    <div className="space-y-5">
      {/* Header & Sub-Tabs */}
      <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Staff Timebook Control Center
            </h2>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                locationConfigured
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
              }`}
            >
              {locationConfigured ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Geofence Active ({radiusMeters}m)</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Set Campus GPS Coordinates</span>
                </>
              )}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
            {effectiveTimezone} · Deadline: {basePolicy.defaultDeadlineHHMM} · Alerts:{' '}
            {(basePolicy.reminderSlots || []).join(', ')}
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Timebook admin sections"
          className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900"
        >
          {(
            [
              { id: 'register', label: 'Daily Register', icon: Users },
              {
                id: 'corrections',
                label: `Corrections (${kpis.pendingCorrections})`,
                icon: ClipboardCheck,
              },
              { id: 'audit', label: `Audit & Security (${auditLogs.length})`, icon: ShieldAlert },
              { id: 'settings', label: 'Geofence & Policy', icon: Settings2 },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 min-h-[34px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  active
                    ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {notice && (
        <div
          className={`rounded-2xl border p-4 flex items-center justify-between gap-3 text-sm ${
            notice.type === 'success'
              ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200'
              : 'border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200'
          }`}
        >
          <span>{notice.text}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="p-1 rounded-lg hover:bg-black/5 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* KPI Strip */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total Staff', value: kpis.totalStaff, tone: 'text-slate-900 dark:text-slate-100' },
          { label: 'GPS Present', value: kpis.presentGps, tone: 'text-emerald-700 dark:text-emerald-400' },
          { label: 'Admin Recorded', value: kpis.adminRecorded, tone: 'text-sky-700 dark:text-sky-400' },
          { label: 'Not Signed In', value: kpis.notSignedIn, tone: 'text-amber-700 dark:text-amber-400' },
          { label: 'Marked Absent', value: kpis.absentCount, tone: 'text-rose-700 dark:text-rose-400' },
          {
            label: 'Pending Requests',
            value: kpis.pendingCorrections,
            tone: 'text-violet-700 dark:text-violet-400',
          },
        ].map((card) => (
          <div
            key={card.label}
            className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5"
          >
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {card.label}
            </p>
            <p className={`text-2xl font-bold font-mono tabular-nums mt-1 ${card.tone}`}>
              {card.value}
            </p>
          </div>
        ))}
      </section>

      {/* TAB 1: DAILY REGISTER & ANALYTICS */}
      {activeTab === 'register' && (
        <div className="space-y-5">
          {/* Chart & Filters */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <section className="lg:col-span-5 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                7-Day Check-In Method Breakdown
              </h3>
              <div className="h-52 w-full mt-3 min-w-0">
                <ResponsiveContainer width="100%" height={200} minWidth={240}>
                  <BarChart data={trendData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="gpsAuto" name="GPS Auto" stackId="a" fill="#0d6e52" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="adminRecorded" name="Admin Recorded" stackId="a" fill="#0284c7" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="absent" name="Absent" stackId="a" fill="#e11d48" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="lg:col-span-7 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Register Filters &amp; Official Exports
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Register Date
                    </label>
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value || todayIso)}
                      className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] text-sm text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Recording Source
                    </label>
                    <select
                      value={methodFilter}
                      onChange={(e) =>
                        setMethodFilter(
                          e.target.value as 'ALL' | 'GPS Auto' | 'Admin Recorded' | 'Not Signed In'
                        )
                      }
                      className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] text-sm text-slate-900 dark:text-slate-100"
                    >
                      <option value="ALL">All Staff</option>
                      <option value="GPS Auto">GPS Auto Only</option>
                      <option value="Admin Recorded">Admin Recorded Only</option>
                      <option value="Not Signed In">Not Signed In Yet</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Role Filter
                    </label>
                    <select
                      value={roleFilter}
                      onChange={(e) => setRoleFilter(e.target.value)}
                      className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] text-sm text-slate-900 dark:text-slate-100"
                    >
                      <option value="ALL">All Staff Roles</option>
                      {STAFF_ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Search Staff
                    </label>
                    <div className="relative">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Name or staff code..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full min-h-[40px] pl-9 pr-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] text-sm text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  Showing {registerRows.length} of {teachers.length} staff for {selectedDate}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleExportCsv}
                    className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Export CSV</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportPdf}
                    className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Export PDF</span>
                  </button>
                </div>
              </div>
            </section>
          </div>

          {/* Daily Staff Register Table */}
          <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 pr-3 font-medium">Staff Member</th>
                    <th className="py-2.5 pr-3 font-medium">Role</th>
                    <th className="py-2.5 pr-3 font-medium">Status</th>
                    <th className="py-2.5 pr-3 font-medium">Method</th>
                    <th className="py-2.5 pr-3 font-medium">Time In</th>
                    <th className="py-2.5 pr-3 font-medium">Location / Accuracy</th>
                    <th className="py-2.5 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {registerRows.map(({ teacher, entry, derivedStatus, derivedMethod }) => (
                    <tr key={teacher.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                      <td className="py-3 pr-3">
                        <p className="font-semibold text-slate-900 dark:text-slate-100">
                          {teacher.fullName}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                          {teacher.staffCode} · {teacher.staffEmail}
                        </p>
                      </td>
                      <td className="py-3 pr-3 text-xs text-slate-700 dark:text-slate-300">
                        {teacher.roleTitle}
                      </td>
                      <td className="py-3 pr-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${
                            derivedStatus === 'Present' || derivedStatus === 'Administratively Recorded'
                              ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                              : derivedStatus === 'Absent'
                              ? 'bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300'
                              : derivedStatus === 'Late' || derivedStatus === 'Not Signed In'
                              ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {derivedStatus}
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-xs">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-md font-medium ${
                            derivedMethod === 'GPS Auto'
                              ? 'bg-emerald-100/70 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200'
                              : derivedMethod === 'Admin Recorded'
                              ? 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {derivedMethod}
                        </span>
                      </td>
                      <td className="py-3 pr-3 font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300">
                        {entry?.timeInDisplay || '—'}
                      </td>
                      <td className="py-3 pr-3 font-mono tabular-nums text-xs text-slate-600 dark:text-slate-400">
                        {entry?.recordingMethod === 'GPS Auto'
                          ? `${Math.round(entry.distanceMeters)}m (±${Math.round(entry.accuracyMeters)}m)`
                          : entry?.correctionReason || '—'}
                      </td>
                      <td className="py-3 text-right">
                        {canManageTimebook && (
                          <button
                            type="button"
                            onClick={() => openCorrectionModal(teacher, entry)}
                            className="inline-flex items-center gap-1 min-h-[32px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            {entry ? 'Correct' : 'Record'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {registerRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                        No staff members match the active filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* TAB 2: CORRECTION REQUESTS */}
      {activeTab === 'corrections' && (
        <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Staff Attendance Correction Queue ({correctionRequests.length})
            </h3>
          </div>

          {correctionRequests.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
              No correction requests have been submitted yet.
            </p>
          ) : (
            <div className="space-y-3">
              {correctionRequests.map((req) => {
                const teacher = teachers.find((t) => t.id === req.teacherId);
                const existingEntry =
                  entries.find((e) => e.date === req.date && e.teacherId === req.teacherId) || null;
                return (
                  <div
                    key={req.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {req.staffName}
                        </span>
                        <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                          {req.staffCode} · {req.roleTitle}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                            req.status === 'Pending'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                              : req.status === 'Approved'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                              : 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300'
                          }`}
                        >
                          {req.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 font-mono tabular-nums">
                        Date: {req.date} · Current: {req.currentStatus} → Requested:{' '}
                        <strong>{req.requestedStatus}</strong>
                      </p>
                      <p className="text-sm text-slate-700 dark:text-slate-200">{req.explanation}</p>
                      {req.adminNote && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Reviewed by {req.reviewedByName}: {req.adminNote}
                        </p>
                      )}
                    </div>

                    {req.status === 'Pending' && canManageTimebook && teacher && (
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => openCorrectionModal(teacher, existingEntry, req)}
                          className="min-h-[36px] px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
                        >
                          Approve &amp; Record
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRejectModal(req);
                            setRejectNote('');
                            setRejectError('');
                          }}
                          className="min-h-[36px] px-3.5 rounded-xl border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs font-semibold hover:bg-rose-50 dark:hover:bg-rose-950/30 whitespace-nowrap cursor-pointer"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* TAB 3: IMMUTABLE AUDIT LOGS & SUSPICIOUS SECURITY LOGS */}
      {activeTab === 'audit' && (
        <div className="space-y-5">
          <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
              <History className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Immutable Administrative Correction Audit Trail ({auditLogs.length})
              </h3>
            </div>
            {auditLogs.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
                No administrative attendance corrections have been recorded.
              </p>
            ) : (
              <div className="overflow-x-auto mt-3">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="py-2 pr-3 font-medium">Modified At</th>
                      <th className="py-2 pr-3 font-medium">Staff Member</th>
                      <th className="py-2 pr-3 font-medium">Attendance Date</th>
                      <th className="py-2 pr-3 font-medium">Original → Updated</th>
                      <th className="py-2 pr-3 font-medium">Justification</th>
                      <th className="py-2 font-medium">Authorized By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                    {auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="py-2.5 pr-3 font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {log.createdAt?.toDate
                            ? log.createdAt.toDate().toLocaleString()
                            : 'Just now'}
                        </td>
                        <td className="py-2.5 pr-3 font-semibold text-slate-900 dark:text-slate-100">
                          {log.staffName} ({log.staffCode})
                        </td>
                        <td className="py-2.5 pr-3 font-mono tabular-nums">{log.attendanceDate}</td>
                        <td className="py-2.5 pr-3">
                          <span className="font-semibold">{log.originalStatus}</span> →{' '}
                          <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                            {log.correctedStatus}
                          </span>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {log.updatedValues}
                          </p>
                        </td>
                        <td className="py-2.5 pr-3 text-slate-700 dark:text-slate-300 max-w-xs">
                          {log.explanation}
                        </td>
                        <td className="py-2.5 font-medium text-slate-800 dark:text-slate-200">
                          {log.authorizedByName}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
              <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Suspicious GPS &amp; Anti-Tampering Security Log ({suspiciousLogs.length})
              </h3>
            </div>
            {suspiciousLogs.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
                No suspicious GPS spoofing, clock tampering, or out-of-bounds incidents recorded.
              </p>
            ) : (
              <div className="overflow-x-auto mt-3">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="py-2 pr-3 font-medium">Date</th>
                      <th className="py-2 pr-3 font-medium">Staff Member</th>
                      <th className="py-2 pr-3 font-medium">Signal Code</th>
                      <th className="py-2 pr-3 font-medium">Distance / Acc</th>
                      <th className="py-2 font-medium">Security Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                    {suspiciousLogs.map((item) => (
                      <tr key={item.id}>
                        <td className="py-2.5 pr-3 font-mono tabular-nums">{item.date}</td>
                        <td className="py-2.5 pr-3 font-semibold text-slate-900 dark:text-slate-100">
                          {item.staffName}
                        </td>
                        <td className="py-2.5 pr-3">
                          <span className="px-2 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 font-mono font-semibold">
                            {item.reasonCode}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 font-mono tabular-nums">
                          {Math.round(item.distanceMeters)}m (±{Math.round(item.accuracyMeters)}m)
                        </td>
                        <td className="py-2.5 text-slate-700 dark:text-slate-300">{item.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 4: GEOFENCE, DEADLINES, WORKDAYS, HOLIDAYS & REMINDERS */}
      {activeTab === 'settings' && (
        <form
          onSubmit={handleSavePolicy}
          className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                School GPS Geofence &amp; Time-In Policy
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Configure campus coordinates, permitted radius, GPS accuracy threshold, reporting deadline, and reminder schedule.
              </p>
            </div>
            {canManageTimebook && (
              <button
                type="button"
                disabled={detectingGps}
                onClick={handleDetectCurrentCampusGps}
                className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Crosshair className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                <span>{detectingGps ? 'Detecting GPS...' : 'Use Current School GPS'}</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Campus Location Name
              </label>
              <input
                type="text"
                disabled={!canManageTimebook}
                value={locationLabel}
                onChange={(e) => setLocationLabel(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] text-sm"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                School Latitude
              </label>
              <input
                type="number"
                step="0.000001"
                disabled={!canManageTimebook}
                value={schoolLat}
                onChange={(e) => setSchoolLat(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] text-sm font-mono tabular-nums"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                School Longitude
              </label>
              <input
                type="number"
                step="0.000001"
                disabled={!canManageTimebook}
                value={schoolLng}
                onChange={(e) => setSchoolLng(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] text-sm font-mono tabular-nums"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Permitted Geofence Radius (metres)
              </label>
              <input
                type="number"
                min={20}
                max={5000}
                disabled={!canManageTimebook}
                value={radiusMeters}
                onChange={(e) => setRadiusMeters(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] text-sm font-mono tabular-nums"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Maximum GPS Accuracy Allowed (metres)
              </label>
              <input
                type="number"
                min={10}
                max={1000}
                disabled={!canManageTimebook}
                value={maxAccuracyMeters}
                onChange={(e) => setMaxAccuracyMeters(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] text-sm font-mono tabular-nums"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Official School Timezone
              </label>
              <select
                disabled={!canManageTimebook}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] text-sm"
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Time-In Window Opens (HH:MM)
              </label>
              <input
                type="time"
                disabled={!canManageTimebook}
                value={windowStartHHMM}
                onChange={(e) => setWindowStartHHMM(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] text-sm font-mono tabular-nums"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Default Reporting Deadline (Strict Lock)
              </label>
              <input
                type="time"
                disabled={!canManageTimebook}
                value={defaultDeadlineHHMM}
                onChange={(e) => setDefaultDeadlineHHMM(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] text-sm font-mono tabular-nums"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Automated Reminder Slots (Comma-separated HH:MM)
              </label>
              <input
                type="text"
                disabled={!canManageTimebook}
                value={reminderSlotsText}
                onChange={(e) => setReminderSlotsText(e.target.value)}
                placeholder="06:30, 07:00, 07:30, 07:50"
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] text-sm font-mono"
              />
            </div>
          </div>

          {/* Toggles & Working Days */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Working Days Schedule
              </p>
              <div className="flex flex-wrap gap-2">
                {WORKDAY_LABELS.map((item) => {
                  const active = workdays.includes(item.day);
                  return (
                    <button
                      key={item.day}
                      type="button"
                      disabled={!canManageTimebook}
                      onClick={() =>
                        setWorkdays((prev) =>
                          prev.includes(item.day)
                            ? prev.filter((d) => d !== item.day)
                            : [...prev, item.day].sort((a, b) => a - b)
                        )
                      }
                      className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold border cursor-pointer ${
                        active
                          ? 'bg-emerald-700 border-emerald-700 text-white'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-5 pt-2">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!canManageTimebook}
                    checked={policyEnabled}
                    onChange={(e) => setPolicyEnabled(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Enable Staff Timebook Module</span>
                </label>

                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!canManageTimebook}
                    checked={remindersEnabled}
                    onChange={(e) => setRemindersEnabled(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Enable Automated Background Reminders</span>
                </label>
              </div>
            </div>

            {/* Public / School Holidays */}
            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                School &amp; Public Holidays ({holidays.length})
              </p>
              {canManageTimebook && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={newHolidayDate}
                    onChange={(e) => setNewHolidayDate(e.target.value)}
                    className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] text-xs"
                  />
                  <input
                    type="text"
                    placeholder="Holiday name (e.g., Kamuzu Day)"
                    value={newHolidayName}
                    onChange={(e) => setNewHolidayName(e.target.value)}
                    className="flex-1 min-w-[160px] min-h-[36px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!/^\d{4}-\d{2}-\d{2}$/.test(newHolidayDate) || !newHolidayName.trim()) {
                        return;
                      }
                      setHolidays((prev) => [
                        ...prev.filter((h) => h.date !== newHolidayDate),
                        { date: newHolidayDate, name: newHolidayName.trim() },
                      ]);
                      setNewHolidayDate('');
                      setNewHolidayName('');
                    }}
                    className="inline-flex items-center gap-1 min-h-[36px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add</span>
                  </button>
                </div>
              )}

              {holidays.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {holidays.map((h) => (
                    <span
                      key={h.date}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-200"
                    >
                      <Calendar className="w-3 h-3" aria-hidden="true" />
                      <span className="font-mono">{h.date}</span>
                      <span>{h.name}</span>
                      {canManageTimebook && (
                        <button
                          type="button"
                          onClick={() =>
                            setHolidays((prev) => prev.filter((item) => item.date !== h.date))
                          }
                          className="text-slate-500 hover:text-rose-600 cursor-pointer"
                          aria-label={`Remove ${h.name}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Optional Role-Based Deadlines */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Optional Role-Specific Deadlines (leave blank to use default {defaultDeadlineHHMM})
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {STAFF_ROLE_OPTIONS.map((role) => (
                <div key={role}>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1 truncate">
                    {role}
                  </label>
                  <input
                    type="time"
                    disabled={!canManageTimebook}
                    value={categoryDeadlines[role] || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCategoryDeadlines((prev) => {
                        const next = { ...prev };
                        if (!val) {
                          delete next[role];
                        } else {
                          next[role] = val;
                        }
                        return next;
                      });
                    }}
                    className="w-full min-h-[36px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] text-xs font-mono"
                  />
                </div>
              ))}
            </div>
          </div>

          {canManageTimebook && (
            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={savingPolicy}
                className="min-h-[42px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
              >
                {savingPolicy ? 'Saving Policy...' : 'Save Geofence & Policy'}
              </button>
            </div>
          )}
        </form>
      )}

      {/* Admin Attendance Correction Modal */}
      <ModalBackdrop
        open={Boolean(editModal)}
        onClose={() => setEditModal(null)}
        disabled={editBusy}
        ariaLabel="Record or Correct Staff Attendance"
      >
        {editModal && (
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 shadow-xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Administrative Attendance Override
              </h3>
              <button
                type="button"
                onClick={() => setEditModal(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 p-3 text-xs space-y-0.5">
              <p className="font-semibold text-slate-900 dark:text-slate-100">
                {editModal.teacher.fullName} ({editModal.teacher.staffCode})
              </p>
              <p className="text-slate-500 dark:text-slate-400 font-mono">
                Date: {editModal.correctionRequest?.date || selectedDate} · Original:{' '}
                {editModal.existingEntry?.status || 'Not Signed In'}
              </p>
            </div>

            <form onSubmit={handleSaveAdminCorrection} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Corrected Status
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as TimebookEntryStatus)}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] text-sm"
                >
                  <option value="Administratively Recorded">Administratively Recorded</option>
                  <option value="Present">Present</option>
                  <option value="Late">Late</option>
                  <option value="On Leave">On Leave</option>
                  <option value="Absent">Absent</option>
                </select>
              </div>

              {editStatus !== 'Absent' && editStatus !== 'On Leave' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Verified Arrival Time (HH:MM:SS)
                  </label>
                  <input
                    type="text"
                    value={editTimeIn}
                    onChange={(e) => setEditTimeIn(e.target.value)}
                    placeholder="07:55:00"
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] text-sm font-mono"
                    required
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Mandatory Justification (Logged Immutably)
                </label>
                <textarea
                  rows={3}
                  required
                  minLength={5}
                  maxLength={600}
                  value={editExplanation}
                  onChange={(e) => setEditExplanation(e.target.value)}
                  placeholder="Enter verified reason for manual attendance entry or adjustment..."
                  className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] text-sm"
                />
              </div>

              {editError && <p className="text-xs text-rose-600 dark:text-rose-400">{editError}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditModal(null)}
                  className="min-h-[40px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editBusy}
                  className="min-h-[40px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {editBusy ? 'Saving Audit...' : 'Authorize & Save'}
                </button>
              </div>
            </form>
          </div>
        )}
      </ModalBackdrop>

      {/* Reject Correction Request Modal */}
      <ModalBackdrop
        open={Boolean(rejectModal)}
        onClose={() => setRejectModal(null)}
        disabled={rejectBusy}
        ariaLabel="Reject Correction Request"
      >
        {rejectModal && (
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 shadow-xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Reject Correction Request
              </h3>
              <button
                type="button"
                onClick={() => setRejectModal(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleConfirmRejectRequest} className="space-y-3.5">
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Rejecting request from <strong>{rejectModal.staffName}</strong> for{' '}
                <span className="font-mono">{rejectModal.date}</span>.
              </p>
              <textarea
                rows={3}
                required
                minLength={5}
                maxLength={400}
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="Enter reason for rejection..."
                className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] text-sm"
              />
              {rejectError && <p className="text-xs text-rose-600 dark:text-rose-400">{rejectError}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRejectModal(null)}
                  className="min-h-[40px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={rejectBusy}
                  className="min-h-[40px] px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {rejectBusy ? 'Rejecting...' : 'Confirm Reject'}
                </button>
              </div>
            </form>
          </div>
        )}
      </ModalBackdrop>
    </div>
  );
};
