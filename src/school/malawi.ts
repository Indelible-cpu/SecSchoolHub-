import {
  AnnouncementAudience,
  Assessment,
  DigitalResourceCategory,
  DigitalResourceFormLevel,
  FormLevel,
  Gender,
  LibraryItemCondition,
  LibraryLoan,
  LibraryMaterialCategory,
  RolePermissions,
  SchoolSubject,
  SchoolType,
  StaffAttendanceStatus,
  Student,
  StudentCaseSeverity,
  StudentCaseStatus,
  StudentCaseType,
  StudentReportRemark,
  StudentStatus,
  TermName,
  WorkspaceRole,
} from './types';

export const MALAWI_DISTRICTS: string[] = [
  'Balaka',
  'Blantyre',
  'Chikwawa',
  'Chiradzulu',
  'Chitipa',
  'Dedza',
  'Dowa',
  'Karonga',
  'Kasungu',
  'Likoma',
  'Lilongwe',
  'Machinga',
  'Mangochi',
  'Mchinji',
  'Mulanje',
  'Mwanza',
  'Mzimba',
  'Mzuzu',
  'Neno',
  'Nkhata Bay',
  'Nkhotakota',
  'Nsanje',
  'Ntcheu',
  'Ntchisi',
  'Phalombe',
  'Rumphi',
  'Salima',
  'Thyolo',
  'Zomba',
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
      homeTitle: 'School Admin Dashboard',
      allowedSections: ['overview', 'students', 'marks', 'fees', 'library', 'staff'],
      canManageSchool: true,
      canManageStaff: true,
      canManageStudents: true,
      canReadMarks: true,
      canWriteMarks: false,
      canReadFees: true,
      canWriteFees: false,
      canReadAttendance: true,
      canWriteAttendance: false,
      canReadStaffAttendance: true,
      canWriteStaffAttendance: true,
      canAccessTimebook: true,
      canManageTimebook: true,
      canManageStudentCases: true,
      canReadLibrary: true,
      canWriteLibrary: false,
      canReadTeachers: true,
    };
  }

  if (role === 'Head Teacher') {
    return {
      role,
      roleLabel: 'Head Teacher',
      homeTitle: 'Head Teacher Dashboard',
      allowedSections: ['overview', 'students', 'marks', 'fees', 'library', 'timebook', 'staff'],
      canManageSchool: false,
      canManageStaff: false,
      canManageStudents: true,
      canReadMarks: true,
      canWriteMarks: true,
      canReadFees: true,
      canWriteFees: true,
      canReadAttendance: true,
      canWriteAttendance: false,
      canReadStaffAttendance: true,
      canWriteStaffAttendance: false,
      canAccessTimebook: true,
      canManageTimebook: false,
      canManageStudentCases: false,
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
      allowedSections: ['overview', 'students', 'marks', 'library', 'timebook', 'staff'],
      canManageSchool: false,
      canManageStaff: false,
      canManageStudents: true,
      canReadMarks: true,
      canWriteMarks: true,
      canReadFees: false,
      canWriteFees: false,
      canReadAttendance: true,
      canWriteAttendance: false,
      canReadStaffAttendance: true,
      canWriteStaffAttendance: false,
      canAccessTimebook: true,
      canManageTimebook: false,
      canManageStudentCases: false,
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
      allowedSections: ['overview', 'fees', 'students', 'timebook'],
      canManageSchool: false,
      canManageStaff: false,
      canManageStudents: false,
      canReadMarks: false,
      canWriteMarks: false,
      canReadFees: true,
      canWriteFees: true,
      canReadAttendance: false,
      canWriteAttendance: false,
      canReadStaffAttendance: false,
      canWriteStaffAttendance: false,
      canAccessTimebook: true,
      canManageTimebook: false,
      canManageStudentCases: false,
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
      allowedSections: ['overview', 'library', 'students', 'timebook'],
      canManageSchool: false,
      canManageStaff: false,
      canManageStudents: false,
      canReadMarks: false,
      canWriteMarks: false,
      canReadFees: false,
      canWriteFees: false,
      canReadAttendance: false,
      canWriteAttendance: false,
      canReadStaffAttendance: false,
      canWriteStaffAttendance: false,
      canAccessTimebook: true,
      canManageTimebook: false,
      canManageStudentCases: false,
      canReadLibrary: true,
      canWriteLibrary: true,
      canReadTeachers: false,
    };
  }

  // Head of Department, Form Teacher, Form Master, Subject Teacher
  const isFormTeacher = role === 'Form Teacher' || role === 'Form Master';
  const roleLabel =
    role === 'Head of Department'
      ? 'Head of Department (HOD)'
      : isFormTeacher
      ? 'Form Teacher'
      : role;
  const homeTitle =
    role === 'Head of Department'
      ? 'HOD Department Dashboard'
      : isFormTeacher
      ? 'Form Teacher Dashboard'
      : 'Teacher Home Dashboard';

  return {
    role,
    roleLabel,
    homeTitle,
    allowedSections: ['overview', 'marks', 'library', 'students', 'timebook'],
    canManageSchool: false,
    canManageStaff: false,
    canManageStudents: false,
    canReadMarks: true,
    canWriteMarks: true,
    canReadFees: false,
    canWriteFees: false,
    canReadAttendance: true,
    canWriteAttendance: isFormTeacher,
    canReadStaffAttendance: false,
    canWriteStaffAttendance: false,
    canAccessTimebook: true,
    canManageTimebook: false,
    canManageStudentCases: false,
    canReadLibrary: true,
    canWriteLibrary: true,
    canReadTeachers: false,
  };
}

