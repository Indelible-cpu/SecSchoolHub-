import {
  Assessment,
  FormLevel,
  LibraryItemCondition,
  LibraryLoan,
  LibraryMaterialCategory,
  RolePermissions,
  SchoolSubject,
  SchoolType,
  TermName,
  WorkspaceRole,
} from './types';

export const MALAWI_DISTRICTS: string[] = [
  'Lilongwe',
  'Blantyre',
  'Zomba',
  'Mzuzu',
  'Kasungu',
  'Mangochi',
  'Dedza',
  'Salima',
  'Karonga',
  'Mulanje',
  'Thyolo',
  'Chiradzulu',
  'Balaka',
  'Ntcheu',
  'Mchinji',
  'Dowa',
  'Nkhotakota',
  'Rumphi',
  'Mzimba',
  'Nkhata Bay',
  'Phalombe',
  'Chikwawa',
  'Nsanje',
  'Likoma',
  'Chitipa',
  'Ntchisi',
  'Neno',
  'Mwanza',
];

export const MALAWI_SUBJECTS: string[] = [
  'English',
  'Chichewa',
  'Mathematics',
  'Biology',
  'Physical Science',
  'Geography',
  'History',
  'Agriculture',
  'Bible Knowledge',
  'Social & Life Skills',
  'Business Studies',
  'Computer Studies',
];

export interface DefaultSubjectPreset {
  name: string;
  code: string;
  formLevels: FormLevel[];
  isCore: boolean;
}

export const DEFAULT_MALAWI_SUBJECT_PRESETS: DefaultSubjectPreset[] = [
  { name: 'English', code: 'ENG', formLevels: [1, 2, 3, 4], isCore: true },
  { name: 'Chichewa', code: 'CHI', formLevels: [1, 2, 3, 4], isCore: true },
  { name: 'Mathematics', code: 'MAT', formLevels: [1, 2, 3, 4], isCore: true },
  { name: 'Biology', code: 'BIO', formLevels: [1, 2, 3, 4], isCore: true },
  { name: 'Physical Science', code: 'PSC', formLevels: [1, 2, 3, 4], isCore: true },
  { name: 'Geography', code: 'GEO', formLevels: [1, 2, 3, 4], isCore: false },
  { name: 'History', code: 'HIS', formLevels: [1, 2, 3, 4], isCore: false },
  { name: 'Agriculture', code: 'AGR', formLevels: [1, 2, 3, 4], isCore: false },
  { name: 'Bible Knowledge', code: 'BKN', formLevels: [1, 2, 3, 4], isCore: false },
  { name: 'Social & Life Skills', code: 'SLS', formLevels: [1, 2, 3, 4], isCore: true },
  { name: 'Business Studies', code: 'BUS', formLevels: [1, 2, 3, 4], isCore: false },
  { name: 'Computer Studies', code: 'CMP', formLevels: [1, 2, 3, 4], isCore: false },
];

export function getSubjectsForForm(
  schoolSubjects: SchoolSubject[],
  formLevel: FormLevel
): string[] {
  if (schoolSubjects.length === 0) {
    return MALAWI_SUBJECTS;
  }
  return schoolSubjects
    .filter((s) => s.formLevels.includes(formLevel))
    .map((s) => s.name)
    .sort((a, b) => a.localeCompare(b));
}

export const SCHOOL_TYPES: SchoolType[] = [
  'Government Day',
  'Government Boarding',
  'Grant-Aided',
  'Private',
];

export const TERMS: TermName[] = ['Term 1', 'Term 2', 'Term 3'];

export const FORM_LEVELS: FormLevel[] = [1, 2, 3, 4];

export const STREAMS = ['A', 'B', 'C', 'North', 'South'];

export function isGovernmentSchool(schoolType: SchoolType): boolean {
  return schoolType === 'Government Day' || schoolType === 'Government Boarding';
}

export function getAcademicBaseYear(academicYear?: string): number {
  const match = String(academicYear ?? '').match(/\b(20\d{2})\b/);
  if (match) {
    const parsed = Number(match[1]);
    if (parsed >= 2000 && parsed <= 2100) return parsed;
  }
  return new Date().getFullYear();
}

export function getDefaultEntryYear(formLevel: FormLevel, academicYear?: string): number {
  const baseYear = getAcademicBaseYear(academicYear);
  const level = Math.min(4, Math.max(1, Math.round(formLevel)));
  return Math.min(2100, Math.max(2000, baseYear - (level - 1)));
}

