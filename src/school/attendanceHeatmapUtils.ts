import type { AttendanceRecord, FormLevel, TermName } from './types';

export interface AttendanceHeatmapDayCell {
  date: string; // YYYY-MM-DD
  weekIndex: number; // 0-based column index
  weekLabel: string; // e.g., W1..W13
  dayOfWeek: number; // 1=Mon .. 7=Sun (ISO weekday)
  dayLabel: string; // Mon..Sun
  monthLabel: string; // Jan..Dec
  isToday: boolean;
  isFuture: boolean;
  present: number;
  late: number;
  excused: number;
  absent: number;
  total: number;
  attendanceRate: number | null; // 0..100 or null when total === 0
}

export interface AttendanceHeatmapWeekColumn {
  weekIndex: number;
  weekStartIso: string;
  weekLabel: string;
  monthHeader: string;
}

export interface AttendanceHeatmapModel {
  termStartIso: string;
  termEndIso: string;
  weeksCount: number;
  includeWeekends: boolean;
  dayRows: Array<{ dayOfWeek: number; label: string }>;
  weeks: AttendanceHeatmapWeekColumn[];
  cells: AttendanceHeatmapDayCell[];
  summary: {
    daysMarked: number;
    totalRecords: number;
    presentOrLateCount: number;
    excusedCount: number;
    absentCount: number;
    overallRate: number | null;
    peakDay: { date: string; rate: number; total: number } | null;
    lowestDay: { date: string; rate: number; total: number } | null;
  };
}

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ISO_DAY_LABELS: Record<number, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};