export const STUDENT_STATUSES: StudentStatus[] = [
  'Active',
  'Suspended',
  'Rusticated',
  'Transferred',
  'Graduated',
];

export const STAFF_ATTENDANCE_STATUSES: StaffAttendanceStatus[] = [
  'Present',
  'Late',
  'Absent',
  'On Leave',
];

export const STUDENT_CASE_TYPES: StudentCaseType[] = [
  'Suspension',
  'Rustication',
  'Warning',
  'Misconduct',
  'Truancy',
  'Other',
];

export const STUDENT_CASE_SEVERITIES: StudentCaseSeverity[] = ['Minor', 'Moderate', 'Severe'];

export const STUDENT_CASE_STATUSES: StudentCaseStatus[] = [
  'Open',
  'Under Review',
  'Serving Suspension',
  'Rusticated',
  'Resolved',
  'Appealed',
];

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

export const LIBRARY_DUE_SOON_WINDOW_DAYS = 2;

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

export function getLibraryDaysUntilDue(
  dueDate: string,
  todayIso = new Date().toISOString().slice(0, 10)
): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !/^\d{4}-\d{2}-\d{2}$/.test(todayIso)) {
    return null;
  }
  const dueMs = Date.parse(`${dueDate}T00:00:00Z`);
  const todayMs = Date.parse(`${todayIso}T00:00:00Z`);
  if (!Number.isFinite(dueMs) || !Number.isFinite(todayMs)) {
    return null;
  }
  return Math.round((dueMs - todayMs) / (1000 * 60 * 60 * 24));
}

export function isLibraryLoanDueWithin48Hours(
  loan: Pick<LibraryLoan, 'status' | 'dueDate'>,
  todayIso = new Date().toISOString().slice(0, 10)
): boolean {
  if (loan.status !== 'Checked Out' || !loan.dueDate) return false;
  const daysLeft = getLibraryDaysUntilDue(loan.dueDate, todayIso);
  return daysLeft !== null && daysLeft >= 0 && daysLeft <= LIBRARY_DUE_SOON_WINDOW_DAYS;
}

