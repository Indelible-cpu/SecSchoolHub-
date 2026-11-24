import {
  calculateTermReportSummary,
  TermReportCardSummary,
  TermReportSubjectRow,
} from './malawi';
import {
  Assessment,
  AttendanceRecord,
  FormLevel,
  School,
  Student,
  TermName,
} from './types';

export type ReportCardTemplateId =
  | 'classic-maneb'
  | 'modern-executive'
  | 'compact-parent-slip'
  | 'detailed-transcript';

export interface AcademicReportTemplateMeta {
  id: ReportCardTemplateId;
  name: string;
  subtitle: string;
  bestFor: string;
  accentHex: string;
  supportsCaDelta: boolean;
  supportsGuardianSlip: boolean;
  defaultOptions: ReportCardExportOptions;
}

export interface ReportCardExportOptions {
  includeGradingKey: boolean;
  includeAttendance: boolean;
  includeRank: boolean;
  includeRemarks: boolean;
  includeGuardianSlip: boolean;
}

export const ACADEMIC_REPORT_TEMPLATES: AcademicReportTemplateMeta[] = [
  {
    id: 'classic-maneb',
    name: 'Classic MANEB Official',
    subtitle: 'Traditional Ministry-style card with school crest, grading key, and dual signatures.',
    bestFor: 'Official term-end filing',
    accentHex: '#0D6E52',
    supportsCaDelta: false,
    supportsGuardianSlip: false,
    defaultOptions: {
      includeGradingKey: true,
      includeAttendance: true,
      includeRank: true,
      includeRemarks: true,
      includeGuardianSlip: false,
    },
  },
  {
    id: 'modern-executive',
    name: 'Modern Academic Executive',
    subtitle: 'Editorial layout with KPI strip, CA/Exam composition bar, and streamlined subject table.',
    bestFor: 'Digital & parent sharing',
    accentHex: '#0F172A',
    supportsCaDelta: false,
    supportsGuardianSlip: false,
    defaultOptions: {
      includeGradingKey: true,
      includeAttendance: true,
      includeRank: true,
      includeRemarks: true,
      includeGuardianSlip: false,
    },
  },
  {
    id: 'compact-parent-slip',
    name: 'Compact Parent Slip',
    subtitle: 'Ink-saving monochrome slip with guardian contacts and tear-off acknowledgement footer.',
    bestFor: 'High-volume B&W printing',
    accentHex: '#334155',
    supportsCaDelta: false,
    supportsGuardianSlip: true,
    defaultOptions: {
      includeGradingKey: false,
      includeAttendance: true,
      includeRank: true,
      includeRemarks: true,
      includeGuardianSlip: true,
    },
  },
  {
    id: 'detailed-transcript',
    name: 'Detailed CA Transcript',
    subtitle: 'Diagnostic sheet showing CA1→CA2 progression delta, attendance breakdown, and seal block.',
    bestFor: 'Academic reviews & conferences',
    accentHex: '#1E3A5F',
    supportsCaDelta: true,
    supportsGuardianSlip: false,
    defaultOptions: {
      includeGradingKey: true,
      includeAttendance: true,
      includeRank: true,
      includeRemarks: true,
      includeGuardianSlip: false,
    },
  },
];

export function getReportTemplateMeta(templateId: ReportCardTemplateId): AcademicReportTemplateMeta {
  return (
    ACADEMIC_REPORT_TEMPLATES.find((t) => t.id === templateId) ||
    ACADEMIC_REPORT_TEMPLATES[0]
  );
}

export interface StudentClassRank {
  rank: number;
  totalRanked: number;
  formLabel: string;
}

export interface StudentReportAttendanceStats {
  present: number;
  late: number;
  absent: number;
  excused: number;
  totalMarked: number;
  ratePct: number | null;
}

export interface BuiltStudentReportCard {
  school: School;
  student: Student;
  term: TermName;
  summary: TermReportCardSummary;
  classRank: StudentClassRank | null;
  attendanceStats: StudentReportAttendanceStats | null;
  formTeacherRemark: string;
  headTeacherRemark: string;
  nextTermOpens: string;
}

