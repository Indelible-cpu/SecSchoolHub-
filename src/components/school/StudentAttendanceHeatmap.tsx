import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { ArrowRight, CalendarCheck } from 'lucide-react';
import {
  buildStudentAttendanceHeatmap,
  formatShortHumanDate,
  type AttendanceHeatmapDayCell,
} from '../../school/attendanceHeatmapUtils';
import { FORM_LEVELS } from '../../school/malawi';
import type { AttendanceRecord, FormLevel, TermName } from '../../school/types';

interface StudentAttendanceHeatmapProps {
  attendance: AttendanceRecord[];
  term: TermName;
  todayIso: string;
  canWriteAttendance?: boolean;
  onOpenAttendance?: () => void;
}

interface TooltipState {
  cell: AttendanceHeatmapDayCell;
  x: number;
  y: number;
}

const RATE_THRESHOLDS = [60, 75, 85, 95];

const LIGHT_BAND_COLORS = [
  '#e11d48', // < 60% (rose-600)
  '#d97706', // 60 - 74.9% (amber-600)
  '#34d399', // 75 - 84.9% (emerald-400)
  '#10b981', // 85 - 94.9% (emerald-500)
  '#047857', // 95 - 100% (emerald-700)
];

const DARK_BAND_COLORS = [
  '#f43f5e', // < 60% (rose-500)
  '#f59e0b', // 60 - 74.9% (amber-500)
  '#065f46', // 75 - 84.9% (emerald-800)
  '#059669', // 85 - 94.9% (emerald-600)
  '#34d399', // 95 - 100% (emerald-400)
];

const LEGEND_BANDS = [
  { label: 'No mark', sampleRate: null },
  { label: '<60%', sampleRate: 45 },
  { label: '60–74%', sampleRate: 68 },
  { label: '75–84%', sampleRate: 80 },
  { label: '85–94%', sampleRate: 90 },
  { label: '95–100%', sampleRate: 98 },
];

