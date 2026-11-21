import {
  AnnouncementAudience,
  Assessment,
  DigitalResourceCategory,
  DigitalResourceFormLevel,
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
      homeTitle: 'School Admin Dashboard',
      allowedSections: ['overview', 'students', 'marks', 'fees', 'attendance', 'library', 'staff'],
      canManageSchool: true,
      canManageStaff: true,
      canManageStudents: true,
      canReadMarks: true,
      canWriteMarks: false,
      canReadFees: true,
      canWriteFees: false,
      canReadAttendance: true,
      canWriteAttendance: false,
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

  // Head of Department, Form Teacher, Subject Teacher
  const roleLabel =
    role === 'Head of Department'
      ? 'Head of Department (HOD)'
      : role === 'Form Teacher' || role === 'Form Master'
      ? 'Form Teacher'
      : role;
  const homeTitle =
    role === 'Head of Department'
      ? 'HOD Department Dashboard'
      : role === 'Form Teacher' || role === 'Form Master'
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

export const DIGITAL_RESOURCE_CATEGORIES: DigitalResourceCategory[] = [
  'Book',
  'Past Paper',
  'Revision Guide',
  'Set Book',
];

export const DIGITAL_RESOURCE_FORM_LEVELS: DigitalResourceFormLevel[] = [
  'All',
  'Form 1',
  'Form 2',
  'Form 3',
  'Form 4',
];

export interface DefaultDigitalLibraryPreset {
  title: string;
  author: string;
  subject: string;
  formLevel: DigitalResourceFormLevel;
  category: DigitalResourceCategory;
  examYear: string;
  summary: string;
  content: string;
  allowOffline: boolean;
}

export const DEFAULT_DIGITAL_LIBRARY_PRESETS: DefaultDigitalLibraryPreset[] = [
  {
    title: 'The Pearl — Complete Literature Study Guide',
    author: 'English Department Panel',
    subject: 'English',
    formLevel: 'Form 4',
    category: 'Set Book',
    examYear: 'MSCE',
    summary: 'Chapter-by-chapter plot breakdown, character profiles, themes, and MSCE Paper II essay questions for John Steinbeck’s The Pearl.',
    allowOffline: true,
    content: `## Overview & Setting
Set in the coastal Mexican town of La Paz, The Pearl follows Kino, a young pearl diver, his wife Juana, and their infant son Coyotito. Steinbeck uses the parable form to examine how sudden wealth exposes colonial exploitation, greed, and the fragility of family harmony.

## Chapter-by-Chapter Summary
Chapters 1–2: Coyotito is stung by a scorpion. When the arrogant town doctor refuses to treat the child because Kino lacks money, Juana and Kino paddle to the oyster beds where Kino discovers "the Pearl of the World."
Chapters 3–4: Word spreads across La Paz. The doctor returns with a staged cure, the priest reminds Kino of his obligations, and the pearl buyers conspire to offer a fraction of the pearl's worth. Kino refuses and resolves to walk to the capital.
Chapters 5–6: Desperation escalates. Juana tries to throw the pearl back into the sea; Kino strikes her, then kills an attacker on the path. Pursued into the mountains by trackers, Kino loses Coyotito to a stray rifle shot. Returning silently to La Paz, Kino and Juana hurl the cursed pearl back into the gulf.

## Key Themes for MSCE Paper II
1. Greed and Materialism: The pearl initially symbolizes education for Coyotito and dignity for the family, yet transforms into an object of paranoia and violence.
2. Colonial & Class Injustice: Indigenous fishermen are systematically cheated by doctors, pearl dealers, and town authorities who speak a different social language of power.
3. Family Love & Courage: Juana’s quiet wisdom ("This pearl is evil") balances Kino’s pride until tragedy reunites them in grief.

## Sample MSCE Essay Prompts
Question A: Discuss four ways in which the town doctor demonstrates hypocrisy and greed after Coyotito is stung.
Question B: Show how Kino’s character changes from Chapter 1 to Chapter 6, supporting each point with clear textual evidence.`,
  },
  {
    title: 'MSCE Biology Past Paper Compilation (Paper I & II)',
    author: 'MANEB Revision Panel',
    subject: 'Biology',
    formLevel: 'Form 4',
    category: 'Past Paper',
    examYear: '2024',
    summary: 'Structured questions and worked marking guides covering cell transport, genetics, ecology, coordination, and enzyme experiments.',
    allowOffline: true,
    content: `## Section A: Multiple Choice & Short Answer Review
1. State two differences between xylem vessels and phloem sieve tubes.
Answer Guide: Xylem vessels have lignified dead cells with no end walls and transport water and mineral ions upward, whereas phloem sieve tubes are living cells with sieve plates and companion cells that translocate sucrose and amino acids bidirectionally.

2. Explain why amylase fails to digest starch when mixed with concentrated hydrochloric acid.
Answer Guide: Concentrated acid lowers pH far below the optimum pH (~7.0) for salivary amylase, breaking ionic and hydrogen bonds that maintain the enzyme’s tertiary structure. The active site changes shape (denaturation), so starch molecules can no longer bind.

## Section B: Genetics & Inheritance Problem
In a maize breeding trial in Lilongwe, tall stem (T) is dominant over dwarf stem (t). A heterozygous tall maize plant (Tt) is crossed with a dwarf maize plant (tt).
- Parental genotypes: Tt x tt
- Gametes from Tt: T, t | Gametes from tt: t, t
- Offspring genotypes: 50% Tt (tall), 50% tt (dwarf) -> Phenotypic ratio 1 tall : 1 dwarf.

## Section C: Practical Investigation Guide (Osmosis)
When identical potato cylinders are placed in 0%, 5%, and 20% sucrose solutions for 45 minutes:
- In 0% sucrose (distilled water), water enters cells by osmosis down a water potential gradient -> cylinder gains mass and becomes turgid.
- In 20% sucrose, water leaves vacuole by osmosis -> cells plasmolyze and cylinder loses mass and becomes flaccid.

## Examiner Tip
Always name the specific membrane (partially permeable membrane) and specify direction from higher water potential to lower water potential.`,
  },
  {
    title: 'MSCE Mathematics Worked Past Paper & Formulas',
    author: 'Mathematics Department',
    subject: 'Mathematics',
    formLevel: 'Form 4',
    category: 'Past Paper',
    examYear: '2025',
    summary: 'Step-by-step worked solutions for quadratic equations, vectors, circle theorems, trigonometry, and variation.',
    allowOffline: true,
    content: `## Question 1: Quadratic Equations & Factorization
Solve the equation: 2x^2 - 7x - 15 = 0.
Worked Solution:
- Product = 2 * (-15) = -30; Sum = -7. Factors are -10 and +3.
- Rewrite: 2x^2 - 10x + 3x - 15 = 0
- Factor by grouping: 2x(x - 5) + 3(x - 5) = 0 -> (2x + 3)(x - 5) = 0
- Solutions: x = -1.5 or x = 5.

## Question 2: Joint Variation
y varies directly as x and inversely as the square of z. Given that y = 6 when x = 12 and z = 2, find y when x = 18 and z = 3.
Worked Solution:
- Formula: y = (k * x) / z^2
- Substitute initial values: 6 = (k * 12) / 4 -> 6 = 3k -> k = 2.
- Find y when x = 18, z = 3: y = (2 * 18) / 3^2 = 36 / 9 = 4.

## Question 3: Sine & Cosine Rule (Bearings)
A surveyor walks 8 km on a bearing of 060° from A to B, then 6 km due south to C. Calculate distance AC.
- Angle ABC = 60° (alternate interior angles with North lines).
- Cosine rule: AC^2 = 8^2 + 6^2 - 2(8)(6)cos(60°) = 64 + 36 - 96(0.5) = 52.
- AC = sqrt(52) = 7.21 km (to 3 s.f.).

## Essential MSCE Formula Checklist
- Quadratic formula: x = [-b +/- sqrt(b^2 - 4ac)] / (2a)
- Area of triangle: 0.5 * a * b * sin(C)
- Simple Interest: I = (P * R * T) / 100
- Gradient between (x1, y1) and (x2, y2): m = (y2 - y1) / (x2 - x1)`,
  },
  {
    title: 'JCE Physical Science Core Revision Guide',
    author: 'Physical Science Panel',
    subject: 'Physical Science',
    formLevel: 'Form 2',
    category: 'Revision Guide',
    examYear: 'JCE',
    summary: 'Concise Form 1–2 Physics & Chemistry notes covering atomic structure, circuits, pressure, acids/bases, and separation techniques.',
    allowOffline: true,
    content: `## Unit 1: Atomic Structure & Bonding
- Protons (+1 charge, mass 1 u) and neutrons (0 charge, mass 1 u) sit inside the nucleus. Electrons (-1 charge, negligible mass) orbit in shells (2, 8, 8 rule for first 20 elements).
- Ionic bonding occurs between metals and non-metals via electron transfer (e.g. NaCl), whereas covalent bonding occurs between non-metals via electron sharing (e.g. H2O, CO2).

## Unit 2: Acids, Bases & Indicators
- Acids produce hydrogen ions (H+) in water and turn blue litmus paper red (pH < 7).
- Alkalis are soluble bases producing hydroxide ions (OH-) and turn red litmus blue (pH > 7).
- Neutralization reaction: Acid + Base -> Salt + Water (e.g. HCl + NaOH -> NaCl + H2O).

## Unit 3: Pressure & Density
- Density = Mass / Volume (SI unit: kg/m^3 or g/cm^3).
- Pressure = Force / Area (SI unit: N/m^2 or Pascal, Pa). Sharp knives cut easily because reducing contact area increases pressure for the same applied force.

## Unit 4: Simple Electrical Circuits
- Ohm’s Law: V = I * R (Voltage in Volts = Current in Amperes * Resistance in Ohms).
- In series circuits, current is identical at every point while voltage splits across resistors. In parallel branches, voltage is equal across every branch and total current equals the sum of branch currents.`,
  },
  {
    title: 'MSCE Geography Mapwork & Malawi Landforms',
    author: 'Geography Department',
    subject: 'Geography',
    formLevel: 'Form 3',
    category: 'Book',
    examYear: '2025',
    summary: 'Digital textbook chapter on 6-figure grid references, cross-sections, rift valley formation, and Lake Malawi drainage systems.',
    allowOffline: true,
    content: `## Chapter 1: Topographic Map Reading
To give an accurate 6-figure grid reference on a 1:50,000 Malawi survey sheet:
1. Always read the Eastings (vertical grid lines increasing left to right) first, estimating tenths inside the square.
2. Then read the Northings (horizontal grid lines increasing bottom to top), estimating tenths upward.
3. Relief representation: Close contour lines denote steep escarpments (such as the Kirk Range or Zomba Plateau slopes); widely spaced contours represent gentle floodplains.

## Chapter 2: The Great Rift Valley in Malawi
Malawi lies at the southern end of the East African Rift System. Normal faulting caused a central block (graben) to subside, creating the trough occupied by Lake Malawi and the Shire Valley, flanked by uplifted horst blocks including the Nyika and Viphya Plateaus.

## Chapter 3: Drainage Patterns & Economic Importance
- Shire River: Sole outlet of Lake Malawi at Mangochi, flowing through Liwonde and dropping over Kapichira and Nkula Falls to generate most of Malawi’s hydro-electric power before joining the Zambezi.
- Challenges: Siltation from upland deforestation reduces reservoir efficiency and damages turbines during peak rainy seasons.`,
  },
  {
    title: 'Chichewa JCE Composition & Proverbial Companion',
    author: 'Chichewa Department',
    subject: 'Chichewa',
    formLevel: 'Form 2',
    category: 'Book',
    examYear: 'JCE',
    summary: 'Essential JCE Chichewa essay frameworks, formal letter salutations, and commonly tested Miyambo (proverbs) with meanings.',
    allowOffline: true,
    content: `## Gawo 1: Kalata ya Ulemu (Formal Letter Structure)
1. Adilesi ya wolemba kumwamba kumanja, ndi tsiku pansipa.
2. Adilesi ya wolandira kumanzere.
3. Moni waulemu: "Bambo Wolemekezeka," kapena "Mkulupampando Wokondedwa,".
4. Mutu wa kalata wolembedwa mwachidule komanso mosonyeza cholinga.
5. Thupi la kalata: Ndime yoyamba ifotokoze cholinga, ndime zotsatira zifotokoze zifukwa mokwanira, ndipo ndime yomaliza ipemphe chithandizo kapena yankho.
6. Mawu omaliza: "Ndine wokhulupirika wanu," ndi dzina lanu lonse.

## Gawo 2: Miyambo Yofunika pa Mayeso (Key Proverbs)
- "Mutu umodzi susenza denga": Ntchito yaikulu imafuna thandizo la anzako (Unity brings strength).
- "Kali kokha n'kanyama, tili tiwiri n'tiwanthu": Kuyenda kapena kugwira ntchito pamodzi kumateteza mavuto.
- "Mwana wosamva anadya nkhuku yaulimi": Kusamvera malangizo kumabweretsa mavuto pambuyo pake.
- "Chikomekome cha nkhuyu, mkati muli nyerere": Musanyengedwe ndi maonekedwe akunja chifukwa mkati mukhoza kukhala vuto.

## Gawo 3: Malangizo a Chimake cha Nkhani (Essay Tips)
Gwiritsani ntchito zilembo zolondola, zizindikiro za m'mawu (mpumulo, dontho, funso), komanso magulu olondola a mayina (mwa chitsanzo: munthu/anthu, mtengo/mitengo).`,
  },
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
    description: 'Teachers, Form Teachers, HODs, Deputy Head & Head Teacher',
  },
  {
    value: 'Librarian',
    label: 'Librarian',
    description: 'School Librarian',
  },
  {
    value: 'Bursar',
    label: 'Bursar',
    description: 'School Bursar',
  },
  {
    value: 'Students',
    label: 'Students',
    description: 'Visible to Students & all staff (including Teachers) except Librarian',
  },
];

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