export function getLibraryDueReminderLabel(
  dueDate: string,
  todayIso = new Date().toISOString().slice(0, 10)
): {
  isOverdue: boolean;
  isDueWithin48h: boolean;
  daysLeft: number | null;
  urgencyLabel: string;
} {
  const daysLeft = getLibraryDaysUntilDue(dueDate, todayIso);
  if (daysLeft === null) {
    return {
      isOverdue: false,
      isDueWithin48h: false,
      daysLeft: null,
      urgencyLabel: 'Active loan',
    };
  }
  if (daysLeft < 0) {
    const lateDays = Math.abs(daysLeft);
    return {
      isOverdue: true,
      isDueWithin48h: false,
      daysLeft,
      urgencyLabel: `${lateDays} ${lateDays === 1 ? 'day' : 'days'} late`,
    };
  }
  if (daysLeft === 0) {
    return {
      isOverdue: false,
      isDueWithin48h: true,
      daysLeft: 0,
      urgencyLabel: 'Due today',
    };
  }
  if (daysLeft === 1) {
    return {
      isOverdue: false,
      isDueWithin48h: true,
      daysLeft: 1,
      urgencyLabel: 'Due in 24h',
    };
  }
  if (daysLeft <= LIBRARY_DUE_SOON_WINDOW_DAYS) {
    return {
      isOverdue: false,
      isDueWithin48h: true,
      daysLeft,
      urgencyLabel: 'Due in 48h',
    };
  }
  return {
    isOverdue: false,
    isDueWithin48h: false,
    daysLeft,
    urgencyLabel: `Due in ${daysLeft}d`,
  };
}

export interface DefaultLibraryBookPreset {
  isbn: string;
  title: string;
  author: string;
  subject: string;
  materialType: LibraryMaterialCategory;
  shelfCode: string;
  totalCopies: number;
  notes: string;
}

export const DEFAULT_LIBRARY_BOOKS_PRESETS: DefaultLibraryBookPreset[] = [
  {
    isbn: '978-99908-87-12-4',
    title: 'MSCE Biology Form 4 Revision Guide',
    author: 'E. Banda & M. Phiri',
    subject: 'Biology',
    materialType: 'Textbook',
    shelfCode: 'LIB-BIO',
    totalCopies: 18,
    notes: 'Covers Form 3–4 MANEB Biology syllabus and practical investigations.',
  },
  {
    isbn: '978-0-14-017737-4',
    title: 'The Pearl (John Steinbeck)',
    author: 'John Steinbeck',
    subject: 'English',
    materialType: 'Set Book',
    shelfCode: 'LIB-ENG',
    totalCopies: 24,
    notes: 'Prescribed MSCE English Literature Paper II set book.',
  },
  {
    isbn: '978-9966-57-104-5',
    title: 'Excel & Succeed Physical Science Form 3',
    author: 'P. Karanja & D. Mhone',
    subject: 'Physical Science',
    materialType: 'Textbook',
    shelfCode: 'LIB-PSC',
    totalCopies: 15,
    notes: 'Senior secondary Physics and Chemistry core textbook.',
  },
  {
    isbn: '978-99908-45-33-1',
    title: 'JCE Mathematics Worked Past Papers',
    author: 'Malawi Sec Mathematics Panel',
    subject: 'Mathematics',
    materialType: 'Past Papers',
    shelfCode: 'LIB-MAT',
    totalCopies: 20,
    notes: 'Junior Certificate Mathematics questions with marking schemes.',
  },
  {
    isbn: '978-0-521-60686-8',
    title: 'Macbeth (William Shakespeare)',
    author: 'William Shakespeare',
    subject: 'English',
    materialType: 'Set Book',
    shelfCode: 'LIB-ENG',
    totalCopies: 22,
    notes: 'Annotated edition for Form 3 & 4 literature classes.',
  },
  {
    isbn: '978-9966-57-218-9',
    title: 'Excel & Succeed Mathematics Form 4',
    author: 'J. Mwachande & C. Kumwenda',
    subject: 'Mathematics',
    materialType: 'Textbook',
    shelfCode: 'LIB-MAT',
    totalCopies: 16,
    notes: 'Vectors, probability, trigonometry, and MSCE exam practice.',
  },
  {
    isbn: '978-99908-19-08-3',
    title: 'Chichewa Chathu Form 1–2',
    author: 'G. Kamanga & L. Nkhoma',
    subject: 'Chichewa',
    materialType: 'Textbook',
    shelfCode: 'LIB-CHI',
    totalCopies: 25,
    notes: 'JCE Chichewa grammar, comprehension, and composition.',
  },
  {
    isbn: '978-0-19-912945-2',
    title: 'MSCE Geography Revision Atlas',
    author: 'F. Chirwa & R. Gondwe',
    subject: 'Geography',
    materialType: 'Reference Book',
    shelfCode: 'LIB-GEO',
    totalCopies: 12,
    notes: 'Map reading, Malawi landforms, climate, and regional development.',
  },
  {
    isbn: '978-99960-14-22-7',
    title: 'MSCE English Grammar & Composition',
    author: 'C. Nkhoma & S. Tembo',
    subject: 'English',
    materialType: 'Textbook',
    shelfCode: 'LIB-ENG',
    totalCopies: 20,
    notes: 'Essay structure, comprehension, and note-making skills.',
  },
];

