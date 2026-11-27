import React, { useMemo } from 'react';
import {
  ArrowRight,
  Award,
  Banknote,
  BookOpen,
  Calendar,
  FileDown,
  GraduationCap,
  Megaphone,
  MessageSquareText,
  Printer,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  calculateTermReportSummary,
  formatMWK,
  formatSchoolTypeLabel,
  TermReportCardSummary,
  TERMS,
} from '../../school/malawi';
import {
  BuiltStudentReportCard,
  computeSubjectCaDeltaPct,
} from '../../school/reportCardTemplates';
import { isValidStudentPhotoDataUrl } from '../../school/studentPhotoHelper';
import {
  Assessment,
  LibraryLoan,
  SchoolAnnouncement,
  StudentFeeSubmission,
  StudentPortal,
  StudentPortalFeeInvoice,
  StudentReportRemark,
  TermName,
} from '../../school/types';
import { SubjectComponentBarChart } from './AnalyticsCharts';
import { StudentPerformanceTrends } from './StudentPerformanceTrends';

export interface StudentPortalDashboardProps {
  portal: StudentPortal;
  assessments: Assessment[];
  summary: TermReportCardSummary;
  selectedTerm: TermName;
  termCounts: Record<TermName, number>;
  fallbackTermWithMarks: TermName | null;
  reportCardPayload: BuiltStudentReportCard | null;
  activeTermRemark: StudentReportRemark | null;
  announcements: SchoolAnnouncement[];
  libraryLoans: LibraryLoan[];
  libraryAlerts: { dueSoonLoans: LibraryLoan[]; overdueLoans: LibraryLoan[] };
  activeBorrowedLoansCount: number;
  readyReservationsCount: number;
  offlineSavedCount: number;
  digitalResourcesCount: number;
  feeInvoices: StudentPortalFeeInvoice[];
  feeSubmissions: StudentFeeSubmission[];
  feeTotals: { billed: number; paid: number; balance: number; pendingProofs: number };
  loadingResults: boolean;
  pdfFeedback: { type: 'success' | 'error'; text: string } | null;
  onSelectTerm: (term: TermName) => void;
  onDownloadPdf: () => void;
  onNavigateTab: (tab: 'results' | 'library' | 'fees') => void;
}