export function inferStudentEntryYear(
  student: { entryYear?: number; admissionNo?: string; formLevel: FormLevel },
  academicYear?: string
): number {
  const explicit = Number(student.entryYear);
  if (Number.isFinite(explicit) && explicit >= 2000 && explicit <= 2100) {
    return Math.round(explicit);
  }
  const admMatch = String(student.admissionNo ?? '').match(/\b(20\d{2})\b/);
  if (admMatch) {
    const parsed = Number(admMatch[1]);
    if (parsed >= 2000 && parsed <= 2100) return parsed;
  }
  return getDefaultEntryYear(student.formLevel, academicYear);
}

export function formatStreamCodeToken(stream?: string): string {
  const cleaned = String(stream ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return (cleaned || 'A').slice(0, 6);
}

export function normalizeRegistrationCode(raw?: string): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 32);
}

export interface GenerateStudentCodeOptions {
  formLevel?: FormLevel;
  stream?: string;
  entryYear?: number;
  usedCodes?: Iterable<string>;
}

export function generateStudentRegistrationCode(options?: GenerateStudentCodeOptions): string {
  const formLevel = Math.min(
    4,
    Math.max(1, Math.round(Number(options?.formLevel) || 1))
  ) as FormLevel;
  const streamToken = formatStreamCodeToken(options?.stream);
  const rawYear = Number(options?.entryYear);
  const entryYear =
    Number.isFinite(rawYear) && rawYear >= 2000 && rawYear <= 2100
      ? Math.round(rawYear)
      : getDefaultEntryYear(formLevel);

  const prefix = `F${formLevel}${streamToken}-${entryYear}`;
  const used = new Set<string>();
  let maxSeq = 0;
  const seqRegex = new RegExp(`^${prefix}-(\\d{1,4})$`);

  if (options?.usedCodes) {
    for (const raw of options.usedCodes) {
      const norm = normalizeRegistrationCode(raw);
      if (!norm) continue;
      used.add(norm);
      const match = norm.match(seqRegex);
      if (match) {
        const seq = Number(match[1]);
        if (Number.isFinite(seq) && seq > maxSeq) {
          maxSeq = seq;
        }
      }
    }
  }

  let nextSeq = maxSeq + 1;
  let candidate = `${prefix}-${String(nextSeq).padStart(3, '0')}`;
  while (used.has(candidate)) {
    nextSeq += 1;
    candidate = `${prefix}-${String(nextSeq).padStart(3, '0')}`;
  }
  return candidate;
}