export const STUDENT_DIGITAL_RESOURCE_CATEGORIES: DigitalResourceCategory[] = [
  'Book',
  'Past Paper',
  'Revision Guide',
  'Set Book',
];

export const TEACHER_DIGITAL_RESOURCE_CATEGORIES: DigitalResourceCategory[] = [
  'Teaching Resource',
  'Scheme of Work',
  'Lesson Plan',
];

export const DIGITAL_RESOURCE_CATEGORIES: DigitalResourceCategory[] = [
  ...STUDENT_DIGITAL_RESOURCE_CATEGORIES,
  ...TEACHER_DIGITAL_RESOURCE_CATEGORIES,
];

export function isTeacherOnlyDigitalCategory(category: DigitalResourceCategory): boolean {
  return (
    category === 'Teaching Resource' ||
    category === 'Scheme of Work' ||
    category === 'Lesson Plan'
  );
}

export const DIGITAL_RESOURCE_FORM_LEVELS: DigitalResourceFormLevel[] = [
  'All',
  'Form 1',
  'Form 2',
  'Form 3',
  'Form 4',
];

export function normalizeIsbn(raw?: string): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9X]/g, '');
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
  if (!trimmed) return 'SecSchoolHub';
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

export const ANNOUNCEMENT_AUDIENCE_OPTIONS: {
  value: AnnouncementAudience;
  label: string;
  description: string;
}[] = [
  {
    value: 'Teachers',
    label: 'Teachers',
    description: 'Subject Teachers, Form Teachers, HODs, Deputy Head & Head Teacher',
  },
  {
    value: 'Librarian',
    label: 'Librarians',
    description: 'School Librarians',
  },
  {
    value: 'Students',
    label: 'Students',
    description: 'Students & Staff',
  },
  {
    value: 'Bursar',
    label: 'Bursar',
    description: 'School Bursar',
  },
];

export function isLibrarianOnlyAnnouncement(
  targetAudiences: AnnouncementAudience[]
): boolean {
  const list = Array.isArray(targetAudiences) ? targetAudiences : [];
  return list.includes('Librarian') && !list.includes('Students');
}

export function canStudentSeeAnnouncement(
  targetAudiences: AnnouncementAudience[]
): boolean {
  const list = Array.isArray(targetAudiences) ? targetAudiences : [];
  if (list.length === 0) return false;
  // Students see general/student announcements, while librarian-specific
  // or staff-only posts without Students are filtered out of their view.
  return list.includes('Students') && !isLibrarianOnlyAnnouncement(list);
}

export function canRoleSeeAnnouncement(
  targetAudiences: AnnouncementAudience[],
  role: WorkspaceRole
): boolean {
  if (role === 'Owner') return true;
  const list = Array.isArray(targetAudiences) ? targetAudiences : [];
  if (role === 'School Librarian') {
    return list.includes('Librarian');
  }
  const forStudents = list.includes('Students');
  if (role === 'School Bursar') {
    return list.includes('Bursar') || forStudents;
  }
  return list.includes('Teachers') || forStudents;
}

export function countStudentAssessmentsByTerm(
  assessments: Pick<Assessment, 'term'>[]
): Record<TermName, number> {
  const counts: Record<TermName, number> = {
    'Term 1': 0,
    'Term 2': 0,
    'Term 3': 0,
  };
  for (const a of assessments) {
    if (a.term === 'Term 1' || a.term === 'Term 2' || a.term === 'Term 3') {
      counts[a.term] += 1;
    }
  }
  return counts;
}

