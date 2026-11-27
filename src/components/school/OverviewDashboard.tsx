import React, { useMemo, useRef, useState } from 'react';
import {
  Users,
  Banknote,
  AlertCircle,
  AlertTriangle,
  CalendarCheck,
  Clock,
  ArrowRight,
  Award,
  BookCheck,
  BookOpen,
  UserCheck,
  FileDown,
  FileSpreadsheet,
  Settings,
  ShieldAlert,
  Database,
} from 'lucide-react';
import {
  Assessment,
  AttendanceRecord,
  BackupSettings,
  BackupSnapshotLog,
  FeeInvoice,
  FeePayment,
  FormLevel,
  LibraryLoan,
  RolePermissions,
  School,
  SchoolAnnouncement,
  SchoolSection,
  StaffAttendanceRecord,
  StaffLink,
  StaffTimebookEntry,
  Student,
  StudentCase,
  Teacher,
} from '../../school/types';
import {
  calculateStudentStanding,
  evaluateAssessmentCaDrop,
  FORM_LEVELS,
  formatMWK,
  getLibraryDaysOverdue,
  getLibraryDueReminderLabel,
  formatSchoolTypeLabel,
  isGovernmentSchool,
  isLibraryLoanDueWithin48Hours,
  isLibraryLoanOverdue,
  LIBRARY_MATERIAL_CATEGORIES,
  MALAWI_SUBJECTS,
  normalizeAssessmentComponents,
  sortStudentsForRegister,
} from '../../school/malawi';
import {
  EnrollmentGenderChart,
  FeeCollectionDonut,
  ManebGradeDistributionChart,
  SubjectComponentBarChart,
  summarizeSubjectComponents,
} from './AnalyticsCharts';
import { ClassPerformanceTrendChart } from './ClassPerformanceTrendChart';
import { TermPerformanceTrendChart } from './TermPerformanceTrendChart';
import { CaDropAlertsPanel } from './CaDropAlertsPanel';
import { AnnouncementsPanel } from './AnnouncementsPanel';
import { StudentAttendanceHeatmap } from './StudentAttendanceHeatmap';
import { BoardReportExportModal } from './BoardReportExportModal';

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
  staffAttendance?: StaffAttendanceRecord[];
  timebookEntries?: StaffTimebookEntry[];
  studentCases?: StudentCase[];
  libraryLoans?: LibraryLoan[];
  announcements?: SchoolAnnouncement[];
  backupSettings?: BackupSettings | null;
  backupLogs?: BackupSnapshotLog[];
  authorDisplayName?: string;
  onNavigate: (section: SchoolSection) => void;
  onOpenStudents?: (tab: 'directory' | 'gallery' | 'attendance' | 'cases') => void;
  onOpenStaff?: (tab: 'directory' | 'timebook' | 'backups') => void;
  onOpenLibrary?: (
    tab: 'catalog' | 'reservations' | 'online',
    audience?: 'all' | 'teaching' | 'student'
  ) => void;
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
  staffAttendance = [],
  timebookEntries = [],
  studentCases = [],
  libraryLoans = [],
  announcements = [],
  backupSettings = null,
  backupLogs = [],
  authorDisplayName = 'School Admin',
  onNavigate,
  onOpenStudents,
  onOpenStaff,
  onOpenLibrary,
}) => {
  const [showBoardExportModal, setShowBoardExportModal] = useState(false);
  const dashboardRootRef = useRef<HTMLDivElement>(null);
  const govTuitionOnly = isGovernmentSchool(school.schoolType);
  const isTeachingRole =
    rolePermissions.role === 'Subject Teacher' ||
    rolePermissions.role === 'Form Teacher' ||
    rolePermissions.role === 'Form Master' ||
    rolePermissions.role === 'Head of Department';
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
  const dueSoonLibraryItems = useMemo(
    () =>
      libraryLoans
        .filter((loan) => isLibraryLoanDueWithin48Hours(loan, todayIso))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.studentName.localeCompare(b.studentName)),
    [libraryLoans, todayIso]
  );
  const dueSoonLibraryCount = dueSoonLibraryItems.length;
  const attendanceStats = useMemo(() => {
    const todayRows = attendance.filter((a) => a.date === todayIso);
    const present = todayRows.filter((a) => a.status === 'Present' || a.status === 'Late').length;
    const rate = todayRows.length > 0 ? Math.round((present / todayRows.length) * 100) : null;
    return { marked: todayRows.length, present, rate, todayRows };
  }, [attendance, todayIso]);

  const staffTurnoutStats = useMemo(() => {
    const byTeacher = new Map<string, { status: string; isGps: boolean }>();
    for (const r of staffAttendance) {
      if (r.date === todayIso) {
        byTeacher.set(r.teacherId, { status: r.status, isGps: false });
      }
    }
    for (const e of timebookEntries) {
      if (e.date === todayIso) {
        byTeacher.set(e.teacherId, {
          status: e.status,
          isGps: e.recordingMethod === 'GPS Auto',
        });
      }
    }

    let present = 0;
    let gpsAuto = 0;
    let absent = 0;
    let onLeave = 0;
    for (const t of teachers) {
      const rec = byTeacher.get(t.id);
      const status = rec?.status || (t.status === 'On Leave' ? 'On Leave' : '');
      if (!status) continue;
      if (status === 'Present' || status === 'Late' || status === 'Administratively Recorded') {
        present += 1;
        if (rec?.isGps) gpsAuto += 1;
      } else if (status === 'Absent') {
        absent += 1;
      } else if (status === 'On Leave') {
        onLeave += 1;
      }
    }
    const expected = Math.max(0, teachers.length - onLeave);
    const rate = expected > 0 ? Math.round((present / expected) * 100) : 0;
    const notSignedIn = Math.max(0, expected - present - absent);
    return {
      totalStaff: teachers.length,
      present,
      gpsAuto,
      absent,
      onLeave,
      notSignedIn,
      rate,
    };
  }, [staffAttendance, teachers, timebookEntries, todayIso]);

  const studentCaseStats = useMemo(() => {
    const activeSuspensions = studentCases.filter(
      (c) => c.caseType === 'Suspension' && c.status !== 'Resolved'
    ).length;
    const rustications = studentCases.filter(
      (c) => c.caseType === 'Rustication' || c.status === 'Rusticated'
    ).length;
    const openCases = studentCases.filter((c) => c.status !== 'Resolved').length;
    return {
      total: studentCases.length,
      activeSuspensions,
      rustications,
      openCases,
    };
  }, [studentCases]);

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
          return (
            a.standing.bestSixPoints - b.standing.bestSixPoints ||
            b.standing.averageScore - a.standing.averageScore
          );
        }
        if (a.standing.bestSixPoints !== null) return -1;
        if (b.standing.bestSixPoints !== null) return 1;
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

  const formTeacherRoster = useMemo(() => {
    if (rolePermissions.role !== 'Form Teacher' && rolePermissions.role !== 'Form Master') {
      return null;
    }
    const rawAssigned = (activeStaffLink?.assignedForm || '').trim();
    const match = rawAssigned.match(/form\s*([1-4])\s*([a-z0-9]*)/i);
    const targetForm = (match ? Number(match[1]) : 4) as FormLevel;
    const targetStream = (match?.[2] || '').trim().toUpperCase();

    const classStudents = sortStudentsForRegister(
      activeStudents.filter((s) => {
        if (s.formLevel !== targetForm) return false;
        if (targetStream && s.stream.trim().toUpperCase() !== targetStream) return false;
        return true;
      }),
      { groupByStream: !targetStream }
    );

    const rows = classStudents.map((stu) => {
      const att = attendanceStats.todayRows.find((a) => a.studentId === stu.id);
      const stuMarks = termAssessments.filter((m) => m.studentId === stu.id);
      const standing = calculateStudentStanding(stu.formLevel as FormLevel, stuMarks);
      const activeLoans = libraryLoans.filter(
        (l) => l.studentId === stu.id && l.status === 'Checked Out'
      );
      const overdueLoans = activeLoans.filter((l) => isLibraryLoanOverdue(l, todayIso));
      const dueSoonLoans = activeLoans.filter((l) => isLibraryLoanDueWithin48Hours(l, todayIso));
      return {
        student: stu,
        attendanceStatus: att?.status || 'Unmarked',
        subjectCount: standing.subjectCount,
        averageScore: standing.subjectCount > 0 ? standing.averageScore : null,
        activeLoanCount: activeLoans.length,
        overdueLoanCount: overdueLoans.length,
        dueSoonLoanCount: dueSoonLoans.length,
      };
    });

    const presentCount = rows.filter(
      (r) => r.attendanceStatus === 'Present' || r.attendanceStatus === 'Late'
    ).length;

    return {
      classLabel: targetStream ? `Form ${targetForm}${targetStream}` : `Form ${targetForm}`,
      rows,
      presentCount,
    };
  }, [activeStaffLink?.assignedForm, activeStudents, attendanceStats.todayRows, libraryLoans, rolePermissions.role, termAssessments, todayIso]);

  const hodDepartmentSummary = useMemo(() => {
    if (rolePermissions.role !== 'Head of Department') return null;
    const deptSubjects =
      activeStaffLink && activeStaffLink.subjects.length > 0
        ? activeStaffLink.subjects
        : MALAWI_SUBJECTS.slice(0, 3);
    const subjSet = new Set(deptSubjects.map((s) => s.toLowerCase()));
    const deptMarks = termAssessments.filter((m) => subjSet.has(m.subject.toLowerCase()));
    const deptDrops = deptMarks.filter((m) => evaluateAssessmentCaDrop(m) !== null).length;
    const examCompleted = deptMarks.filter((m) => normalizeAssessmentComponents(m).hasExam).length;
    const completionPct =
      deptMarks.length > 0 ? Math.round((examCompleted / deptMarks.length) * 100) : 0;

    return {
      deptSubjects,
      deptMarksCount: deptMarks.length,
      deptDrops,
      completionPct,
    };
  }, [activeStaffLink, rolePermissions.role, termAssessments]);

  const librarianStats = useMemo(() => {
    let checkedOutLoans = 0;
    let checkedOutCopies = 0;
    let dueSoonLoans = 0;
    let dueSoonCopies = 0;
    let overdueLoans = 0;
    let overdueCopies = 0;
    let returnedLoans = 0;
    let damagedOrLost = 0;
    const borrowerIds = new Set<string>();
    const subjectMap = new Map<
      string,
      { subject: string; totalCopies: number; checkedOutCopies: number; overdueCopies: number }
    >();
    const categoryMap = new Map<string, number>();

    for (const loan of libraryLoans) {
      const qty = Math.max(1, Number(loan.quantity) || 1);
      const subj = (loan.subject || 'General').trim() || 'General';
      const sEntry = subjectMap.get(subj) || {
        subject: subj,
        totalCopies: 0,
        checkedOutCopies: 0,
        overdueCopies: 0,
      };
      sEntry.totalCopies += qty;
      categoryMap.set(loan.materialType, (categoryMap.get(loan.materialType) || 0) + qty);

      if (loan.status === 'Checked Out') {
        checkedOutLoans += 1;
        checkedOutCopies += qty;
        borrowerIds.add(loan.studentId);
        sEntry.checkedOutCopies += qty;
        if (isLibraryLoanOverdue(loan, todayIso)) {
          overdueLoans += 1;
          overdueCopies += qty;
          sEntry.overdueCopies += qty;
        } else if (isLibraryLoanDueWithin48Hours(loan, todayIso)) {
          dueSoonLoans += 1;
          dueSoonCopies += qty;
        }
      } else {
        returnedLoans += 1;
        if (loan.conditionOnReturn === 'Damaged' || loan.conditionOnReturn === 'Lost') {
          damagedOrLost += 1;
        }
      }

      subjectMap.set(subj, sEntry);
    }

    const activeQueue = libraryLoans
      .filter((l) => l.status === 'Checked Out')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 8);

    const mostBorrowedSubjects = Array.from(subjectMap.values())
      .sort((a, b) => b.totalCopies - a.totalCopies || a.subject.localeCompare(b.subject))
      .slice(0, 6);

    const byForm = FORM_LEVELS.map((form) => {
      const formActive = libraryLoans.filter(
        (l) => l.formLevel === form && l.status === 'Checked Out'
      );
      const formOverdue = formActive.filter((l) => isLibraryLoanOverdue(l, todayIso));
      const formDueSoon = formActive.filter((l) => isLibraryLoanDueWithin48Hours(l, todayIso));
      return {
        form,
        activeCount: formActive.length,
        overdueCount: formOverdue.length,
        dueSoonCount: formDueSoon.length,
      };
    });

    const byCategory = LIBRARY_MATERIAL_CATEGORIES.map((category) => ({
      category,
      copies: categoryMap.get(category) || 0,
    })).filter((c) => c.copies > 0);

    return {
      checkedOutLoans,
      checkedOutCopies,
      dueSoonLoans,
      dueSoonCopies,
      overdueLoans,
      overdueCopies,
      returnedLoans,
      damagedOrLost,
      activeBorrowers: borrowerIds.size,
      activeQueue,
      mostBorrowedSubjects,
      byForm,
      byCategory,
    };
  }, [libraryLoans, todayIso]);

  // Role Header Strip (spacious across all roles)
  const RoleHeaderBanner = (
    <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="flex items-center gap-3.5 sm:gap-4 min-w-0 flex-1">
        {school.logoDataUrl && (
          <div className="h-12 w-12 sm:h-14 sm:w-14 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden shrink-0 flex items-center justify-center">
            <img
              src={school.logoDataUrl}
              alt={`${school.name} logo`}
              className="h-full w-full object-contain p-1"
            />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs font-semibold">
            <span className="text-emerald-700 dark:text-emerald-400">
              {rolePermissions.roleLabel}
            </span>
            <span className="text-slate-300 dark:text-slate-700">·</span>
            <span className="text-slate-600 dark:text-slate-400">
              {school.district} District
            </span>
            <span className="text-slate-300 dark:text-slate-700">·</span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/80 text-[11px] font-medium">
              {formatSchoolTypeLabel(school.schoolType)}
            </span>
          </div>
          <h1 className="mt-1 text-lg sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            {rolePermissions.homeTitle}
          </h1>
          <p className="mt-0.5 text-xs sm:text-sm text-slate-600 dark:text-slate-300 font-medium">
            {activeStaffLink
              ? `${activeStaffLink.staffName} (${activeStaffLink.staffCode}) · ${activeStaffLink.assignedForm} · ${school.name} · ${school.currentTerm}`
              : `${school.name} · ${school.currentTerm} (${school.academicYear})`}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {rolePermissions.canReadMarks && (
          <button
            type="button"
            onClick={() => setShowBoardExportModal(true)}
            className="inline-flex items-center gap-2 min-h-[40px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer transition-colors"
          >
            <FileDown className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
            <span>Export Board PDF</span>
          </button>
        )}
      </div>
    </div>
  );

  const boardExportModal = rolePermissions.canReadMarks ? (
    <BoardReportExportModal
      open={showBoardExportModal}
      onClose={() => setShowBoardExportModal(false)}
      school={school}
      rolePermissions={rolePermissions}
      authorDisplayName={authorDisplayName}
      students={students}
      teachers={teachers}
      assessments={assessments}
      attendance={attendance}
      invoices={rolePermissions.canReadFees ? invoices : []}
      todayIso={todayIso}
      dashboardRootEl={dashboardRootRef.current}
    />
  ) : null;

  const LibraryDueReminderBanner =
    rolePermissions.canReadLibrary &&
    (dueSoonLibraryItems.length > 0 || overdueLibraryCount > 0) ? (
      <section
        aria-label="Automated library return reminders"
        className="bg-white dark:bg-[#161B22] border border-amber-200 dark:border-amber-900/60 rounded-2xl p-5 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center text-amber-700 dark:text-amber-400 shrink-0">
              <Clock className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Library Return Reminders · Due Within 48 Hours
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                {dueSoonLibraryCount} {dueSoonLibraryCount === 1 ? 'book' : 'books'} due within 48h
                {overdueLibraryCount > 0 ? ` · ${overdueLibraryCount} overdue` : ''}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('library')}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>Open School Library</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>

        {dueSoonLibraryItems.length > 0 && (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80 rounded-xl border border-amber-200/80 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/15 overflow-hidden">
            {dueSoonLibraryItems.slice(0, 4).map((loan) => {
              const reminder = getLibraryDueReminderLabel(loan.dueDate, todayIso);
              return (
                <div
                  key={loan.id}
                  className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {loan.bookTitle}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                      {loan.studentName} · Form {loan.formLevel}
                      {loan.stream} · {loan.bookCode}
                    </div>
                  </div>
                  <div className="text-right font-mono tabular-nums shrink-0">
                    <span className="font-semibold text-amber-800 dark:text-amber-300">
                      {reminder.urgencyLabel}
                    </span>{' '}
                    <span className="text-slate-500 dark:text-slate-400">
                      (Due {loan.dueDate})
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    ) : null;

  // =========================================================================
  // 0. SCHOOL LIBRARIAN HOME DASHBOARD (ISOLATED FROM MARKS & FEES)
  // =========================================================================
  if (rolePermissions.role === 'School Librarian') {
    return (
      <div className="space-y-6">
        {RoleHeaderBanner}
        <AnnouncementsPanel
          school={school}
          rolePermissions={rolePermissions}
          announcements={announcements}
          authorDisplayName={authorDisplayName}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>Books Checked Out</span>
              <BookOpen className="w-4 h-4 text-emerald-600" aria-hidden="true" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {librarianStats.checkedOutCopies}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono">
              {librarianStats.checkedOutLoans} active loans
            </div>
          </div>

          <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>Overdue Returns</span>
              <AlertTriangle
                className={`w-4 h-4 ${
                  librarianStats.overdueLoans > 0 ? 'text-rose-600' : 'text-slate-400'
                }`}
                aria-hidden="true"
              />
            </div>
            <div
              className={`mt-2 text-2xl font-bold font-mono tabular-nums ${
                librarianStats.overdueLoans > 0
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-slate-900 dark:text-white'
              }`}
            >
              {librarianStats.overdueLoans}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono">
              {librarianStats.overdueCopies} overdue ·{' '}
              <span
                className={
                  librarianStats.dueSoonLoans > 0
                    ? 'text-amber-700 dark:text-amber-400 font-semibold'
                    : ''
                }
              >
                {librarianStats.dueSoonLoans} due in 48h
              </span>
            </div>
          </div>

          <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>Returned &amp; Cleared</span>
              <BookCheck className="w-4 h-4 text-emerald-600" aria-hidden="true" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
              {librarianStats.returnedLoans}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono">
              {librarianStats.damagedOrLost > 0
                ? `${librarianStats.damagedOrLost} damaged/lost`
                : 'All returned intact'}
            </div>
          </div>

          <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>Active Borrowers</span>
              <Users className="w-4 h-4 text-slate-400" aria-hidden="true" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {librarianStats.activeBorrowers}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              of {activeStudents.length} active students
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Active Loans & Overdue Queue */}
          <section className="lg:col-span-7 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Overdue &amp; 48-Hour Return Reminders
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('library')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap cursor-pointer"
              >
                <span>Open Library Register</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>

            {librarianStats.dueSoonLoans > 0 && (
              <div className="mt-3 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/25 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" aria-hidden="true" />
                <span>
                  <span className="font-semibold">
                    {librarianStats.dueSoonLoans}{' '}
                    {librarianStats.dueSoonLoans === 1 ? 'book' : 'books'} due within 48 hours
                  </span>{' '}
                  ({librarianStats.dueSoonCopies} {librarianStats.dueSoonCopies === 1 ? 'copy' : 'copies'}). Remind borrowers before the return deadline.
                </span>
              </div>
            )}

            {librarianStats.activeQueue.length === 0 ? (
              <div className="py-10 text-sm text-slate-500 dark:text-slate-400">
                No textbooks or reading materials are currently checked out.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                      <th className="py-2 pr-3 font-medium">Material &amp; Code</th>
                      <th className="py-2 px-3 font-medium">Student</th>
                      <th className="py-2 px-3 font-medium">Due Date</th>
                      <th className="py-2 pl-3 font-medium text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {librarianStats.activeQueue.map((loan) => {
                      const overdue = isLibraryLoanOverdue(loan, todayIso);
                      const dueSoon = isLibraryLoanDueWithin48Hours(loan, todayIso);
                      const reminder = getLibraryDueReminderLabel(loan.dueDate, todayIso);
                      const daysLate = overdue ? getLibraryDaysOverdue(loan.dueDate, todayIso) : 0;
                      return (
                        <tr
                          key={loan.id}
                          className={
                            dueSoon
                              ? 'bg-amber-50/45 dark:bg-amber-950/15'
                              : overdue
                              ? 'bg-rose-50/35 dark:bg-rose-950/10'
                              : ''
                          }
                        >
                          <td className="py-2.5 pr-3">
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {loan.bookTitle}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                              {loan.bookCode} · {loan.subject || 'General'}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-xs">
                            <div className="font-medium text-slate-800 dark:text-slate-200">
                              {loan.studentName}
                            </div>
                            <div className="font-mono text-slate-500 dark:text-slate-400">
                              Form {loan.formLevel}
                              {loan.stream} · {loan.admissionNo}
                            </div>
                          </td>
                          <td
                            className={`py-2.5 px-3 font-mono text-xs tabular-nums ${
                              overdue
                                ? 'text-rose-600 dark:text-rose-400 font-semibold'
                                : dueSoon
                                ? 'text-amber-700 dark:text-amber-400 font-semibold'
                                : 'text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {loan.dueDate}
                          </td>
                          <td
                            className={`py-2.5 pl-3 text-right text-xs font-semibold whitespace-nowrap ${
                              overdue
                                ? 'text-rose-600 dark:text-rose-400'
                                : dueSoon
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {overdue
                              ? `Overdue (${daysLate}d)`
                              : dueSoon
                              ? `48h Alert · ${reminder.urgencyLabel}`
                              : 'Checked Out'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Most Borrowed Subjects & Form Circulation */}
          <section className="lg:col-span-5 space-y-6">
            <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Most Borrowed Subjects
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('library')}
                  className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                >
                  Analytics
                </button>
              </div>
              {librarianStats.mostBorrowedSubjects.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">No circulation recorded yet.</p>
              ) : (
                <div className="space-y-3">
                  {librarianStats.mostBorrowedSubjects.map((item) => {
                    const max = librarianStats.mostBorrowedSubjects[0]?.totalCopies || 1;
                    const widthPct = Math.max(8, Math.round((item.totalCopies / max) * 100));
                    return (
                      <div key={item.subject} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-800 dark:text-slate-200">
                            {item.subject}
                          </span>
                          <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                            {item.totalCopies} {item.totalCopies === 1 ? 'copy' : 'copies'} ·{' '}
                            {item.checkedOutCopies} out
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            style={{ width: `${widthPct}%` }}
                            className="h-full rounded-full bg-emerald-700 dark:bg-emerald-500"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-3">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Active Loans by Form
              </h2>
              <div className="grid grid-cols-2 gap-2.5">
                {librarianStats.byForm.map((f) => (
                  <div
                    key={f.form}
                    className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800 p-3"
                  >
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Form {f.form}
                    </div>
                    <div className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                      {f.activeCount}
                    </div>
                    <div
                      className={`text-[11px] font-mono ${
                        f.overdueCount > 0
                          ? 'text-rose-600 dark:text-rose-400 font-semibold'
                          : f.dueSoonCount > 0
                          ? 'text-amber-700 dark:text-amber-400 font-semibold'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {f.overdueCount > 0
                        ? `${f.overdueCount} overdue`
                        : f.dueSoonCount > 0
                        ? `${f.dueSoonCount} due in 48h`
                        : 'On schedule'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 1. SCHOOL BURSAR HOME DASHBOARD
  // =========================================================================
  if (rolePermissions.role === 'School Bursar') {
    return (
      <div className="space-y-6">
        {RoleHeaderBanner}
        <AnnouncementsPanel
          school={school}
          rolePermissions={rolePermissions}
          announcements={announcements}
          authorDisplayName={authorDisplayName}
        />

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
  // 2. TEACHER / FORM TEACHER / HOD HOME DASHBOARD (NO FEE DATA)
  // =========================================================================
  if (
    rolePermissions.role === 'Subject Teacher' ||
    rolePermissions.role === 'Form Teacher' ||
    rolePermissions.role === 'Form Master' ||
    rolePermissions.role === 'Head of Department'
  ) {
    return (
      <div ref={dashboardRootRef} className="space-y-6">
        {RoleHeaderBanner}
        <AnnouncementsPanel
          school={school}
          rolePermissions={rolePermissions}
          announcements={announcements}
          authorDisplayName={authorDisplayName}
        />

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

        <TermPerformanceTrendChart
          assessments={assessments}
          currentAcademicYear={school.academicYear}
          currentTerm={school.currentTerm}
          onOpenGradebook={() => onNavigate('marks')}
        />

        <ClassPerformanceTrendChart
          assessments={termAssessments}
          term={school.currentTerm}
          onOpenGradebook={() => onNavigate('marks')}
        />

        {rolePermissions.canReadAttendance && (
          <StudentAttendanceHeatmap
            attendance={attendance}
            term={school.currentTerm}
            todayIso={todayIso}
            canWriteAttendance={rolePermissions.canWriteAttendance}
            onOpenAttendance={() =>
              onOpenStudents ? onOpenStudents('attendance') : onNavigate('students')
            }
          />
        )}

        {rolePermissions.role === 'Head of Department' && hodDepartmentSummary && (
          <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                HOD Department Oversight
              </div>
              <h2 className="mt-0.5 text-base font-semibold text-slate-900 dark:text-white">
                {hodDepartmentSummary.deptSubjects.join(' · ')}
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono">
                {hodDepartmentSummary.deptMarksCount} term assessments ·{' '}
                {hodDepartmentSummary.completionPct}% exam completion ·{' '}
                {hodDepartmentSummary.deptDrops} CA drop{' '}
                {hodDepartmentSummary.deptDrops === 1 ? 'alert' : 'alerts'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onNavigate('marks')}
                className="min-h-[38px] px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
              >
                Review Department Marks
              </button>
              <button
                type="button"
                onClick={() =>
                  onOpenLibrary ? onOpenLibrary('online', 'teaching') : onNavigate('library')
                }
                className="min-h-[38px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Online Teaching Library
              </button>
            </div>
          </section>
        )}

        {(rolePermissions.role === 'Form Teacher' || rolePermissions.role === 'Form Master') &&
          formTeacherRoster && (
          <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  My Form Class Roster — {formTeacherRoster.classLabel}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                  {formTeacherRoster.rows.length} active students · {formTeacherRoster.presentCount} marked present today
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onOpenStudents ? onOpenStudents('attendance') : onNavigate('students')
                  }
                  className="min-h-[36px] px-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
                >
                  Mark Class Roll Call
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('students')}
                  className="min-h-[36px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Open Student Directory
                </button>
              </div>
            </div>

            {formTeacherRoster.rows.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-4">
                No active students currently enrolled in {formTeacherRoster.classLabel}.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                      <th className="py-2 pr-3 font-medium">Student</th>
                      <th className="py-2 px-3 font-medium">Adm #</th>
                      <th className="py-2 px-3 font-medium">Today&apos;s Roll Call</th>
                      <th className="py-2 px-3 font-medium text-right">Term Avg</th>
                      <th className="py-2 pl-3 font-medium text-right">Library Books</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {formTeacherRoster.rows.slice(0, 10).map((r) => (
                      <tr key={r.student.id}>
                        <td className="py-2.5 pr-3 font-medium text-slate-900 dark:text-slate-100">
                          {r.student.fullName}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                          {r.student.admissionNo}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-xs font-semibold ${
                            r.attendanceStatus === 'Present'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : r.attendanceStatus === 'Absent'
                              ? 'text-rose-600 dark:text-rose-400'
                              : r.attendanceStatus === 'Late' || r.attendanceStatus === 'Excused'
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-slate-400'
                          }`}
                        >
                          {r.attendanceStatus}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-xs">
                          {r.averageScore !== null ? `${r.averageScore.toFixed(1)}%` : '—'}
                        </td>
                        <td
                          className={`py-2.5 pl-3 text-right font-mono text-xs ${
                            r.overdueLoanCount > 0
                              ? 'text-rose-600 dark:text-rose-400 font-semibold'
                              : r.dueSoonLoanCount > 0
                              ? 'text-amber-700 dark:text-amber-400 font-semibold'
                              : 'text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {r.activeLoanCount === 0
                            ? '0'
                            : r.overdueLoanCount > 0
                            ? `${r.activeLoanCount} out (${r.overdueLoanCount} overdue)`
                            : r.dueSoonLoanCount > 0
                            ? `${r.activeLoanCount} out (${r.dueSoonLoanCount} due in 48h)`
                            : `${r.activeLoanCount} out`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

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
                onClick={() =>
                  onOpenStudents ? onOpenStudents('attendance') : onNavigate('students')
                }
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap cursor-pointer"
              >
                <span>{rolePermissions.canWriteAttendance ? 'Take Roll Call' : 'Student Turnout'}</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
            <EnrollmentGenderChart rows={formBreakdown} />
          </section>
        </div>
        {boardExportModal}
      </div>
    );
  }

  // =========================================================================
  // 3. DEPUTY HEAD ACADEMIC DASHBOARD (NO FEE DATA)
  // =========================================================================
  if (rolePermissions.role === 'Deputy Head') {
    return (
      <div ref={dashboardRootRef} className="space-y-6">
        {RoleHeaderBanner}
        <AnnouncementsPanel
          school={school}
          rolePermissions={rolePermissions}
          announcements={announcements}
          authorDisplayName={authorDisplayName}
        />

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

        <TermPerformanceTrendChart
          assessments={assessments}
          currentAcademicYear={school.academicYear}
          currentTerm={school.currentTerm}
          onOpenGradebook={() => onNavigate('marks')}
        />

        <ClassPerformanceTrendChart
          assessments={termAssessments}
          term={school.currentTerm}
          onOpenGradebook={() => onNavigate('marks')}
        />

        {rolePermissions.canReadAttendance && (
          <StudentAttendanceHeatmap
            attendance={attendance}
            term={school.currentTerm}
            todayIso={todayIso}
            canWriteAttendance={rolePermissions.canWriteAttendance}
            onOpenAttendance={() =>
              onOpenStudents ? onOpenStudents('attendance') : onNavigate('students')
            }
          />
        )}

        <CaDropAlertsPanel
          assessments={termAssessments}
          students={students}
          term={school.currentTerm}
          onOpenGradebook={() => onNavigate('marks')}
        />

        {LibraryDueReminderBanner}

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
        {boardExportModal}
      </div>
    );
  }

  // =========================================================================
  // 4. OWNER / HEAD TEACHER EXECUTIVE DASHBOARD
  // =========================================================================
  return (
    <div ref={dashboardRootRef} className="space-y-6">
      {RoleHeaderBanner}
      <AnnouncementsPanel
        school={school}
        rolePermissions={rolePermissions}
        announcements={announcements}
        authorDisplayName={authorDisplayName}
      />

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

      {/* Staff Presence & Student Disciplinary Cases Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              <Clock className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
              <span>Staff Timebook &amp; Turnout ({todayIso})</span>
            </div>
            <div className="mt-2 text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {staffTurnoutStats.present} / {staffTurnoutStats.totalStaff} Present ({staffTurnoutStats.rate}%)
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              GPS Auto: {staffTurnoutStats.gpsAuto} · Not Signed In: {staffTurnoutStats.notSignedIn} · Absent: {staffTurnoutStats.absent}
              {staffTurnoutStats.onLeave > 0 ? ` · On Leave: ${staffTurnoutStats.onLeave}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={() => (onOpenStaff ? onOpenStaff('timebook') : onNavigate('staff'))}
            className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold hover:opacity-90 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>Timebook &amp; Turnout</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>

        <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
              <span>Student Cases (Suspensions &amp; Rustications)</span>
            </div>
            <div className="mt-2 text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {studentCaseStats.openCases} Open Cases
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              Suspensions: {studentCaseStats.activeSuspensions} · Rustications: {studentCaseStats.rustications} · Total: {studentCaseStats.total}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('students')}
            className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>{rolePermissions.canManageStudentCases ? 'Manage Cases' : 'View Students'}</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {rolePermissions.role === 'Owner' && onOpenStaff && (
        <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              <Database className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
              <span>Owner Database Backups &amp; Storage Bucket</span>
            </div>
            <div className="mt-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
              {backupLogs.find((b) => b.status === 'Completed')?.completedAtIso
                ? `Last snapshot: ${backupLogs
                    .find((b) => b.status === 'Completed')!
                    .completedAtIso.replace('T', ' ')
                    .slice(0, 16)} UTC (${backupLogs.find((b) => b.status === 'Completed')!.totalDocuments} docs)`
                : 'No cloud snapshot exported yet'}
            </div>
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {backupSettings?.autoBackupEnabled
                ? `Automated ${backupSettings.cadence} snapshots enabled (${backupSettings.storageTarget})`
                : 'Manual & scheduled full Firestore export to secure storage bucket'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenStaff('backups')}
            className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>Database Backups</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Term-over-Term Student Aggregate Performance Trends (Recharts) */}
      <TermPerformanceTrendChart
        assessments={assessments}
        currentAcademicYear={school.academicYear}
        currentTerm={school.currentTerm}
        onOpenGradebook={() => onNavigate('marks')}
      />

      {/* Class-Wide Academic Performance Trends (CA1, CA2, Summative) */}
      <ClassPerformanceTrendChart
        assessments={termAssessments}
        term={school.currentTerm}
        onOpenGradebook={() => onNavigate('marks')}
      />

      {/* Term Student Attendance Frequency Heatmap (D3) */}
      {rolePermissions.canReadAttendance && (
        <StudentAttendanceHeatmap
          attendance={attendance}
          term={school.currentTerm}
          todayIso={todayIso}
          canWriteAttendance={rolePermissions.canWriteAttendance}
          onOpenAttendance={() =>
            onOpenStudents ? onOpenStudents('attendance') : onNavigate('students')
          }
        />
      )}

      {/* Automated Early-Warning CA Drop Alerts */}
      <CaDropAlertsPanel
        assessments={termAssessments}
        students={students}
        term={school.currentTerm}
        onOpenGradebook={() => onNavigate('marks')}
      />

      {LibraryDueReminderBanner}

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
      {boardExportModal}
    </div>
  );
};