export function getRolePermissions(role: WorkspaceRole): RolePermissions {
  if (role === 'Owner') {
    return {
      role,
      roleLabel: 'School Owner / Admin',
      homeTitle: 'Head Teacher Dashboard',
      allowedSections: ['overview', 'students', 'marks', 'fees', 'attendance', 'library', 'staff'],
      canManageSchool: true,
      canManageStaff: true,
      canManageStudents: true,
      canReadMarks: true,
      canWriteMarks: true,
      canReadFees: true,
      canWriteFees: true,
      canReadAttendance: true,
      canWriteAttendance: true,
      canReadLibrary: true,
      canWriteLibrary: true,
      canReadTeachers: true,
    };
  }

  if (role === 'Head Teacher') {
    return {
      role,
      roleLabel: 'Head Teacher',
      homeTitle: 'Head Teacher Dashboard',
      allowedSections: ['overview', 'students', 'marks', 'fees', 'attendance', 'library', 'staff'],
      canManageSchool: false,
      canManageStaff: false,
      canManageStudents: true,
      canReadMarks: true,
      canWriteMarks: true,
      canReadFees: true,
      canWriteFees: true,
      canReadAttendance: true,
      canWriteAttendance: true,
      canReadLibrary: true,
      canWriteLibrary: true,
      canReadTeachers: true,
    };
  }

  if (role === 'Deputy Head') {
    return {
      role,
      roleLabel: 'Deputy Head Teacher',
      homeTitle: 'Deputy Head Dashboard',
      allowedSections: ['overview', 'students', 'marks', 'attendance', 'library', 'staff'],
      canManageSchool: false,
      canManageStaff: false,
      canManageStudents: true,
      canReadMarks: true,
      canWriteMarks: true,
      canReadFees: false,
      canWriteFees: false,
      canReadAttendance: true,
      canWriteAttendance: true,
      canReadLibrary: true,
      canWriteLibrary: true,
      canReadTeachers: true,
    };
  }

  if (role === 'School Bursar') {
    return {
      role,
      roleLabel: 'School Bursar',
      homeTitle: 'Bursar Financial Dashboard',
      allowedSections: ['overview', 'fees', 'students'],
      canManageSchool: false,
      canManageStaff: false,
      canManageStudents: false,
      canReadMarks: false,
      canWriteMarks: false,
      canReadFees: true,
      canWriteFees: true,
      canReadAttendance: false,
      canWriteAttendance: false,
      canReadLibrary: false,
      canWriteLibrary: false,
      canReadTeachers: false,
    };
  }

  if (role === 'School Librarian') {
    return {
      role,
      roleLabel: 'School Librarian',
      homeTitle: 'School Library Dashboard',
      allowedSections: ['overview', 'library', 'students'],
      canManageSchool: false,
      canManageStaff: false,
      canManageStudents: false,
      canReadMarks: false,
      canWriteMarks: false,
      canReadFees: false,
      canWriteFees: false,
      canReadAttendance: false,
      canWriteAttendance: false,
      canReadLibrary: true,
      canWriteLibrary: true,
      canReadTeachers: false,
    };
  }

  // Head of Department, Form Master (Form Teacher), Subject Teacher
  const roleLabel =
    role === 'Head of Department'
      ? 'Head of Department (HOD)'
      : role === 'Form Master'
      ? 'Form Teacher (Form Master)'
      : role;
  const homeTitle =
    role === 'Head of Department'
      ? 'HOD Department Dashboard'
      : role === 'Form Master'
      ? 'Form Teacher Dashboard'
      : 'Teacher Home Dashboard';

  return {
    role,
    roleLabel,
    homeTitle,
    allowedSections: ['overview', 'marks', 'attendance', 'library', 'students'],
    canManageSchool: false,
    canManageStaff: false,
    canManageStudents: false,
    canReadMarks: true,
    canWriteMarks: true,
    canReadFees: false,
    canWriteFees: false,
    canReadAttendance: true,
    canWriteAttendance: true,
    canReadLibrary: true,
    canWriteLibrary: true,
    canReadTeachers: false,
  };
}

export const LIBRARY_MATERIAL_CATEGORIES: LibraryMaterialCategory[] = [
  'Textbook',
  'Set Book',
  'Reference Book',
  'Past Papers',
  'Reader / Novel',
  'Science Manual',
];

export const LIBRARY_RETURN_CONDITIONS: LibraryItemCondition[] = [
  'Good',
  'Fair',
  'Damaged',
  'Lost',
];

export function addDaysToIsoDate(isoDate: string, days: number): string {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(isoDate)
    ? new Date(`${isoDate}T00:00:00Z`)
    : new Date();
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function isLibraryLoanOverdue(
  loan: Pick<LibraryLoan, 'status' | 'dueDate'>,
  todayIso = new Date().toISOString().slice(0, 10)
): boolean {
  return loan.status === 'Checked Out' && Boolean(loan.dueDate) && loan.dueDate < todayIso;
}

export function getLibraryDaysOverdue(
  dueDate: string,
  todayIso = new Date().toISOString().slice(0, 10)
): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !/^\d{4}-\d{2}-\d{2}$/.test(todayIso)) {
    return 0;
  }
  const dueMs = Date.parse(`${dueDate}T00:00:00Z`);
  const todayMs = Date.parse(`${todayIso}T00:00:00Z`);
  if (!Number.isFinite(dueMs) || !Number.isFinite(todayMs) || todayMs <= dueMs) {
    return 0;
  }
  return Math.round((todayMs - dueMs) / (1000 * 60 * 60 * 24));
}

export function formatMWK(amount: number): string {
  if (!Number.isFinite(amount)) return 'MK 0';
  const neg = amount < 0;
  const rounded = Math.round(Math.abs(amount));
  const formatted = new Intl.NumberFormat('en-MW').format(rounded);
  return `${neg ? '-' : ''}MK ${formatted}`;
}