/**
 * Computes ordinal class rankings per Form Level for a given academic term.
 * Students are ranked in descending order of weighted term average, tie-broken
 * by lower MSCE Best-6 points (for Forms 3–4) or higher passed subject count.
 */
export function computeFormRankings(params: {
  students: Student[];
  assessments: Assessment[];
  term: TermName;
  academicYear?: string;
}): Map<string, StudentClassRank> {
  const { students, assessments, term, academicYear } = params;
  const rankMap = new Map<string, StudentClassRank>();

  const assessmentsByStudent = new Map<string, Assessment[]>();
  for (const a of assessments) {
    if (a.term !== term) continue;
    if (academicYear && a.academicYear && a.academicYear !== academicYear) continue;
    const list = assessmentsByStudent.get(a.studentId) || [];
    list.push(a);
    assessmentsByStudent.set(a.studentId, list);
  }

  // Fallback if academicYear filter yields zero entries (e.g. legacy records)
  if (assessmentsByStudent.size === 0 && academicYear) {
    for (const a of assessments) {
      if (a.term !== term) continue;
      const list = assessmentsByStudent.get(a.studentId) || [];
      list.push(a);
      assessmentsByStudent.set(a.studentId, list);
    }
  }

  const byForm = new Map<
    FormLevel,
    Array<{ studentId: string; avg: number; bestSix: number; passedCount: number }>
  >();

  for (const stu of students) {
    const stuAssessments = assessmentsByStudent.get(stu.id);
    if (!stuAssessments || stuAssessments.length === 0) continue;
    const summary = calculateTermReportSummary(stu.formLevel, stuAssessments);
    const bucket = byForm.get(stu.formLevel) || [];
    bucket.push({
      studentId: stu.id,
      avg: summary.weightedAverage,
      bestSix: summary.standing.bestSixPoints ?? 999,
      passedCount: summary.passedSubjectCount,
    });
    byForm.set(stu.formLevel, bucket);
  }

  for (const [formLevel, cohort] of byForm.entries()) {
    cohort.sort(
      (a, b) =>
        b.avg - a.avg ||
        a.bestSix - b.bestSix ||
        b.passedCount - a.passedCount ||
        a.studentId.localeCompare(b.studentId)
    );

    const totalRanked = cohort.length;
    let currentRank = 1;
    cohort.forEach((entry, index) => {
      if (index > 0) {
        const prev = cohort[index - 1];
        const isTie =
          Math.abs(prev.avg - entry.avg) < 0.05 &&
          prev.bestSix === entry.bestSix &&
          prev.passedCount === entry.passedCount;
        if (!isTie) {
          currentRank = index + 1;
        }
      }
      rankMap.set(entry.studentId, {
        rank: currentRank,
        totalRanked,
        formLabel: `Form ${formLevel}`,
      });
    });
  }

  return rankMap;
}

