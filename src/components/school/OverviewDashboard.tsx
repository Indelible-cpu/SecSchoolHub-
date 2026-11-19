import React, { useMemo } from 'react';
import {
  Users,
  Banknote,
  AlertCircle,
  CalendarCheck,
  ArrowRight,
  Award,
  BookOpen,
  UserCheck,
  FileSpreadsheet,
} from 'lucide-react';
import {
  Assessment,
  AttendanceRecord,
  FeeInvoice,
  FeePayment,
  FormLevel,
  LibraryLoan,
  RolePermissions,
  School,
  SchoolSection,
  StaffLink,
  Student,
  Teacher,
} from '../../school/types';
import {
  calculateStudentStanding,
  FORM_LEVELS,
  formatMWK,
  isGovernmentSchool,
  isLibraryLoanOverdue,
  MALAWI_SUBJECTS,
  normalizeAssessmentComponents,
} from '../../school/malawi';
import {
  EnrollmentGenderChart,
  FeeCollectionDonut,
  ManebGradeDistributionChart,
  SubjectComponentBarChart,
  summarizeSubjectComponents,
} from './AnalyticsCharts';
import { ClassPerformanceTrendChart } from './ClassPerformanceTrendChart';
import { CaDropAlertsPanel } from './CaDropAlertsPanel';

interface OverviewDashboardProps {
  school: School;
  rolePermissions: RolePermissions;
  activeStaffLink?: StaffLink | null;
  students: Student[];
  teachers: Teacher[];
  assessments: Assessment[];
  invoices: FeeInvoice[];
  payments: FeePayment[];
  attendance: AttendanceRecord[];
  libraryLoans?: LibraryLoan[];
  onNavigate: (section: SchoolSection) => void;
}