export function calculateWeightedComponent(
  rawScore: number,
  totalMarks: number,
  weightPercent: number
): number {
  if (!Number.isFinite(totalMarks) || totalMarks <= 0 || !Number.isFinite(rawScore)) {
    return 0;
  }
  const clamped = Math.min(totalMarks, Math.max(0, rawScore));
  return Math.round(((clamped / totalMarks) * weightPercent) * 10) / 10;
}

export interface NormalizedAssessmentBreakdown {
  ca1Raw: number;
  ca1Max: number;
  ca1Score: number;
  hasCa1: boolean;
  ca2Raw: number;
  ca2Max: number;
  ca2Score: number;
  hasCa2: boolean;
  caScore: number;
  examRaw: number;
  examMax: number;
  examScore: number;
  hasExam: boolean;
}

export function normalizeAssessmentComponents(a: Assessment): NormalizedAssessmentBreakdown {
  if (typeof a.ca1Max === 'number') {
    const ca1Max = Math.max(0, Number(a.ca1Max) || 0);
    const ca1Raw = Math.min(ca1Max, Math.max(0, Number(a.ca1Raw) || 0));
    const ca1Score =
      typeof a.ca1Score === 'number'
        ? Math.min(20, Math.max(0, a.ca1Score))
        : calculateWeightedComponent(ca1Raw, ca1Max, 20);

    const ca2Max = Math.max(0, Number(a.ca2Max) || 0);
    const ca2Raw = Math.min(ca2Max, Math.max(0, Number(a.ca2Raw) || 0));
    const ca2Score =
      typeof a.ca2Score === 'number'
        ? Math.min(20, Math.max(0, a.ca2Score))
        : calculateWeightedComponent(ca2Raw, ca2Max, 20);

    const examMax = Math.max(0, Number(a.examMax) || 0);
    const examRaw = Math.min(examMax, Math.max(0, Number(a.examRaw) || 0));
    const examScore =
      examMax > 0
        ? calculateWeightedComponent(examRaw, examMax, 60)
        : Math.min(60, Math.max(0, Number(a.examScore) || 0));

    return {
      ca1Raw,
      ca1Max,
      ca1Score,
      hasCa1: ca1Max > 0,
      ca2Raw,
      ca2Max,
      ca2Score,
      hasCa2: ca2Max > 0,
      caScore: Math.round((ca1Score + ca2Score) * 10) / 10,
      examRaw,
      examMax,
      examScore,
      hasExam: examMax > 0,
    };
  }

  // Legacy fallback (pre-CA1/CA2 split documents)
  const legacyCa = Math.min(40, Math.max(0, Number(a.caScore) || 0));
  const legacyExam = Math.min(60, Math.max(0, Number(a.examScore) || 0));
  const ca1Score = Math.round((legacyCa / 2) * 10) / 10;
  const ca2Score = Math.round((legacyCa - ca1Score) * 10) / 10;

  return {
    ca1Raw: ca1Score,
    ca1Max: legacyCa > 0 ? 20 : 0,
    ca1Score,
    hasCa1: legacyCa > 0,
    ca2Raw: ca2Score,
    ca2Max: legacyCa > 0 ? 20 : 0,
    ca2Score,
    hasCa2: legacyCa > 0,
    caScore: legacyCa,
    examRaw: legacyExam,
    examMax: legacyExam > 0 ? 60 : 0,
    examScore: legacyExam,
    hasExam: legacyExam > 0,
  };
}

export function detectNextAssessmentStage(
  existing?: Assessment | null
): 'ca1' | 'ca2' | 'exam' {
  if (!existing) return 'ca1';
  const norm = normalizeAssessmentComponents(existing);
  if (!norm.hasCa1) return 'ca1';
  if (!norm.hasCa2) return 'ca2';
  return 'exam';
}

export interface ManebGradeResult {
  totalScore: number;
  grade: string;
  gradePoint: number;
  remark: string;
  system: 'JCE' | 'MSCE';
}