export function formatOrdinalPosition(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

export function computeStudentAttendanceStats(
  attendance: AttendanceRecord[],
  studentId: string
): StudentReportAttendanceStats | null {
  const records = attendance.filter((r) => r.studentId === studentId);
  if (records.length === 0) return null;

  let present = 0;
  let late = 0;
  let absent = 0;
  let excused = 0;

  for (const r of records) {
    if (r.status === 'Present') present += 1;
    else if (r.status === 'Late') late += 1;
    else if (r.status === 'Absent') absent += 1;
    else if (r.status === 'Excused') excused += 1;
  }

  const totalMarked = records.length;
  const ratePct =
    totalMarked > 0 ? Math.round(((present + late) / totalMarked) * 1000) / 10 : null;

  return { present, late, absent, excused, totalMarked, ratePct };
}

export function computeSubjectCaDeltaPct(row: TermReportSubjectRow): number | null {
  if (!row.hasCa1 || !row.hasCa2) return null;
  const ca1Pct = (row.ca1Score / 20) * 100;
  const ca2Pct = (row.ca2Score / 20) * 100;
  return Math.round((ca2Pct - ca1Pct) * 10) / 10;
}

export function generateDefaultTeacherRemarks(
  summary: TermReportCardSummary,
  student: Student,
  rank?: StudentClassRank | null
): { formTeacherRemark: string; headTeacherRemark: string } {
  if (summary.subjectCount === 0) {
    return {
      formTeacherRemark: 'Awaiting subject assessment records for this academic term.',
      headTeacherRemark: 'Please ensure all continuous assessments and exams are submitted.',
    };
  }

  const firstName = student.fullName.split(' ')[0] || student.fullName;
  const avg = summary.weightedAverage;
  const rankNote =
    rank && rank.totalRanked > 1
      ? ` Ranked ${formatOrdinalPosition(rank.rank)} out of ${rank.totalRanked} in ${rank.formLabel}.`
      : '';

  let formTeacherRemark = '';
  if (avg >= 75) {
    formTeacherRemark = `Excellent academic effort by ${firstName} across ${summary.subjectCount} subjects.${rankNote} Keep up the disciplined study habits.`;
  } else if (avg >= 60) {
    formTeacherRemark = `Good and steady progress this term with ${summary.creditSubjectCount} credit passes.${rankNote} Aim for higher exam consistency.`;
  } else if (summary.standing.outcome === 'Pass') {
    formTeacherRemark = `Satisfactory performance.${rankNote} Extra revision in weaker subjects will lift next term's aggregate.`;
  } else if (!summary.standing.passedEnglish) {
    formTeacherRemark = `${firstName} must prioritize English pass requirements alongside core subjects.${rankNote} Regular remedial practice is advised.`;
  } else {
    formTeacherRemark = `Performance below target this term.${rankNote} Closer supervision of homework and CA tests is recommended.`;
  }

  let headTeacherRemark = '';
  if (summary.standing.outcome === 'Pass' && avg >= 70) {
    headTeacherRemark = `Commendable ${summary.system} standing. Promoted/Cleared with distinction potential.`;
  } else if (summary.standing.outcome === 'Pass') {
    headTeacherRemark = `${summary.system} Pass achieved. Encouraged to target stronger credits next term.`;
  } else if (summary.standing.outcome === 'Incomplete') {
    const minSubjects = student.formLevel >= 3 ? 6 : 5;
    headTeacherRemark = `Incomplete ${summary.system} profile (${summary.subjectCount}/${minSubjects} subjects graded). Complete missing papers.`;
  } else {
    headTeacherRemark = `${summary.system} requirements not yet met. Guardian consultation requested before next term.`;
  }

  return { formTeacherRemark, headTeacherRemark };
}

export function buildStudentReportCardPayload(params: {
  school: School;
  student: Student;
  term: TermName;
  summary: TermReportCardSummary;
  classRank?: StudentClassRank | null;
  attendanceStats?: StudentReportAttendanceStats | null;
  formTeacherRemark?: string;
  headTeacherRemark?: string;
  nextTermOpens?: string;
}): BuiltStudentReportCard {
  const defaults = generateDefaultTeacherRemarks(params.summary, params.student, params.classRank);
  return {
    school: params.school,
    student: params.student,
    term: params.term,
    summary: params.summary,
    classRank: params.classRank ?? null,
    attendanceStats: params.attendanceStats ?? null,
    formTeacherRemark:
      params.formTeacherRemark !== undefined && params.formTeacherRemark.trim() !== ''
        ? params.formTeacherRemark.trim()
        : defaults.formTeacherRemark,
    headTeacherRemark:
      params.headTeacherRemark !== undefined && params.headTeacherRemark.trim() !== ''
        ? params.headTeacherRemark.trim()
        : defaults.headTeacherRemark,
    nextTermOpens: (params.nextTermOpens || '').trim(),
  };
}
