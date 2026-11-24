import React from 'react';
import { formatMWK, normalizeAssessmentComponents } from '../../school/malawi';
import { useMountedAnimation } from '../../school/useChartAnimation';
import { Assessment } from '../../school/types';

interface FeeCollectionDonutProps {
  billed: number;
  paid: number;
  balance: number;
  paidCount: number;
  partialCount: number;
  unpaidCount: number;
}

export const FeeCollectionDonut: React.FC<FeeCollectionDonutProps> = ({
  billed,
  paid,
  balance,
  paidCount,
  partialCount,
  unpaidCount,
}) => {
  const mounted = useMountedAnimation();
  const rate = billed > 0 ? Math.min(100, Math.round((paid / billed) * 100)) : 0;
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = mounted ? circumference - (rate / 100) * circumference : circumference;

  const totalInvoices = paidCount + partialCount + unpaidCount;
  const paidPct = totalInvoices > 0 ? (paidCount / totalInvoices) * 100 : 0;
  const partialPct = totalInvoices > 0 ? (partialCount / totalInvoices) * 100 : 0;
  const unpaidPct = totalInvoices > 0 ? (unpaidCount / totalInvoices) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-5">
        <div className="relative w-28 h-28 shrink-0">
          <svg viewBox="0 0 112 112" className="w-full h-full -rotate-90" aria-hidden="true">
            <circle
              cx="56"
              cy="56"
              r={radius}
              fill="none"
              strokeWidth="12"
              className="stroke-slate-100 dark:stroke-slate-800"
            />
            <circle
              cx="56"
              cy="56"
              r={radius}
              fill="none"
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              className="stroke-emerald-600 dark:stroke-emerald-500 transition-all duration-500 ease-out motion-reduce:transition-none"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {rate}%
            </span>
            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
              Collected
            </span>
          </div>
        </div>

        <div className="flex-1 min-w-0 space-y-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
              <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 dark:bg-emerald-500 shrink-0" />
              Collected
            </span>
            <span className="font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
              {formatMWK(paid)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
              <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 shrink-0" />
              Outstanding
            </span>
            <span className="font-mono tabular-nums font-semibold text-amber-700 dark:text-amber-400">
              {formatMWK(balance)}
            </span>
          </div>
          <div className="pt-1 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
            <span className="text-slate-500 dark:text-slate-400">Total Billed</span>
            <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
              {formatMWK(billed)}
            </span>
          </div>
        </div>
      </div>

      {totalInvoices > 0 && (
        <div className="space-y-1.5">
          <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
            {paidPct > 0 && (
              <div
                style={{ width: mounted ? `${paidPct}%` : '0%' }}
                className="bg-emerald-600 dark:bg-emerald-500 transition-all duration-500 ease-out motion-reduce:transition-none"
              />
            )}
            {partialPct > 0 && (
              <div
                style={{ width: mounted ? `${partialPct}%` : '0%' }}
                className="bg-amber-500 transition-all duration-500 ease-out motion-reduce:transition-none"
              />
            )}
            {unpaidPct > 0 && (
              <div
                style={{ width: mounted ? `${unpaidPct}%` : '0%' }}
                className="bg-rose-500 transition-all duration-500 ease-out motion-reduce:transition-none"
              />
            )}
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
            <span className="text-emerald-700 dark:text-emerald-400">{paidCount} Paid</span>
            <span className="text-amber-700 dark:text-amber-400">{partialCount} Partial</span>
            <span className="text-rose-600 dark:text-rose-400">{unpaidCount} Unpaid</span>
          </div>
        </div>
      )}
    </div>
  );
};

interface FormBarRow {
  form: number;
  levelLabel: string;
  male: number;
  female: number;
  total: number;
  attMarked: number;
  attPresent: number;
}