export function calculateManebGrade(
  formLevel: FormLevel,
  caScore: number,
  examScore: number
): ManebGradeResult {
  const clampedCa = Math.min(40, Math.max(0, Number(caScore) || 0));
  const clampedExam = Math.min(60, Math.max(0, Number(examScore) || 0));
  const total = Math.round((clampedCa + clampedExam) * 10) / 10;

  if (formLevel <= 2) {
    // JCE (Form 1 & Form 2) Letter Scale
    if (total >= 80) return { totalScore: total, grade: 'A', gradePoint: 1, remark: 'Distinction', system: 'JCE' };
    if (total >= 70) return { totalScore: total, grade: 'B', gradePoint: 3, remark: 'Very Good', system: 'JCE' };
    if (total >= 60) return { totalScore: total, grade: 'C', gradePoint: 5, remark: 'Credit', system: 'JCE' };
    if (total >= 50) return { totalScore: total, grade: 'D', gradePoint: 7, remark: 'Pass', system: 'JCE' };
    return { totalScore: total, grade: 'F', gradePoint: 9, remark: 'Fail', system: 'JCE' };
  }

  // MSCE (Form 3 & Form 4) 1-9 Point Scale
  if (total >= 80) return { totalScore: total, grade: '1', gradePoint: 1, remark: 'Distinction', system: 'MSCE' };
  if (total >= 75) return { totalScore: total, grade: '2', gradePoint: 2, remark: 'Distinction', system: 'MSCE' };
  if (total >= 70) return { totalScore: total, grade: '3', gradePoint: 3, remark: 'Strong Credit', system: 'MSCE' };
  if (total >= 65) return { totalScore: total, grade: '4', gradePoint: 4, remark: 'Credit', system: 'MSCE' };
  if (total >= 60) return { totalScore: total, grade: '5', gradePoint: 5, remark: 'Credit', system: 'MSCE' };
  if (total >= 55) return { totalScore: total, grade: '6', gradePoint: 6, remark: 'Credit', system: 'MSCE' };
  if (total >= 50) return { totalScore: total, grade: '7', gradePoint: 7, remark: 'Pass', system: 'MSCE' };
  if (total >= 40) return { totalScore: total, grade: '8', gradePoint: 8, remark: 'Pass', system: 'MSCE' };
  return { totalScore: total, grade: '9', gradePoint: 9, remark: 'Fail', system: 'MSCE' };
}

export interface AggregateSummary {
  subjectCount: number;
  averageScore: number;
  bestSixPoints: number | null;
  passedEnglish: boolean;
  outcome: 'Pass' | 'Fail' | 'Incomplete';
}

export function calculateStudentStanding(
  formLevel: FormLevel,
  assessments: Assessment[]
): AggregateSummary {
  if (assessments.length === 0) {
    return {
      subjectCount: 0,
      averageScore: 0,
      bestSixPoints: null,
      passedEnglish: false,
      outcome: 'Incomplete',
    };
  }

  const avg =
    assessments.reduce((acc, item) => acc + item.totalScore, 0) / assessments.length;

  const english = assessments.find((a) => a.subject.toLowerCase() === 'english');
  const passedEnglish = english ? english.gradePoint <= 8 : false;

  if (formLevel >= 3) {
    if (assessments.length < 6) {
      return {
        subjectCount: assessments.length,
        averageScore: avg,
        bestSixPoints: null,
        passedEnglish,
        outcome: 'Incomplete',
      };
    }

    // Best 6 including English if available
    let selected: Assessment[] = [];
    if (english) {
      const others = assessments
        .filter((a) => a.id !== english.id)
        .sort((a, b) => a.gradePoint - b.gradePoint || b.totalScore - a.totalScore)
        .slice(0, 5);
      selected = [english, ...others];
    } else {
      selected = [...assessments]
        .sort((a, b) => a.gradePoint - b.gradePoint || b.totalScore - a.totalScore)
        .slice(0, 6);
    }

    const bestSixPoints = selected.reduce((sum, item) => sum + item.gradePoint, 0);
    const creditsCount = selected.filter((item) => item.gradePoint <= 6).length;
    const passedAllSix = selected.every((item) => item.gradePoint <= 8);

    // MSCE pass typically requires passing English + 5 subjects with at least 1 credit (or 5 credits + pass)
    const outcome = passedEnglish && passedAllSix && creditsCount >= 1 ? 'Pass' : 'Fail';

    return {
      subjectCount: assessments.length,
      averageScore: avg,
      bestSixPoints,
      passedEnglish,
      outcome,
    };
  }

  // JCE Form 1-2
  const passedSubjects = assessments.filter((a) => a.gradePoint <= 7).length;
  const outcome =
    assessments.length < 5
      ? 'Incomplete'
      : passedEnglish && passedSubjects >= 5
      ? 'Pass'
      : 'Fail';

  return {
    subjectCount: assessments.length,
    averageScore: avg,
    bestSixPoints: null,
    passedEnglish,
    outcome,
  };
}

