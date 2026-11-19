import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Phone, TrendingDown } from 'lucide-react';
import { detectCaDownwardAlerts } from '../../school/malawi';
import { Assessment, Student, TermName } from '../../school/types';

interface CaDropAlertsPanelProps {
  assessments: Assessment[];
  students: Student[];
  term: TermName;
  onOpenGradebook?: () => void;
}

const THRESHOLD_OPTIONS = [10, 15, 20] as const;

export const CaDropAlertsPanel: React.FC<CaDropAlertsPanelProps> = ({
  assessments,
  students,
  term,
  onOpenGradebook,
}) => {
  const [minDropPct, setMinDropPct] = useState<number>(10);

  const studentById = useMemo(() => {
    const map = new Map<string, Student>();
    for (const s of students) {
      map.set(s.id, s);
    }
    return map;
  }, [students]);

  const { alerts, studentSummaries, pairedCount } = useMemo(
    () => detectCaDownwardAlerts(assessments, minDropPct),
    [assessments, minDropPct]
  );

  const criticalCount = alerts.filter((a) => a.severity === 'critical').length;
  const watchCount = alerts.filter((a) => a.severity === 'warning').length;

  return (
    <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle
              className={`w-4 h-4 shrink-0 ${
                alerts.length > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
              }`}
              aria-hidden="true"
            />
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Early-Warning CA Drop Alerts ({term})
            </h2>
          </div>
          {pairedCount > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-2.5 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              <span>{studentSummaries.length} student{studentSummaries.length === 1 ? '' : 's'} flagged</span>
              {criticalCount > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-rose-600 dark:text-rose-400 font-semibold">
                    {criticalCount} High Risk
                  </span>
                </>
              )}
              {watchCount > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-amber-700 dark:text-amber-400 font-semibold">
                    {watchCount} Watch
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
            {THRESHOLD_OPTIONS.map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => setMinDropPct(pct)}
                className={`min-h-[32px] px-2.5 rounded-lg text-[11px] font-mono font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  minDropPct === pct
                    ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {pct}%+ Drop
              </button>
            ))}
          </div>

          {onOpenGradebook && (
            <button
              type="button"
              onClick={onOpenGradebook}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Review in Gradebook</span>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {pairedCount === 0 ? (
        <div className="py-4 px-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 text-xs text-slate-500 dark:text-slate-400">
          Automated alerts trigger once students have both CA 1 and CA 2 scores entered for {term}.
        </div>
      ) : alerts.length === 0 ? (
        <div className="py-3.5 px-4 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-900/50 flex items-center gap-2.5 text-xs text-emerald-900 dark:text-emerald-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
          <span>
            No CA drops ≥{minDropPct}% detected across {pairedCount} paired CA 1 → CA 2 records.
          </span>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                <th className="py-2 pr-3 font-medium">Student</th>
                <th className="py-2 px-3 font-medium">Subject</th>
                <th className="py-2 px-3 font-medium text-right">CA 1 → CA 2</th>
                <th className="py-2 px-3 font-medium text-right">Trend</th>
                <th className="py-2 px-3 font-medium">Guardian Phone</th>
                <th className="py-2 pl-3 font-medium text-right">Risk Level</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {alerts.slice(0, 8).map((alert) => {
                const student = studentById.get(alert.studentId);
                return (
                  <tr key={alert.assessmentId} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {alert.studentName}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                        Form {alert.formLevel}{alert.stream}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-xs font-medium text-slate-700 dark:text-slate-200">
                      {alert.subject}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {alert.ca1Pct.toFixed(0)}% → {alert.ca2Pct.toFixed(0)}%
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-xs font-semibold text-rose-600 dark:text-rose-400 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        <TrendingDown className="w-3.5 h-3.5" aria-hidden="true" />
                        -{alert.dropPct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-xs font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {student?.guardianPhone ? (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="w-3 h-3 text-slate-400" aria-hidden="true" />
                          {student.guardianPhone}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pl-3 text-right text-xs font-semibold whitespace-nowrap">
                      <span
                        className={
                          alert.severity === 'critical'
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }
                      >
                        {alert.severity === 'critical' ? 'High Risk' : 'Watch'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {alerts.length > 8 && (
            <div className="pt-2.5 text-right text-xs text-slate-500 dark:text-slate-400 font-mono">
              Showing top 8 of {alerts.length} flagged subject trends
            </div>
          )}
        </div>
      )}
    </section>
  );
};