export const StudentAttendanceHeatmap: React.FC<StudentAttendanceHeatmapProps> = ({
  attendance,
  term,
  todayIso,
  canWriteAttendance = false,
  onOpenAttendance,
}) => {
  const [formFilter, setFormFilter] = useState<'ALL' | FormLevel>('ALL');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );
  const [containerWidth, setContainerWidth] = useState<number>(760);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Sync with dark theme toggles on <html>
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains('dark'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Track available SVG width responsively
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const updateWidth = () => {
      const next = Math.max(460, Math.floor(el.clientWidth));
      setContainerWidth(next);
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const model = useMemo(
    () =>
      buildStudentAttendanceHeatmap({
        attendance,
        todayIso,
        term,
        formFilter,
        weeksCount: 13,
      }),
    [attendance, todayIso, term, formFilter]
  );

  // Keep selectedDate valid when switching filters
  const selectedCell = useMemo(() => {
    if (selectedDate) {
      const match = model.cells.find((c) => c.date === selectedDate);
      if (match) return match;
    }
    const markedCells = model.cells.filter((c) => c.total > 0);
    return markedCells.length > 0 ? markedCells[markedCells.length - 1] : null;
  }, [model.cells, selectedDate]);

  const colorScale = useMemo(
    () =>
      d3
        .scaleThreshold<number, string>()
        .domain(RATE_THRESHOLDS)
        .range(isDark ? DARK_BAND_COLORS : LIGHT_BAND_COLORS),
    [isDark]
  );

  const emptyCellFill = isDark ? '#1e293b' : '#f1f5f9';
  const emptyCellStroke = isDark ? '#334155' : '#e2e8f0';
  const futureCellFill = isDark ? '#0f172a' : '#f8fafc';
  const labelColor = isDark ? '#94a3b8' : '#64748b';

  // Render D3 SVG heatmap
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const margin = { top: 28, right: 10, bottom: 22, left: 38 };
    const width = Math.max(520, containerWidth);
    const innerWidth = width - margin.left - margin.right;

    const cellGap = 5;
    const approxCellWidth =
      (innerWidth - cellGap * (model.weeksCount - 1)) / model.weeksCount;
    const rowHeight = Math.max(24, Math.min(38, Math.round(approxCellWidth * 0.72)));
    const innerHeight =
      model.dayRows.length * rowHeight + Math.max(0, model.dayRows.length - 1) * cellGap;
    const height = margin.top + innerHeight + margin.bottom;

    svg.attr('viewBox', `0 0 ${width} ${height}`).attr('width', width).attr('height', height);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3
      .scaleBand<number>()
      .domain(model.weeks.map((w) => w.weekIndex))
      .range([0, innerWidth])
      .paddingInner(0.14)
      .paddingOuter(0);

    const yScale = d3
      .scaleBand<number>()
      .domain(model.dayRows.map((d) => d.dayOfWeek))
      .range([0, innerHeight])
      .paddingInner(0.16)
      .paddingOuter(0);

    // Month labels above week columns
    g.append('g')
      .attr('class', 'heatmap-month-labels')
      .selectAll('text')
      .data(model.weeks.filter((w) => w.monthHeader !== ''))
      .join('text')
      .attr('x', (w) => xScale(w.weekIndex) ?? 0)
      .attr('y', -10)
      .attr('fill', labelColor)
      .attr('font-size', '11px')
      .attr('font-weight', 600)
      .text((w) => w.monthHeader);

    // Week numbers along bottom axis (W1 .. W13)
    g.append('g')
      .attr('class', 'heatmap-week-labels')
      .selectAll('text')
      .data(model.weeks)
      .join('text')
      .attr('x', (w) => (xScale(w.weekIndex) ?? 0) + xScale.bandwidth() / 2)
      .attr('y', innerHeight + 16)
      .attr('text-anchor', 'middle')
      .attr('fill', labelColor)
      .attr('font-size', '10px')
      .style('font-family', 'var(--font-mono)')
      .text((w) => w.weekLabel);

    // Day-of-week labels along left axis (Mon..Fri / Mon..Sun)
    g.append('g')
      .attr('class', 'heatmap-day-labels')
      .selectAll('text')
      .data(model.dayRows)
      .join('text')
      .attr('x', -8)
      .attr('y', (d) => (yScale(d.dayOfWeek) ?? 0) + yScale.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .attr('fill', labelColor)
      .attr('font-size', '11px')
      .attr('font-weight', 500)
      .text((d) => d.label);

    const cellW = xScale.bandwidth();
    const cellH = yScale.bandwidth();
    const cornerRadius = Math.min(6, Math.max(3, Math.round(Math.min(cellW, cellH) * 0.18)));

    const cellGroups = g
      .append('g')
      .attr('class', 'heatmap-cells')
      .selectAll<SVGGElement, AttendanceHeatmapDayCell>('g.heatmap-cell-group')
      .data(model.cells, (d) => d.date)
      .join('g')
      .attr('class', 'heatmap-cell-group')
      .attr(
        'transform',
        (d) => `translate(${xScale(d.weekIndex) ?? 0},${yScale(d.dayOfWeek) ?? 0})`
      );

    cellGroups
      .append('rect')
      .attr('width', cellW)
      .attr('height', cellH)
      .attr('rx', cornerRadius)
      .attr('ry', cornerRadius)
      .attr('fill', (d) => {
        if (d.attendanceRate !== null) return colorScale(d.attendanceRate);
        return d.isFuture ? futureCellFill : emptyCellFill;
      })
      .attr('stroke', (d) => {
        if (selectedCell && d.date === selectedCell.date) {
          return isDark ? '#f8fafc' : '#0f172a';
        }
        if (d.isToday) {
          return isDark ? '#34d399' : '#047857';
        }
        return d.attendanceRate !== null ? 'transparent' : emptyCellStroke;
      })
      .attr('stroke-width', (d) => {
        if (selectedCell && d.date === selectedCell.date) return 2;
        if (d.isToday) return 1.5;
        return d.attendanceRate !== null ? 0 : 1;
      })
      .attr('opacity', (d) => (d.isFuture && d.total === 0 ? 0.55 : 1))
      .style('cursor', (d) => (d.total > 0 || !d.isFuture ? 'pointer' : 'default'))
      .on('mouseenter', function (_event, d) {
        d3.select(this).attr('opacity', 0.86);
        const xPos = margin.left + (xScale(d.weekIndex) ?? 0) + cellW / 2;
        const yPos = margin.top + (yScale(d.dayOfWeek) ?? 0);
        setTooltip({ cell: d, x: xPos, y: yPos });
      })
      .on('mouseleave', function (_event, d) {
        d3.select(this).attr('opacity', d.isFuture && d.total === 0 ? 0.55 : 1);
        setTooltip(null);
      })
      .on('click', (_event, d) => {
        if (d.total > 0 || !d.isFuture) {
          setSelectedDate(d.date);
        }
      });

    // Subtle tabular rate inside wide enough marked cells
    if (cellW >= 34 && cellH >= 24) {
      cellGroups
        .filter((d) => d.attendanceRate !== null)
        .append('text')
        .attr('x', cellW / 2)
        .attr('y', cellH / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'middle')
        .attr('pointer-events', 'none')
        .attr('font-size', '10px')
        .attr('font-weight', 600)
        .style('font-family', 'var(--font-mono)')
        .attr('fill', (d) => {
          const r = d.attendanceRate ?? 0;
          if (!isDark && r >= 75 && r < 85) return '#064e3b';
          if (isDark && r >= 95) return '#022c22';
          return '#ffffff';
        })
        .text((d) => `${Math.round(d.attendanceRate ?? 0)}%`);
    }
  }, [
    colorScale,
    containerWidth,
    emptyCellFill,
    emptyCellStroke,
    futureCellFill,
    isDark,
    labelColor,
    model,
    selectedCell,
  ]);

  const hasSchoolAttendanceAnyForm = attendance.length > 0;

  return (
    <section
      aria-label="Student Attendance Frequency Heatmap"
      className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Student Attendance Frequency Heatmap ({term})
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            <span>
              {model.termStartIso} to {model.termEndIso}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Term Mean:{' '}
              <strong className="text-emerald-700 dark:text-emerald-400">
                {model.summary.overallRate !== null ? `${model.summary.overallRate}%` : '—'}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>{model.summary.daysMarked} roll-call days</span>
            {model.summary.totalRecords > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {model.summary.presentOrLateCount} present / {model.summary.absentCount} absent
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <div
            role="group"
            aria-label="Filter heatmap by form level"
            className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900"
          >
            <button
              type="button"
              onClick={() => setFormFilter('ALL')}
              className={`min-h-[32px] px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                formFilter === 'ALL'
                  ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              All Forms
            </button>
            {FORM_LEVELS.map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setFormFilter(lvl)}
                className={`min-h-[32px] px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  formFilter === lvl
                    ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                F{lvl}
              </button>
            ))}
          </div>

          {onOpenAttendance && (
            <button
              type="button"
              onClick={onOpenAttendance}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>{canWriteAttendance ? 'Take Roll Call' : 'Attendance Register'}</span>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {!hasSchoolAttendanceAnyForm ? (
        <div className="py-10 px-4 text-center space-y-3 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
          <div className="mx-auto w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400">
            <CalendarCheck className="w-4 h-4" aria-hidden="true" />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            No daily student roll-call registers have been recorded for {term} yet. Daily attendance rates across Forms 1–4 will appear here once registers are saved.
          </p>
          {onOpenAttendance && (
            <button
              type="button"
              onClick={onOpenAttendance}
              className="inline-flex items-center gap-1.5 min-h-[38px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
            >
              <span>{canWriteAttendance ? 'Take First Roll Call' : 'Open Attendance Register'}</span>
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* D3 Responsive Heatmap SVG Container */}
          <div ref={wrapperRef} className="relative w-full overflow-x-auto">
            <svg
              ref={svgRef}
              role="img"
              aria-label={`D3 student attendance frequency heatmap for ${term}`}
              className="block w-full min-w-[520px] select-none"
            />

            {tooltip && (
              <div
                role="status"
                style={{
                  left: `${Math.min(Math.max(tooltip.x, 95), Math.max(containerWidth, 520) - 95)}px`,
                  top: `${Math.max(4, tooltip.y - 8)}px`,
                  transform: 'translate(-50%, -100%)',
                }}
                className="pointer-events-none absolute z-20 rounded-xl bg-slate-900 dark:bg-slate-950 text-white border border-slate-700 px-3 py-2 text-[11px] shadow-lg whitespace-nowrap"
              >
                <div className="font-semibold text-slate-100">
                  {formatShortHumanDate(tooltip.cell.date)}
                  {tooltip.cell.isToday ? ' (Today)' : ''}
                </div>
                {tooltip.cell.total === 0 ? (
                  <div className="text-slate-400 font-mono mt-0.5">
                    {tooltip.cell.isFuture ? 'Upcoming school day' : 'No roll call recorded'}
                  </div>
                ) : (
                  <div className="font-mono tabular-nums mt-0.5 text-slate-300 space-y-0.5">
                    <div>
                      Rate:{' '}
                      <strong className="text-emerald-400">
                        {tooltip.cell.attendanceRate?.toFixed(1)}%
                      </strong>{' '}
                      ({tooltip.cell.present + tooltip.cell.late}/{tooltip.cell.total})
                    </div>
                    <div className="text-[10px] text-slate-400">
                      P: {tooltip.cell.present} · L: {tooltip.cell.late} · E: {tooltip.cell.excused} · A:{' '}
                      {tooltip.cell.absent}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Color Scale Legend & Selected Day Summary */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                Attendance Rate:
              </span>
              {LEGEND_BANDS.map((band) => {
                const bg =
                  band.sampleRate === null ? emptyCellFill : colorScale(band.sampleRate);
                return (
                  <span
                    key={band.label}
                    className="inline-flex items-center gap-1.5 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300"
                  >
                    <span
                      className="w-3 h-3 rounded-xs shrink-0 border"
                      style={{
                        backgroundColor: bg,
                        borderColor: band.sampleRate === null ? emptyCellStroke : 'transparent',
                      }}
                      aria-hidden="true"
                    />
                    <span>{band.label}</span>
                  </span>
                );
              })}
            </div>

            {selectedCell && selectedCell.total > 0 ? (
              <div className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
                <strong className="text-slate-900 dark:text-white">
                  {formatShortHumanDate(selectedCell.date)}:
                </strong>{' '}
                <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                  {selectedCell.attendanceRate?.toFixed(1)}%
                </span>{' '}
                <span>
                  ({selectedCell.present} Present, {selectedCell.late} Late,{' '}
                  {selectedCell.excused} Excused, {selectedCell.absent} Absent)
                </span>
              </div>
            ) : (
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                No {formFilter === 'ALL' ? '' : `Form ${formFilter} `}attendance records found in this 13-week term window.
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