export function parseIsoDateToUtcMs(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

export function formatUtcMsToIsoDate(utcMs: number): string {
  const dt = new Date(utcMs);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysIso(isoDate: string, deltaDays: number): string {
  const ms = parseIsoDateToUtcMs(isoDate);
  return formatUtcMsToIsoDate(ms + deltaDays * 86_400_000);
}

/**
 * Returns ISO weekday 1 (Monday) .. 7 (Sunday)
 */
export function getIsoWeekday(isoDate: string): number {
  const jsDay = new Date(parseIsoDateToUtcMs(isoDate)).getUTCDay(); // 0=Sun..6=Sat
  return jsDay === 0 ? 7 : jsDay;
}

export function getMondayOfWeekIso(isoDate: string): string {
  const isoDay = getIsoWeekday(isoDate);
  return addDaysIso(isoDate, -(isoDay - 1));
}

export function formatShortHumanDate(isoDate: string): string {
  if (!ISO_DATE_REGEX.test(isoDate)) return isoDate;
  const ms = parseIsoDateToUtcMs(isoDate);
  const dt = new Date(ms);
  const day = dt.getUTCDate();
  const month = MONTH_SHORT[dt.getUTCMonth()] || '';
  const weekday = ISO_DAY_LABELS[getIsoWeekday(isoDate)] || '';
  return `${weekday}, ${day} ${month} ${dt.getUTCFullYear()}`;
}

/**
 * Builds a term-aligned calendar heatmap model (default 13 weeks = ~1 Malawi school term)
 * ending on the week containing `todayIso` (or the latest attendance date if newer).
 */
export function buildStudentAttendanceHeatmap(params: {
  attendance: AttendanceRecord[];
  todayIso: string;
  term?: TermName;
  formFilter?: 'ALL' | FormLevel;
  weeksCount?: number;
}): AttendanceHeatmapModel {
  const safeToday = ISO_DATE_REGEX.test(params.todayIso)
    ? params.todayIso
    : formatUtcMsToIsoDate(Date.now());
  const weeksCount = Math.max(4, Math.min(20, Math.round(params.weeksCount ?? 13)));
  const formFilter = params.formFilter ?? 'ALL';

  const filteredRecords = params.attendance.filter((rec) => {
    if (!ISO_DATE_REGEX.test(rec.date)) return false;
    if (formFilter !== 'ALL' && rec.formLevel !== formFilter) return false;
    return true;
  });

  // Anchor the rightmost column to the week of todayIso (or latest marked date if later)
  let anchorIso = safeToday;
  for (const r of filteredRecords) {
    if (r.date > anchorIso) anchorIso = r.date;
  }

  const endWeekMonday = getMondayOfWeekIso(anchorIso);
  const startWeekMonday = addDaysIso(endWeekMonday, -(weeksCount - 1) * 7);
  const termStartIso = startWeekMonday;

  // Check if any marked record within the window falls on Saturday (6) or Sunday (7)
  const potentialEndIso = addDaysIso(endWeekMonday, 6);
  let hasWeekendData = false;
  for (const r of filteredRecords) {
    if (r.date >= termStartIso && r.date <= potentialEndIso) {
      const wd = getIsoWeekday(r.date);
      if (wd >= 6) {
        hasWeekendData = true;
        break;
      }
    }
  }

  const maxDayOfWeek = hasWeekendData ? 7 : 5;
  const termEndIso = addDaysIso(endWeekMonday, maxDayOfWeek - 1);

  const byDate = new Map<
    string,
    { present: number; late: number; excused: number; absent: number }
  >();
  for (const r of filteredRecords) {
    if (r.date < termStartIso || r.date > termEndIso) continue;
    const bucket = byDate.get(r.date) || { present: 0, late: 0, excused: 0, absent: 0 };
    if (r.status === 'Present') bucket.present += 1;
    else if (r.status === 'Late') bucket.late += 1;
    else if (r.status === 'Excused') bucket.excused += 1;
    else if (r.status === 'Absent') bucket.absent += 1;
    byDate.set(r.date, bucket);
  }

  const dayRows: Array<{ dayOfWeek: number; label: string }> = [];
  for (let d = 1; d <= maxDayOfWeek; d++) {
    dayRows.push({ dayOfWeek: d, label: ISO_DAY_LABELS[d] });
  }

  const weeks: AttendanceHeatmapWeekColumn[] = [];
  const cells: AttendanceHeatmapDayCell[] = [];
  let prevMonth = -1;

  let daysMarked = 0;
  let totalRecords = 0;
  let presentOrLateCount = 0;
  let excusedCount = 0;
  let absentCount = 0;
  let peakDay: { date: string; rate: number; total: number } | null = null;
  let lowestDay: { date: string; rate: number; total: number } | null = null;

  for (let w = 0; w < weeksCount; w++) {
    const weekStartIso = addDaysIso(startWeekMonday, w * 7);
    const dt = new Date(parseIsoDateToUtcMs(weekStartIso));
    const mIdx = dt.getUTCMonth();
    const monthName = MONTH_SHORT[mIdx] || '';
    const monthHeader = mIdx !== prevMonth ? monthName : '';
    prevMonth = mIdx;
    const weekLabel = `W${w + 1}`;

    weeks.push({
      weekIndex: w,
      weekStartIso,
      weekLabel,
      monthHeader,
    });

    for (let d = 1; d <= maxDayOfWeek; d++) {
      const date = addDaysIso(weekStartIso, d - 1);
      const counts = byDate.get(date) || { present: 0, late: 0, excused: 0, absent: 0 };
      const total = counts.present + counts.late + counts.excused + counts.absent;
      const attended = counts.present + counts.late;
      const rate = total > 0 ? Math.round((attended / total) * 1000) / 10 : null;

      if (total > 0 && rate !== null) {
        daysMarked += 1;
        totalRecords += total;
        presentOrLateCount += attended;
        excusedCount += counts.excused;
        absentCount += counts.absent;

        if (!peakDay || rate > peakDay.rate || (rate === peakDay.rate && total > peakDay.total)) {
          peakDay = { date, rate, total };
        }
        if (!lowestDay || rate < lowestDay.rate || (rate === lowestDay.rate && total > lowestDay.total)) {
          lowestDay = { date, rate, total };
        }
      }

      const cellMonth = MONTH_SHORT[new Date(parseIsoDateToUtcMs(date)).getUTCMonth()] || '';
      cells.push({
        date,
        weekIndex: w,
        weekLabel,
        dayOfWeek: d,
        dayLabel: ISO_DAY_LABELS[d],
        monthLabel: cellMonth,
        isToday: date === safeToday,
        isFuture: date > safeToday,
        present: counts.present,
        late: counts.late,
        excused: counts.excused,
        absent: counts.absent,
        total,
        attendanceRate: rate,
      });
    }
  }

  const overallRate =
    totalRecords > 0 ? Math.round((presentOrLateCount / totalRecords) * 1000) / 10 : null;

  return {
    termStartIso,
    termEndIso,
    weeksCount,
    includeWeekends: hasWeekendData,
    dayRows,
    weeks,
    cells,
    summary: {
      daysMarked,
      totalRecords,
      presentOrLateCount,
      excusedCount,
      absentCount,
      overallRate,
      peakDay,
      lowestDay,
    },
  };
}