export function resolveStudentPortalTerm(
  preferredTerm: TermName,
  assessments: Pick<Assessment, 'term'>[]
): TermName {
  if (assessments.some((a) => a.term === preferredTerm)) {
    return preferredTerm;
  }
  const fallbackOrder: TermName[] = ['Term 3', 'Term 2', 'Term 1'];
  for (const term of fallbackOrder) {
    if (assessments.some((a) => a.term === term)) {
      return term;
    }
  }
  return preferredTerm;
}

export function makeReportRemarkId(
  studentId: string,
  term: TermName,
  academicYear: string
): string {
  const safeStu = String(studentId || 'stu').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeTerm = String(term || 'Term_1').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeYear = String(academicYear || 'year').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `rmk_${safeStu}_${safeTerm}_${safeYear}`.slice(0, 128);
}

export function findStudentTermRemark(
  remarks: StudentReportRemark[],
  studentId: string,
  term: TermName,
  academicYear?: string
): StudentReportRemark | null {
  const matching = remarks.filter((r) => r.studentId === studentId && r.term === term);
  if (matching.length === 0) return null;
  const cleanYear = (academicYear || '').trim();
  if (cleanYear) {
    const exact = matching.find((r) => (r.academicYear || '').trim() === cleanYear);
    if (exact) return exact;
  }
  const sorted = [...matching].sort(
    (a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0)
  );
  return sorted[0] || null;
}

export function arePortalResultFieldsSynced(
  portalDoc: Partial<Assessment>,
  schoolAssessment: Assessment,
  expectedStudentName: string
): boolean {
  const norm = normalizeAssessmentComponents(schoolAssessment);
  const cleanName = expectedStudentName.trim().slice(0, 120);
  const cleanStream = (schoolAssessment.stream || 'A').trim().slice(0, 20);
  const cleanSubject = (schoolAssessment.subject || '').trim().slice(0, 60);
  const cleanYear = (schoolAssessment.academicYear || '').trim().slice(0, 20);
  const cleanComment = (schoolAssessment.teacherComment || '').trim().slice(0, 240);

  return (
    (portalDoc.studentName || '') === cleanName &&
    portalDoc.formLevel === Math.round(schoolAssessment.formLevel) &&
    (portalDoc.stream || '') === cleanStream &&
    portalDoc.term === schoolAssessment.term &&
    (portalDoc.academicYear || '') === cleanYear &&
    (portalDoc.subject || '') === cleanSubject &&
    portalDoc.ca1Raw === norm.ca1Raw &&
    portalDoc.ca1Max === norm.ca1Max &&
    portalDoc.ca1Score === norm.ca1Score &&
    portalDoc.ca2Raw === norm.ca2Raw &&
    portalDoc.ca2Max === norm.ca2Max &&
    portalDoc.ca2Score === norm.ca2Score &&
    portalDoc.caScore === norm.caScore &&
    portalDoc.examRaw === norm.examRaw &&
    portalDoc.examMax === norm.examMax &&
    portalDoc.examScore === norm.examScore &&
    portalDoc.totalScore === Number(schoolAssessment.totalScore) &&
    portalDoc.grade === schoolAssessment.grade &&
    portalDoc.gradePoint === Math.round(Number(schoolAssessment.gradePoint) || 9) &&
    portalDoc.remark === schoolAssessment.remark &&
    (portalDoc.teacherComment || '') === cleanComment
  );
}

export interface RegisterSortableStudent {
  id?: string;
  fullName: string;
  gender?: Gender | string;
  formLevel?: FormLevel | number;
  stream?: string;
  admissionNo?: string;
}

export interface StudentRegisterSortOptions {
  groupByForm?: boolean;
  groupByStream?: boolean;
}

/**
 * Canonical school register ordering:
 * Boys ('Male') upwards (rank 0), Girls ('Female') downwards (rank 1).
 */
export function getStudentGenderRegisterRank(gender?: string): number {
  const norm = String(gender ?? '').trim().toLowerCase();
  if (norm === 'male' || norm === 'm' || norm === 'boy' || norm === 'boys') {
    return 0;
  }
  if (norm === 'female' || norm === 'f' || norm === 'girl' || norm === 'girls') {
    return 1;
  }
  return 2;
}

/**
 * Compares two students using standard school register ordering:
 * Boys upwards A–Z, followed by Girls downwards A–Z.
 */