export interface TermReportSubjectRow {
  assessment: Assessment;
  ca1Score: number;
  hasCa1: boolean;
  ca2Score: number;
  hasCa2: boolean;
  caTotal: number;
  examScore: number;
  hasExam: boolean;
  totalScore: number;
  grade: string;
  gradePoint: number;
  remark: string;
}

export interface TermReportCardSummary {
  rows: TermReportSubjectRow[];
  subjectCount: number;
  passedSubjectCount: number;
  creditSubjectCount: number;
  ca1Average: number;
  ca2Average: number;
  caAverage: number;
  summativeAverage: number;
  weightedAverage: number;
  meanManebPoint: number | null;
  overallGrade: string;
  overallRemark: string;
  system: 'JCE' | 'MSCE';
  standing: AggregateSummary;
}

export function calculateTermReportSummary(
  formLevel: FormLevel,
  studentTermAssessments: Assessment[]
): TermReportCardSummary {
  const sorted = [...studentTermAssessments].sort((a, b) => a.subject.localeCompare(b.subject));
  const rows: TermReportSubjectRow[] = sorted.map((a) => {
    const b = normalizeAssessmentComponents(a);
    const totalScore = Math.round((b.ca1Score + b.ca2Score + b.examScore) * 10) / 10;
    const maneb = calculateManebGrade(formLevel, b.caScore, b.examScore);
    return {
      assessment: a,
      ca1Score: b.ca1Score,
      hasCa1: b.hasCa1,
      ca2Score: b.ca2Score,
      hasCa2: b.hasCa2,
      caTotal: b.caScore,
      examScore: b.examScore,
      hasExam: b.hasExam,
      totalScore,
      grade: maneb.grade,
      gradePoint: maneb.gradePoint,
      remark: maneb.remark,
    };
  });

  const count = rows.length;
  const standing = calculateStudentStanding(formLevel, studentTermAssessments);

  if (count === 0) {
    return {
      rows: [],
      subjectCount: 0,
      passedSubjectCount: 0,
      creditSubjectCount: 0,
      ca1Average: 0,
      ca2Average: 0,
      caAverage: 0,
      summativeAverage: 0,
      weightedAverage: 0,
      meanManebPoint: null,
      overallGrade: '—',
      overallRemark: 'No Marks',
      system: formLevel <= 2 ? 'JCE' : 'MSCE',
      standing,
    };
  }

  const passedSubjectCount = rows.filter((r) =>
    formLevel <= 2 ? r.gradePoint <= 7 : r.gradePoint <= 8
  ).length;
  const creditSubjectCount = rows.filter((r) => r.gradePoint <= 6).length;
  const ca1Average = Math.round((rows.reduce((s, r) => s + r.ca1Score, 0) / count) * 10) / 10;
  const ca2Average = Math.round((rows.reduce((s, r) => s + r.ca2Score, 0) / count) * 10) / 10;
  const caAverage = Math.round((ca1Average + ca2Average) * 10) / 10;
  const summativeAverage = Math.round((rows.reduce((s, r) => s + r.examScore, 0) / count) * 10) / 10;
  const weightedAverage =
    Math.round((rows.reduce((s, r) => s + r.totalScore, 0) / count) * 10) / 10;
  const meanManebPoint =
    Math.round((rows.reduce((s, r) => s + r.gradePoint, 0) / count) * 10) / 10;

  const overallManeb = calculateManebGrade(formLevel, caAverage, summativeAverage);

  return {
    rows,
    subjectCount: count,
    passedSubjectCount,
    creditSubjectCount,
    ca1Average,
    ca2Average,
    caAverage,
    summativeAverage,
    weightedAverage,
    meanManebPoint,
    overallGrade: overallManeb.grade,
    overallRemark: overallManeb.remark,
    system: overallManeb.system,
    standing,
  };
}