export const OverviewDashboard: React.FC<OverviewDashboardProps> = ({
  school,
  rolePermissions,
  activeStaffLink,
  students,
  teachers,
  assessments,
  invoices,
  payments,
  attendance,
  libraryLoans = [],
  onNavigate,
}) => {
  const govTuitionOnly = isGovernmentSchool(school.schoolType);
  const activeStudents = useMemo(
    () => students.filter((s) => s.status === 'Active'),
    [students]
  );

  const feeStats = useMemo(() => {
    const termInvoices = invoices.filter((inv) => inv.term === school.currentTerm);
    const totalBilled = termInvoices.reduce((sum, i) => sum + i.totalBilled, 0);
    const totalPaid = termInvoices.reduce((sum, i) => sum + i.totalPaid, 0);
    const balance = Math.max(0, totalBilled - totalPaid);
    const rate = totalBilled > 0 ? Math.round((totalPaid / totalBilled) * 100) : 0;
    const paidCount = termInvoices.filter((i) => i.status === 'Paid').length;
    const partialCount = termInvoices.filter((i) => i.status === 'Partial').length;
    const unpaidCount = termInvoices.filter((i) => i.status === 'Unpaid').length;
    return {
      totalBilled,
      totalPaid,
      balance,
      rate,
      count: termInvoices.length,
      paidCount,
      partialCount,
      unpaidCount,
      outstandingCount: partialCount + unpaidCount,
    };
  }, [invoices, school.currentTerm]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const overdueLibraryCount = useMemo(
    () => libraryLoans.filter((loan) => isLibraryLoanOverdue(loan, todayIso)).length,
    [libraryLoans, todayIso]
  );
  const attendanceStats = useMemo(() => {
    const todayRows = attendance.filter((a) => a.date === todayIso);
    const present = todayRows.filter((a) => a.status === 'Present' || a.status === 'Late').length;
    const rate = todayRows.length > 0 ? Math.round((present / todayRows.length) * 100) : null;
    return { marked: todayRows.length, present, rate, todayRows };
  }, [attendance, todayIso]);

  const formBreakdown = useMemo(() => {
    return FORM_LEVELS.map((form) => {
      const list = activeStudents.filter((s) => s.formLevel === form);
      const male = list.filter((s) => s.gender === 'Male').length;
      const female = list.filter((s) => s.gender === 'Female').length;
      const boarders = list.filter((s) => s.boardingStatus === 'Boarder').length;
      const formAtt = attendanceStats.todayRows.filter((a) => a.formLevel === form);
      const formPresent = formAtt.filter((a) => a.status === 'Present' || a.status === 'Late').length;
      return {
        form,
        levelLabel: form <= 2 ? 'JCE' : 'MSCE',
        total: list.length,
        male,
        female,
        boarders,
        attMarked: formAtt.length,
        attPresent: formPresent,
      };
    });
  }, [activeStudents, attendanceStats.todayRows]);

  const paymentMethodTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of payments) {
      map.set(p.method, (map.get(p.method) || 0) + p.amount);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [payments]);

  const topOutstandingInvoices = useMemo(() => {
    return invoices
      .filter((i) => i.term === school.currentTerm && i.totalBilled - i.totalPaid > 0)
      .sort((a, b) => b.totalBilled - b.totalPaid - (a.totalBilled - a.totalPaid))
      .slice(0, 6);
  }, [invoices, school.currentTerm]);

  const termAssessments = useMemo(
    () => assessments.filter((a) => a.term === school.currentTerm),
    [assessments, school.currentTerm]
  );

  const termSubjectComponents = useMemo(
    () => summarizeSubjectComponents(termAssessments),
    [termAssessments]
  );

  const topMsceStudents = useMemo(() => {
    const upperStudents = activeStudents.filter((s) => s.formLevel >= 3);
    return upperStudents
      .map((student) => {
        const studentMarks = termAssessments.filter((a) => a.studentId === student.id);
        const standing = calculateStudentStanding(student.formLevel as FormLevel, studentMarks);
        return { student, standing };
      })
      .filter((row) => row.standing.subjectCount > 0)
      .sort((a, b) => {
        if (a.standing.bestSixPoints !== null && b.standing.bestSixPoints !== null) {
          return a.standing.bestSixPoints - b.standing.bestSixPoints;
        }
        return b.standing.averageScore - a.standing.averageScore;
      })
      .slice(0, 5);
  }, [activeStudents, termAssessments]);

  const teacherHomeStats = useMemo(() => {
    const assignedSubjects =
      activeStaffLink && activeStaffLink.subjects.length > 0
        ? activeStaffLink.subjects
        : MALAWI_SUBJECTS.slice(0, 4);
    const subjectSet = new Set(assignedSubjects.map((s) => s.toLowerCase()));
    const myTermMarks = termAssessments.filter((a) => subjectSet.has(a.subject.toLowerCase()));
    const relevantMarks = myTermMarks.length > 0 ? myTermMarks : termAssessments;
    const passedCount = relevantMarks.filter((a) => a.gradePoint <= 8).length;
    const passRate =
      relevantMarks.length > 0 ? Math.round((passedCount / relevantMarks.length) * 100) : null;

    const subjectRows = assignedSubjects.map((subj) => {
      const rows = termAssessments.filter((a) => a.subject.toLowerCase() === subj.toLowerCase());
      let ca1Done = 0;
      let ca2Done = 0;
      let examDone = 0;
      let sum = 0;
      for (const r of rows) {
        const b = normalizeAssessmentComponents(r);
        if (b.hasCa1) ca1Done += 1;
        if (b.hasCa2) ca2Done += 1;
        if (b.hasExam) examDone += 1;
        sum += r.totalScore;
      }
      return {
        subject: subj,
        count: rows.length,
        ca1Done,
        ca2Done,
        examDone,
        meanScore: rows.length > 0 ? sum / rows.length : null,
      };
    });

    return {
      assignedSubjects,
      myMarksCount: myTermMarks.length,
      totalMarksCount: termAssessments.length,
      passRate,
      subjectRows,
    };
  }, [activeStaffLink, termAssessments]);

  // Role Header Strip (visible across all roles)
  const RoleHeaderBanner = (
    <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
          {rolePermissions.roleLabel} · {school.district} · {school.schoolType}
        </div>
        <h1 className="mt-0.5 text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight">
          {rolePermissions.homeTitle}
        </h1>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 font-mono">
          {activeStaffLink
            ? `${activeStaffLink.staffName} (${activeStaffLink.staffCode}) · ${activeStaffLink.assignedForm} · ${school.currentTerm}`
            : `${school.name} · ${school.currentTerm} (${school.academicYear})${
                govTuitionOnly ? ' · Tuition-Only Gov. Policy' : ''
              }`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {rolePermissions.canWriteMarks && (
          <button
            type="button"
            onClick={() => onNavigate('marks')}
            className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
          >
            <Award className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Exam Marks</span>
          </button>
        )}
        {rolePermissions.canWriteFees && (
          <button
            type="button"
            onClick={() => onNavigate('fees')}
            className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer"
          >
            <Banknote className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Bursar Ledger</span>
          </button>
        )}
        {rolePermissions.canWriteAttendance && (
          <button
            type="button"
            onClick={() => onNavigate('attendance')}
            className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer"
          >
            <CalendarCheck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Roll Call</span>
          </button>
        )}
        {rolePermissions.canReadLibrary && (
          <button
            type="button"
            onClick={() => onNavigate('library')}
            className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              School Library
              {overdueLibraryCount > 0 ? (
                <span className="text-rose-600 dark:text-rose-400">
                  {' '}
                  · {overdueLibraryCount} overdue
                </span>
              ) : null}
            </span>
          </button>
        )}
      </div>
    </div>
  );

  // =========================================================================
  // 1. SCHOOL BURSAR HOME DASHBOARD
  // =========================================================================
  if (rolePermissions.role === 'School Bursar') {
    return (
      <div className="space-y-6">
        {RoleHeaderBanner}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>{school.currentTerm} Billed</span>
              <FileSpreadsheet className="w-4 h-4 text-slate-400" aria-hidden="true" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {formatMWK(feeStats.totalBilled)}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono">
              {feeStats.count} invoices{govTuitionOnly ? ' · Tuition-Only' : ''}
            </div>
          </div>

          <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>Collected</span>
              <Banknote className="w-4 h-4 text-emerald-600" aria-hidden="true" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
              {formatMWK(feeStats.totalPaid)}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {feeStats.rate}% rate
            </div>
          </div>

          <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>Outstanding</span>
              <AlertCircle className="w-4 h-4 text-amber-600" aria-hidden="true" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-amber-700 dark:text-amber-400">
              {formatMWK(feeStats.balance)}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono">
              {feeStats.outstandingCount} open accounts
            </div>
          </div>

          <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>Active Students</span>
              <Users className="w-4 h-4 text-slate-400" aria-hidden="true" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {activeStudents.length}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Forms 1–4
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Collection Donut + Channels */}
          <section className="lg:col-span-5 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Collection Progress ({school.currentTerm})
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('fees')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap cursor-pointer"
              >
                <span>Bursar Desk</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>

            <FeeCollectionDonut
              billed={feeStats.totalBilled}
              paid={feeStats.totalPaid}
              balance={feeStats.balance}
              paidCount={feeStats.paidCount}
              partialCount={feeStats.partialCount}
              unpaidCount={feeStats.unpaidCount}
            />

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Payment Channels
              </div>
              {paymentMethodTotals.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">No payments yet.</p>
              ) : (
                paymentMethodTotals.map(([method, amount]) => {
                  const share =
                    feeStats.totalPaid > 0 ? Math.round((amount / feeStats.totalPaid) * 100) : 0;
                  return (
                    <div key={method} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-700 dark:text-slate-300">{method}</span>
                        <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                          {formatMWK(amount)} ({share}%)
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          style={{ width: `${Math.min(100, share)}%` }}
                          className="h-full bg-emerald-700 dark:bg-emerald-500 rounded-full"
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Top Outstanding Invoices */}
          <section className="lg:col-span-7 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Top Outstanding Balances ({school.currentTerm})
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('fees')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap cursor-pointer"
              >
                <span>Open Ledger</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>

            {topOutstandingInvoices.length === 0 ? (
              <div className="py-8 text-sm text-slate-500 dark:text-slate-400">
                No unpaid {school.currentTerm} balances.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                      <th className="py-2 pr-3 font-medium">Student</th>
                      <th className="py-2 px-3 font-medium">Class</th>
                      <th className="py-2 px-3 font-medium text-right">Billed</th>
                      <th className="py-2 px-3 font-medium text-right">Balance</th>
                      <th className="py-2 pl-3 font-medium text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {topOutstandingInvoices.map((inv) => {
                      const bal = Math.max(0, inv.totalBilled - inv.totalPaid);
                      return (
                        <tr key={inv.id}>
                          <td className="py-2.5 pr-3 font-medium text-slate-900 dark:text-slate-100">
                            {inv.studentName}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-slate-600 dark:text-slate-400">
                            Form {inv.formLevel}{inv.stream}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-xs">
                            {formatMWK(inv.totalBilled)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-amber-700 dark:text-amber-400">
                            {formatMWK(bal)}
                          </td>
                          <td
                            className={`py-2.5 pl-3 text-right text-xs font-semibold ${
                              inv.status === 'Partial'
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {inv.status}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {payments.length > 0 && (
              <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Latest Receipts
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {payments.slice(0, 3).map((p) => (
                    <div key={p.id} className="py-2 flex items-center justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          {p.studentName}
                        </span>{' '}
                        <span className="text-slate-500 dark:text-slate-400 font-mono">
                          · {p.receiptNo} · {p.method}
                        </span>
                      </div>
                      <div className="font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400 shrink-0">
                        {formatMWK(p.amount)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 2. TEACHER / FORM MASTER / HOD HOME DASHBOARD (NO FEE DATA)
  // =========================================================================
  if (
    rolePermissions.role === 'Subject Teacher' ||
    rolePermissions.role === 'Form Master' ||
    rolePermissions.role === 'Head of Department'
  ) {
    return (
      <div className="space-y-6">
        {RoleHeaderBanner}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>Assigned Subjects</span>
              <BookOpen className="w-4 h-4 text-emerald-600" aria-hidden="true" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {teacherHomeStats.assignedSubjects.length}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
              {teacherHomeStats.assignedSubjects.join(', ')}
            </div>
          </div>

          <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>{school.currentTerm} Marks Entered</span>
              <Award className="w-4 h-4 text-slate-400" aria-hidden="true" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
              {teacherHomeStats.myMarksCount > 0
                ? teacherHomeStats.myMarksCount
                : teacherHomeStats.totalMarksCount}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {teacherHomeStats.totalMarksCount} total term assessments
            </div>
          </div>

          <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>Subject Pass Rate</span>
              <UserCheck className="w-4 h-4 text-slate-400" aria-hidden="true" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {teacherHomeStats.passRate !== null ? `${teacherHomeStats.passRate}%` : '—'}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              CA 1 (20%) + CA 2 (20%) + Exam (60%)
            </div>
          </div>

          <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>Today&apos;s Attendance</span>
              <CalendarCheck className="w-4 h-4 text-slate-400" aria-hidden="true" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {attendanceStats.rate !== null ? `${attendanceStats.rate}%` : 'Not marked'}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {attendanceStats.marked > 0
                ? `${attendanceStats.present} of ${attendanceStats.marked} marked present`
                : `${activeStudents.length} active students`}
            </div>
          </div>
        </div>

        <ClassPerformanceTrendChart
          assessments={termAssessments}
          term={school.currentTerm}
          onOpenGradebook={() => onNavigate('marks')}
        />

        <CaDropAlertsPanel
          assessments={termAssessments}
          students={students}
          term={school.currentTerm}
          onOpenGradebook={() => onNavigate('marks')}
        />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <section className="lg:col-span-6 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4 mb-3">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Exam Grade Distribution ({school.currentTerm})
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('marks')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap cursor-pointer"
              >
                <span>Open Gradebook</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
            <ManebGradeDistributionChart assessments={termAssessments} />
          </section>

          <section className="lg:col-span-6 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-3">
              Subject Mean Performance (CA1 + CA2 + Exam)
            </h2>
            {termSubjectComponents.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                No subject marks entered yet.
              </p>
            ) : (
              <SubjectComponentBarChart items={termSubjectComponents} maxItems={6} />
            )}
          </section>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <section className="lg:col-span-7 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                CA &amp; Exam Progress ({school.currentTerm})
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('marks')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap cursor-pointer"
              >
                <span>Record Marks</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 pr-3 font-medium">Subject</th>
                    <th className="py-2.5 px-3 font-medium text-right">Records</th>
                    <th className="py-2.5 px-3 font-medium text-right">CA 1</th>
                    <th className="py-2.5 px-3 font-medium text-right">CA 2</th>
                    <th className="py-2.5 px-3 font-medium text-right">Summative</th>
                    <th className="py-2.5 pl-3 font-medium text-right">Mean</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {teacherHomeStats.subjectRows.map((row) => (
                    <tr key={row.subject} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-3 pr-3 font-semibold text-slate-900 dark:text-slate-100">
                        {row.subject}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">{row.count}</td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {row.ca1Done}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {row.ca2Done}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {row.examDone}
                      </td>
                      <td className="py-3 pl-3 text-right font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
                        {row.meanScore !== null ? `${row.meanScore.toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="lg:col-span-5 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4 mb-3">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Enrollment &amp; Roll Call
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('attendance')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap cursor-pointer"
              >
                <span>Take Roll Call</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
            <EnrollmentGenderChart rows={formBreakdown} />
          </section>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 3. DEPUTY HEAD ACADEMIC DASHBOARD (NO FEE DATA)
  // =========================================================================
  if (rolePermissions.role === 'Deputy Head') {
    return (
      <div className="space-y-6">
        {RoleHeaderBanner}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>Active Students</span>
              <Users className="w-4 h-4 text-slate-400" aria-hidden="true" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {activeStudents.length}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Across Forms 1–4
            </div>
          </div>

          <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>{school.currentTerm} Assessments</span>
              <Award className="w-4 h-4 text-emerald-600" aria-hidden="true" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
              {termAssessments.length}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              CA 1 + CA 2 + Summative records
            </div>
          </div>

          <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>Today&apos;s Attendance</span>
              <CalendarCheck className="w-4 h-4 text-slate-400" aria-hidden="true" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {attendanceStats.rate !== null ? `${attendanceStats.rate}%` : 'Not marked'}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {attendanceStats.marked > 0
                ? `${attendanceStats.present} of ${attendanceStats.marked} marked present`
                : `No register saved for ${todayIso}`}
            </div>
          </div>

          <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>Active Staff</span>
              <UserCheck className="w-4 h-4 text-slate-400" aria-hidden="true" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {teachers.filter((t) => t.status === 'Active').length}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {teachers.length} total directory staff
            </div>
          </div>
        </div>

        <ClassPerformanceTrendChart
          assessments={termAssessments}
          term={school.currentTerm}
          onOpenGradebook={() => onNavigate('marks')}
        />

        <CaDropAlertsPanel
          assessments={termAssessments}
          students={students}
          term={school.currentTerm}
          onOpenGradebook={() => onNavigate('marks')}
        />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <section className="lg:col-span-7 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Form 1–4 Enrollment ({school.currentTerm})
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('students')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap cursor-pointer"
              >
                <span>Manage Students</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
            <EnrollmentGenderChart rows={formBreakdown} />
          </section>

          <section className="lg:col-span-5 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Exam Grade Distribution
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('marks')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap cursor-pointer"
              >
                <span>Gradebook</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
            <ManebGradeDistributionChart assessments={termAssessments} />
          </section>
        </div>

        <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Form 3 &amp; Form 4 MSCE Standing ({school.currentTerm})
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('marks')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap cursor-pointer"
            >
              <span>Open Gradebook</span>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
          {topMsceStudents.length === 0 ? (
            <div className="py-8 text-sm text-slate-500 dark:text-slate-400">
              Record Form 3 or Form 4 subject scores in the Exam Marks gradebook to see Best-6 aggregates here.
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-3 font-medium">Student</th>
                    <th className="py-2 px-3 font-medium">Class</th>
                    <th className="py-2 px-3 font-medium text-right">Subjects Graded</th>
                    <th className="py-2 px-3 font-medium text-right">Mean Score</th>
                    <th className="py-2 px-3 font-medium text-right">Best 6 Points</th>
                    <th className="py-2 pl-3 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {topMsceStudents.map(({ student, standing }) => (
                    <tr key={student.id}>
                      <td className="py-2.5 pr-3 font-medium text-slate-900 dark:text-slate-100">
                        {student.fullName}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-slate-600 dark:text-slate-400">
                        Form {student.formLevel}{student.stream}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {standing.subjectCount}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {standing.averageScore.toFixed(1)}%
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                        {standing.bestSixPoints !== null ? `${standing.bestSixPoints} pts` : 'Need 6'}
                      </td>
                      <td
                        className={`py-2.5 pl-3 text-right text-xs font-semibold ${
                          standing.outcome === 'Pass'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : standing.outcome === 'Fail'
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {standing.outcome}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    );
  }

  // =========================================================================
  // 4. OWNER / HEAD TEACHER EXECUTIVE DASHBOARD
  // =========================================================================
  return (
    <div className="space-y-6">
      {RoleHeaderBanner}

      {/* 4-Column KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Active Students</span>
            <Users className="w-4 h-4 text-slate-400" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {activeStudents.length}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {teachers.filter((t) => t.status === 'Active').length} active staff members
          </div>
        </div>

        <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>{school.currentTerm} Fees Collected</span>
            <Banknote className="w-4 h-4 text-emerald-600" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatMWK(feeStats.totalPaid)}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {feeStats.rate}% of {formatMWK(feeStats.totalBilled)} billed
          </div>
        </div>

        <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Fees Outstanding</span>
            <AlertCircle className="w-4 h-4 text-amber-600" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {formatMWK(feeStats.balance)}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Across {feeStats.count} {school.currentTerm} invoices
          </div>
        </div>

        <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Today&apos;s Attendance</span>
            <CalendarCheck className="w-4 h-4 text-slate-400" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {attendanceStats.rate !== null ? `${attendanceStats.rate}%` : 'Not marked'}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {attendanceStats.marked > 0
              ? `${attendanceStats.present} of ${attendanceStats.marked} marked present`
              : `No register saved for ${todayIso}`}
          </div>
        </div>
      </div>

      {/* Class-Wide Academic Performance Trends (CA1, CA2, Summative) */}
      <ClassPerformanceTrendChart
        assessments={termAssessments}
        term={school.currentTerm}
        onOpenGradebook={() => onNavigate('marks')}
      />

      {/* Automated Early-Warning CA Drop Alerts */}
      <CaDropAlertsPanel
        assessments={termAssessments}
        students={students}
        term={school.currentTerm}
        onOpenGradebook={() => onNavigate('marks')}
      />

      {/* Visual Analytics Row (Fees + Academics) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-5 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Fee Collection ({school.currentTerm})
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('fees')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap cursor-pointer"
            >
              <span>Bursar Desk</span>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          <FeeCollectionDonut
            billed={feeStats.totalBilled}
            paid={feeStats.totalPaid}
            balance={feeStats.balance}
            paidCount={feeStats.paidCount}
            partialCount={feeStats.partialCount}
            unpaidCount={feeStats.unpaidCount}
          />

          {paymentMethodTotals.length > 0 && (
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
              {paymentMethodTotals.map(([method, amount]) => {
                const share =
                  feeStats.totalPaid > 0 ? Math.round((amount / feeStats.totalPaid) * 100) : 0;
                return (
                  <div key={method} className="flex items-center justify-between text-xs">
                    <span className="text-slate-600 dark:text-slate-300">{method}</span>
                    <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                      {formatMWK(amount)} ({share}%)
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="lg:col-span-7 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Form 1–4 Enrollment &amp; Attendance
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('students')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap cursor-pointer"
            >
              <span>Manage Students</span>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          <EnrollmentGenderChart rows={formBreakdown} />

          <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-3">
              Exam Grade Distribution ({school.currentTerm})
            </h3>
            <ManebGradeDistributionChart assessments={termAssessments} />
          </div>
        </section>
      </div>

      {/* Subject Performance + Upper Secondary MSCE Standing */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-5 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-3">
            Subject Mean Breakdown
          </h2>
          {termSubjectComponents.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No subject marks entered yet.
            </p>
          ) : (
            <SubjectComponentBarChart items={termSubjectComponents} maxItems={6} />
          )}
        </section>

        <section className="lg:col-span-7 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Form 3 &amp; Form 4 MSCE Standing ({school.currentTerm})
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('marks')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap cursor-pointer"
            >
              <span>Open Gradebook</span>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

        {topMsceStudents.length === 0 ? (
          <div className="py-8 text-sm text-slate-500 dark:text-slate-400">
            No Form 3–4 subject marks recorded yet.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                  <th className="py-2 pr-3 font-medium">Student</th>
                  <th className="py-2 px-3 font-medium">Class</th>
                  <th className="py-2 px-3 font-medium text-right">Subjects Graded</th>
                  <th className="py-2 px-3 font-medium text-right">Mean Score</th>
                  <th className="py-2 px-3 font-medium text-right">Best 6 Points</th>
                  <th className="py-2 pl-3 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {topMsceStudents.map(({ student, standing }) => (
                  <tr key={student.id}>
                    <td className="py-2.5 pr-3 font-medium text-slate-900 dark:text-slate-100">
                      {student.fullName}
                    </td>
                    <td className="py-2.5 px-3 text-xs text-slate-600 dark:text-slate-400">
                      Form {student.formLevel}{student.stream}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {standing.subjectCount}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {standing.averageScore.toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                      {standing.bestSixPoints !== null ? `${standing.bestSixPoints} pts` : 'Need 6'}
                    </td>
                    <td
                      className={`py-2.5 pl-3 text-right text-xs font-semibold ${
                        standing.outcome === 'Pass'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : standing.outcome === 'Fail'
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {standing.outcome}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </section>
      </div>
    </div>
  );
};
