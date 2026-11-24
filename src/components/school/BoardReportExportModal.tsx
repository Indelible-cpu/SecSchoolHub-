import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileDown, Loader2, X } from 'lucide-react';
import {
  buildBoardReportSummaryData,
  exportOverviewChartsToBoardPdf,
  readOverviewChartFilterSummaries,
  type BoardReportConfig,
  type BoardReportOrientation,
} from '../../school/boardPdfExport';
import { formatMWK } from '../../school/malawi';
import type {
  Assessment,
  AttendanceRecord,
  FeeInvoice,
  RolePermissions,
  School,
  Student,
  Teacher,
} from '../../school/types';

interface BoardReportExportModalProps {
  open: boolean;
  onClose: () => void;
  school: School;
  rolePermissions: RolePermissions;
  authorDisplayName: string;
  students: Student[];
  teachers: Teacher[];
  assessments: Assessment[];
  attendance: AttendanceRecord[];
  invoices: FeeInvoice[];
  todayIso: string;
  dashboardRootEl: HTMLElement | null;
}

export const BoardReportExportModal: React.FC<BoardReportExportModalProps> = ({
  open,
  onClose,
  school,
  rolePermissions,
  authorDisplayName,
  students,
  teachers,
  assessments,
  attendance,
  invoices,
  todayIso,
  dashboardRootEl,
}) => {
  const [reportTitle, setReportTitle] = useState(
    'School Board Academic & Performance Report'
  );
  const [meetingDate, setMeetingDate] = useState(todayIso);
  const [preparedBy, setPreparedBy] = useState(
    authorDisplayName || rolePermissions.roleLabel
  );
  const [orientation, setOrientation] = useState<BoardReportOrientation>('landscape');
  const [executiveNotes, setExecutiveNotes] = useState('');

  const [includeTermTrends, setIncludeTermTrends] = useState(true);
  const [includeClassTrends, setIncludeClassTrends] = useState(true);
  const [includeAttendanceHeatmap, setIncludeAttendanceHeatmap] = useState(
    rolePermissions.canReadAttendance
  );
  const [includeGradeAndSubjects, setIncludeGradeAndSubjects] = useState(true);
  const [includeEnrollmentAndMsce, setIncludeEnrollmentAndMsce] = useState(true);
  const [includeFinancialSummary, setIncludeFinancialSummary] = useState(
    rolePermissions.canReadFees
  );

  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setExportStatus(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isExporting) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, isExporting, onClose]);

  const filterSummaries = useMemo(
    () => (open ? readOverviewChartFilterSummaries(dashboardRootEl) : null),
    [open, dashboardRootEl]
  );

  const summaryData = useMemo(
    () =>
      buildBoardReportSummaryData({
        school,
        students,
        teachers,
        assessments,
        attendance,
        invoices,
        todayIso,
        includeFinancialSummary: rolePermissions.canReadFees && includeFinancialSummary,
      }),
    [
      school,
      students,
      teachers,
      assessments,
      attendance,
      invoices,
      todayIso,
      rolePermissions.canReadFees,
      includeFinancialSummary,
    ]
  );

  if (!open) return null;

  const hasAnySectionSelected =
    includeTermTrends ||
    includeClassTrends ||
    (rolePermissions.canReadAttendance && includeAttendanceHeatmap) ||
    includeGradeAndSubjects ||
    includeEnrollmentAndMsce ||
    (rolePermissions.canReadFees && includeFinancialSummary);

  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasAnySectionSelected || isExporting) return;

    setIsExporting(true);
    setExportStatus(null);

    try {
      const config: BoardReportConfig = {
        reportTitle,
        meetingDate,
        preparedBy,
        orientation,
        executiveNotes,
        sections: {
          includeTermTrends,
          includeClassTrends,
          includeAttendanceHeatmap:
            rolePermissions.canReadAttendance && includeAttendanceHeatmap,
          includeGradeAndSubjects,
          includeEnrollmentAndMsce,
          includeFinancialSummary:
            rolePermissions.canReadFees && includeFinancialSummary,
        },
      };

      const result = await exportOverviewChartsToBoardPdf({
        school,
        config,
        summary: summaryData,
        dashboardRootEl,
      });

      setExportStatus({
        type: 'success',
        message: `Exported ${result.fileName} (${result.pageCount} page${result.pageCount === 1 ? '' : 's'}, ${result.capturedChartsCount} live chart${result.capturedChartsCount === 1 ? '' : 's'} captured).`,
      });
    } catch (err) {
      setExportStatus({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Unable to generate the printable board PDF right now.',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const latestMean = summaryData.termTrends.latestPoint?.aggregateMean;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="board-pdf-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-3 sm:p-5"
    >
      <div className="w-full max-w-3xl rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 shadow-xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2
              id="board-pdf-modal-title"
              className="text-base font-semibold text-slate-900 dark:text-white truncate"
            >
              Export Board Meeting Performance PDF
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {school.name} · {school.currentTerm} ({school.academicYear})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            aria-label="Close board report export dialog"
            className="min-h-[38px] min-w-[38px] rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleExport} className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Executive KPI Preview */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 p-3">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Enrollment</div>
              <div className="mt-1 text-base font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {summaryData.activeStudentsCount}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 p-3">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Aggregate Mean</div>
              <div className="mt-1 text-base font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                {latestMean !== null && latestMean !== undefined ? `${latestMean.toFixed(1)}%` : '—'}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 p-3">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Term Pass Rate</div>
              <div className="mt-1 text-base font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {summaryData.termAssessmentsCount > 0
                  ? `${summaryData.gradeDistribution.passRate}%`
                  : '—'}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 p-3">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {rolePermissions.canReadFees && summaryData.feeSummary
                  ? 'Fee Collection'
                  : 'Term Attendance'}
              </div>
              <div className="mt-1 text-base font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {rolePermissions.canReadFees && summaryData.feeSummary
                  ? `${summaryData.feeSummary.collectionRate}%`
                  : summaryData.attendanceOverview.termMeanRate !== null
                  ? `${summaryData.attendanceOverview.termMeanRate}%`
                  : '—'}
              </div>
            </div>
          </div>

          {/* Meeting Metadata */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Board Report Title
              </span>
              <input
                type="text"
                value={reportTitle}
                onChange={(e) => setReportTitle(e.target.value)}
                required
                className="w-full min-h-[40px] px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Board Meeting Date
              </span>
              <input
                type="date"
                value={meetingDate}
                onChange={(e) => setMeetingDate(e.target.value)}
                required
                className="w-full min-h-[40px] px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm font-mono text-slate-900 dark:text-slate-100"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Prepared By
              </span>
              <input
                type="text"
                value={preparedBy}
                onChange={(e) => setPreparedBy(e.target.value)}
                className="w-full min-h-[40px] px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100"
              />
            </label>
          </div>

          {/* Page Orientation */}
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Page Layout
            </span>
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setOrientation('landscape')}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  orientation === 'landscape'
                    ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                A4 Landscape (Wide Charts)
              </button>
              <button
                type="button"
                onClick={() => setOrientation('portrait')}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  orientation === 'portrait'
                    ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                A4 Portrait
              </button>
            </div>
          </div>

          {/* Live Charts & Sections Selection */}
          <div className="space-y-2.5">
            <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Dashboard Charts &amp; Sections to Include
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800">
              <label className="flex items-start gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                <input
                  type="checkbox"
                  checked={includeTermTrends}
                  onChange={(e) => setIncludeTermTrends(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-emerald-700"
                />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Term-over-Term Aggregate Performance Chart &amp; Table
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
                    {filterSummaries?.['term-trend']}
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                <input
                  type="checkbox"
                  checked={includeClassTrends}
                  onChange={(e) => setIncludeClassTrends(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-emerald-700"
                />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Class-Wide Performance Trends (CA 1 · CA 2 · Summative)
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
                    {filterSummaries?.['class-trend']}
                  </div>
                </div>
              </label>

              {rolePermissions.canReadAttendance && (
                <label className="flex items-start gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                  <input
                    type="checkbox"
                    checked={includeAttendanceHeatmap}
                    onChange={(e) => setIncludeAttendanceHeatmap(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-emerald-700"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Student Attendance Frequency Heatmap (D3)
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
                      {filterSummaries?.['attendance-heatmap']}
                    </div>
                  </div>
                </label>
              )}

              <label className="flex items-start gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                <input
                  type="checkbox"
                  checked={includeGradeAndSubjects}
                  onChange={(e) => setIncludeGradeAndSubjects(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-emerald-700"
                />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    MANEB Grade Distribution &amp; Subject Mean Breakdown
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                    {summaryData.termAssessmentsCount} assessments across{' '}
                    {summaryData.subjectRows.length} subjects
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                <input
                  type="checkbox"
                  checked={includeEnrollmentAndMsce}
                  onChange={(e) => setIncludeEnrollmentAndMsce(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-emerald-700"
                />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Form 1–4 Enrollment &amp; MSCE Standing Summary
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                    {summaryData.activeStudentsCount} active students ·{' '}
                    {summaryData.msceTopRows.length} MSCE ranked entries
                  </div>
                </div>
              </label>

              {rolePermissions.canReadFees && (
                <label className="flex items-start gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                  <input
                    type="checkbox"
                    checked={includeFinancialSummary}
                    onChange={(e) => setIncludeFinancialSummary(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-emerald-700"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Term Fee Collection Summary
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                      {summaryData.feeSummary
                        ? `${formatMWK(summaryData.feeSummary.totalPaid)} collected (${summaryData.feeSummary.collectionRate}%)`
                        : 'Term fee billing and collection totals'}
                    </div>
                  </div>
                </label>
              )}
            </div>
          </div>

          {/* Executive Board Notes */}
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Board Briefing Notes / Action Items (Optional)
            </span>
            <textarea
              rows={2}
              value={executiveNotes}
              onChange={(e) => setExecutiveNotes(e.target.value)}
              placeholder="e.g., Form 4 mock exam remediation plan, Science laboratory equipment request, or attendance follow-up..."
              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100"
            />
          </label>

          {exportStatus && (
            <div
              role="status"
              className={`rounded-xl px-3.5 py-2.5 text-xs flex items-center gap-2 border ${
                exportStatus.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300'
                  : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300'
              }`}
            >
              {exportStatus.type === 'success' && (
                <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
              <span>{exportStatus.message}</span>
            </div>
          )}

          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Captures the currently filtered Overview charts with print-safe light styling and board sign-off lines.
            </p>
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={onClose}
                disabled={isExporting}
                className="min-h-[40px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={!hasAnySectionSelected || isExporting}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isExporting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <FileDown className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{isExporting ? 'Preparing PDF...' : 'Download Board PDF'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