export function compareStudentsRegisterOrder(
  a: RegisterSortableStudent,
  b: RegisterSortableStudent,
  options: StudentRegisterSortOptions = {}
): number {
  if (options.groupByForm) {
    const formCmp = (Number(a.formLevel) || 0) - (Number(b.formLevel) || 0);
    if (formCmp !== 0) return formCmp;
  }
  if (options.groupByStream) {
    const streamCmp = (a.stream || '')
      .trim()
      .localeCompare((b.stream || '').trim(), undefined, { sensitivity: 'base' });
    if (streamCmp !== 0) return streamCmp;
  }

  const genderCmp =
    getStudentGenderRegisterRank(a.gender) - getStudentGenderRegisterRank(b.gender);
  if (genderCmp !== 0) return genderCmp;

  const nameCmp = (a.fullName || '')
    .trim()
    .localeCompare((b.fullName || '').trim(), undefined, { sensitivity: 'base' });
  if (nameCmp !== 0) return nameCmp;

  const formTie = (Number(a.formLevel) || 0) - (Number(b.formLevel) || 0);
  if (formTie !== 0) return formTie;

  const streamTie = (a.stream || '')
    .trim()
    .localeCompare((b.stream || '').trim(), undefined, { sensitivity: 'base' });
  if (streamTie !== 0) return streamTie;

  const admTie = (a.admissionNo || '')
    .trim()
    .localeCompare((b.admissionNo || '').trim(), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  if (admTie !== 0) return admTie;

  return (a.id || '').localeCompare(b.id || '');
}

export function sortStudentsForRegister<T extends RegisterSortableStudent>(
  students: readonly T[],
  options: StudentRegisterSortOptions = {}
): T[] {
  return [...students].sort((a, b) => compareStudentsRegisterOrder(a, b, options));
}

export function formatOrdinalRank(rank: number): string {
  const n = Math.max(1, Math.round(rank));
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export type RankableAssessment = Pick<
  Assessment,
  | 'id'
  | 'studentId'
  | 'studentName'
  | 'formLevel'
  | 'stream'
  | 'subject'
  | 'totalScore'
  | 'examScore'
  | 'gradePoint'
>;

export interface RankedAssessmentEntry<T extends RankableAssessment> {
  assessment: T;
  rank: number;
  ordinal: string;
  totalEntries: number;
  isTied: boolean;
}

/**
 * Auto-ranks assessments from highest to lowest totalScore using standard
 * competition ranking (1, 1, 3) for ties.
 */
export function rankAssessmentsByPerformance<T extends RankableAssessment>(
  assessments: readonly T[],
  studentsById?: ReadonlyMap<string, Pick<Student, 'gender' | 'fullName' | 'admissionNo' | 'formLevel' | 'stream' | 'id'>>
): RankedAssessmentEntry<T>[] {
  if (assessments.length === 0) return [];

  const sorted = [...assessments].sort((a, b) => {
    const scoreDiff = (Number(b.totalScore) || 0) - (Number(a.totalScore) || 0);
    if (Math.abs(scoreDiff) >= 0.05) return scoreDiff;

    const examDiff = (Number(b.examScore) || 0) - (Number(a.examScore) || 0);
    if (Math.abs(examDiff) >= 0.05) return examDiff;

    const gpDiff = (Number(a.gradePoint) || 9) - (Number(b.gradePoint) || 9);
    if (gpDiff !== 0) return gpDiff;

    const stuA = studentsById?.get(a.studentId);
    const stuB = studentsById?.get(b.studentId);
    if (stuA && stuB) {
      const regCmp = compareStudentsRegisterOrder(stuA, stuB);
      if (regCmp !== 0) return regCmp;
    }

    const nameCmp = (a.studentName || '')
      .trim()
      .localeCompare((b.studentName || '').trim(), undefined, { sensitivity: 'base' });
    if (nameCmp !== 0) return nameCmp;

    return (a.subject || '').localeCompare(b.subject || '', undefined, { sensitivity: 'base' }) ||
      (a.id || '').localeCompare(b.id || '');
  });

  const totalEntries = sorted.length;
  const ranks: number[] = new Array(totalEntries);
  let currentRank = 1;
  for (let i = 0; i < totalEntries; i += 1) {
    if (i > 0) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const isSameScore =
        Math.abs((Number(prev.totalScore) || 0) - (Number(curr.totalScore) || 0)) < 0.05;
      if (!isSameScore) {
        currentRank = i + 1;
      }
    }
    ranks[i] = currentRank;
  }

  return sorted.map((assessment, i) => {
    const rank = ranks[i];
    const isTied =
      (i > 0 && ranks[i - 1] === rank) ||
      (i + 1 < totalEntries && ranks[i + 1] === rank);
    return {
      assessment,
      rank,
      ordinal: formatOrdinalRank(rank),
      totalEntries,
      isTied,
    };
  });
}

export interface StudentSearchTarget {
  fullName?: string;
  admissionNo?: string;
  registrationCode?: string;
  formLevel?: FormLevel | number;
  stream?: string;
  guardianName?: string;
  guardianPhone?: string;
  guardianSecondaryPhone?: string;
  emergencyContactName?: string;
  extraTerms?: Array<string | undefined | null>;
}

export interface StudentSearchOptions {
  includeGuardian?: boolean;
  includeFormClass?: boolean;
}

function compactSearchCode(val?: string | null): string {
  return String(val ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-_]+/g, '');
}

