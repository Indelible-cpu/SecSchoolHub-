import React, { useMemo, useState } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowRight, TrendingDown, TrendingUp } from 'lucide-react';
import { FORM_LEVELS } from '../../school/malawi';
import {
  buildTermPerformanceTrends,
  type TermPerformancePoint,
} from '../../school/termPerformanceUtils';
import { usePrefersReducedMotion } from '../../school/useChartAnimation';
import type { Assessment, FormLevel, TermName } from '../../school/types';

interface TermPerformanceTrendChartProps {
  assessments: Assessment[];
  currentAcademicYear: string;
  currentTerm: TermName;
  onOpenGradebook?: () => void;
}

type ViewMode = 'trend' | 'comparison';

const FORM_COLORS: Record<FormLevel, string> = {
  1: '#059669', // emerald-600
  2: '#0d9488', // teal-600
  3: '#0284c7', // sky-600
  4: '#d97706', // amber-600
};

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload?: TermPerformancePoint;
  }>;
  formFilter: 'ALL' | FormLevel;
}

const TermTrendTooltip: React.FC<CustomTooltipProps> = ({ active, payload, formFilter }) => {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="rounded-xl border border-slate-700/80 bg-slate-950/95 px-3.5 py-2.5 text-xs text-slate-100 shadow-xl min-w-[200px] space-y-1.5">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-1.5">
        <span className="font-semibold text-white">{point.fullLabel}</span>
        {point.deltaFromPrev !== null && (
          <span
            className={`font-mono tabular-nums font-semibold ${
              point.deltaFromPrev >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {point.deltaFromPrev >= 0 ? `+${point.deltaFromPrev.toFixed(1)}` : point.deltaFromPrev.toFixed(1)} pts
          </span>
        )}
      </div>

      {!point.hasData ? (
        <p className="text-[11px] text-slate-400 py-0.5">No marks recorded for this term yet.</p>
      ) : (
        <div className="space-y-1 font-mono tabular-nums">
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-300 font-sans">Aggregate Mean</span>
            <span className="font-semibold text-emerald-400">
              {point.aggregateMean !== null ? `${point.aggregateMean.toFixed(1)}%` : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-300 font-sans">Pass Rate</span>
            <span className="font-semibold text-sky-400">
              {point.passRatePct !== null ? `${point.passRatePct.toFixed(1)}%` : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4 text-[11px] text-slate-400">
            <span className="font-sans">Students / Marks</span>
            <span>
              {point.studentCount} / {point.assessmentCount}
            </span>
          </div>

          {formFilter === 'ALL' && (
            <div className="pt-1 mt-1 border-t border-slate-800/90 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
              {FORM_LEVELS.map((f) => {
                const val = point[`form${f}`];
                if (val === null) return null;
                return (
                  <div key={f} className="flex items-center justify-between gap-2">
                    <span className="text-slate-400 font-sans">Form {f}</span>
                    <span className="text-slate-200">{val.toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const TermPerformanceTrendChart: React.FC<TermPerformanceTrendChartProps> = ({
  assessments,
  currentAcademicYear,
  currentTerm,
  onOpenGradebook,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('trend');
  const [formFilter, setFormFilter] = useState<'ALL' | FormLevel>('ALL');
  const [subjectFilter, setSubjectFilter] = useState<string>('ALL');
  const prefersReducedMotion = usePrefersReducedMotion();
  const animateCharts = !prefersReducedMotion;

  const summary = useMemo(
    () =>
      buildTermPerformanceTrends(assessments, {
        currentAcademicYear,
        formFilter,
        subjectFilter,
      }),
    [assessments, currentAcademicYear, formFilter, subjectFilter]
  );

  const delta = summary.latestPoint?.deltaFromPrev ?? null;

  return (
    <section
      aria-label="Term-over-term student performance trends"
      data-board-chart="term-trend"
      data-chart-filter-summary={`View: ${viewMode === 'trend' ? 'Aggregate Trend' : 'Mean vs Pass Rate'} · ${formFilter === 'ALL' ? 'All Forms (1–4)' : `Form ${formFilter}`} · ${subjectFilter === 'ALL' ? 'All Subjects' : subjectFilter}`}
      className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4"
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Student Performance Trends (Term-over-Term Aggregate Marks)
          </h2>
          {summary.latestPoint ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              <span>
                Latest ({summary.latestPoint.fullLabel}):{' '}
                <strong className="text-slate-900 dark:text-slate-100">
                  {summary.latestPoint.aggregateMean !== null
                    ? `${summary.latestPoint.aggregateMean.toFixed(1)}%`
                    : '—'}
                </strong>
              </span>
              {delta !== null && (
                <>
                  <span aria-hidden="true">·</span>
                  <span
                    className={`inline-flex items-center gap-1 font-semibold ${
                      delta >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {delta >= 0 ? (
                      <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />
                    ) : (
                      <TrendingDown className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    {delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)} pts vs{' '}
                    {summary.previousPoint?.label}
                  </span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>
                Pass Rate:{' '}
                <strong className="text-sky-700 dark:text-sky-400">
                  {summary.latestPoint.passRatePct !== null
                    ? `${summary.latestPoint.passRatePct.toFixed(1)}%`
                    : '—'}
                </strong>
              </span>
              {summary.bestPoint && summary.activeTermsCount > 1 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    Peak:{' '}
                    <strong className="text-emerald-700 dark:text-emerald-400">
                      {summary.bestPoint.label} ({summary.bestPoint.aggregateMean?.toFixed(1)}%)
                    </strong>
                  </span>
                </>
              )}
            </div>
          ) : (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Chronological aggregate mark averages across Terms 1–3 ({currentAcademicYear}).
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {assessments.length > 0 && (
            <>
              <select
                aria-label="Filter term performance by form level"
                value={formFilter === 'ALL' ? 'ALL' : String(formFilter)}
                onChange={(e) =>
                  setFormFilter(e.target.value === 'ALL' ? 'ALL' : (Number(e.target.value) as FormLevel))
                }
                className="min-h-[36px] px-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                <option value="ALL">All Forms (1–4)</option>
                {FORM_LEVELS.map((f) => (
                  <option key={f} value={String(f)}>
                    Form {f}
                  </option>
                ))}
              </select>

              {summary.availableSubjects.length > 0 && (
                <select
                  aria-label="Filter term performance by subject"
                  value={subjectFilter}
                  onChange={(e) => setSubjectFilter(e.target.value)}
                  className="min-h-[36px] px-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 max-w-[165px] cursor-pointer"
                >
                  <option value="ALL">All Subjects</option>
                  {summary.availableSubjects.map((subj) => (
                    <option key={subj} value={subj}>
                      {subj}
                    </option>
                  ))}
                </select>
              )}

              <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => setViewMode('trend')}
                  className={`min-h-[30px] px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    viewMode === 'trend'
                      ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Aggregate Trend
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('comparison')}
                  className={`min-h-[30px] px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    viewMode === 'comparison'
                      ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Mean vs Pass Rate
                </button>
              </div>
            </>
          )}

          {onOpenGradebook && (
            <button
              type="button"
              onClick={onOpenGradebook}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Gradebook</span>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {summary.totalAssessments === 0 ? (
        <div className="py-10 px-4 text-center space-y-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {assessments.length === 0
              ? `No assessment marks recorded across Terms 1–3 yet. Enter ${currentTerm} scores to begin tracking term-over-term aggregates.`
              : 'No assessments match the selected Form Level and Subject filter.'}
          </p>
          {assessments.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setFormFilter('ALL');
                setSubjectFilter('ALL');
              }}
              className="inline-flex items-center gap-1.5 min-h-[36px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Reset Filters
            </button>
          ) : (
            onOpenGradebook && (
              <button
                type="button"
                onClick={onOpenGradebook}
                className="inline-flex items-center gap-1.5 min-h-[38px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
              >
                <span>Open Exam Marks Gradebook</span>
              </button>
            )
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="h-[275px] w-full min-w-0 text-slate-500 dark:text-slate-400">
            <ResponsiveContainer width="100%" height="100%">
              {viewMode === 'trend' ? (
                <ComposedChart
                  data={summary.points}
                  margin={{ top: 12, right: 16, left: -12, bottom: 4 }}
                >
                  <defs>
                    <linearGradient id="termAggFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#059669" stopOpacity={0.22} />
                      <stop offset="95%" stopColor="#059669" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.14} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: 'currentColor', fontSize: 11 }}
                    axisLine={{ stroke: 'currentColor', opacity: 0.25 }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fill: 'currentColor', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<TermTrendTooltip formFilter={formFilter} />} />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
                  <ReferenceLine
                    y={50}
                    stroke="#94a3b8"
                    strokeDasharray="4 4"
                    label={{
                      value: '50% Pass',
                      position: 'insideTopRight',
                      fill: '#94a3b8',
                      fontSize: 10,
                    }}
                  />

                  <Area
                    key="aggregate-mean-area"
                    type="monotone"
                    dataKey="aggregateMean"
                    name={formFilter === 'ALL' ? 'School Aggregate Mean' : `Form ${formFilter} Mean`}
                    stroke="#047857"
                    strokeWidth={2.75}
                    fill="url(#termAggFill)"
                    dot={{ r: 4.5, fill: '#047857', stroke: '#ffffff', strokeWidth: 1.5 }}
                    activeDot={{ r: 6.5 }}
                    connectNulls
                    isAnimationActive={animateCharts}
                    animationDuration={550}
                    animationEasing="ease-out"
                  />

                  {formFilter === 'ALL' &&
                    summary.activeForms.map((f, idx) => (
                      <Line
                        key={f}
                        type="monotone"
                        dataKey={`form${f}`}
                        name={`Form ${f}`}
                        stroke={FORM_COLORS[f]}
                        strokeWidth={1.85}
                        strokeDasharray="3 3"
                        dot={{ r: 3.5 }}
                        activeDot={{ r: 5 }}
                        connectNulls
                        isAnimationActive={animateCharts}
                        animationBegin={idx * 70}
                        animationDuration={550}
                        animationEasing="ease-out"
                      />
                    ))}
                </ComposedChart>
              ) : (
                <BarChart
                  data={summary.points}
                  margin={{ top: 12, right: 16, left: -12, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.14} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: 'currentColor', fontSize: 11 }}
                    axisLine={{ stroke: 'currentColor', opacity: 0.25 }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fill: 'currentColor', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<TermTrendTooltip formFilter={formFilter} />} />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
                  <ReferenceLine y={50} stroke="#94a3b8" strokeDasharray="4 4" />
                  <Bar
                    dataKey="aggregateMean"
                    name="Aggregate Mean (%)"
                    fill="#059669"
                    radius={[5, 5, 0, 0]}
                    maxBarSize={44}
                    isAnimationActive={animateCharts}
                    animationBegin={0}
                    animationDuration={520}
                    animationEasing="ease-out"
                  />
                  <Bar
                    dataKey="passRatePct"
                    name="Pass Rate (%)"
                    fill="#0284c7"
                    radius={[5, 5, 0, 0]}
                    maxBarSize={44}
                    isAnimationActive={animateCharts}
                    animationBegin={90}
                    animationDuration={520}
                    animationEasing="ease-out"
                  />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>

          {summary.activeTermsCount === 1 && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
              Showing baseline data for {summary.latestPoint?.fullLabel}. Term-over-term trend lines extend automatically as Term 2 and Term 3 marks are entered.
            </p>
          )}
        </div>
      )}
    </section>
  );
};