export const EnrollmentGenderChart: React.FC<{ rows: FormBarRow[] }> = ({ rows }) => {
  const mounted = useMountedAnimation();
  const maxTotal = Math.max(1, ...rows.map((r) => r.total));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-4 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 dark:bg-emerald-500" />
          Boys
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-xs bg-sky-500 dark:bg-sky-400" />
          Girls
        </span>
      </div>

      <div className="space-y-2.5">
        {rows.map((r) => {
          const boysPct = (r.male / maxTotal) * 100;
          const girlsPct = (r.female / maxTotal) * 100;
          const attPct = r.attMarked > 0 ? Math.round((r.attPresent / r.attMarked) * 100) : null;
          return (
            <div key={r.form} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-100 w-14">
                    Form {r.form}
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono">{r.levelLabel}</span>
                </div>
                <div className="flex items-center gap-3 font-mono tabular-nums text-[11px]">
                  <span className="text-slate-600 dark:text-slate-300">
                    {r.male}B · {r.female}G
                  </span>
                  <span className="font-semibold text-slate-900 dark:text-white w-8 text-right">
                    {r.total}
                  </span>
                  {attPct !== null && (
                    <span className="text-emerald-700 dark:text-emerald-400 w-12 text-right">
                      {attPct}% att
                    </span>
                  )}
                </div>
              </div>
              <div className="h-3 w-full rounded-md bg-slate-100 dark:bg-slate-800/80 overflow-hidden flex gap-0.5">
                {boysPct > 0 && (
                  <div
                    style={{ width: mounted ? `${boysPct}%` : '0%' }}
                    className="h-full bg-emerald-600 dark:bg-emerald-500 transition-all duration-500 ease-out motion-reduce:transition-none"
                    title={`Form ${r.form} Boys: ${r.male}`}
                  />
                )}
                {girlsPct > 0 && (
                  <div
                    style={{ width: mounted ? `${girlsPct}%` : '0%' }}
                    className="h-full bg-sky-500 dark:bg-sky-400 transition-all duration-500 ease-out motion-reduce:transition-none"
                    title={`Form ${r.form} Girls: ${r.female}`}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const ManebGradeDistributionChart: React.FC<{ assessments: Assessment[] }> = ({
  assessments,
}) => {
  const mounted = useMountedAnimation();
  if (assessments.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
        No graded subjects available yet.
      </div>
    );
  }

  let distinction = 0; // gradePoint <= 2 (A or 1-2)
  let credit = 0; // gradePoint 3-6 (B-C or 3-6)
  let pass = 0; // gradePoint 7-8 (D or 7-8)
  let fail = 0; // gradePoint 9 (F or 9)

  for (const a of assessments) {
    if (a.gradePoint <= 2) distinction++;
    else if (a.gradePoint <= 6) credit++;
    else if (a.gradePoint <= 8) pass++;
    else fail++;
  }

  const total = assessments.length;
  const passRate = Math.round(((total - fail) / total) * 100);
  const meanScore =
    Math.round((assessments.reduce((sum, a) => sum + a.totalScore, 0) / total) * 10) / 10;

  const bands = [
    {
      label: 'Distinction (A / 1–2)',
      count: distinction,
      color: 'bg-emerald-600 dark:bg-emerald-500',
      text: 'text-emerald-700 dark:text-emerald-400',
    },
    {
      label: 'Credit (B–C / 3–6)',
      count: credit,
      color: 'bg-teal-500 dark:bg-teal-400',
      text: 'text-teal-700 dark:text-teal-300',
    },
    {
      label: 'Pass (D / 7–8)',
      count: pass,
      color: 'bg-amber-500 dark:bg-amber-400',
      text: 'text-amber-700 dark:text-amber-400',
    },
    {
      label: 'Fail (F / 9)',
      count: fail,
      color: 'bg-rose-500 dark:bg-rose-500',
      text: 'text-rose-600 dark:text-rose-400',
    },
  ];

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-4 font-mono tabular-nums">
          <span>
            <strong className="text-emerald-700 dark:text-emerald-400">{passRate}%</strong>{' '}
            <span className="text-slate-500 dark:text-slate-400">Pass Rate</span>
          </span>
          <span>
            <strong className="text-slate-900 dark:text-white">{meanScore}%</strong>{' '}
            <span className="text-slate-500 dark:text-slate-400">Mean Score</span>
          </span>
        </div>
        <span className="text-[11px] font-mono tabular-nums text-slate-400">{total} marks</span>
      </div>

      {/* Stacked Overview Strip */}
      <div className="h-3.5 w-full rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
        {bands.map((b) => {
          const pct = (b.count / total) * 100;
          if (pct <= 0) return null;
          return (
            <div
              key={b.label}
              style={{ width: mounted ? `${pct}%` : '0%' }}
              className={`${b.color} transition-all duration-500 ease-out motion-reduce:transition-none`}
              title={`${b.label}: ${b.count}`}
            />
          );
        })}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-0.5">
        {bands.map((b) => {
          const pct = Math.round((b.count / total) * 100);
          return (
            <div key={b.label} className="space-y-0.5">
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{b.label}</div>
              <div className={`text-sm font-bold font-mono tabular-nums ${b.text}`}>
                {b.count} <span className="text-[11px] font-normal text-slate-400">({pct}%)</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export interface SubjectChartItem {
  subject: string;
  ca1: number; // out of 20
  ca2: number; // out of 20
  exam: number; // out of 60
  total: number; // out of 100
  grade?: string;
}

export const SubjectComponentBarChart: React.FC<{
  items: SubjectChartItem[];
  maxItems?: number;
}> = ({ items, maxItems = 10 }) => {
  const mounted = useMountedAnimation();
  const visible = items.slice(0, maxItems);
  if (visible.length === 0) return null;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-end gap-3 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 dark:bg-emerald-500" />
          CA 1 (20%)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-xs bg-teal-500 dark:bg-teal-400" />
          CA 2 (20%)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-xs bg-sky-600 dark:bg-sky-500" />
          Summative (60%)
        </span>
      </div>

      <div className="space-y-2">
        {visible.map((item) => (
          <div key={item.subject} className="space-y-1">
            <div className="flex items-center justify-between text-xs gap-2">
              <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                {item.subject}
              </span>
              <span className="font-mono tabular-nums text-[11px] shrink-0">
                <span className="text-slate-500 dark:text-slate-400 mr-2">
                  {item.ca1.toFixed(0)}+{item.ca2.toFixed(0)}+{item.exam.toFixed(0)}
                </span>
                <strong className="text-slate-900 dark:text-white">{item.total.toFixed(1)}%</strong>
                {item.grade && (
                  <span className="ml-1.5 font-bold text-emerald-700 dark:text-emerald-400">
                    ({item.grade})
                  </span>
                )}
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
              {item.ca1 > 0 && (
                <div
                  style={{ width: mounted ? `${Math.min(20, item.ca1)}%` : '0%' }}
                  className="bg-emerald-600 dark:bg-emerald-500 transition-all duration-500 ease-out motion-reduce:transition-none"
                  title={`CA 1: ${item.ca1.toFixed(1)}/20`}
                />
              )}
              {item.ca2 > 0 && (
                <div
                  style={{ width: mounted ? `${Math.min(20, item.ca2)}%` : '0%' }}
                  className="bg-teal-500 dark:bg-teal-400 transition-all duration-500 ease-out motion-reduce:transition-none"
                  title={`CA 2: ${item.ca2.toFixed(1)}/20`}
                />
              )}
              {item.exam > 0 && (
                <div
                  style={{ width: mounted ? `${Math.min(60, item.exam)}%` : '0%' }}
                  className="bg-sky-600 dark:bg-sky-500 transition-all duration-500 ease-out motion-reduce:transition-none"
                  title={`Summative: ${item.exam.toFixed(1)}/60`}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export function summarizeSubjectComponents(assessments: Assessment[]): SubjectChartItem[] {
  const bySubj = new Map<
    string,
    { ca1Sum: number; ca2Sum: number; examSum: number; totalSum: number; count: number }
  >();
  for (const a of assessments) {
    const b = normalizeAssessmentComponents(a);
    const cur = bySubj.get(a.subject) || {
      ca1Sum: 0,
      ca2Sum: 0,
      examSum: 0,
      totalSum: 0,
      count: 0,
    };
    cur.ca1Sum += b.ca1Score;
    cur.ca2Sum += b.ca2Score;
    cur.examSum += b.examScore;
    cur.totalSum += a.totalScore;
    cur.count += 1;
    bySubj.set(a.subject, cur);
  }
  return Array.from(bySubj.entries())
    .map(([subject, s]) => ({
      subject,
      ca1: s.ca1Sum / s.count,
      ca2: s.ca2Sum / s.count,
      exam: s.examSum / s.count,
      total: s.totalSum / s.count,
    }))
    .sort((a, b) => b.total - a.total);
}
