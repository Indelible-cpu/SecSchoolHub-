import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import {
  Award,
  Building2,
  FileDown,
  GraduationCap,
  KeyRound,
  LogOut,
  Moon,
  Printer,
  Sun,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { calculateTermReportSummary, TERMS } from '../../school/malawi';
import { downloadStudentTermReportCardPdf } from '../../school/pdfReports';
import { Assessment, School, Student, StudentPortal, TermName } from '../../school/types';
import { PWAInstallButton } from '../PWAInstallButton';
import { OfflineIndicator } from '../OfflineIndicator';
import { SubjectComponentBarChart } from './AnalyticsCharts';

interface StudentResultsPortalProps {
  registrationCode: string;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onSignOut: () => void;
  hasAdminWorkspace?: boolean;
  onSwitchToAdmin?: () => void;
}

export const StudentResultsPortal: React.FC<StudentResultsPortalProps> = ({
  registrationCode,
  theme,
  onToggleTheme,
  onSignOut,
  hasAdminWorkspace = false,
  onSwitchToAdmin,
}) => {
  const [portalLoading, setPortalLoading] = useState(true);
  const [activePortal, setActivePortal] = useState<StudentPortal | null>(null);
  const [selectedTerm, setSelectedTerm] = useState<TermName>('Term 2');
  const [termInitializedForCode, setTermInitializedForCode] = useState<string>('');
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loadingResults, setLoadingResults] = useState(true);

  useEffect(() => {
    if (!registrationCode) {
      setActivePortal(null);
      setPortalLoading(false);
      return;
    }

    setPortalLoading(true);
    const portalRef = doc(db, 'studentPortals', registrationCode);
    const unsub = onSnapshot(
      portalRef,
      (snap) => {
        if (snap.exists()) {
          const portal = { id: snap.id, ...(snap.data() as Omit<StudentPortal, 'id'>) };
          setActivePortal(portal);
        } else {
          setActivePortal(null);
        }
        setPortalLoading(false);
      },
      (err) => {
        setPortalLoading(false);
        handleFirestoreError(err, OperationType.GET, `studentPortals/${registrationCode}`);
      }
    );

    return () => unsub();
  }, [registrationCode]);

  useEffect(() => {
    if (activePortal && termInitializedForCode !== activePortal.registrationCode) {
      setSelectedTerm(activePortal.currentTerm);
      setTermInitializedForCode(activePortal.registrationCode);
    }
  }, [activePortal, termInitializedForCode]);

  useEffect(() => {
    if (!registrationCode || !activePortal) {
      setAssessments([]);
      setLoadingResults(false);
      return;
    }

    setLoadingResults(true);
    const resultsRef = collection(db, 'studentPortals', registrationCode, 'results');
    const unsub = onSnapshot(
      resultsRef,
      (snap) => {
        const docs = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Assessment, 'id'>) }))
          .filter((a) => a.studentId === activePortal.studentId);
        setAssessments(docs);
        setLoadingResults(false);
      },
      (err) => {
        setLoadingResults(false);
        handleFirestoreError(
          err,
          OperationType.LIST,
          `studentPortals/${registrationCode}/results`
        );
      }
    );

    return () => unsub();
  }, [activePortal, registrationCode]);

  const termAssessments = useMemo(
    () => assessments.filter((a) => a.term === selectedTerm),
    [assessments, selectedTerm]
  );

  const summary = useMemo(() => {
    if (!activePortal) return null;
    return calculateTermReportSummary(activePortal.formLevel, termAssessments);
  }, [activePortal, termAssessments]);

  const handleDownloadPdf = () => {
    if (!activePortal || !summary || summary.rows.length === 0) return;
    const viewSchool: School = {
      id: activePortal.schoolId,
      ownerId: activePortal.ownerId,
      name: activePortal.schoolName,
      district: activePortal.schoolDistrict,
      schoolType: activePortal.schoolType,
      motto: activePortal.motto,
      academicYear: activePortal.academicYear,
      currentTerm: activePortal.currentTerm,
      defaultTuitionMWK: 0,
      defaultGpfMWK: 0,
      defaultExamFeeMWK: 0,
    };
    const viewStudent: Student = {
      id: activePortal.studentId,
      ownerId: activePortal.ownerId,
      admissionNo: activePortal.admissionNo,
      fullName: activePortal.studentName,
      gender: 'Female',
      formLevel: activePortal.formLevel,
      stream: activePortal.stream,
      boardingStatus: activePortal.boardingStatus,
      guardianName: '',
      guardianPhone: '',
      registrationCode: activePortal.registrationCode,
      status: activePortal.status,
    };
    downloadStudentTermReportCardPdf({
      school: viewSchool,
      student: viewStudent,
      term: selectedTerm,
      summary,
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F8FA] dark:bg-[#0D1117] text-slate-900 dark:text-slate-100">
      <header className="sticky top-0 z-30 h-16 bg-white/95 dark:bg-[#161B22]/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-5xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
              <GraduationCap className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold tracking-tight text-slate-900 dark:text-white truncate">
                {activePortal ? activePortal.schoolName : 'MalawiSec Student Portal'}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate font-mono">
                Student Exam Results · Code: {registrationCode}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {hasAdminWorkspace && onSwitchToAdmin && (
              <button
                type="button"
                onClick={onSwitchToAdmin}
                className="min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Staff Workspace
              </button>
            )}
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label="Toggle light or dark theme"
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <PWAInstallButton variant="header" />
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {portalLoading ? (
          <div className="max-w-md mx-auto py-12 space-y-3">
            <div className="h-5 w-48 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
            <div className="h-24 w-full bg-slate-200 dark:bg-slate-800 rounded-2xl animate-pulse" />
          </div>
        ) : !activePortal || !summary ? (
          <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 max-w-2xl mx-auto text-center space-y-4">
            <div className="mx-auto h-12 w-12 rounded-2xl bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center text-amber-700 dark:text-amber-400">
              <KeyRound className="w-6 h-6" aria-hidden="true" />
            </div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">
              Registration Code Not Found or Revoked
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              No active student record matches registration code{' '}
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                {registrationCode}
              </span>
              . Please check the code carefully or ask your school administrator or form master to
              issue a valid registration code.
            </p>
            <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={onSignOut}
                className="min-h-[42px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
              >
                Enter Different Registration Code
              </button>
              {hasAdminWorkspace && onSwitchToAdmin && (
                <button
                  type="button"
                  onClick={onSwitchToAdmin}
                  className="inline-flex items-center gap-1.5 min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Open Staff Workspace</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Student Profile Header & Controls */}
            <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    {activePortal.schoolName} · {activePortal.schoolDistrict} District ·{' '}
                    {activePortal.schoolType}
                  </div>
                  <h1 className="mt-1 text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                    {activePortal.studentName}
                  </h1>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Admission #: <span className="font-mono font-semibold">{activePortal.admissionNo}</span> ·{' '}
                    Form {activePortal.formLevel}
                    {activePortal.stream} ({activePortal.formLevel <= 2 ? 'JCE' : 'MSCE'}) ·{' '}
                    {activePortal.boardingStatus} · {activePortal.academicYear}
                    {activePortal.status !== 'Active' ? ` · ${activePortal.status}` : ''}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    disabled={summary.rows.length === 0}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Print</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadPdf}
                    disabled={summary.rows.length === 0}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FileDown className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Download PDF Report Card</span>
                  </button>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
                  {TERMS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setSelectedTerm(t)}
                      className={`min-h-[36px] px-3.5 rounded-lg text-xs font-semibold cursor-pointer ${
                        selectedTerm === t
                          ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  Reg. Code: <span className="font-semibold text-slate-800 dark:text-slate-200">{activePortal.registrationCode}</span>
                </div>
              </div>
            </section>

            {/* Summary KPIs */}
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
              <div className="rounded-2xl bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-900/60 p-4">
                <div className="text-xs text-emerald-800 dark:text-emerald-300 font-medium">
                  {activePortal.formLevel >= 3 ? 'MSCE Best 6' : 'Subjects Passed'}
                </div>
                <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-emerald-900 dark:text-emerald-200">
                  {summary.subjectCount === 0
                    ? '—'
                    : activePortal.formLevel >= 3
                    ? summary.standing.bestSixPoints !== null
                      ? `${summary.standing.bestSixPoints} pts`
                      : `${summary.subjectCount}/6`
                    : `${summary.passedSubjectCount}/${summary.subjectCount}`}
                </div>
                <div className="mt-0.5 text-[11px] text-emerald-700 dark:text-emerald-400 font-mono">
                  {activePortal.formLevel >= 3 && summary.meanManebPoint !== null
                    ? `Mean Pt ${summary.meanManebPoint}`
                    : `${summary.creditSubjectCount} credit${summary.creditSubjectCount === 1 ? '' : 's'}`}
                </div>
              </div>

              <div className="rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-4">
                <div className="text-xs text-slate-500 dark:text-slate-400">Overall Grade</div>
                <div className="mt-1.5 text-2xl font-bold font-mono text-slate-900 dark:text-white">
                  {summary.overallGrade}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                  {summary.overallRemark} · {summary.system}
                </div>
              </div>

              <div className="rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-4">
                <div className="text-xs text-slate-500 dark:text-slate-400">Term Average</div>
                <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  {summary.subjectCount > 0 ? `${summary.weightedAverage.toFixed(1)}%` : '—'}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                  CA {summary.caAverage.toFixed(1)} + Exam {summary.summativeAverage.toFixed(1)}
                </div>
              </div>

              <div className="rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-4">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {summary.system} Standing
                </div>
                <div
                  className={`mt-1.5 text-2xl font-bold ${
                    summary.standing.outcome === 'Pass'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : summary.standing.outcome === 'Fail'
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {summary.standing.outcome}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {summary.subjectCount} graded
                </div>
              </div>
            </section>

            {/* Subject Component Visual Breakdown */}
            {summary.rows.length > 0 && (
              <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
                  Subject Score Breakdown
                </h2>
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
              </section>
            )}

            {/* Subject Results Table */}
            <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Award className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {selectedTerm} Examination Results
                  </h2>
                </div>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  CA1 20% + CA2 20% + Exam 60%
                </span>
              </div>

              {loadingResults ? (
                <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                  Loading exam results...
                </div>
              ) : summary.rows.length === 0 ? (
                <div className="py-12 px-6 text-center text-sm text-slate-500 dark:text-slate-400">
                  No published marks for {selectedTerm} ({activePortal.academicYear}).
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                        <th className="py-3 px-4 font-medium">Subject</th>
                        <th className="py-3 px-3 font-medium text-right">CA 1 (20%)</th>
                        <th className="py-3 px-3 font-medium text-right">CA 2 (20%)</th>
                        <th className="py-3 px-3 font-medium text-right">Summative (60%)</th>
                        <th className="py-3 px-3 font-medium text-right">Total (100%)</th>
                        <th className="py-3 px-3 font-medium text-right">Pts (1–9)</th>
                        <th className="py-3 px-3 font-medium text-right">Grade</th>
                        <th className="py-3 px-4 font-medium text-right">Remark</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {summary.rows.map((r) => {
                        const a = r.assessment;
                        return (
                          <tr key={a.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                            <td className="py-3 px-4 font-medium text-slate-900 dark:text-slate-100">
                              {a.subject}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums">
                              {r.hasCa1 ? (
                                <div>
                                  <div>{r.ca1Score.toFixed(1)}</div>
                                  {typeof a.ca1Raw === 'number' && typeof a.ca1Max === 'number' && a.ca1Max > 0 && (
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
                                  <div>{r.ca2Score.toFixed(1)}</div>
                                  {typeof a.ca2Raw === 'number' && typeof a.ca2Max === 'number' && a.ca2Max > 0 && (
                                    <div className="text-[10px] text-slate-400">
                                      {a.ca2Raw}/{a.ca2Max}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums">
                              {r.hasExam ? (
                                <div>
                                  <div>{r.examScore.toFixed(1)}</div>
                                  {typeof a.examRaw === 'number' && typeof a.examMax === 'number' && a.examMax > 0 && (
                                    <div className="text-[10px] text-slate-400">
                                      {a.examRaw}/{a.examMax}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold">
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
                        <td className="py-3 px-4 text-right">{summary.overallRemark}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
      <OfflineIndicator />
    </div>
  );
};
