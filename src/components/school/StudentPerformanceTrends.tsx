import React, { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowDownRight, ArrowUpRight, Minus, TrendingUp } from 'lucide-react';
import {
  calculateTermReportSummary,
  normalizeAssessmentComponents,
  TERMS,
} from '../../school/malawi';
import { Assessment, FormLevel, TermName } from '../../school/types';

interface StudentPerformanceTrendsProps {
  studentId: string;
  studentName: string;
  formLevel: FormLevel;
  academicYear: string;
  assessments: Assessment[];
  compact?: boolean;
}

type TrendMetricMode = 'score' | 'gradePoint';

interface TermTrendPoint {
  key: string;
  label: string;
  shortLabel: string;
  academicYear: string;
  term: TermName;
  formLevel: FormLevel;
  system: 'JCE' | 'MSCE';
  subjectCount: number;
  weightedAverage: number;
  caPct: number;
  examPct: number;
  gradePoint: number | null;
  overallGrade: string;
  overallRemark: string;
  outcome: string;
  scoreDelta: number | null;
}

function getTermOrder(term: TermName): number {
  const idx = TERMS.indexOf(term);
  return idx >= 0 ? idx : 99;
}

function parseYearRank(yearStr: string): number {
  const m = String(yearStr || '').match(/\d{4}/);
  return m ? Number(m[0]) : 0;
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

function getSubjectMeanPoint(formLevel: FormLevel, totalScore: number): {
  grade: string;
  gradePoint: number;
  remark: string;
} {
  // Reuse calculateTermReportSummary with 1 synthetic/matched item via assessment summary
  // Actually compute directly from summary helper or stored gradePoint
  if (formLevel <= 2) {
    if (totalScore >= 80) return { grade: 'A', gradePoint: 1, remark: 'Distinction' };
    if (totalScore >= 70) return { grade: 'B', gradePoint: 3, remark: 'Strong Credit' };
    if (totalScore >= 55) return { grade: 'C', gradePoint: 5, remark: 'Credit' };
    if (totalScore >= 40) return { grade: 'D', gradePoint: 7, remark: 'Pass' };
    return { grade: 'F', gradePoint: 9, remark: 'Fail' };
  }
  if (totalScore >= 80) return { grade: '1', gradePoint: 1, remark: 'Distinction' };
  if (totalScore >= 70) return { grade: '2', gradePoint: 2, remark: 'Distinction' };
  if (totalScore >= 65) return { grade: '3', gradePoint: 3, remark: 'Strong Credit' };
  if (totalScore >= 60) return { grade: '4', gradePoint: 4, remark: 'Credit' };
  if (totalScore >= 55) return { grade: '5', gradePoint: 5, remark: 'Credit' };
  if (totalScore >= 50) return { grade: '6', gradePoint: 6, remark: 'Credit' };
  if (totalScore >= 45) return { grade: '7', gradePoint: 7, remark: 'Pass' };
  if (totalScore >= 40) return { grade: '8', gradePoint: 8, remark: 'Pass' };
  return { grade: '9', gradePoint: 9, remark: 'Fail' };
}

export const StudentPerformanceTrends: React.FC<StudentPerformanceTrendsProps> = ({
  studentId,
  studentName,
  formLevel,
  academicYear,
  assessments,
  compact = false,
}) => {
  const [metricMode, setMetricMode] = useState<TrendMetricMode>('score');
  const [selectedSubject, setSelectedSubject] = useState<string>('ALL');

  const studentAssessments = useMemo(
    () => assessments.filter((a) => a.studentId === studentId),
    [assessments, studentId]
  );

  const subjectOptions = useMemo(() => {
    const names = new Set<string>();
    for (const a of studentAssessments) {
      if (a.subject) names.add(a.subject);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [studentAssessments]);

  const effectiveSubject =
    selectedSubject !== 'ALL' && !subjectOptions.includes(selectedSubject)
      ? 'ALL'
      : selectedSubject;

  const trendPoints = useMemo<TermTrendPoint[]>(() => {
    const buckets = new Map<
      string,
      { academicYear: string; term: TermName; items: Assessment[] }
    >();

    for (const a of studentAssessments) {
      if (effectiveSubject !== 'ALL' && a.subject !== effectiveSubject) continue;
      const yr = (a.academicYear || academicYear || '').trim() || academicYear;
      const key = `${yr}__${a.term}`;
      const existing = buckets.get(key) || { academicYear: yr, term: a.term, items: [] };
      existing.items.push(a);
      buckets.set(key, existing);
    }

    const sortedBuckets = Array.from(buckets.values()).sort((a, b) => {
      const yearDiff = parseYearRank(a.academicYear) - parseYearRank(b.academicYear);
      if (yearDiff !== 0) return yearDiff;
      const strDiff = a.academicYear.localeCompare(b.academicYear);
      if (strDiff !== 0) return strDiff;
      return getTermOrder(a.term) - getTermOrder(b.term);
    });

    const distinctYears = new Set(sortedBuckets.map((b) => b.academicYear));
    const showYear = distinctYears.size > 1;

    const rawPoints: TermTrendPoint[] = sortedBuckets.map((bucket) => {
      const bucketForm = bucket.items.reduce<FormLevel>(
        (maxF, item) => (item.formLevel > maxF ? item.formLevel : maxF),
        formLevel
      );

      if (effectiveSubject === 'ALL') {
        const summary = calculateTermReportSummary(bucketForm, bucket.items);
        return {
          key: `${bucket.academicYear}__${bucket.term}`,
          label: `${bucket.term} (${bucket.academicYear})`,
          shortLabel: showYear ? `${bucket.term.replace('Term ', 'T')} ${bucket.academicYear}` : bucket.term,
          academicYear: bucket.academicYear,
          term: bucket.term,
          formLevel: bucketForm,
          system: summary.system,
          subjectCount: summary.subjectCount,
          weightedAverage: round1(summary.weightedAverage),
          caPct: round1((summary.caAverage / 40) * 100),
          examPct: round1((summary.summativeAverage / 60) * 100),
          gradePoint: summary.meanManebPoint !== null ? round1(summary.meanManebPoint) : null,
          overallGrade: summary.overallGrade,
          overallRemark: summary.overallRemark,
          outcome: summary.standing.outcome,
          scoreDelta: null,
        };
      }

      const item = bucket.items[0];
      const norm = normalizeAssessmentComponents(item);
      const total = round1(norm.caScore + norm.examScore);
      const caPct = round1((norm.caScore / 40) * 100);
      const examPct = round1((norm.examScore / 60) * 100);
      const standing = getSubjectMeanPoint(bucketForm, total);
      return {
        key: `${bucket.academicYear}__${bucket.term}`,
        label: `${bucket.term} (${bucket.academicYear})`,
        shortLabel: showYear ? `${bucket.term.replace('Term ', 'T')} ${bucket.academicYear}` : bucket.term,
        academicYear: bucket.academicYear,
        term: bucket.term,
        formLevel: bucketForm,
        system: bucketForm <= 2 ? 'JCE' : 'MSCE',
        subjectCount: 1,
        weightedAverage: total,
        caPct,
        examPct,
        gradePoint: standing.gradePoint,
        overallGrade: standing.grade,
        overallRemark: standing.remark,
        outcome: standing.gradePoint <= 8 ? 'Pass' : 'Fail',
        scoreDelta: null,
      };
    });

    return rawPoints.map((pt, idx) => ({
      ...pt,
      scoreDelta:
        idx > 0 ? round1(pt.weightedAverage - rawPoints[idx - 1].weightedAverage) : null,
    }));
  }, [academicYear, effectiveSubject, formLevel, studentAssessments]);

  const summaryStats = useMemo(() => {
    if (trendPoints.length === 0) return null;
    const latest = trendPoints[trendPoints.length - 1];
    const first = trendPoints[0];
    const overallChange =
      trendPoints.length > 1 ? round1(latest.weightedAverage - first.weightedAverage) : null;
    const bestTerm = trendPoints.reduce(
      (best, curr) => (curr.weightedAverage > best.weightedAverage ? curr : best),
      trendPoints[0]
    );
    return {
      latest,
      overallChange,
      bestTerm,
    };
  }, [trendPoints]);

  if (studentAssessments.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 px-5 py-10 text-center space-y-2">
        <TrendingUp className="w-6 h-6 mx-auto text-slate-400" aria-hidden="true" />
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          No Term Marks Recorded Yet
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
          Academic progression across Term 1, Term 2, and Term 3 will appear here once assessment scores are recorded for {studentName}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
            <span>
              Performance Trends
              {effectiveSubject !== 'ALL' ? ` · ${effectiveSubject}` : ' · Term Progression'}
            </span>
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
            {trendPoints.length} {trendPoints.length === 1 ? 'term' : 'terms'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter performance trend by subject"
            value={effectiveSubject}
            onChange={(e) => setSelectedSubject(e.target.value)}
            className="min-h-[36px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200"
          >
            <option value="ALL">All Subjects (Overall Mean)</option>
            {subjectOptions.map((subj) => (
              <option key={subj} value={subj}>
                {subj}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setMetricMode('score')}
              className={`min-h-[30px] px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                metricMode === 'score'
                  ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Score (%)
            </button>
            <button
              type="button"
              onClick={() => setMetricMode('gradePoint')}
              className={`min-h-[30px] px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                metricMode === 'gradePoint'
                  ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Grade Points (1–9)
            </button>
          </div>
        </div>
      </div>

      {/* Progression Summary KPI Strip */}
      {summaryStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400">Latest Term Mean</div>
            <div className="mt-1 text-base font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {summaryStats.latest.weightedAverage.toFixed(1)}%
            </div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {summaryStats.latest.shortLabel}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400">Latest Grade</div>
            <div className="mt-1 text-base font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
              {summaryStats.latest.overallGrade}
              {summaryStats.latest.gradePoint !== null && (
                <span className="ml-1.5 text-xs font-normal text-slate-500 dark:text-slate-400">
                  (Pt {summaryStats.latest.gradePoint})
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {summaryStats.latest.overallRemark}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400">Multi-Term Change</div>
            <div
              className={`mt-1 text-base font-bold font-mono tabular-nums inline-flex items-center gap-1 ${
                summaryStats.overallChange === null
                  ? 'text-slate-500 dark:text-slate-400'
                  : summaryStats.overallChange > 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : summaryStats.overallChange < 0
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              {summaryStats.overallChange === null ? (
                <span>Single term</span>
              ) : summaryStats.overallChange > 0 ? (
                <>
                  <ArrowUpRight className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>+{summaryStats.overallChange.toFixed(1)}%</span>
                </>
              ) : summaryStats.overallChange < 0 ? (
                <>
                  <ArrowDownRight className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{summaryStats.overallChange.toFixed(1)}%</span>
                </>
              ) : (
                <>
                  <Minus className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>0.0%</span>
                </>
              )}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {trendPoints.length > 1
                ? `${trendPoints[0].shortLabel} → ${summaryStats.latest.shortLabel}`
                : 'Add another term to compare'}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400">Peak Term</div>
            <div className="mt-1 text-base font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {summaryStats.bestTerm.weightedAverage.toFixed(1)}%
            </div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {summaryStats.bestTerm.shortLabel} · Grade {summaryStats.bestTerm.overallGrade}
            </div>
          </div>
        </div>
      )}

      {/* Recharts Visualization */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#161B22] p-3.5 sm:p-4">
        <div
          className={`${
            compact ? 'h-[220px]' : 'h-[260px]'
          } w-full min-w-0 text-slate-500 dark:text-slate-400`}
        >
          <ResponsiveContainer width="100%" height="100%">
            {metricMode === 'score' ? (
              <LineChart
                data={trendPoints}
                margin={{ top: 10, right: 16, left: -12, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.14} />
                <XAxis
                  dataKey="shortLabel"
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
                  formatter={(value: unknown, name: unknown) =>
                    typeof value === 'number'
                      ? [`${value.toFixed(1)}%`, String(name ?? '')]
                      : ['—', String(name ?? '')]
                  }
                  labelFormatter={(_, payload) => {
                    const pt = payload?.[0]?.payload as TermTrendPoint | undefined;
                    if (!pt) return '';
                    return `${pt.label} · Grade ${pt.overallGrade} (${pt.overallRemark})`;
                  }}
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid rgba(148, 163, 184, 0.3)',
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    color: '#f8fafc',
                    fontSize: '12px',
                  }}
                  itemStyle={{ fontFamily: 'ui-monospace, monospace' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
                <Line
                  type="monotone"
                  dataKey="weightedAverage"
                  name="Overall Score (%)"
                  stroke="#059669"
                  strokeWidth={2.75}
                  dot={{ r: 5, strokeWidth: 2, fill: '#059669' }}
                  activeDot={{ r: 7 }}
                />
                <Line
                  type="monotone"
                  dataKey="caPct"
                  name="CA Avg (40%)"
                  stroke="#0d9488"
                  strokeWidth={1.75}
                  strokeDasharray="4 4"
                  dot={{ r: 3.5 }}
                />
                <Line
                  type="monotone"
                  dataKey="examPct"
                  name="Summative Avg (60%)"
                  stroke="#0284c7"
                  strokeWidth={1.75}
                  strokeDasharray="4 4"
                  dot={{ r: 3.5 }}
                />
              </LineChart>
            ) : (
              <LineChart
                data={trendPoints}
                margin={{ top: 10, right: 16, left: -12, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.14} />
                <XAxis
                  dataKey="shortLabel"
                  tick={{ fill: 'currentColor', fontSize: 11 }}
                  axisLine={{ stroke: 'currentColor', opacity: 0.25 }}
                  tickLine={false}
                />
                <YAxis
                  domain={[1, 9]}
                  reversed
                  ticks={[1, 2, 3, 4, 5, 6, 7, 8, 9]}
                  tickFormatter={(v) => `Pt ${v}`}
                  tick={{ fill: 'currentColor', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(value: unknown) =>
                    typeof value === 'number'
                      ? [`Pt ${value.toFixed(1)} (1 = best, 9 = fail)`, 'Mean Grade Point']
                      : ['—', 'Mean Grade Point']
                  }
                  labelFormatter={(_, payload) => {
                    const pt = payload?.[0]?.payload as TermTrendPoint | undefined;
                    if (!pt) return '';
                    return `${pt.label} · Grade ${pt.overallGrade} (${pt.weightedAverage.toFixed(1)}%)`;
                  }}
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid rgba(148, 163, 184, 0.3)',
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    color: '#f8fafc',
                    fontSize: '12px',
                  }}
                  itemStyle={{ fontFamily: 'ui-monospace, monospace' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
                <Line
                  type="monotone"
                  dataKey="gradePoint"
                  name="Grade Point (1 best → 9 fail)"
                  stroke="#059669"
                  strokeWidth={2.75}
                  dot={{ r: 5, strokeWidth: 2, fill: '#059669' }}
                  activeDot={{ r: 7 }}
                  connectNulls
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>

      {/* Term-by-Term Breakdown Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400">
              <th className="py-2.5 px-3 font-medium">Term</th>
              <th className="py-2.5 px-2.5 font-medium text-right">Subjects</th>
              <th className="py-2.5 px-2.5 font-medium text-right">CA %</th>
              <th className="py-2.5 px-2.5 font-medium text-right">Exam %</th>
              <th className="py-2.5 px-2.5 font-medium text-right">Mean %</th>
              <th className="py-2.5 px-2.5 font-medium text-right">Trend</th>
              <th className="py-2.5 px-2.5 font-medium text-right">Grade</th>
              <th className="py-2.5 px-3 font-medium text-right">Standing</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 bg-white dark:bg-[#161B22]">
            {trendPoints.map((pt) => (
              <tr key={pt.key}>
                <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                  {pt.label}
                </td>
                <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                  {pt.subjectCount}
                </td>
                <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                  {pt.caPct.toFixed(1)}%
                </td>
                <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                  {pt.examPct.toFixed(1)}%
                </td>
                <td className="py-2.5 px-2.5 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                  {pt.weightedAverage.toFixed(1)}%
                </td>
                <td
                  className={`py-2.5 px-2.5 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                    pt.scoreDelta === null
                      ? 'text-slate-400'
                      : pt.scoreDelta > 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : pt.scoreDelta < 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-500'
                  }`}
                >
                  {pt.scoreDelta === null
                    ? '—'
                    : pt.scoreDelta > 0
                    ? `+${pt.scoreDelta.toFixed(1)}%`
                    : `${pt.scoreDelta.toFixed(1)}%`}
                </td>
                <td className="py-2.5 px-2.5 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                  {pt.overallGrade}
                </td>
                <td
                  className={`py-2.5 px-3 text-right font-semibold whitespace-nowrap ${
                    pt.outcome === 'Pass'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : pt.outcome === 'Fail'
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {pt.outcome}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