function extractStudentNameTokens(fullName: string): string[] {
  const cleaned = fullName
    .trim()
    .toLowerCase()
    .replace(/[,]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (!cleaned) return [];
  return cleaned.split(' ').filter(Boolean);
}

/**
 * Matches a student record against a search query by surname, any name part,
 * full name, registration code, admission number, or optional form/guardian fields.
 * Supports multi-word queries in any order (e.g. "Banda Chifundo" matches "Chifundo Banda").
 */
export function matchesStudentSearchQuery(
  target: StudentSearchTarget,
  rawQuery: string,
  options: StudentSearchOptions = {}
): boolean {
  const trimmed = String(rawQuery ?? '').trim().toLowerCase();
  if (!trimmed) return true;

  const fullName = String(target.fullName ?? '').trim().toLowerCase();
  const admissionNo = String(target.admissionNo ?? '').trim().toLowerCase();
  const regCode = String(target.registrationCode ?? '').trim().toLowerCase();
  const compactAdm = compactSearchCode(target.admissionNo);
  const compactReg = compactSearchCode(target.registrationCode);
  const nameTokens = extractStudentNameTokens(fullName);

  const formStr =
    target.formLevel !== undefined
      ? `form ${target.formLevel}${target.stream || ''} f${target.formLevel}${target.stream || ''}`.toLowerCase()
      : '';

  const guardianBlob = options.includeGuardian
    ? [
        target.guardianName,
        target.guardianPhone,
        target.guardianSecondaryPhone,
        target.emergencyContactName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
    : '';

  const extraBlob = (target.extraTerms || [])
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const searchableStrings = [
    fullName,
    admissionNo,
    regCode,
    ...(options.includeFormClass && formStr ? [formStr] : []),
    ...(guardianBlob ? [guardianBlob] : []),
    ...(extraBlob ? [extraBlob] : []),
  ].filter(Boolean);

  if (searchableStrings.some((field) => field.includes(trimmed))) {
    return true;
  }

  const compactQuery = compactSearchCode(trimmed);
  if (
    compactQuery &&
    ((compactReg && compactReg.includes(compactQuery)) ||
      (compactAdm && compactAdm.includes(compactQuery)))
  ) {
    return true;
  }

  // Token-by-token check: supports surname-first ("Banda Chifundo") or surname + code ("Banda F1A")
  const queryTokens = trimmed
    .replace(/[,]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (queryTokens.length === 0) return true;

  return queryTokens.every((token) => {
    const compactTok = compactSearchCode(token);
    if (nameTokens.some((nt) => nt.includes(token))) return true;
    if (searchableStrings.some((field) => field.includes(token))) return true;
    if (
      compactTok &&
      ((compactReg && compactReg.includes(compactTok)) ||
        (compactAdm && compactAdm.includes(compactTok)))
    ) {
      return true;
    }
    return false;
  });
}