export function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (val: string | number) => `"${String(val).replace(/"/g, '""')}"`;
  const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function formatMalawiSmsPhone(rawPhone?: string): string | null {
  const cleaned = String(rawPhone ?? '').replace(/[^\d+]/g, '');
  if (!cleaned) return null;

  let normalized = cleaned;
  if (normalized.startsWith('00265')) {
    normalized = `+265${normalized.slice(5)}`;
  } else if (normalized.startsWith('265')) {
    normalized = `+${normalized}`;
  } else if (normalized.startsWith('0') && normalized.length >= 9 && normalized.length <= 10) {
    normalized = `+265${normalized.slice(1)}`;
  }

  if (!/^\+\d{8,15}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

export function formatSmsSenderLabel(schoolName: string): string {
  const trimmed = String(schoolName ?? '').trim();
  if (!trimmed) return 'MalawiSec';
  return trimmed.slice(0, 32);
}

export type CaDropSeverity = 'critical' | 'warning';

export interface CaDropAlert {
  assessmentId: string;
  studentId: string;
  studentName: string;
  formLevel: FormLevel;
  stream: string;
  term: TermName;
  subject: string;
  ca1Pct: number;
  ca2Pct: number;
  ca1Weighted: number;
  ca2Weighted: number;
  dropPct: number;
  severity: CaDropSeverity;
}

export interface StudentRiskSummary {
  studentId: string;
  studentName: string;
  formLevel: FormLevel;
  stream: string;
  alerts: CaDropAlert[];
  maxDropPct: number;
  highestSeverity: CaDropSeverity;
}

export function evaluateAssessmentCaDrop(
  assessment: Assessment,
  minDropPct = 10
): CaDropAlert | null {
  const norm = normalizeAssessmentComponents(assessment);
  if (!norm.hasCa1 || !norm.hasCa2) return null;

  const ca1Pct = Math.round((norm.ca1Score / 20) * 1000) / 10;
  const ca2Pct = Math.round((norm.ca2Score / 20) * 1000) / 10;
  const dropPct = Math.round((ca1Pct - ca2Pct) * 10) / 10;

  if (dropPct < minDropPct) return null;

  const severity: CaDropSeverity =
    dropPct >= 20 || (dropPct >= 15 && ca2Pct < 50) ? 'critical' : 'warning';

  return {
    assessmentId: assessment.id,
    studentId: assessment.studentId,
    studentName: assessment.studentName,
    formLevel: assessment.formLevel,
    stream: assessment.stream,
    term: assessment.term,
    subject: assessment.subject,
    ca1Pct,
    ca2Pct,
    ca1Weighted: norm.ca1Score,
    ca2Weighted: norm.ca2Score,
    dropPct,
    severity,
  };
}

export function detectCaDownwardAlerts(
  assessments: Assessment[],
  minDropPct = 10
): {
  alerts: CaDropAlert[];
  byAssessmentId: Map<string, CaDropAlert>;
  studentSummaries: StudentRiskSummary[];
  pairedCount: number;
} {
  const alerts: CaDropAlert[] = [];
  const byAssessmentId = new Map<string, CaDropAlert>();
  let pairedCount = 0;

  for (const a of assessments) {
    const norm = normalizeAssessmentComponents(a);
    if (norm.hasCa1 && norm.hasCa2) pairedCount += 1;
    const alert = evaluateAssessmentCaDrop(a, minDropPct);
    if (alert) {
      alerts.push(alert);
      byAssessmentId.set(a.id, alert);
    }
  }

  alerts.sort((a, b) => b.dropPct - a.dropPct || a.studentName.localeCompare(b.studentName));

  const byStudent = new Map<string, StudentRiskSummary>();
  for (const alert of alerts) {
    const existing = byStudent.get(alert.studentId);
    if (!existing) {
      byStudent.set(alert.studentId, {
        studentId: alert.studentId,
        studentName: alert.studentName,
        formLevel: alert.formLevel,
        stream: alert.stream,
        alerts: [alert],
        maxDropPct: alert.dropPct,
        highestSeverity: alert.severity,
      });
    } else {
      existing.alerts.push(alert);
      if (alert.dropPct > existing.maxDropPct) {
        existing.maxDropPct = alert.dropPct;
      }
      if (alert.severity === 'critical') {
        existing.highestSeverity = 'critical';
      }
    }
  }

  const studentSummaries = Array.from(byStudent.values()).sort(
    (a, b) => b.maxDropPct - a.maxDropPct || b.alerts.length - a.alerts.length
  );

  return { alerts, byAssessmentId, studentSummaries, pairedCount };
}