export const StudentPortalDashboard: React.FC<StudentPortalDashboardProps> = ({
  portal,
  assessments,
  summary,
  selectedTerm,
  termCounts,
  fallbackTermWithMarks,
  reportCardPayload,
  activeTermRemark,
  announcements,
  libraryLoans,
  libraryAlerts,
  activeBorrowedLoansCount,
  readyReservationsCount,
  offlineSavedCount,
  digitalResourcesCount,
  feeInvoices,
  feeSubmissions,
  feeTotals,
  loadingResults,
  pdfFeedback,
  onSelectTerm,
  onDownloadPdf,
  onNavigateTab,
}) => {
  const hasLogo = Boolean(portal.logoDataUrl && isValidStudentPhotoDataUrl(portal.logoDataUrl));

  // Compute term-over-term comparison relative to the previous graded term
  const termComparison = useMemo(() => {
    const ordered = TERMS.map((term) => {
      const items = assessments.filter((a) => a.term === term);
      if (items.length === 0) return null;
      return {
        term,
        summary: calculateTermReportSummary(portal.formLevel, items),
      };
    }).filter((x): x is { term: TermName; summary: TermReportCardSummary } => x !== null);

    const activeIdx = ordered.findIndex((o) => o.term === selectedTerm);
    if (activeIdx <= 0) {
      return {
        previousTerm: null as TermName | null,
        deltaPct: null as number | null,
        gradedTermsCount: ordered.length,
      };
    }

    const prev = ordered[activeIdx - 1];
    const curr = ordered[activeIdx];
    const deltaPct = Math.round((curr.summary.weightedAverage - prev.summary.weightedAverage) * 10) / 10;
    return {
      previousTerm: prev.term,
      deltaPct,
      gradedTermsCount: ordered.length,
    };
  }, [assessments, portal.formLevel, selectedTerm]);

  const subjectComments = useMemo(
    () =>
      summary.rows
        .filter((r) => Boolean(r.assessment.teacherComment && r.assessment.teacherComment.trim()))
        .map((r) => ({
          id: r.assessment.id,
          subject: r.assessment.subject,
          totalScore: r.totalScore,
          grade: r.grade,
          gradePoint: r.gradePoint,
          comment: r.assessment.teacherComment!.trim(),
        })),
    [summary.rows]
  );

  const hasPublishedFormRemark = Boolean(activeTermRemark?.formTeacherRemark?.trim());
  const hasPublishedHeadRemark = Boolean(activeTermRemark?.headTeacherRemark?.trim());
  const nextTermOpens = (
    activeTermRemark?.nextTermOpens ||
    reportCardPayload?.nextTermOpens ||
    ''
  ).trim();

  return (
    <div className="space-y-6">
      {/* 1. Term Selector & Primary Actions */}
      <section
        aria-label="Academic term controls"
        className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-3.5 flex flex-wrap items-center justify-between gap-3 print:hidden"
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            Academic Term:
          </span>
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
            {TERMS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onSelectTerm(t)}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  selectedTerm === t
                    ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {t}
                {termCounts[t] > 0 ? ` (${termCounts[t]})` : ''}
              </button>
            ))}
          </div>
          {summary.subjectCount === 0 && fallbackTermWithMarks && (
            <button
              type="button"
              onClick={() => onSelectTerm(fallbackTermWithMarks)}
              className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
            >
              Jump to {fallbackTermWithMarks} ({termCounts[fallbackTermWithMarks]} subjects) →
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            disabled={summary.rows.length === 0}
            className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Print Report</span>
          </button>
          <button
            type="button"
            onClick={onDownloadPdf}
            disabled={summary.rows.length === 0}
            className="inline-flex items-center gap-1.5 min-h-[36px] px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileDown className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Download PDF Report Card</span>
          </button>
        </div>
      </section>

      {pdfFeedback && (
        <div
          role="status"
          className={`rounded-xl px-4 py-2.5 text-xs font-medium border print:hidden ${
            pdfFeedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/60 text-emerald-800 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/60 text-rose-800 dark:text-rose-300'
          }`}
        >
          {pdfFeedback.text}
        </div>
      )}

      {/* 2. Verified Academic KPI Strip */}
      <section aria-label="Academic standing summary" className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-4">
          <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Term Weighted Average</span>
            <Award className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {summary.subjectCount > 0 ? `${summary.weightedAverage.toFixed(1)}%` : '—'}
          </div>
          <div className="mt-1 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {summary.subjectCount > 0
              ? `CA1 ${summary.ca1Average.toFixed(1)} · CA2 ${summary.ca2Average.toFixed(1)} · Exam ${summary.summativeAverage.toFixed(1)}`
              : `No ${selectedTerm} marks recorded`}
          </div>
        </div>

        <div className="rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {summary.system} Standing &amp; Grade
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-slate-900 dark:text-white">
              {summary.overallGrade}
            </span>
            <span
              className={`text-sm font-semibold ${
                summary.standing.outcome === 'Pass'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : summary.standing.outcome === 'Fail'
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {summary.standing.outcome}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
            {summary.overallRemark} · {summary.subjectCount} graded
          </div>
        </div>

        <div className="rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-900/60 p-4">
          <div className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
            {portal.formLevel >= 3 ? 'MSCE Best 6 Aggregate' : 'JCE Subjects Passed'}
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-emerald-950 dark:text-emerald-200">
            {summary.subjectCount === 0
              ? '—'
              : portal.formLevel >= 3
              ? summary.standing.bestSixPoints !== null
                ? `${summary.standing.bestSixPoints} pts`
                : `${summary.subjectCount}/6`
              : `${summary.passedSubjectCount}/${summary.subjectCount}`}
          </div>
          <div className="mt-1 text-[11px] font-mono text-emerald-800 dark:text-emerald-400">
            {portal.formLevel >= 3 && summary.meanManebPoint !== null
              ? `Mean Pt ${summary.meanManebPoint.toFixed(1)} · ${summary.creditSubjectCount} credits`
              : `${summary.creditSubjectCount} credit pass${summary.creditSubjectCount === 1 ? '' : 'es'}`}
          </div>
        </div>

        <div className="rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-4">
          <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Term-Over-Term Delta</span>
            {termComparison.deltaPct !== null && termComparison.deltaPct < 0 ? (
              <TrendingDown className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" aria-hidden="true" />
            ) : (
              <TrendingUp className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
            )}
          </div>
          <div
            className={`mt-1.5 text-2xl font-bold font-mono tabular-nums ${
              termComparison.deltaPct === null
                ? 'text-slate-900 dark:text-white'
                : termComparison.deltaPct > 0
                ? 'text-emerald-700 dark:text-emerald-400'
                : termComparison.deltaPct < 0
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-slate-900 dark:text-white'
            }`}
          >
            {termComparison.deltaPct === null
              ? 'Baseline'
              : `${termComparison.deltaPct > 0 ? '+' : ''}${termComparison.deltaPct.toFixed(1)}%`}
          </div>
          <div className="mt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
            {termComparison.previousTerm
              ? `vs ${termComparison.previousTerm}`
              : `${termComparison.gradedTermsCount} graded term${termComparison.gradedTermsCount === 1 ? '' : 's'}`}
          </div>
        </div>
      </section>

      {/* 3. Detailed Official Academic Report Card */}
      <section
        aria-label="Detailed academic report card"
        className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden"
      >
        {/* School Letterhead & Candidate Profile Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            {hasLogo ? (
              <img
                src={portal.logoDataUrl}
                alt={`${portal.schoolName} crest`}
                className="w-11 h-11 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0"
              />
            ) : (
              <div className="w-11 h-11 rounded-full border border-sky-400/30 bg-white dark:bg-slate-900 overflow-hidden flex items-center justify-center shrink-0 shadow-xs">
                <img src="/brand-logo.png" alt="SecSchoolHub" className="w-full h-full object-contain" />
              </div>
              <div className="hidden">
                <GraduationCap className="w-5 h-5" aria-hidden="true" />
              </div>
            )}
            <div className="min-w-0">
              <div className="text-[11px] font-mono uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-semibold">
                Official Academic Report Card · {selectedTerm} ({portal.academicYear})
              </div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white truncate">
                {portal.schoolName}
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 truncate">
                {portal.schoolDistrict} · {formatSchoolTypeLabel(portal.schoolType)}
                {portal.motto ? ` · "${portal.motto}"` : ''}
              </p>
            </div>
          </div>

          <div className="text-left sm:text-right text-xs space-y-0.5 font-mono">
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              {portal.studentName}
            </div>
            <div className="text-slate-600 dark:text-slate-400 tabular-nums">
              Adm {portal.admissionNo} · Form {portal.formLevel}
              {portal.stream} · {portal.boardingStatus}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Reg Code {portal.registrationCode} · Weights: CA1 20% + CA2 20% + Exam 60%
            </div>
          </div>
        </div>

        {/* Report Table */}
        {loadingResults ? (
          <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
            Loading verified report card records...
          </div>
        ) : summary.rows.length === 0 ? (
          <div className="py-12 px-6 text-center space-y-3 text-sm text-slate-500 dark:text-slate-400">
            <div>
              No subject marks have been published for {selectedTerm} ({portal.academicYear}).
            </div>
            {fallbackTermWithMarks && (
              <button
                type="button"
                onClick={() => onSelectTerm(fallbackTermWithMarks)}
                className="inline-flex items-center gap-1.5 min-h-[36px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
              >
                <span>
                  Open {fallbackTermWithMarks} Report Card ({termCounts[fallbackTermWithMarks]} subjects)
                </span>
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                    <th className="py-3 px-4 font-medium">Subject &amp; Teacher Note</th>
                    <th className="py-3 px-3 font-medium text-right">CA 1 (20%)</th>
                    <th className="py-3 px-3 font-medium text-right">CA 2 (20%)</th>
                    <th className="py-3 px-3 font-medium text-right">CA Δ</th>
                    <th className="py-3 px-3 font-medium text-right">Summative (60%)</th>
                    <th className="py-3 px-3 font-medium text-right">Total (100%)</th>
                    <th className="py-3 px-3 font-medium text-right">Pts</th>
                    <th className="py-3 px-3 font-medium text-right">Grade</th>
                    <th className="py-3 px-4 font-medium text-right">Remark</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {summary.rows.map((r) => {
                    const a = r.assessment;
                    const caDelta = computeSubjectCaDeltaPct(r);
                    return (
                      <tr key={a.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {a.subject}
                          </div>
                          {a.teacherComment && (
                            <div className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400 max-w-xs">
                              {a.teacherComment}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums">
                          {r.hasCa1 ? (
                            <div>
                              <div className="text-slate-900 dark:text-slate-100">
                                {r.ca1Score.toFixed(1)}
                              </div>
                              {typeof a.ca1Raw === 'number' &&
                                typeof a.ca1Max === 'number' &&
                                a.ca1Max > 0 && (
                                  <div className="text-[10px] text-slate-400">
                                    {a.ca1Raw}/{a.ca1Max}
                                  </div>
                                )}
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums">
                          {r.hasCa2 ? (
                            <div>
                              <div className="text-slate-900 dark:text-slate-100">
                                {r.ca2Score.toFixed(1)}
                              </div>
                              {typeof a.ca2Raw === 'number' &&
                                typeof a.ca2Max === 'number' &&
                                a.ca2Max > 0 && (
                                  <div className="text-[10px] text-slate-400">
                                    {a.ca2Raw}/{a.ca2Max}
                                  </div>
                                )}
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td
                          className={`py-3 px-3 text-right font-mono tabular-nums text-xs font-semibold ${
                            caDelta === null
                              ? 'text-slate-400'
                              : caDelta >= 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : caDelta <= -10
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {caDelta === null
                            ? '—'
                            : `${caDelta > 0 ? '+' : ''}${caDelta.toFixed(0)}%`}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums">
                          {r.hasExam ? (
                            <div>
                              <div className="text-slate-900 dark:text-slate-100">
                                {r.examScore.toFixed(1)}
                              </div>
                              {typeof a.examRaw === 'number' &&
                                typeof a.examMax === 'number' &&
                                a.examMax > 0 && (
                                  <div className="text-[10px] text-slate-400">
                                    {a.examRaw}/{a.examMax}
                                  </div>
                                )}
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                          {r.totalScore.toFixed(1)}%
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          {r.gradePoint}
                        </td>
                        <td
                          className={`py-3 px-3 text-right font-mono font-bold ${
                            r.gradePoint <= 6
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : r.gradePoint <= 8
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {r.grade}
                        </td>
                        <td className="py-3 px-4 text-right text-xs text-slate-600 dark:text-slate-400">
                          {r.remark}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-900/70 font-semibold text-xs">
                    <td className="py-3 px-4 text-slate-900 dark:text-white">
                      Term Average ({summary.subjectCount} Subjects)
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {summary.ca1Average.toFixed(1)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {summary.ca2Average.toFixed(1)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-slate-400">—</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {summary.summativeAverage.toFixed(1)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-white">
                      {summary.weightedAverage.toFixed(1)}%
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                      {summary.meanManebPoint !== null ? summary.meanManebPoint.toFixed(1) : '—'}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                      {summary.overallGrade}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-700 dark:text-slate-200">
                      {summary.overallRemark}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Grading Key + Pending CA note + Next Term Opens */}
            <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400">
              <span className="font-mono">
                {portal.formLevel <= 2
                  ? 'JCE Key: A (80–100%) · B (70–79%) · C (60–69%) · D (50–59%) · F (0–49%)'
                  : 'MSCE Key: 1–2 (75–100% Dist.) · 3 (70–74% Strong Cr.) · 4–6 (55–69% Credit) · 7–8 (40–54% Pass) · 9 (0–39% Fail)'}
              </span>
              {nextTermOpens && (
                <span className="inline-flex items-center gap-1.5 font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                  <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                  Next Term Opens: {nextTermOpens}
                </span>
              )}
            </div>

            {/* Subject Score Chart */}
            <div className="p-5 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Subject Composition (CA 1 · CA 2 · Summative Exam)
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigateTab('results')}
                  className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer print:hidden"
                >
                  Open Full Report Sheet →
                </button>
              </div>
              <SubjectComponentBarChart
                items={summary.rows.map((r) => ({
                  subject: r.assessment.subject,
                  ca1: r.ca1Score,
                  ca2: r.ca2Score,
                  exam: r.examScore,
                  total: r.totalScore,
                  grade: r.grade,
                }))}
                maxItems={12}
              />
            </div>
          </>
        )}
      </section>

      {/* 4. Term-Over-Term Performance Trends */}
      <section
        aria-label="Term-over-term academic trends"
        className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5"
      >
        {assessments.length > 0 ? (
          <StudentPerformanceTrends
            studentId={portal.studentId}
            studentName={portal.studentName}
            formLevel={portal.formLevel}
            academicYear={portal.academicYear}
            assessments={assessments}
          />
        ) : (
          <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
            Term-over-term progression charts will appear automatically once term assessments are published.
          </div>
        )}
      </section>

      {/* 5. Teacher Comments & Official Remarks */}
      <section
        aria-label="Teacher comments and remarks"
        className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <MessageSquareText
              className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0"
              aria-hidden="true"
            />
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Teacher Comments &amp; {selectedTerm} Remarks
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {hasPublishedFormRemark || hasPublishedHeadRemark
                  ? 'Official remarks published by your school faculty'
                  : 'Academic standing remarks derived from your verified subject scores'}
              </p>
            </div>
          </div>
          {nextTermOpens && (
            <span className="text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-400">
              Next Term Opens: {nextTermOpens}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                Form Teacher Remark
              </span>
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                {activeTermRemark?.formTeacherName
                  ? activeTermRemark.formTeacherName
                  : hasPublishedFormRemark
                  ? 'Published'
                  : 'Academic summary'}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">
              {reportCardPayload?.formTeacherRemark ||
                'Awaiting subject assessment records for this academic term.'}
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                Head Teacher Remark
              </span>
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                {activeTermRemark?.headTeacherName
                  ? activeTermRemark.headTeacherName
                  : hasPublishedHeadRemark
                  ? 'Published'
                  : 'Academic summary'}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">
              {reportCardPayload?.headTeacherRemark ||
                'Please ensure all continuous assessments and exams are submitted.'}
            </p>
          </div>
        </div>

        {/* Per-Subject Teacher Notes */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Subject Teacher Comments ({subjectComments.length})
            </h3>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">{selectedTerm}</span>
          </div>

          {subjectComments.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No individual subject teacher notes have been added for {selectedTerm} yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {subjectComments.map((item) => (
                <div
                  key={item.id}
                  className="py-2.5 first:pt-1 last:pb-0 flex flex-col sm:flex-row sm:items-baseline justify-between gap-1.5"
                >
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {item.subject}:
                    </span>{' '}
                    <span className="text-xs text-slate-700 dark:text-slate-300">
                      {item.comment}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                    {item.totalScore.toFixed(1)}% · Grade {item.grade}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 6. Campus Notices, Library & MWK Fees Overview */}
      <section aria-label="Campus services and announcements" className="grid grid-cols-1 lg:grid-cols-3 gap-4 print:hidden">
        {/* Announcements */}
        <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Announcements{' '}
                <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  ({announcements.length})
                </span>
              </h2>
            </div>
          </div>
          {announcements.length === 0 ? (
            <div className="py-4 text-xs text-slate-500 dark:text-slate-400">
              No school announcements at this time.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {announcements.slice(0, 3).map((item) => (
                <article key={item.id} className="py-2.5 first:pt-1 last:pb-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {item.title}
                    </h3>
                    <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                      {item.publishedDate}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
                    {item.message}
                  </p>
                </article>
              ))}
            </div>
          )}
        </div>

        {/* School Library Summary */}
        <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                School Library
              </span>
              <BookOpen className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {activeBorrowedLoansCount} Checked Out
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-300 font-mono">
              {offlineSavedCount} saved offline · {digitalResourcesCount} digital books
            </div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {libraryAlerts.overdueLoans.length > 0
                ? `${libraryAlerts.overdueLoans.length} overdue return${libraryAlerts.overdueLoans.length === 1 ? '' : 's'}`
                : libraryAlerts.dueSoonLoans.length > 0
                ? `${libraryAlerts.dueSoonLoans.length} due within 48h`
                : readyReservationsCount > 0
                ? `${readyReservationsCount} reserved ready for pickup`
                : `${libraryLoans.length} total loan records`}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('library')}
            className="inline-flex items-center justify-between min-h-[38px] px-3.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
          >
            <span>Open Library &amp; Offline Books</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>

        {/* School Fees (MWK) Summary */}
        <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                School Fees (MWK)
              </span>
              <Banknote className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
            </div>
            <div
              className={`text-2xl font-bold font-mono tabular-nums ${
                feeTotals.balance > 0
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-emerald-700 dark:text-emerald-400'
              }`}
            >
              {feeInvoices.length > 0 ? formatMWK(feeTotals.balance) : '—'}
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-300 font-mono">
              {feeInvoices.length > 0
                ? `Paid ${formatMWK(feeTotals.paid)} of ${formatMWK(feeTotals.billed)}`
                : 'No term fee invoices billed yet'}
            </div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {feeSubmissions.length > 0
                ? `${feeSubmissions.length} proof${feeSubmissions.length === 1 ? '' : 's'} uploaded${
                    feeTotals.pendingProofs > 0 ? ` · ${feeTotals.pendingProofs} pending` : ''
                  }`
                : 'Upload bank/mobile money slips in Fees'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('fees')}
            className="inline-flex items-center justify-between min-h-[38px] px-3.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
          >
            <span>Open Fees &amp; Upload Proof</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  );
};
