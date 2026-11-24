import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowRight } from 'lucide-react';
import { FORM_LEVELS, normalizeAssessmentComponents } from '../../school/malawi';
import { usePrefersReducedMotion } from '../../school/useChartAnimation';
import { Assessment, FormLevel, TermName } from '../../school/types';

interface ClassPerformanceTrendChartProps {
  assessments: Assessment[];
  term: TermName;
  onOpenGradebook?: () => void;
}

type ChartMode = 'trend' | 'byForm';

const FORM_COLORS: Record<FormLevel, string> = {
  1: '#059669', // emerald-600
  2: '#0d9488', // teal-600
  3: '#0284c7', // sky-600
  4: '#d97706', // amber-600
};

interface StagePoint {
  stage: string;
  schoolAvg: number | null;
  form1: number | null;
  form2: number | null;
  form3: number | null;
  form4: number | null;
  count: number;
}

interface FormPoint {
  formLabel: string;
  ca1: number | null;
  ca2: number | null;
  exam: number | null;
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

export const ClassPerformanceTrendChart: React.FC<ClassPerformanceTrendChartProps> = ({
  assessments,
  term,
  onOpenGradebook,
}) => {
  const [mode, setMode] = useState<ChartMode>('trend');
  const prefersReducedMotion = usePrefersReducedMotion();
  const animateCharts = !prefersReducedMotion;

  const analytics = useMemo(() => {
    const accum = {
      all: { ca1Sum: 0, ca1N: 0, ca2Sum: 0, ca2N: 0, examSum: 0, examN: 0 },
      1: { ca1Sum: 0, ca1N: 0, ca2Sum: 0, ca2N: 0, examSum: 0, examN: 0 },
      2: { ca1Sum: 0, ca1N: 0, ca2Sum: 0, ca2N: 0, examSum: 0, examN: 0 },
      3: { ca1Sum: 0, ca1N: 0, ca2Sum: 0, ca2N: 0, examSum: 0, examN: 0 },
      4: { ca1Sum: 0, ca1N: 0, ca2Sum: 0, ca2N: 0, examSum: 0, examN: 0 },
    };

    for (const a of assessments) {
      const b = normalizeAssessmentComponents(a);
      const bucket = accum[a.formLevel];
      if (b.hasCa1) {
        const pct = (b.ca1Score / 20) * 100;
        accum.all.ca1Sum += pct;
        accum.all.ca1N += 1;
        bucket.ca1Sum += pct;
        bucket.ca1N += 1;
      }
      if (b.hasCa2) {
        const pct = (b.ca2Score / 20) * 100;
        accum.all.ca2Sum += pct;
        accum.all.ca2N += 1;
        bucket.ca2Sum += pct;
        bucket.ca2N += 1;
      }
      if (b.hasExam) {
        const pct = (b.examScore / 60) * 100;
        accum.all.examSum += pct;
        accum.all.examN += 1;
        bucket.examSum += pct;
        bucket.examN += 1;
      }
    }

    const avg = (sum: number, n: number): number | null => (n > 0 ? round1(sum / n) : null);

    const activeForms = FORM_LEVELS.filter((f) => {
      const b = accum[f];
      return b.ca1N > 0 || b.ca2N > 0 || b.examN > 0;
    });

    const stageData: StagePoint[] = [
      {
        stage: 'CA 1 (20%)',
        schoolAvg: avg(accum.all.ca1Sum, accum.all.ca1N),
        form1: avg(accum[1].ca1Sum, accum[1].ca1N),
        form2: avg(accum[2].ca1Sum, accum[2].ca1N),
        form3: avg(accum[3].ca1Sum, accum[3].ca1N),
        form4: avg(accum[4].ca1Sum, accum[4].ca1N),
        count: accum.all.ca1N,
      },
      {
        stage: 'CA 2 (20%)',
        schoolAvg: avg(accum.all.ca2Sum, accum.all.ca2N),
        form1: avg(accum[1].ca2Sum, accum[1].ca2N),
        form2: avg(accum[2].ca2Sum, accum[2].ca2N),
        form3: avg(accum[3].ca2Sum, accum[3].ca2N),
        form4: avg(accum[4].ca2Sum, accum[4].ca2N),
        count: accum.all.ca2N,
      },
      {
        stage: 'Summative (60%)',
        schoolAvg: avg(accum.all.examSum, accum.all.examN),
        form1: avg(accum[1].examSum, accum[1].examN),
        form2: avg(accum[2].examSum, accum[2].examN),
        form3: avg(accum[3].examSum, accum[3].examN),
        form4: avg(accum[4].examSum, accum[4].examN),
        count: accum.all.examN,
      },
    ];

    const formData: FormPoint[] = FORM_LEVELS.map((f) => ({
      formLabel: `Form ${f}`,
      ca1: avg(accum[f].ca1Sum, accum[f].ca1N),
      ca2: avg(accum[f].ca2Sum, accum[f].ca2N),
      exam: avg(accum[f].examSum, accum[f].examN),
    })).filter((row) => row.ca1 !== null || row.ca2 !== null || row.exam !== null);

    return {
      stageData,
      formData,
      activeForms,
      ca1Avg: avg(accum.all.ca1Sum, accum.all.ca1N),
      ca2Avg: avg(accum.all.ca2Sum, accum.all.ca2N),
      examAvg: avg(accum.all.examSum, accum.all.examN),
      hasAnyData:
        accum.all.ca1N > 0 || accum.all.ca2N > 0 || accum.all.examN > 0,
    };
  }, [assessments]);

  return (
    <section
      data-board-chart="class-trend"
      data-chart-filter-summary={`Term: ${term} · Mode: ${mode === 'trend' ? 'Stage Trend (CA 1, CA 2, Summative)' : 'By Form Breakdown'}`}
      className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Class-Wide Academic Performance Trends ({term})
          </h2>
          {analytics.hasAnyData && (
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              <span>
                CA 1:{' '}
                <strong className="text-slate-900 dark:text-slate-100">
                  {analytics.ca1Avg !== null ? `${analytics.ca1Avg}%` : '—'}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                CA 2:{' '}
                <strong className="text-slate-900 dark:text-slate-100">
                  {analytics.ca2Avg !== null ? `${analytics.ca2Avg}%` : '—'}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Summative:{' '}
                <strong className="text-emerald-700 dark:text-emerald-400">
                  {analytics.examAvg !== null ? `${analytics.examAvg}%` : '—'}
                </strong>
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {analytics.hasAnyData && (
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setMode('trend')}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  mode === 'trend'
                    ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Stage Trend
              </button>
              <button
                type="button"
                onClick={() => setMode('byForm')}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  mode === 'byForm'
                    ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                By Form
              </button>
            </div>
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

      {!analytics.hasAnyData ? (
        <div className="py-10 px-4 text-center space-y-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No CA 1, CA 2, or Summative scores recorded for {term} yet.
          </p>
          {onOpenGradebook && (
            <button
              type="button"
              onClick={onOpenGradebook}
              className="inline-flex items-center gap-1.5 min-h-[38px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
            >
              <span>Enter First Marks</span>
            </button>
          )}
        </div>
      ) : (
        <div className="h-[260px] w-full min-w-0 text-slate-500 dark:text-slate-400">
          <ResponsiveContainer width="100%" height="100%">
            {mode === 'trend' ? (
              <LineChart
                data={analytics.stageData}
                margin={{ top: 10, right: 16, left: -12, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.14} />
                <XAxis
                  dataKey="stage"
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
                <Tooltip
                  formatter={(value: unknown) =>
                    typeof value === 'number' ? [`${value.toFixed(1)}%`, undefined] : ['—', undefined]
                  }
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid rgba(148, 163, 184, 0.3)',
                    backgroundColor: 'rgba(15, 23, 42, 0.94)',
                    color: '#f8fafc',
                    fontSize: '12px',
                  }}
                  itemStyle={{ fontFamily: 'ui-monospace, monospace' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />

                {analytics.activeForms.map((f, idx) => (
                  <Line
                    key={f}
                    type="monotone"
                    dataKey={`form${f}`}
                    name={`Form ${f}`}
                    stroke={FORM_COLORS[f]}
                    strokeWidth={2.5}
                    dot={{ r: 4, strokeWidth: 2 }}
                    activeDot={{ r: 6 }}
                    connectNulls
                    isAnimationActive={animateCharts}
                    animationBegin={idx * 65}
                    animationDuration={550}
                    animationEasing="ease-out"
                  />
                ))}

                {analytics.activeForms.length > 1 && (
                  <Line
                    type="monotone"
                    dataKey="schoolAvg"
                    name="School Mean"
                    stroke="#64748b"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={{ r: 3.5 }}
                    connectNulls
                    isAnimationActive={animateCharts}
                    animationBegin={180}
                    animationDuration={550}
                    animationEasing="ease-out"
                  />
                )}
              </LineChart>
            ) : (
              <BarChart
                data={analytics.formData}
                margin={{ top: 10, right: 16, left: -12, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.14} />
                <XAxis
                  dataKey="formLabel"
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
                <Tooltip
                  formatter={(value: unknown) =>
                    typeof value === 'number' ? [`${value.toFixed(1)}%`, undefined] : ['—', undefined]
                  }
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid rgba(148, 163, 184, 0.3)',
                    backgroundColor: 'rgba(15, 23, 42, 0.94)',
                    color: '#f8fafc',
                    fontSize: '12px',
                  }}
                  itemStyle={{ fontFamily: 'ui-monospace, monospace' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
                <Bar
                  dataKey="ca1"
                  name="CA 1 (20%)"
                  fill="#059669"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={animateCharts}
                  animationBegin={0}
                  animationDuration={500}
                  animationEasing="ease-out"
                />
                <Bar
                  dataKey="ca2"
                  name="CA 2 (20%)"
                  fill="#0d9488"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={animateCharts}
                  animationBegin={75}
                  animationDuration={500}
                  animationEasing="ease-out"
                />
                <Bar
                  dataKey="exam"
                  name="Summative (60%)"
                  fill="#0284c7"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={animateCharts}
                  animationBegin={150}
                  animationDuration={500}
                  animationEasing="ease-out"
                />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
};
