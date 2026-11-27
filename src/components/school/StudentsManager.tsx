import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  BookOpen,
  Camera,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock,
  Copy,
  Download,
  Eye,
  FileText,
  KeyRound,
  LayoutGrid,
  Pencil,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import {
  Assessment,
  AttendanceRecord,
  BoardingStatus,
  FeeInvoice,
  FormLevel,
  Gender,
  LibraryLoan,
  School,
  Student,
  StudentCase,
  StudentCaseSeverity,
  StudentCaseStatus,
  StudentCaseType,
  StudentStatus,
} from '../../school/types';
import {
  calculateStudentStanding,
  downloadCSV,
  FORM_LEVELS,
  formatMalawiSmsPhone,
  formatMWK,
  generateStudentRegistrationCode,
  getDefaultEntryYear,
  getLibraryDueReminderLabel,
  getStudentGenderRegisterRank,
  inferStudentEntryYear,
  isLibraryLoanDueWithin48Hours,
  isLibraryLoanOverdue,
  matchesStudentSearchQuery,
  normalizeAssessmentComponents,
  normalizeRegistrationCode,
  sortStudentsForRegister,
  STREAMS,
  STUDENT_CASE_SEVERITIES,
  STUDENT_CASE_STATUSES,
  STUDENT_CASE_TYPES,
  STUDENT_STATUSES,
} from '../../school/malawi';
import {
  issueMissingRegistrationCodes,
  removeStudent,
  removeStudentCase,
  saveStudent,
  saveStudentCase,
  StudentPayload,
  updateStudentPhoto,
} from '../../school/firestoreService';
import {
  getStudentInitials,
  isValidStudentPhotoDataUrl,
  processStudentPhotoFile,
} from '../../school/studentPhotoHelper';
import {
  buildModalDraftKey,
  clearModalDraft,
  loadModalDraft,
  saveModalDraft,
} from '../../school/modalDrafts';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';
import { DraftRestoredNotice, ModalBackdrop } from './ModalBackdrop';
import { StudentPerformanceTrends } from './StudentPerformanceTrends';
import { StudentAttendancePanel } from './AttendanceRegister';
import { StudentCsvImportModal } from './StudentCsvImportModal';
import { StudentPhotoCaptureModal } from './StudentPhotoCaptureModal';

interface StudentsManagerProps {
  school: School;
  ownerId: string;
  students: Student[];
  assessments: Assessment[];
  invoices: FeeInvoice[];
  libraryLoans?: LibraryLoan[];
  studentCases?: StudentCase[];
  attendance?: AttendanceRecord[];
  canManageStudents?: boolean;
  canManageStudentCases?: boolean;
  canReadAttendance?: boolean;
  canWriteAttendance?: boolean;
  canViewAcademicReport?: boolean;
  canViewFees?: boolean;
  canViewLibrary?: boolean;
  recordedByName?: string;
  initialTab?: 'directory' | 'gallery' | 'attendance' | 'cases';
  tabRequestNonce?: number;
  onOpenLibrary?: () => void;
}

const GUARDIAN_RELATIONSHIPS = [
  'Mother',
  'Father',
  'Aunt / Uncle',
  'Grandparent',
  'Sibling',
  'Legal Guardian',
  'Other',
];

const EMPTY_FORM: StudentPayload = {
  admissionNo: '',
  fullName: '',
  gender: 'Female',
  formLevel: 1,
  stream: 'A',
  entryYear: new Date().getFullYear(),
  boardingStatus: 'Day Scholar',
  guardianName: '',
  guardianPhone: '+265 ',
  guardianSecondaryPhone: '',
  guardianRelationship: 'Mother',
  emergencyContactName: '',
  emergencyContactPhone: '',
  emergencyNotes: '',
  studentEmail: '',
  registrationCode: '',
  photoDataUrl: '',
  status: 'Active',
};

interface StudentAvatarProps {
  fullName: string;
  photoDataUrl?: string;
  sizeClass?: string;
  textClass?: string;
}

const StudentAvatar: React.FC<StudentAvatarProps> = ({
  fullName,
  photoDataUrl,
  sizeClass = 'w-9 h-9',
  textClass = 'text-xs',
}) => {
  const [failedSrc, setFailedSrc] = useState('');
  const cleanUrl =
    photoDataUrl && isValidStudentPhotoDataUrl(photoDataUrl) && photoDataUrl !== failedSrc
      ? photoDataUrl
      : '';

  if (cleanUrl) {
    return (
      <img
        src={cleanUrl}
        alt={fullName}
        referrerPolicy="no-referrer"
        onError={() => setFailedSrc(cleanUrl)}
        className={`${sizeClass} rounded-full object-cover border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shrink-0`}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className={`${sizeClass} rounded-full border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold flex items-center justify-center shrink-0 select-none ${textClass}`}
    >
      {getStudentInitials(fullName)}
    </div>
  );
};

interface StudentFormDraft {
  formState: StudentPayload;
  regCodeAuto: boolean;
  entryYearAuto: boolean;
}

interface StudentCaseFormState {
  studentId: string;
  caseType: StudentCaseType;
  severity: StudentCaseSeverity;
  status: StudentCaseStatus;
  title: string;
  description: string;
  actionTaken: string;
  incidentDate: string;
  suspensionEndDate: string;
  guardianNotified: boolean;
  syncStudentStatus: StudentStatus | '';
}

function getStudentStatusTextClass(status: StudentStatus): string {
  if (status === 'Active') return 'text-emerald-700 dark:text-emerald-400';
  if (status === 'Rusticated') return 'text-rose-700 dark:text-rose-400';
  if (status === 'Suspended') return 'text-rose-600 dark:text-rose-400';
  return 'text-amber-700 dark:text-amber-400';
}

function getCaseTypeTextClass(caseType: StudentCaseType): string {
  if (caseType === 'Rustication') {
    return 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300';
  }
  if (caseType === 'Suspension') {
    return 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300';
  }
  if (caseType === 'Misconduct' || caseType === 'Truancy') {
    return 'bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-900 text-orange-800 dark:text-orange-300';
  }
  return 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300';
}

export const StudentsManager: React.FC<StudentsManagerProps> = ({
  school,
  ownerId,
  students,
  assessments,
  invoices,
  libraryLoans = [],
  studentCases = [],
  attendance = [],
  canManageStudents = true,
  canManageStudentCases = false,
  canReadAttendance = false,
  canWriteAttendance = false,
  canViewAcademicReport = true,
  canViewFees = true,
  canViewLibrary = false,
  recordedByName = 'School Admin',
  initialTab,
  tabRequestNonce,
  onOpenLibrary,
}) => {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [sectionTab, setSectionTab] = useState<'directory' | 'gallery' | 'attendance' | 'cases'>(() =>
    initialTab && (initialTab !== 'attendance' || canReadAttendance) ? initialTab : 'directory'
  );
  const [search, setSearch] = useState('');
  const [formFilter, setFormFilter] = useState<'all' | FormLevel>('all');
  const [streamFilter, setStreamFilter] = useState<'all' | string>('all');
  const [boardingFilter, setBoardingFilter] = useState<'all' | BoardingStatus>('all');
  const [photoFilter, setPhotoFilter] = useState<'all' | 'with_photo' | 'missing_photo'>('all');
  const [registerGrouping, setRegisterGrouping] = useState<'register' | 'by_form'>('register');

  useEffect(() => {
    if (!tabRequestNonce || !initialTab) return;
    if (initialTab === 'attendance' && !canReadAttendance) return;
    setSectionTab(initialTab);
  }, [canReadAttendance, initialTab, tabRequestNonce]);

  const [modalOpen, setModalOpen] = useState(false);
  const [csvImportModalOpen, setCsvImportModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formState, setFormState] = useState<StudentPayload>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [studentDraftRestored, setStudentDraftRestored] = useState(false);

  const [detailStudent, setDetailStudent] = useState<Student | null>(null);
  const [detailTab, setDetailTab] = useState<'overview' | 'trends'>('overview');
  const [reportStudent, setReportStudent] = useState<Student | null>(null);
  const [confirmStudent, setConfirmStudent] = useState<Student | null>(null);
  const [deletingStudent, setDeletingStudent] = useState(false);
  const [deleteStudentError, setDeleteStudentError] = useState('');

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [issuingCodes, setIssuingCodes] = useState(false);
  const [codeBanner, setCodeBanner] = useState('');
  const [regCodeAuto, setRegCodeAuto] = useState(true);
  const [entryYearAuto, setEntryYearAuto] = useState(true);

  // Student Camera Photo State
  const [cameraModalTarget, setCameraModalTarget] = useState<
    { mode: 'form' } | { mode: 'immediate'; student: Student } | null
  >(null);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [photoSaveError, setPhotoSaveError] = useState('');
  const [formPhotoProcessing, setFormPhotoProcessing] = useState(false);
  const formPhotoInputRef = useRef<HTMLInputElement | null>(null);

  // Student Disciplinary Cases (Suspensions & Rustications) State
  const [caseSearch, setCaseSearch] = useState('');
  const [caseTypeFilter, setCaseTypeFilter] = useState<'all' | StudentCaseType>('all');
  const [caseStatusFilter, setCaseStatusFilter] = useState<'all' | StudentCaseStatus>('all');
  const [caseModalOpen, setCaseModalOpen] = useState(false);
  const [editingCaseId, setEditingCaseId] = useState<string | null>(null);
  const [caseForm, setCaseForm] = useState<StudentCaseFormState>(() => ({
    studentId: '',
    caseType: 'Suspension',
    severity: 'Severe',
    status: 'Serving Suspension',
    title: '',
    description: '',
    actionTaken: '',
    incidentDate: todayIso,
    suspensionEndDate: '',
    guardianNotified: true,
    syncStudentStatus: 'Suspended',
  }));
  const [savingCase, setSavingCase] = useState(false);
  const [caseError, setCaseError] = useState('');
  const [caseDraftRestored, setCaseDraftRestored] = useState(false);
  const [confirmCase, setConfirmCase] = useState<StudentCase | null>(null);
  const [deletingCase, setDeletingCase] = useState(false);
  const [deleteCaseError, setDeleteCaseError] = useState('');
  const [caseActionBusyId, setCaseActionBusyId] = useState<string | null>(null);

  const studentDraftKey = useMemo(
    () => buildModalDraftKey(school.id, 'student_form', editingId || 'new'),
    [school.id, editingId]
  );

  const caseDraftKey = useMemo(
    () => buildModalDraftKey(school.id, 'student_case', editingCaseId || 'new'),
    [school.id, editingCaseId]
  );

  useEffect(() => {
    if (!modalOpen) return;
    // Omit bulky base64 thumbnail from localStorage draft to stay well within browser storage quota
    const { photoDataUrl: _omitPhoto, ...draftFormState } = formState;
    saveModalDraft<StudentFormDraft>(studentDraftKey, {
      formState: draftFormState,
      regCodeAuto,
      entryYearAuto,
    });
  }, [modalOpen, studentDraftKey, formState, regCodeAuto, entryYearAuto]);

  useEffect(() => {
    if (!caseModalOpen) return;
    saveModalDraft<StudentCaseFormState>(caseDraftKey, caseForm);
  }, [caseModalOpen, caseDraftKey, caseForm]);

  const missingCodeCount = useMemo(
    () => students.filter((s) => normalizeRegistrationCode(s.registrationCode).length < 6).length,
    [students]
  );

  const libraryByStudentId = useMemo(() => {
    const map = new Map<
      string,
      {
        activeLoans: LibraryLoan[];
        dueSoonLoans: LibraryLoan[];
        overdueLoans: LibraryLoan[];
        returnedCount: number;
      }
    >();
    if (!canViewLibrary) return map;

    for (const loan of libraryLoans) {
      const entry = map.get(loan.studentId) || {
        activeLoans: [],
        dueSoonLoans: [],
        overdueLoans: [],
        returnedCount: 0,
      };
      if (loan.status === 'Checked Out') {
        entry.activeLoans.push(loan);
        if (isLibraryLoanOverdue(loan, todayIso)) {
          entry.overdueLoans.push(loan);
        } else if (isLibraryLoanDueWithin48Hours(loan, todayIso)) {
          entry.dueSoonLoans.push(loan);
        }
      } else {
        entry.returnedCount += 1;
      }
      map.set(loan.studentId, entry);
    }

    for (const entry of map.values()) {
      entry.activeLoans.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      entry.dueSoonLoans.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      entry.overdueLoans.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    }
    return map;
  }, [canViewLibrary, libraryLoans, todayIso]);

  const makeUniqueRegCode = (
    formLevel: FormLevel,
    stream: string,
    entryYear?: number,
    excludeId?: string | null
  ) => {
    const used = students
      .filter((s) => s.id !== excludeId)
      .map((s) => normalizeRegistrationCode(s.registrationCode))
      .filter((c) => c.length > 0);
    return generateStudentRegistrationCode({
      formLevel,
      stream,
      entryYear,
      usedCodes: used,
    });
  };

  const handleCopyCode = async (id: string, code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((prev) => (prev === id ? null : prev));
      }, 2000);
    } catch {
      // Clipboard API unavailable
    }
  };

  const handleIssueMissingCodes = async () => {
    setIssuingCodes(true);
    setCodeBanner('');
    try {
      const issued = await issueMissingRegistrationCodes(school, ownerId, students);
      setCodeBanner(
        issued > 0
          ? `Issued registration codes to ${issued} student${issued === 1 ? '' : 's'}.`
          : 'All students already have registration codes.'
      );
    } catch (err) {
      setCodeBanner(err instanceof Error ? err.message : 'Unable to issue registration codes.');
    } finally {
      setIssuingCodes(false);
    }
  };

  const availableStreams = useMemo(() => {
    const set = new Set<string>(STREAMS);
    for (const s of students) {
      if (s.stream) set.add(s.stream);
    }
    return Array.from(set);
  }, [students]);

  const studentsById = useMemo(() => {
    const map = new Map<string, Student>();
    for (const s of students) {
      map.set(s.id, s);
    }
    return map;
  }, [students]);

  const filtered = useMemo(() => {
    const matched = students.filter((s) => {
      if (formFilter !== 'all' && s.formLevel !== formFilter) return false;
      if (streamFilter !== 'all' && s.stream !== streamFilter) return false;
      if (boardingFilter !== 'all' && s.boardingStatus !== boardingFilter) return false;
      return matchesStudentSearchQuery(s, search, {
        includeGuardian: true,
        includeFormClass: true,
      });
    });
    return sortStudentsForRegister(matched, {
      groupByForm: registerGrouping === 'by_form',
    });
  }, [boardingFilter, formFilter, registerGrouping, search, streamFilter, students]);

  const filteredGenderCounts = useMemo(() => {
    let boys = 0;
    let girls = 0;
    for (const s of filtered) {
      const rank = getStudentGenderRegisterRank(s.gender);
      if (rank === 0) boys += 1;
      else if (rank === 1) girls += 1;
    }
    return { boys, girls };
  }, [filtered]);

  const galleryStudents = useMemo(() => {
    return filtered.filter((s) => {
      const hasPhoto = Boolean(s.photoDataUrl && isValidStudentPhotoDataUrl(s.photoDataUrl));
      if (photoFilter === 'with_photo') return hasPhoto;
      if (photoFilter === 'missing_photo') return !hasPhoto;
      return true;
    });
  }, [filtered, photoFilter]);

  const totalWithPhotosCount = useMemo(
    () =>
      students.filter((s) => Boolean(s.photoDataUrl && isValidStudentPhotoDataUrl(s.photoDataUrl)))
        .length,
    [students]
  );

  const buildFreshCreateStudent = (): StudentFormDraft => {
    const nextNumber = String(students.length + 1).padStart(3, '0');
    const defaultEntryYear = getDefaultEntryYear(1, school.academicYear);
    return {
      entryYearAuto: true,
      regCodeAuto: true,
      formState: {
        ...EMPTY_FORM,
        admissionNo: `SCH/${defaultEntryYear}/${nextNumber}`,
        entryYear: defaultEntryYear,
        registrationCode: makeUniqueRegCode(1, 'A', defaultEntryYear, null),
      },
    };
  };

  const buildFreshEditStudent = (student: Student): StudentFormDraft => {
    const inferredYear = inferStudentEntryYear(student, school.academicYear);
    const hasExistingCode = normalizeRegistrationCode(student.registrationCode).length >= 6;
    return {
      entryYearAuto: !student.entryYear,
      regCodeAuto: !hasExistingCode,
      formState: {
        admissionNo: student.admissionNo,
        fullName: student.fullName,
        gender: student.gender,
        formLevel: student.formLevel,
        stream: student.stream,
        entryYear: inferredYear,
        boardingStatus: student.boardingStatus,
        guardianName: student.guardianName,
        guardianPhone: student.guardianPhone,
        guardianSecondaryPhone: student.guardianSecondaryPhone || '',
        guardianRelationship: student.guardianRelationship || '',
        emergencyContactName: student.emergencyContactName || '',
        emergencyContactPhone: student.emergencyContactPhone || '',
        emergencyNotes: student.emergencyNotes || '',
        studentEmail: student.studentEmail || '',
        registrationCode: hasExistingCode
          ? student.registrationCode || ''
          : makeUniqueRegCode(student.formLevel, student.stream, inferredYear, student.id),
        photoDataUrl: student.photoDataUrl || '',
        status: student.status,
      },
    };
  };

  const openCreateModal = () => {
    const key = buildModalDraftKey(school.id, 'student_form', 'new');
    const draft = loadModalDraft<StudentFormDraft>(key);
    const fresh = buildFreshCreateStudent();
    setEditingId(null);
    if (draft?.formState) {
      setEntryYearAuto(draft.entryYearAuto);
      setRegCodeAuto(draft.regCodeAuto);
      setFormState({ ...draft.formState, photoDataUrl: '' });
      setStudentDraftRestored(true);
    } else {
      setEntryYearAuto(fresh.entryYearAuto);
      setRegCodeAuto(fresh.regCodeAuto);
      setFormState(fresh.formState);
      setStudentDraftRestored(false);
    }
    setErrorMsg('');
    setModalOpen(true);
  };

  const openEditModal = (student: Student) => {
    const key = buildModalDraftKey(school.id, 'student_form', student.id);
    const draft = loadModalDraft<StudentFormDraft>(key);
    const fresh = buildFreshEditStudent(student);
    setEditingId(student.id);
    if (draft?.formState) {
      setEntryYearAuto(draft.entryYearAuto);
      setRegCodeAuto(draft.regCodeAuto);
      setFormState({
        ...draft.formState,
        photoDataUrl: student.photoDataUrl || '',
      });
      setStudentDraftRestored(true);
    } else {
      setEntryYearAuto(fresh.entryYearAuto);
      setRegCodeAuto(fresh.regCodeAuto);
      setFormState(fresh.formState);
      setStudentDraftRestored(false);
    }
    setErrorMsg('');
    setModalOpen(true);
  };

  const handleDiscardStudentDraft = () => {
    clearModalDraft(studentDraftKey);
    if (editingId) {
      const target = students.find((s) => s.id === editingId);
      if (target) {
        const fresh = buildFreshEditStudent(target);
        setEntryYearAuto(fresh.entryYearAuto);
        setRegCodeAuto(fresh.regCodeAuto);
        setFormState(fresh.formState);
      }
    } else {
      const fresh = buildFreshCreateStudent();
      setEntryYearAuto(fresh.entryYearAuto);
      setRegCodeAuto(fresh.regCodeAuto);
      setFormState(fresh.formState);
    }
    setStudentDraftRestored(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.fullName.trim() || !formState.admissionNo.trim() || !formState.guardianName.trim()) {
      setErrorMsg('Admission number, student name, and guardian name are required.');
      return;
    }
    const cleanEntryYear = Number(formState.entryYear);
    if (!Number.isFinite(cleanEntryYear) || cleanEntryYear < 2000 || cleanEntryYear > 2100) {
      setErrorMsg('Year of entry must be a valid 4-digit year (2000–2100).');
      return;
    }
    const cleanCode = normalizeRegistrationCode(formState.registrationCode);
    if (cleanCode.length > 0 && cleanCode.length < 6) {
      setErrorMsg('Registration code must be at least 6 characters (letters, numbers, or dashes).');
      return;
    }
    if (
      cleanCode.length >= 6 &&
      students.some(
        (s) => s.id !== editingId && normalizeRegistrationCode(s.registrationCode) === cleanCode
      )
    ) {
      setErrorMsg(`Registration code ${cleanCode} is already assigned to another student.`);
      return;
    }

    setSaving(true);
    setErrorMsg('');
    try {
      await saveStudent(
        school.id,
        ownerId,
        {
          ...formState,
          entryYear: Math.round(cleanEntryYear),
          registrationCode: cleanCode,
          autoGeneratedCode: regCodeAuto,
        },
        editingId || undefined,
        school
      );
      clearModalDraft(studentDraftKey);
      setStudentDraftRestored(false);
      setModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save student.');
    } finally {
      setSaving(false);
    }
  };

  const buildFreshCaseForm = (preselectedStudentId?: string): StudentCaseFormState => ({
    studentId: preselectedStudentId || students[0]?.id || '',
    caseType: 'Suspension',
    severity: 'Severe',
    status: 'Serving Suspension',
    title: '',
    description: '',
    actionTaken: '',
    incidentDate: todayIso,
    suspensionEndDate: '',
    guardianNotified: true,
    syncStudentStatus: 'Suspended',
  });

  const buildFreshEditCaseForm = (item: StudentCase): StudentCaseFormState => ({
    studentId: item.studentId,
    caseType: item.caseType,
    severity: item.severity,
    status: item.status,
    title: item.title,
    description: item.description,
    actionTaken: item.actionTaken || '',
    incidentDate: item.incidentDate || todayIso,
    suspensionEndDate: item.suspensionEndDate || '',
    guardianNotified: Boolean(item.guardianNotified),
    syncStudentStatus: '',
  });

  const openCreateCaseModal = (preselectedStudentId?: string) => {
    if (!canManageStudentCases) return;
    const key = buildModalDraftKey(school.id, 'student_case', 'new');
    const draft = loadModalDraft<StudentCaseFormState>(key);
    const fresh = buildFreshCaseForm(preselectedStudentId);
    setEditingCaseId(null);
    if (draft && draft.studentId) {
      setCaseForm(
        preselectedStudentId ? { ...draft, studentId: preselectedStudentId } : draft
      );
      setCaseDraftRestored(true);
    } else {
      setCaseForm(fresh);
      setCaseDraftRestored(false);
    }
    setCaseError('');
    setCaseModalOpen(true);
  };

  const openEditCaseModal = (item: StudentCase) => {
    if (!canManageStudentCases) return;
    const key = buildModalDraftKey(school.id, 'student_case', item.id);
    const draft = loadModalDraft<StudentCaseFormState>(key);
    const fresh = buildFreshEditCaseForm(item);
    setEditingCaseId(item.id);
    if (draft && draft.title) {
      setCaseForm(draft);
      setCaseDraftRestored(true);
    } else {
      setCaseForm(fresh);
      setCaseDraftRestored(false);
    }
    setCaseError('');
    setCaseModalOpen(true);
  };

  const handleDiscardCaseDraft = () => {
    clearModalDraft(caseDraftKey);
    if (editingCaseId) {
      const found = studentCases.find((c) => c.id === editingCaseId);
      if (found) {
        setCaseForm(buildFreshEditCaseForm(found));
      }
    } else {
      setCaseForm(buildFreshCaseForm());
    }
    setCaseDraftRestored(false);
  };

  const handleCaseTypeChange = (nextType: StudentCaseType) => {
    setCaseForm((prev) => {
      if (editingCaseId) {
        return { ...prev, caseType: nextType };
      }
      if (nextType === 'Suspension') {
        return {
          ...prev,
          caseType: nextType,
          severity: 'Severe',
          status: 'Serving Suspension',
          syncStudentStatus: 'Suspended',
        };
      }
      if (nextType === 'Rustication') {
        return {
          ...prev,
          caseType: nextType,
          severity: 'Severe',
          status: 'Rusticated',
          syncStudentStatus: 'Rusticated',
        };
      }
      return {
        ...prev,
        caseType: nextType,
        severity: nextType === 'Warning' || nextType === 'Truancy' ? 'Minor' : 'Moderate',
        status: 'Open',
        syncStudentStatus: '',
      };
    });
  };

  const handleSaveCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageStudentCases) return;
    const targetStudent = students.find((s) => s.id === caseForm.studentId);
    if (!targetStudent) {
      setCaseError('Please select a student for this case.');
      return;
    }
    if (caseForm.title.trim().length < 2) {
      setCaseError('Case title must be at least 2 characters.');
      return;
    }
    if (caseForm.description.trim().length < 2) {
      setCaseError('Please describe the incident or disciplinary reason.');
      return;
    }

    setSavingCase(true);
    setCaseError('');
    try {
      await saveStudentCase(
        school.id,
        ownerId,
        {
          studentId: targetStudent.id,
          studentName: targetStudent.fullName,
          admissionNo: targetStudent.admissionNo,
          formLevel: targetStudent.formLevel,
          stream: targetStudent.stream,
          caseType: caseForm.caseType,
          severity: caseForm.severity,
          status: caseForm.status,
          title: caseForm.title.trim(),
          description: caseForm.description.trim(),
          actionTaken: caseForm.actionTaken.trim(),
          incidentDate: caseForm.incidentDate,
          suspensionEndDate: caseForm.suspensionEndDate,
          guardianNotified: caseForm.guardianNotified,
          recordedBy: recordedByName,
          syncStudentStatus: caseForm.syncStudentStatus,
        },
        editingCaseId || undefined
      );
      clearModalDraft(caseDraftKey);
      setCaseDraftRestored(false);
      setCaseModalOpen(false);
    } catch (err) {
      setCaseError(err instanceof Error ? err.message : 'Unable to save student case.');
    } finally {
      setSavingCase(false);
    }
  };

  const handleQuickResolveCase = async (item: StudentCase) => {
    if (!canManageStudentCases) return;
    setCaseActionBusyId(item.id);
    try {
      const targetStudent = students.find((s) => s.id === item.studentId);
      await saveStudentCase(
        school.id,
        ownerId,
        {
          studentId: item.studentId,
          studentName: item.studentName,
          admissionNo: item.admissionNo,
          formLevel: item.formLevel,
          stream: item.stream,
          caseType: item.caseType,
          severity: item.severity,
          status: 'Resolved',
          title: item.title,
          description: item.description,
          actionTaken: item.actionTaken,
          incidentDate: item.incidentDate,
          suspensionEndDate: item.suspensionEndDate,
          guardianNotified: item.guardianNotified,
          recordedBy: recordedByName,
          syncStudentStatus: targetStudent?.status === 'Suspended' ? 'Active' : '',
        },
        item.id
      );
    } finally {
      setCaseActionBusyId(null);
    }
  };

  const requestDelete = (student: Student) => {
    setDeleteStudentError('');
    setConfirmStudent(student);
  };

  const handleExportCSV = () => {
    downloadCSV(
      `${school.name.toLowerCase().replace(/\s+/g, '-')}-students.csv`,
      [
        'Register #',
        'Admission No',
        'Full Name',
        'Gender',
        'Form',
        'Stream',
        'Year of Entry',
        'Boarding',
        'Guardian',
        'Relationship',
        'Primary Phone',
        'Secondary Phone',
        'Emergency Contact',
        'Emergency Phone',
        'Emergency Notes',
        'Registration Code',
        'Status',
      ],
      filtered.map((s, idx) => [
        idx + 1,
        s.admissionNo,
        s.fullName,
        s.gender,
        `Form ${s.formLevel}`,
        s.stream,
        inferStudentEntryYear(s, school.academicYear),
        s.boardingStatus,
        s.guardianName,
        s.guardianRelationship || '',
        s.guardianPhone,
        s.guardianSecondaryPhone || '',
        s.emergencyContactName || '',
        s.emergencyContactPhone || '',
        s.emergencyNotes || '',
        s.registrationCode || '',
        s.status,
      ])
    );
  };

  const caseMetrics = useMemo(() => {
    const activeSuspensions = studentCases.filter(
      (c) => c.status === 'Serving Suspension' || (c.caseType === 'Suspension' && c.status !== 'Resolved')
    ).length;
    const rustications = studentCases.filter(
      (c) => c.caseType === 'Rustication' || c.status === 'Rusticated'
    ).length;
    const openCases = studentCases.filter(
      (c) => c.status === 'Open' || c.status === 'Under Review' || c.status === 'Appealed'
    ).length;
    return {
      total: studentCases.length,
      activeSuspensions,
      rustications,
      openCases,
    };
  }, [studentCases]);

  const filteredCases = useMemo(() => {
    return studentCases.filter((c) => {
      if (caseTypeFilter !== 'all' && c.caseType !== caseTypeFilter) return false;
      if (caseStatusFilter !== 'all' && c.status !== caseStatusFilter) return false;
      const linkedStu = studentsById.get(c.studentId);
      return matchesStudentSearchQuery(
        {
          fullName: linkedStu?.fullName || c.studentName,
          admissionNo: linkedStu?.admissionNo || c.admissionNo,
          registrationCode: linkedStu?.registrationCode,
          extraTerms: [c.title, c.description],
        },
        caseSearch
      );
    });
  }, [caseSearch, caseStatusFilter, caseTypeFilter, studentCases, studentsById]);

  const detailData = useMemo(() => {
    if (!detailStudent) return null;
    const liveStudent = students.find((s) => s.id === detailStudent.id) || detailStudent;
    const termInvoices = invoices.filter(
      (inv) => inv.studentId === liveStudent.id && inv.term === school.currentTerm
    );
    const billed = termInvoices.reduce((s, i) => s + i.totalBilled, 0);
    const paid = termInvoices.reduce((s, i) => s + i.totalPaid, 0);
    const termMarks = assessments.filter(
      (a) => a.studentId === liveStudent.id && a.term === school.currentTerm
    );
    const standing = calculateStudentStanding(liveStudent.formLevel, termMarks);
    const librarySummary = libraryByStudentId.get(liveStudent.id) || {
      activeLoans: [],
      dueSoonLoans: [],
      overdueLoans: [],
      returnedCount: 0,
    };
    const cases = studentCases.filter((c) => c.studentId === liveStudent.id);
    return {
      student: liveStudent,
      billed,
      paid,
      balance: Math.max(0, billed - paid),
      standing,
      librarySummary,
      cases,
    };
  }, [assessments, detailStudent, invoices, libraryByStudentId, school.currentTerm, studentCases, students]);

  const reportData = useMemo(() => {
    if (!reportStudent) return null;
    const studentMarks = assessments.filter(
      (a) => a.studentId === reportStudent.id && a.term === school.currentTerm
    );
    const standing = calculateStudentStanding(reportStudent.formLevel, studentMarks);
    const termInvoices = invoices.filter(
      (inv) => inv.studentId === reportStudent.id && inv.term === school.currentTerm
    );
    const billed = termInvoices.reduce((s, i) => s + i.totalBilled, 0);
    const paid = termInvoices.reduce((s, i) => s + i.totalPaid, 0);
    return {
      marks: studentMarks.sort((a, b) => a.subject.localeCompare(b.subject)),
      standing,
      billed,
      paid,
      balance: Math.max(0, billed - paid),
    };
  }, [assessments, invoices, reportStudent, school.currentTerm]);

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <div>
              <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Students ({students.length})
              </h1>
            </div>
            <div
              role="tablist"
              aria-label="Students workspace tabs"
              className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900"
            >
              <button
                type="button"
                role="tab"
                aria-selected={sectionTab === 'directory'}
                onClick={() => setSectionTab('directory')}
                className={`min-h-[34px] px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  sectionTab === 'directory'
                    ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Student Directory ({students.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sectionTab === 'gallery'}
                onClick={() => setSectionTab('gallery')}
                className={`inline-flex items-center gap-1.5 min-h-[34px] px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  sectionTab === 'gallery'
                    ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                <span>Gallery ({totalWithPhotosCount})</span>
              </button>
              {canReadAttendance && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={sectionTab === 'attendance'}
                  onClick={() => setSectionTab('attendance')}
                  className={`min-h-[34px] px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    sectionTab === 'attendance'
                      ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {canWriteAttendance ? 'Roll Call & Turnout' : 'Student Turnout'}
                </button>
              )}
              <button
                type="button"
                role="tab"
                aria-selected={sectionTab === 'cases'}
                onClick={() => setSectionTab('cases')}
                className={`inline-flex items-center gap-1.5 min-h-[34px] px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  sectionTab === 'cases'
                    ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <AlertOctagon className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                <span>Suspensions &amp; Cases ({studentCases.length})</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {sectionTab === 'directory' ? (
              <>
                {canManageStudents && missingCodeCount > 0 && (
                  <button
                    type="button"
                    onClick={handleIssueMissingCodes}
                    disabled={issuingCodes}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl border border-emerald-700/30 bg-emerald-50/70 dark:bg-emerald-950/40 text-xs font-semibold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/70 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>
                      {issuingCodes ? 'Issuing Codes...' : `Issue Missing Codes (${missingCodeCount})`}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleExportCSV}
                  disabled={filtered.length === 0}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Export CSV</span>
                </button>
                {canManageStudents && (
                  <button
                    type="button"
                    onClick={() => setCsvImportModalOpen(true)}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Import CSV</span>
                  </button>
                )}
                {canManageStudentCases && (
                  <button
                    type="button"
                    onClick={() => openCreateCaseModal()}
                    disabled={students.length === 0}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl border border-rose-200 dark:border-rose-900/70 bg-rose-50/80 dark:bg-rose-950/35 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100/80 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <AlertOctagon className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Record Case</span>
                  </button>
                )}
                {canManageStudents && (
                  <button
                    type="button"
                    onClick={openCreateModal}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Add Student</span>
                  </button>
                )}
              </>
            ) : sectionTab === 'cases' ? (
              canManageStudentCases && (
                <button
                  type="button"
                  onClick={() => openCreateCaseModal()}
                  disabled={students.length === 0}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Record Student Case</span>
                </button>
              )
            ) : null}
          </div>
        </div>

        {codeBanner && (sectionTab === 'directory' || sectionTab === 'gallery') && (
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 px-3.5 py-2 text-xs text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-2">
            <span>{codeBanner}</span>
            <button
              type="button"
              onClick={() => setCodeBanner('')}
              className="text-emerald-700 dark:text-emerald-300 hover:underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {sectionTab === 'directory' || sectionTab === 'gallery' ? (
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="relative flex-1">
              <Search
                className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search surname, name, reg/adm code, guardian, or phone..."
                className="w-full min-h-[42px] pl-10 pr-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto">
              {(['all', 1, 2, 3, 4] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormFilter(f)}
                  className={`min-h-[38px] px-3 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                    formFilter === f
                      ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {f === 'all' ? 'All Forms' : `Form ${f}`}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Filter by class stream"
                value={streamFilter}
                onChange={(e) => setStreamFilter(e.target.value)}
                className="min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                <option value="all">All Classes</option>
                {availableStreams.map((st) => (
                  <option key={st} value={st}>
                    Stream {st}
                  </option>
                ))}
              </select>

              {sectionTab === 'gallery' ? (
                <select
                  aria-label="Filter by photo availability"
                  value={photoFilter}
                  onChange={(e) =>
                    setPhotoFilter(e.target.value as 'all' | 'with_photo' | 'missing_photo')
                  }
                  className="min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
                >
                  <option value="all">All Students</option>
                  <option value="with_photo">With Profile Photo</option>
                  <option value="missing_photo">Needs Photo</option>
                </select>
              ) : (
                <select
                  aria-label="Filter by boarding status"
                  value={boardingFilter}
                  onChange={(e) => setBoardingFilter(e.target.value as 'all' | BoardingStatus)}
                  className="min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
                >
                  <option value="all">All Boarding</option>
                  <option value="Day Scholar">Day Scholar</option>
                  <option value="Boarder">Boarder</option>
                </select>
              )}

              <select
                aria-label="Register order arrangement"
                value={registerGrouping}
                onChange={(e) => setRegisterGrouping(e.target.value as 'register' | 'by_form')}
                className="min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                <option value="register">Register: Boys ↑ A–Z · Girls ↓ A–Z</option>
                <option value="by_form">By Form · Boys ↑ · Girls ↓</option>
              </select>
            </div>
          </div>
        ) : sectionTab === 'cases' ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                <div className="text-slate-500 dark:text-slate-400">Total Cases Logged</div>
                <div className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  {caseMetrics.total}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200/70 dark:border-amber-900/50">
                <div className="text-amber-800 dark:text-amber-300">Active Suspensions</div>
                <div className="mt-1 text-lg font-bold font-mono tabular-nums text-amber-800 dark:text-amber-300">
                  {caseMetrics.activeSuspensions}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-rose-50/70 dark:bg-rose-950/25 border border-rose-200/70 dark:border-rose-900/50">
                <div className="text-rose-800 dark:text-rose-300">Rustications</div>
                <div className="mt-1 text-lg font-bold font-mono tabular-nums text-rose-700 dark:text-rose-300">
                  {caseMetrics.rustications}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                <div className="text-slate-500 dark:text-slate-400">Open / Under Review</div>
                <div className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  {caseMetrics.openCases}
                </div>
              </div>
            </div>

            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <div className="relative flex-1">
                <Search
                  className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={caseSearch}
                  onChange={(e) => setCaseSearch(e.target.value)}
                  placeholder="Search cases by surname, name, reg/adm code, title, or notes..."
                  className="w-full min-h-[42px] pl-10 pr-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
                />
              </div>

              <select
                aria-label="Filter cases by type"
                value={caseTypeFilter}
                onChange={(e) => setCaseTypeFilter(e.target.value as 'all' | StudentCaseType)}
                className="min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                <option value="all">All Case Types</option>
                {STUDENT_CASE_TYPES.map((ct) => (
                  <option key={ct} value={ct}>
                    {ct}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter cases by status"
                value={caseStatusFilter}
                onChange={(e) => setCaseStatusFilter(e.target.value as 'all' | StudentCaseStatus)}
                className="min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                <option value="all">All Case Statuses</option>
                {STUDENT_CASE_STATUSES.map((cs) => (
                  <option key={cs} value={cs}>
                    {cs}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
      </div>

      {sectionTab === 'attendance' && canReadAttendance ? (
        <StudentAttendancePanel
          school={school}
          ownerId={ownerId}
          students={students}
          attendance={attendance}
          canWriteAttendance={canWriteAttendance}
        />
      ) : sectionTab === 'cases' ? (
        <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
          {filteredCases.length === 0 ? (
            <div className="py-12 px-6 text-center space-y-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {studentCases.length === 0
                  ? 'No student disciplinary cases, suspensions, or rustications recorded yet.'
                  : 'No disciplinary cases match your current filter.'}
              </p>
              {studentCases.length === 0 && canManageStudentCases && students.length > 0 && (
                <button
                  type="button"
                  onClick={() => openCreateCaseModal()}
                  className="inline-flex items-center gap-2 min-h-[42px] px-4 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Record First Student Case</span>
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                    <th className="py-3 px-4 font-medium">Student</th>
                    <th className="py-3 px-4 font-medium">Type &amp; Severity</th>
                    <th className="py-3 px-4 font-medium">Case Summary</th>
                    <th className="py-3 px-4 font-medium">Dates</th>
                    <th className="py-3 px-4 font-medium">Status</th>
                    <th className="py-3 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {filteredCases.map((item) => {
                    const matchedStu = students.find((s) => s.id === item.studentId);
                    return (
                      <tr key={item.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30">
                        <td className="py-3 px-4">
                          {matchedStu ? (
                            <button
                              type="button"
                              onClick={() => {
                                setDetailTab('overview');
                                setDetailStudent(matchedStu);
                              }}
                              className="font-semibold text-slate-900 dark:text-slate-100 hover:text-emerald-700 dark:hover:text-emerald-400 text-left cursor-pointer"
                            >
                              {item.studentName}
                            </button>
                          ) : (
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {item.studentName}
                            </div>
                          )}
                          <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                            {item.admissionNo} · Form {item.formLevel}{item.stream}
                          </div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-lg border text-xs font-semibold ${getCaseTypeTextClass(
                              item.caseType
                            )}`}
                          >
                            {item.caseType}
                          </span>
                          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                            Severity: {item.severity}
                          </div>
                        </td>
                        <td className="py-3 px-4 max-w-sm">
                          <div className="font-semibold text-slate-900 dark:text-slate-100 text-xs">
                            {item.title}
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 mt-0.5">
                            {item.description}
                          </p>
                          {item.actionTaken && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                              Action: {item.actionTaken}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap font-mono tabular-nums text-xs text-slate-600 dark:text-slate-300">
                          <div>Incident: {item.incidentDate}</div>
                          {item.suspensionEndDate && (
                            <div className="text-[11px] text-amber-700 dark:text-amber-400">
                              Ends: {item.suspensionEndDate}
                            </div>
                          )}
                          <div className="text-[11px] text-slate-400 mt-0.5 font-sans">
                            {item.guardianNotified ? 'Guardian notified' : 'Guardian not yet notified'}
                          </div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div
                            className={`text-xs font-semibold ${
                              item.status === 'Resolved'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : item.status === 'Rusticated'
                                ? 'text-rose-700 dark:text-rose-400'
                                : item.status === 'Serving Suspension'
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-slate-800 dark:text-slate-200'
                            }`}
                          >
                            {item.status}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            By {item.recordedBy}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {canManageStudentCases ? (
                            <div className="inline-flex items-center gap-1">
                              {item.status !== 'Resolved' && (
                                <button
                                  type="button"
                                  disabled={caseActionBusyId === item.id}
                                  onClick={() => handleQuickResolveCase(item)}
                                  className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-xs font-semibold cursor-pointer disabled:opacity-50"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>{caseActionBusyId === item.id ? 'Saving...' : 'Resolve'}</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openEditCaseModal(item)}
                                aria-label={`Edit case ${item.title}`}
                                className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteCaseError('');
                                  setConfirmCase(item);
                                }}
                                aria-label={`Delete case ${item.title}`}
                                className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400">Admin managed</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : sectionTab === 'gallery' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 px-1">
            <span className="font-mono tabular-nums">
              Showing {galleryStudents.length} student{galleryStudents.length === 1 ? '' : 's'} ·{' '}
              {galleryStudents.filter((s) => Boolean(s.photoDataUrl && isValidStudentPhotoDataUrl(s.photoDataUrl))).length} with circular photo
            </span>
            <span>
              Click any student portrait to capture or update their profile photo
            </span>
          </div>

          {galleryStudents.length === 0 ? (
            <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl py-12 px-6 text-center space-y-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {students.length === 0
                  ? 'No students enrolled yet.'
                  : 'No students match your selected form, class, or photo filter.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
              {galleryStudents.map((s) => {
                const hasPhoto = Boolean(s.photoDataUrl && isValidStudentPhotoDataUrl(s.photoDataUrl));
                return (
                  <div
                    key={s.id}
                    className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col items-center text-center gap-3"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setPhotoSaveError('');
                        setCameraModalTarget({ mode: 'immediate', student: s });
                      }}
                      title={hasPhoto ? `Update profile photo for ${s.fullName}` : `Set profile photo for ${s.fullName}`}
                      aria-label={hasPhoto ? `Update profile photo for ${s.fullName}` : `Set profile photo for ${s.fullName}`}
                      className="relative group rounded-full cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    >
                      <StudentAvatar
                        fullName={s.fullName}
                        photoDataUrl={s.photoDataUrl}
                        sizeClass="w-24 h-24"
                        textClass="text-2xl"
                      />
                    </button>

                    <div className="w-full min-w-0 space-y-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setDetailTab('overview');
                          setDetailStudent(s);
                        }}
                        className="w-full font-semibold text-sm text-slate-900 dark:text-slate-100 hover:text-emerald-700 dark:hover:text-emerald-400 truncate cursor-pointer"
                      >
                        {s.fullName}
                      </button>
                      <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
                        {s.admissionNo}
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-400 truncate">
                        Form {s.formLevel}{s.stream} · {s.boardingStatus}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setPhotoSaveError('');
                        setCameraModalTarget({ mode: 'immediate', student: s });
                      }}
                      className="mt-auto w-full inline-flex items-center justify-center gap-1.5 min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                      <span>{hasPhoto ? 'Update Photo' : 'Set Photo'}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Data Table */
        <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-12 px-6 text-center space-y-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {students.length === 0
                ? 'No students enrolled yet. Register your first Form 1–4 student.'
                : 'No students match your current search or filter.'}
            </p>
            {students.length === 0 && canManageStudents && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="inline-flex items-center gap-2 min-h-[42px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Enroll First Student</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCsvImportModalOpen(true)}
                  className="inline-flex items-center gap-2 min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  <span>Import from CSV</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-3 font-medium w-10 text-center">#</th>
                  <th className="py-3 px-4 font-medium">Admission #</th>
                  <th className="py-3 px-4 font-medium">Student Name</th>
                  <th className="py-3 px-4 font-medium">Class</th>
                  <th className="py-3 px-4 font-medium">Boarding</th>
                  <th className="py-3 px-4 font-medium">Guardian &amp; Emergency</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filtered.map((s, idx) => {
                  const stuLib = canViewLibrary ? libraryByStudentId.get(s.id) : undefined;
                  const genderRank = getStudentGenderRegisterRank(s.gender);
                  const prevGenderRank =
                    idx > 0 ? getStudentGenderRegisterRank(filtered[idx - 1].gender) : null;
                  const showRegisterHeader =
                    registerGrouping === 'register' &&
                    (idx === 0 || genderRank !== prevGenderRank);
                  const showFormRegisterHeader =
                    registerGrouping === 'by_form' &&
                    (idx === 0 || filtered[idx - 1].formLevel !== s.formLevel);
                  return (
                  <React.Fragment key={s.id}>
                    {showRegisterHeader && (
                      <tr className="bg-slate-50/90 dark:bg-slate-900/70 border-y border-slate-200/80 dark:border-slate-800">
                        <td
                          colSpan={8}
                          className="py-2 px-4 text-[11px] font-mono uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-300"
                        >
                          {genderRank === 0
                            ? `Boys (Upwards · A–Z) · ${filteredGenderCounts.boys}`
                            : genderRank === 1
                            ? `Girls (Downwards · A–Z) · ${filteredGenderCounts.girls}`
                            : 'Other Students · A–Z'}
                        </td>
                      </tr>
                    )}
                    {showFormRegisterHeader && (
                      <tr className="bg-slate-50/90 dark:bg-slate-900/70 border-y border-slate-200/80 dark:border-slate-800">
                        <td
                          colSpan={8}
                          className="py-2 px-4 text-[11px] font-mono uppercase tracking-wider font-semibold text-slate-600 dark:text-slate-300"
                        >
                          Form {s.formLevel} Register · Boys ↑ A–Z · Girls ↓ A–Z
                        </td>
                      </tr>
                    )}
                  <tr className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30">
                    <td className="py-3 px-3 text-center font-mono tabular-nums text-xs text-slate-400 dark:text-slate-500">
                      {idx + 1}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {s.admissionNo}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setPhotoSaveError('');
                            setCameraModalTarget({ mode: 'immediate', student: s });
                          }}
                          title={`Take or update photo for ${s.fullName}`}
                          aria-label={`Take or update photo for ${s.fullName}`}
                          className="relative group shrink-0 rounded-full cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-600"
                        >
                          <StudentAvatar
                            fullName={s.fullName}
                            photoDataUrl={s.photoDataUrl}
                            sizeClass="w-9 h-9"
                            textClass="text-xs"
                          />
                        </button>
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => setDetailStudent(s)}
                            className="font-semibold text-slate-900 dark:text-slate-100 hover:text-emerald-700 dark:hover:text-emerald-400 text-left cursor-pointer"
                          >
                            {s.fullName}
                          </button>
                          <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-1.5">
                            <span>{s.gender}</span>
                        {s.registrationCode ? (
                          <>
                            <span>·</span>
                            <span className="font-mono text-emerald-700 dark:text-emerald-400">
                              Code: {s.registrationCode}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopyCode(s.id, s.registrationCode || '')}
                              aria-label={`Copy registration code for ${s.fullName}`}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                            >
                              {copiedId === s.id ? (
                                <Check className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                              ) : (
                                <Copy className="w-3 h-3" aria-hidden="true" />
                              )}
                            </button>
                          </>
                        ) : (
                          <span>· No portal code</span>
                        )}
                        {stuLib && stuLib.dueSoonLoans.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setDetailStudent(s)}
                            className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                          >
                            <span>·</span>
                            <Clock className="w-3 h-3" aria-hidden="true" />
                            <span>
                              {stuLib.dueSoonLoans.length}{' '}
                              {stuLib.dueSoonLoans.length === 1 ? 'book' : 'books'} due in 48h
                            </span>
                          </button>
                        )}
                        {stuLib && stuLib.overdueLoans.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setDetailStudent(s)}
                            className="inline-flex items-center gap-1 font-medium text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                          >
                            <span>·</span>
                            <span>{stuLib.overdueLoans.length} overdue</span>
                          </button>
                        )}
                      </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-slate-800 dark:text-slate-200 font-medium">
                      <div>Form {s.formLevel}{s.stream}</div>
                      <div className="text-[11px] font-normal font-mono text-slate-500 dark:text-slate-400">
                        Entry {inferStudentEntryYear(s, school.academicYear)}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {s.boardingStatus}
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-xs font-medium text-slate-800 dark:text-slate-200">
                        {s.guardianName}
                        {s.guardianRelationship ? (
                          <span className="text-slate-500 dark:text-slate-400 font-normal">
                            {' '}({s.guardianRelationship})
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {s.guardianPhone || '—'}
                        {s.guardianSecondaryPhone ? ` · Alt: ${s.guardianSecondaryPhone}` : ''}
                      </div>
                      {(s.emergencyContactName || s.emergencyNotes) && (
                        <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5 truncate max-w-[230px]">
                          Emergency: {s.emergencyContactName || 'Medical note saved'}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className={`text-xs font-semibold ${getStudentStatusTextClass(s.status)}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setDetailTab('overview');
                            setDetailStudent(s);
                          }}
                          className="inline-flex items-center gap-1 min-h-[36px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Details</span>
                        </button>
                        {canViewAcademicReport && (
                          <button
                            type="button"
                            onClick={() => setReportStudent(s)}
                            className="inline-flex items-center gap-1 min-h-[36px] px-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer"
                          >
                            <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Report</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setPhotoSaveError('');
                            setCameraModalTarget({ mode: 'immediate', student: s });
                          }}
                          title={`Take or set profile photo for ${s.fullName}`}
                          aria-label={`Take or set profile photo for ${s.fullName}`}
                          className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-emerald-700 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer"
                        >
                          <Camera className="w-3.5 h-3.5" />
                        </button>
                        {canManageStudents && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditModal(s)}
                              aria-label={`Edit ${s.fullName}`}
                              className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => requestDelete(s)}
                              aria-label={`Delete ${s.fullName}`}
                              className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* Student Detail View Modal (Guardian Contact Numbers + Emergency Details) */}
      {detailData && (
        <ModalBackdrop open={Boolean(detailData)} onClose={() => setDetailStudent(null)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl max-h-[92vh] overflow-y-auto space-y-5">
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-start gap-3.5 min-w-0">
                <StudentAvatar
                  fullName={detailData.student.fullName}
                  photoDataUrl={detailData.student.photoDataUrl}
                  sizeClass="w-16 h-16"
                  textClass="text-lg"
                />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    Student Profile &amp; Emergency Record · {school.name}
                  </div>
                  <h2 className="mt-0.5 text-xl font-bold text-slate-900 dark:text-white truncate">
                    {detailData.student.fullName}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
                    {detailData.student.admissionNo} · Form {detailData.student.formLevel}{detailData.student.stream} ({detailData.student.formLevel <= 2 ? 'JCE' : 'MSCE'}) · Entry {inferStudentEntryYear(detailData.student, school.academicYear)} · {detailData.student.boardingStatus} · {detailData.student.gender}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setPhotoSaveError('');
                      setCameraModalTarget({ mode: 'immediate', student: detailData.student });
                    }}
                    className="mt-2 inline-flex items-center gap-1.5 min-h-[32px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                    <span>{detailData.student.photoDataUrl ? 'Update Camera Photo' : 'Take Camera Photo'}</span>
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailStudent(null)}
                aria-label="Close student details"
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {canViewAcademicReport && (
              <div
                role="tablist"
                aria-label="Student profile sections"
                className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailTab === 'overview'}
                  onClick={() => setDetailTab('overview')}
                  className={`min-h-[34px] px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    detailTab === 'overview'
                      ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Profile &amp; Library
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailTab === 'trends'}
                  onClick={() => setDetailTab('trends')}
                  className={`min-h-[34px] px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    detailTab === 'trends'
                      ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Performance Trends
                </button>
              </div>
            )}

            {canViewAcademicReport && detailTab === 'trends' ? (
              <StudentPerformanceTrends
                studentId={detailData.student.id}
                studentName={detailData.student.fullName}
                formLevel={detailData.student.formLevel}
                academicYear={school.academicYear}
                assessments={assessments}
                compact
              />
            ) : (
              <>
            {/* Enrollment & Quick Summary Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                <div className="text-slate-500 dark:text-slate-400">Enrollment Status</div>
                <div
                  className={`mt-1 font-semibold ${
                    detailData.student.status === 'Active'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {detailData.student.status}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                <div className="text-slate-500 dark:text-slate-400">Registration Code</div>
                {detailData.student.registrationCode ? (
                  <div className="mt-1 flex items-center justify-between gap-1.5">
                    <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400 truncate">
                      {detailData.student.registrationCode}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopyCode(
                          `detail_${detailData.student.id}`,
                          detailData.student.registrationCode || ''
                        )
                      }
                      aria-label="Copy student registration code"
                      className="p-1 rounded hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-500 cursor-pointer shrink-0"
                    >
                      {copiedId === `detail_${detailData.student.id}` ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="mt-1 text-slate-400">Not issued</div>
                )}
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                <div className="text-slate-500 dark:text-slate-400">{school.currentTerm} Standing</div>
                <div className="mt-1 font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                  {canViewAcademicReport
                    ? detailData.standing.subjectCount > 0
                      ? `${detailData.standing.averageScore.toFixed(1)}% (${detailData.standing.subjectCount} subj)`
                      : 'No marks'
                    : 'Academic Staff'}
                </div>
                {canViewAcademicReport && (
                  <button
                    type="button"
                    onClick={() => setDetailTab('trends')}
                    className="mt-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                  >
                    View Performance Trends →
                  </button>
                )}
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
                <div className="text-slate-500 dark:text-slate-400">{school.currentTerm} Fee Balance</div>
                <div className="mt-1 font-mono tabular-nums font-semibold text-amber-700 dark:text-amber-400">
                  {canViewFees ? formatMWK(detailData.balance) : 'Bursar Only'}
                </div>
              </div>
            </div>

            {/* Guardian Contact Numbers & Emergency Details Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Guardian Contact Numbers */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 bg-slate-50/50 dark:bg-slate-900/40">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                  <Phone className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                  <span>Guardian Contact Numbers</span>
                </div>

                <div className="space-y-2.5 text-xs">
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Guardian Name &amp; Relationship</div>
                    <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">
                      {detailData.student.guardianName}
                      {detailData.student.guardianRelationship
                        ? ` · ${detailData.student.guardianRelationship}`
                        : ''}
                    </div>
                  </div>

                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Primary Contact Number (SMS Alerts)</div>
                    {detailData.student.guardianPhone ? (
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <a
                          href={`tel:${detailData.student.guardianPhone.replace(/\s+/g, '')}`}
                          className="font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                        >
                          {detailData.student.guardianPhone}
                        </a>
                        {formatMalawiSmsPhone(detailData.student.guardianPhone) && (
                          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            SMS: {formatMalawiSmsPhone(detailData.student.guardianPhone)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="mt-0.5 text-slate-400">Not recorded</div>
                    )}
                  </div>

                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Secondary / Alternate Number</div>
                    {detailData.student.guardianSecondaryPhone ? (
                      <a
                        href={`tel:${detailData.student.guardianSecondaryPhone.replace(/\s+/g, '')}`}
                        className="mt-0.5 inline-block font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200 hover:underline"
                      >
                        {detailData.student.guardianSecondaryPhone}
                      </a>
                    ) : (
                      <div className="mt-0.5 text-slate-400">Not recorded</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Emergency Details */}
              <div className="rounded-xl border border-amber-200/80 dark:border-amber-900/60 p-4 space-y-3 bg-amber-50/40 dark:bg-amber-950/20">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
                  <ShieldAlert className="w-4 h-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />
                  <span>Emergency Details</span>
                </div>

                <div className="space-y-2.5 text-xs">
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Emergency Contact Person</div>
                    <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">
                      {detailData.student.emergencyContactName || 'Not recorded'}
                    </div>
                  </div>

                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Emergency Phone Number</div>
                    {detailData.student.emergencyContactPhone ? (
                      <a
                        href={`tel:${detailData.student.emergencyContactPhone.replace(/\s+/g, '')}`}
                        className="mt-0.5 inline-block font-mono tabular-nums font-semibold text-amber-800 dark:text-amber-300 hover:underline"
                      >
                        {detailData.student.emergencyContactPhone}
                      </a>
                    ) : (
                      <div className="mt-0.5 text-slate-400">Not recorded</div>
                    )}
                  </div>

                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Medical / Allergy &amp; Emergency Notes</div>
                    {detailData.student.emergencyNotes ? (
                      <div className="mt-1 rounded-lg bg-white/80 dark:bg-slate-900/70 border border-amber-200 dark:border-amber-900/50 px-2.5 py-2 text-slate-800 dark:text-slate-200 leading-relaxed flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                        <span>{detailData.student.emergencyNotes}</span>
                      </div>
                    ) : (
                      <div className="mt-0.5 text-slate-400">No medical alerts or emergency instructions recorded.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Library Circulation & 48-Hour Return Reminders on Student Profile */}
            {canViewLibrary && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 bg-slate-50/50 dark:bg-slate-900/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                    <BookOpen className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                    <span>Library Books &amp; 48-Hour Return Reminders</span>
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {detailData.librarySummary.activeLoans.length} active ·{' '}
                    {detailData.librarySummary.returnedCount} returned
                  </div>
                </div>

                {detailData.librarySummary.dueSoonLoans.length > 0 && (
                  <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/30 px-3 py-2.5 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
                    <Clock className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="space-y-0.5">
                      <div className="font-semibold">
                        Automated Return Reminder: {detailData.librarySummary.dueSoonLoans.length}{' '}
                        {detailData.librarySummary.dueSoonLoans.length === 1 ? 'book' : 'books'} due within 48 hours
                      </div>
                      <div className="text-[11px] text-amber-800 dark:text-amber-300">
                        {detailData.librarySummary.dueSoonLoans
                          .map(
                            (l) =>
                              `${l.bookTitle} (${getLibraryDueReminderLabel(l.dueDate, todayIso).urgencyLabel})`
                          )
                          .join(' · ')}
                      </div>
                    </div>
                  </div>
                )}

                {detailData.librarySummary.overdueLoans.length > 0 && (
                  <div className="rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/30 px-3 py-2.5 text-xs text-rose-900 dark:text-rose-200 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <span className="font-semibold">
                        {detailData.librarySummary.overdueLoans.length} overdue{' '}
                        {detailData.librarySummary.overdueLoans.length === 1 ? 'book' : 'books'}:
                      </span>{' '}
                      {detailData.librarySummary.overdueLoans
                        .map(
                          (l) =>
                            `${l.bookTitle} (${getLibraryDueReminderLabel(l.dueDate, todayIso).urgencyLabel})`
                        )
                        .join(' · ')}
                    </div>
                  </div>
                )}

                {detailData.librarySummary.activeLoans.length === 0 ? (
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    No library textbooks or reading materials are currently checked out to this student.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200/70 dark:divide-slate-800 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#161B22] overflow-hidden">
                    {detailData.librarySummary.activeLoans.map((loan) => {
                      const reminder = getLibraryDueReminderLabel(loan.dueDate, todayIso);
                      return (
                        <div
                          key={loan.id}
                          className={`px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs ${
                            reminder.isOverdue
                              ? 'bg-rose-50/40 dark:bg-rose-950/15'
                              : reminder.isDueWithin48h
                              ? 'bg-amber-50/50 dark:bg-amber-950/20'
                              : ''
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {loan.bookTitle}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                              {loan.bookCode} · {loan.subject || 'General'} · Out {loan.checkoutDate}
                            </div>
                          </div>
                          <div className="text-right font-mono tabular-nums shrink-0">
                            <div
                              className={`font-semibold ${
                                reminder.isOverdue
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : reminder.isDueWithin48h
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {reminder.isDueWithin48h
                                ? `Due Within 48h · ${reminder.urgencyLabel}`
                                : reminder.isOverdue
                                ? `Overdue · ${reminder.urgencyLabel}`
                                : 'Checked Out'}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              Due {loan.dueDate}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {/* Disciplinary & Case History */}
            {(detailData.cases.length > 0 || canManageStudentCases) && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 bg-slate-50/50 dark:bg-slate-900/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                    <ClipboardList className="w-4 h-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                    <span>Disciplinary &amp; Case History ({detailData.cases.length})</span>
                  </div>
                  {canManageStudentCases && (
                    <button
                      type="button"
                      onClick={() => {
                        const targetId = detailData.student.id;
                        setDetailStudent(null);
                        openCreateCaseModal(targetId);
                      }}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 dark:text-rose-400 hover:underline cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Record Case / Suspension</span>
                    </button>
                  )}
                </div>

                {detailData.cases.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    No disciplinary cases, suspensions, or rustications recorded for this student.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-200/70 dark:divide-slate-800 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#161B22] overflow-hidden">
                    {detailData.cases.map((c) => (
                      <div key={c.id} className="px-3 py-2.5 text-xs space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-lg border text-[11px] font-semibold ${getCaseTypeTextClass(
                                c.caseType
                              )}`}
                            >
                              {c.caseType}
                            </span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {c.title}
                            </span>
                          </div>
                          <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                            {c.incidentDate}
                            {c.suspensionEndDate ? ` → ${c.suspensionEndDate}` : ''} · {c.status}
                          </span>
                        </div>
                        <p className="text-slate-600 dark:text-slate-400">{c.description}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
              </>
            )}

            {/* Detail Modal Footer Actions */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {canManageStudents && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = detailData.student;
                      setDetailStudent(null);
                      openEditModal(target);
                    }}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Edit Profile &amp; Emergency Info</span>
                  </button>
                )}
                {canManageStudentCases && (
                  <button
                    type="button"
                    onClick={() => {
                      const targetId = detailData.student.id;
                      setDetailStudent(null);
                      openCreateCaseModal(targetId);
                    }}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl border border-rose-200 dark:border-rose-900/70 bg-rose-50/70 dark:bg-rose-950/35 hover:bg-rose-100/70 text-xs font-semibold text-rose-700 dark:text-rose-300 cursor-pointer"
                  >
                    <AlertOctagon className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Record Case / Suspension</span>
                  </button>
                )}
                {canViewAcademicReport && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = detailData.student;
                      setDetailStudent(null);
                      setReportStudent(target);
                    }}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Open Term Report Card</span>
                  </button>
                )}
                {canViewLibrary && onOpenLibrary && (
                  <button
                    type="button"
                    onClick={() => {
                      setDetailStudent(null);
                      onOpenLibrary();
                    }}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer"
                  >
                    <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Open School Library</span>
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDetailStudent(null)}
                className="min-h-[40px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}

      {/* Add / Edit Student Modal */}
      {modalOpen && (
        <ModalBackdrop open={modalOpen} disabled={saving} onClose={() => setModalOpen(false)}>
          <div className="w-full max-w-xl rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {editingId ? 'Edit Student Record' : 'Enroll New Student'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-5">
              <DraftRestoredNotice
                visible={studentDraftRestored}
                onDiscard={handleDiscardStudentDraft}
              />

              {errorMsg && (
                <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                  {errorMsg}
                </div>
              )}

              {/* Student Profile Photo */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-3.5 flex flex-wrap items-center gap-3.5">
                <StudentAvatar
                  fullName={formState.fullName || 'Student'}
                  photoDataUrl={formState.photoDataUrl}
                  sizeClass="w-16 h-16"
                  textClass="text-lg"
                />
                <div className="flex-1 min-w-[180px] space-y-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Student Profile Photo
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Take a square portrait with the device camera or upload an image file.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        setPhotoSaveError('');
                        setCameraModalTarget({ mode: 'form' });
                      }}
                      className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                    >
                      <Camera className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{formState.photoDataUrl ? 'Retake Camera Photo' : 'Take Camera Photo'}</span>
                    </button>
                    <input
                      ref={formPhotoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        setErrorMsg('');
                        setFormPhotoProcessing(true);
                        try {
                          const dataUrl = await processStudentPhotoFile(file);
                          setFormState((prev) => ({ ...prev, photoDataUrl: dataUrl }));
                        } catch (err) {
                          setErrorMsg(
                            err instanceof Error ? err.message : 'Unable to process image file.'
                          );
                        } finally {
                          setFormPhotoProcessing(false);
                        }
                      }}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={saving || formPhotoProcessing}
                      onClick={() => formPhotoInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-50"
                    >
                      <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{formPhotoProcessing ? 'Processing...' : 'Upload'}</span>
                    </button>
                    {formState.photoDataUrl && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => setFormState((prev) => ({ ...prev, photoDataUrl: '' }))}
                        className="inline-flex items-center gap-1 min-h-[36px] px-2.5 rounded-lg text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Student Identity & Academic Placement */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Admission Number
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={40}
                    value={formState.admissionNo}
                    onChange={(e) => setFormState({ ...formState, admissionNo: e.target.value })}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Gender
                  </label>
                  <select
                    value={formState.gender}
                    onChange={(e) => setFormState({ ...formState, gender: e.target.value as Gender })}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                  >
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Student Full Name
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={120}
                    value={formState.fullName}
                    onChange={(e) => setFormState({ ...formState, fullName: e.target.value })}
                    placeholder="e.g. Chifundo Tembo"
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Form Level (Class)
                  </label>
                  <select
                    value={formState.formLevel}
                    onChange={(e) => {
                      const nextForm = Number(e.target.value) as FormLevel;
                      const nextYear = entryYearAuto
                        ? getDefaultEntryYear(nextForm, school.academicYear)
                        : formState.entryYear ?? getDefaultEntryYear(nextForm, school.academicYear);
                      setFormState((prev) => ({
                        ...prev,
                        formLevel: nextForm,
                        entryYear: nextYear,
                        registrationCode: regCodeAuto
                          ? makeUniqueRegCode(nextForm, prev.stream, nextYear, editingId)
                          : prev.registrationCode,
                      }));
                    }}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                  >
                    {FORM_LEVELS.map((f) => (
                      <option key={f} value={f}>
                        Form {f} ({f <= 2 ? 'JCE' : 'MSCE'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Stream
                  </label>
                  <select
                    value={formState.stream}
                    onChange={(e) => {
                      const nextStream = e.target.value;
                      setFormState((prev) => ({
                        ...prev,
                        stream: nextStream,
                        registrationCode: regCodeAuto
                          ? makeUniqueRegCode(prev.formLevel, nextStream, prev.entryYear, editingId)
                          : prev.registrationCode,
                      }));
                    }}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                  >
                    {STREAMS.map((st) => (
                      <option key={st} value={st}>
                        Stream {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Year of Entry
                  </label>
                  <input
                    type="number"
                    required
                    min={2000}
                    max={2100}
                    value={formState.entryYear ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const parsed = Number(raw);
                      setEntryYearAuto(false);
                      setFormState((prev) => ({
                        ...prev,
                        entryYear: raw === '' ? undefined : parsed,
                        registrationCode:
                          regCodeAuto && Number.isFinite(parsed) && parsed >= 2000 && parsed <= 2100
                            ? makeUniqueRegCode(prev.formLevel, prev.stream, parsed, editingId)
                            : prev.registrationCode,
                      }));
                    }}
                    placeholder="e.g. 2026"
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Boarding Status
                  </label>
                  <select
                    value={formState.boardingStatus}
                    onChange={(e) =>
                      setFormState({ ...formState, boardingStatus: e.target.value as BoardingStatus })
                    }
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                  >
                    <option value="Day Scholar">Day Scholar</option>
                    <option value="Boarder">Boarder</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Enrollment Status
                  </label>
                  <select
                    value={formState.status}
                    onChange={(e) =>
                      setFormState({ ...formState, status: e.target.value as StudentStatus })
                    }
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                  >
                    {STUDENT_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Student Portal Registration Code (Auto-Generated)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      maxLength={32}
                      value={formState.registrationCode || ''}
                      onChange={(e) => {
                        setRegCodeAuto(false);
                        setFormState({
                          ...formState,
                          registrationCode: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''),
                        });
                      }}
                      placeholder="e.g. F1A-2026-001"
                      className="flex-1 min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm tracking-wider uppercase"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setRegCodeAuto(true);
                        const targetYear =
                          formState.entryYear &&
                          formState.entryYear >= 2000 &&
                          formState.entryYear <= 2100
                            ? formState.entryYear
                            : getDefaultEntryYear(formState.formLevel, school.academicYear);
                        setFormState((prev) => ({
                          ...prev,
                          entryYear: targetYear,
                          registrationCode: makeUniqueRegCode(
                            prev.formLevel,
                            prev.stream,
                            targetYear,
                            editingId
                          ),
                        }));
                      }}
                      className="inline-flex items-center gap-1.5 min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{formState.registrationCode ? 'Regenerate' : 'Generate'}</span>
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    Auto-generated from Class, Stream &amp; Year of Entry (e.g. F1A-2026-001). Share with the student for portal sign-in.
                  </p>
                </div>
              </div>

              {/* Guardian Contact Numbers */}
              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Guardian Contact Numbers
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Guardian Name
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={120}
                      value={formState.guardianName}
                      onChange={(e) => setFormState({ ...formState, guardianName: e.target.value })}
                      placeholder="e.g. Grace Banda"
                      className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Relationship
                    </label>
                    <select
                      value={formState.guardianRelationship || ''}
                      onChange={(e) =>
                        setFormState({ ...formState, guardianRelationship: e.target.value })
                      }
                      className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                    >
                      <option value="">Select relationship...</option>
                      {GUARDIAN_RELATIONSHIPS.map((rel) => (
                        <option key={rel} value={rel}>
                          {rel}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Primary Guardian Phone (SMS)
                    </label>
                    <input
                      type="tel"
                      maxLength={30}
                      value={formState.guardianPhone}
                      onChange={(e) => setFormState({ ...formState, guardianPhone: e.target.value })}
                      placeholder="+265 999 000 000"
                      className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Secondary / Alternate Phone
                    </label>
                    <input
                      type="tel"
                      maxLength={30}
                      value={formState.guardianSecondaryPhone || ''}
                      onChange={(e) =>
                        setFormState({ ...formState, guardianSecondaryPhone: e.target.value })
                      }
                      placeholder="+265 888 000 000 (optional)"
                      className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Emergency Details */}
              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <div className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                  Emergency Details
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Emergency Contact Person
                    </label>
                    <input
                      type="text"
                      maxLength={120}
                      value={formState.emergencyContactName || ''}
                      onChange={(e) =>
                        setFormState({ ...formState, emergencyContactName: e.target.value })
                      }
                      placeholder="e.g. Dr. Kelvin Banda (Uncle)"
                      className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Emergency Phone Number
                    </label>
                    <input
                      type="tel"
                      maxLength={30}
                      value={formState.emergencyContactPhone || ''}
                      onChange={(e) =>
                        setFormState({ ...formState, emergencyContactPhone: e.target.value })
                      }
                      placeholder="+265 995 110 224"
                      className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Medical Conditions, Allergies &amp; Emergency Notes
                    </label>
                    <textarea
                      rows={2}
                      maxLength={240}
                      value={formState.emergencyNotes || ''}
                      onChange={(e) =>
                        setFormState({ ...formState, emergencyNotes: e.target.value })
                      }
                      placeholder="e.g. Penicillin allergy, asthma inhaler, preferred clinic, or authorized pickup person..."
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[42px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Enroll Student'}
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}

      {/* Student Term Report Card Modal */}
      {reportStudent && reportData && (
        <ModalBackdrop open={Boolean(reportStudent && reportData)} onClose={() => setReportStudent(null)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  {school.name} · {school.district} District
                </div>
                <h2 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
                  {school.currentTerm} Progress Report ({school.academicYear})
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {reportStudent.fullName} · {reportStudent.admissionNo} · Form {reportStudent.formLevel}{reportStudent.stream} ({reportStudent.formLevel <= 2 ? 'JCE' : 'MSCE'})
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Print</span>
                </button>
                <button
                  type="button"
                  onClick={() => setReportStudent(null)}
                  className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Guardian & Emergency Strip */}
            <div className="mt-4 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-slate-500 dark:text-slate-400">Guardian: </span>
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  {reportStudent.guardianName}
                </span>
                <span className="font-mono text-slate-600 dark:text-slate-300">
                  {' '}· {reportStudent.guardianPhone || '—'}
                  {reportStudent.guardianSecondaryPhone ? ` / ${reportStudent.guardianSecondaryPhone}` : ''}
                </span>
              </div>
              {reportStudent.emergencyContactName && (
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Emergency: </span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {reportStudent.emergencyContactName}
                  </span>
                  {reportStudent.emergencyContactPhone && (
                    <span className="font-mono text-slate-600 dark:text-slate-300">
                      {' '}({reportStudent.emergencyContactPhone})
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Academic Summary */}
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900">
                <div className="text-slate-500 dark:text-slate-400">Subjects Graded</div>
                <div className="mt-1 text-base font-bold font-mono tabular-nums">{reportData.standing.subjectCount}</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900">
                <div className="text-slate-500 dark:text-slate-400">Mean Score</div>
                <div className="mt-1 text-base font-bold font-mono tabular-nums">
                  {reportData.standing.averageScore.toFixed(1)}%
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900">
                <div className="text-slate-500 dark:text-slate-400">
                  {reportStudent.formLevel >= 3 ? 'MSCE Best 6' : 'Term Standing'}
                </div>
                <div className="mt-1 text-base font-bold font-mono tabular-nums">
                  {reportStudent.formLevel >= 3
                    ? reportData.standing.bestSixPoints !== null
                      ? `${reportData.standing.bestSixPoints} pts`
                      : 'Need 6'
                    : reportData.standing.outcome}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900">
                <div className="text-slate-500 dark:text-slate-400">Fee Balance</div>
                <div className="mt-1 text-base font-bold font-mono tabular-nums text-amber-700 dark:text-amber-400">
                  {canViewFees ? formatMWK(reportData.balance) : 'Bursar Only'}
                </div>
              </div>
            </div>

            {/* Subject Marks Table */}
            <div className="mt-5 overflow-x-auto">
              {reportData.marks.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                  No {school.currentTerm} subject scores recorded for this student yet.
                </p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="py-2 pr-3 font-medium">Subject</th>
                      <th className="py-2 px-2.5 font-medium text-right">CA 1 (20%)</th>
                      <th className="py-2 px-2.5 font-medium text-right">CA 2 (20%)</th>
                      <th className="py-2 px-2.5 font-medium text-right">Summative (60%)</th>
                      <th className="py-2 px-2.5 font-medium text-right">Total (100%)</th>
                      <th className="py-2 px-2.5 font-medium text-right">Grade</th>
                      <th className="py-2 pl-2.5 font-medium text-right">Remark</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                    {reportData.marks.map((m) => {
                      const b = normalizeAssessmentComponents(m);
                      return (
                        <tr key={m.id}>
                          <td className="py-2.5 pr-3 font-medium text-slate-900 dark:text-slate-100">
                            {m.subject}
                          </td>
                          <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                            {b.hasCa1 ? b.ca1Score.toFixed(1) : '—'}
                          </td>
                          <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                            {b.hasCa2 ? b.ca2Score.toFixed(1) : '—'}
                          </td>
                          <td className="py-2.5 px-2.5 text-right font-mono tabular-nums">
                            {b.hasExam ? b.examScore.toFixed(1) : '—'}
                          </td>
                          <td className="py-2.5 px-2.5 text-right font-mono tabular-nums font-semibold">
                            {m.totalScore}%
                          </td>
                          <td className="py-2.5 px-2.5 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                            {m.grade}
                          </td>
                          <td className="py-2.5 pl-2.5 text-right">{m.remark}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </ModalBackdrop>
      )}

      {/* Record / Edit Student Disciplinary Case Modal */}
      {caseModalOpen && (
        <ModalBackdrop open={caseModalOpen} disabled={savingCase} onClose={() => setCaseModalOpen(false)}>
          <div className="w-full max-w-xl rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {editingCaseId ? 'Edit Student Disciplinary Case' : 'Record Student Case'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setCaseModalOpen(false)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCase} className="mt-4 space-y-4">
              <DraftRestoredNotice
                visible={caseDraftRestored}
                onDiscard={handleDiscardCaseDraft}
              />

              {caseError && (
                <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                  {caseError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Student
                </label>
                <select
                  value={caseForm.studentId}
                  disabled={Boolean(editingCaseId)}
                  onChange={(e) => setCaseForm({ ...caseForm, studentId: e.target.value })}
                  required
                  className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm disabled:opacity-60"
                >
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName} — Form {s.formLevel}{s.stream} ({s.admissionNo} · {s.status})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Case Type
                  </label>
                  <select
                    value={caseForm.caseType}
                    onChange={(e) => handleCaseTypeChange(e.target.value as StudentCaseType)}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                  >
                    {STUDENT_CASE_TYPES.map((ct) => (
                      <option key={ct} value={ct}>
                        {ct}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Severity
                  </label>
                  <select
                    value={caseForm.severity}
                    onChange={(e) =>
                      setCaseForm({ ...caseForm, severity: e.target.value as StudentCaseSeverity })
                    }
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                  >
                    {STUDENT_CASE_SEVERITIES.map((sv) => (
                      <option key={sv} value={sv}>
                        {sv}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Case Status
                  </label>
                  <select
                    value={caseForm.status}
                    onChange={(e) =>
                      setCaseForm({ ...caseForm, status: e.target.value as StudentCaseStatus })
                    }
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                  >
                    {STUDENT_CASE_STATUSES.map((cs) => (
                      <option key={cs} value={cs}>
                        {cs}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Case Title / Offence Summary
                </label>
                <input
                  type="text"
                  required
                  maxLength={140}
                  value={caseForm.title}
                  onChange={(e) => setCaseForm({ ...caseForm, title: e.target.value })}
                  placeholder="e.g. Two-week suspension for repeated dorm violation"
                  className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Incident Details &amp; Committee Findings
                </label>
                <textarea
                  rows={3}
                  required
                  maxLength={1200}
                  value={caseForm.description}
                  onChange={(e) => setCaseForm({ ...caseForm, description: e.target.value })}
                  placeholder="Describe the incident, hearing date, witnesses, and disciplinary ruling..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Incident / Ruling Date
                  </label>
                  <input
                    type="date"
                    required
                    value={caseForm.incidentDate}
                    onChange={(e) => setCaseForm({ ...caseForm, incidentDate: e.target.value })}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Suspension Return / End Date (Optional)
                  </label>
                  <input
                    type="date"
                    value={caseForm.suspensionEndDate}
                    onChange={(e) => setCaseForm({ ...caseForm, suspensionEndDate: e.target.value })}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Disciplinary Action / Conditions (Optional)
                </label>
                <input
                  type="text"
                  maxLength={400}
                  value={caseForm.actionTaken}
                  onChange={(e) => setCaseForm({ ...caseForm, actionTaken: e.target.value })}
                  placeholder="e.g. Guardian conference required before returning to class"
                  className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Update Student Enrollment Status
                  </label>
                  <select
                    value={caseForm.syncStudentStatus}
                    onChange={(e) =>
                      setCaseForm({
                        ...caseForm,
                        syncStudentStatus: e.target.value as StudentStatus | '',
                      })
                    }
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                  >
                    <option value="">Keep current student status</option>
                    <option value="Suspended">Set student status to Suspended</option>
                    <option value="Rusticated">Set student status to Rusticated</option>
                    <option value="Active">Restore student status to Active</option>
                  </select>
                </div>

                <label className="flex items-center gap-2 min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={caseForm.guardianNotified}
                    onChange={(e) =>
                      setCaseForm({ ...caseForm, guardianNotified: e.target.checked })
                    }
                    className="rounded border-slate-300"
                  />
                  <span>Parent / Guardian notified</span>
                </label>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCaseModalOpen(false)}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCase}
                  className="min-h-[42px] px-5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {savingCase ? 'Saving...' : editingCaseId ? 'Save Case Changes' : 'Save Student Case'}
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}

      {/* Safe Delete Student Modal */}
      <ConfirmDeleteModal
        open={!!confirmStudent}
        title="Delete Student Record"
        itemName={
          confirmStudent
            ? `${confirmStudent.fullName} · ${confirmStudent.admissionNo} (Form ${confirmStudent.formLevel}${confirmStudent.stream})`
            : ''
        }
        description="This permanently removes the student from the school registry and immediately revokes their Student Results Portal access."
        warningNote="High-risk action: If this student only transferred or graduated, consider changing their Enrollment Status instead so historical marks and invoices remain linked."
        requireKeyword="DELETE"
        confirmLabel="Delete Student"
        deleting={deletingStudent}
        error={deleteStudentError}
        onCancel={() => {
          if (!deletingStudent) setConfirmStudent(null);
        }}
        onConfirm={async () => {
          if (!confirmStudent) return;
          setDeletingStudent(true);
          setDeleteStudentError('');
          try {
            await removeStudent(school.id, confirmStudent.id);
            setConfirmStudent(null);
          } catch (err) {
            setDeleteStudentError(
              err instanceof Error ? err.message : 'Unable to delete student.'
            );
          } finally {
            setDeletingStudent(false);
          }
        }}
      />

      {/* Safe Delete Disciplinary Case Modal */}
      <ConfirmDeleteModal
        open={!!confirmCase}
        title="Delete Disciplinary Case"
        itemName={
          confirmCase
            ? `${confirmCase.studentName} · ${confirmCase.caseType}: ${confirmCase.title}`
            : ''
        }
        description="This permanently deletes this disciplinary case record from the school register. Student enrollment status is not changed automatically."
        confirmLabel="Delete Case"
        deleting={deletingCase}
        error={deleteCaseError}
        onCancel={() => {
          if (!deletingCase) {
            setConfirmCase(null);
            setDeleteCaseError('');
          }
        }}
        onConfirm={async () => {
          if (!confirmCase) return;
          setDeletingCase(true);
          setDeleteCaseError('');
          try {
            await removeStudentCase(school.id, confirmCase.id);
            setConfirmCase(null);
          } catch (err) {
            setDeleteCaseError(
              err instanceof Error ? err.message : 'Unable to delete disciplinary case.'
            );
          } finally {
            setDeletingCase(false);
          }
        }}
      />
      <StudentCsvImportModal
        open={canManageStudents && csvImportModalOpen}
        school={school}
        ownerId={ownerId}
        students={students}
        onClose={() => setCsvImportModalOpen(false)}
      />
      <StudentPhotoCaptureModal
        open={Boolean(cameraModalTarget) && (cameraModalTarget?.mode !== 'form' || canManageStudents)}
        headerLabel="Student Portrait Camera"
        saveButtonLabel={cameraModalTarget?.mode === 'form' ? 'Use Photo' : 'Save Student Photo'}
        mode={cameraModalTarget?.mode === 'form' ? 'form' : 'immediate'}
        studentName={
          cameraModalTarget?.mode === 'immediate'
            ? cameraModalTarget.student.fullName
            : formState.fullName
        }
        admissionNo={
          cameraModalTarget?.mode === 'immediate'
            ? cameraModalTarget.student.admissionNo
            : formState.admissionNo
        }
        initialPhotoUrl={
          cameraModalTarget?.mode === 'immediate'
            ? cameraModalTarget.student.photoDataUrl || ''
            : formState.photoDataUrl || ''
        }
        saving={savingPhoto}
        saveError={photoSaveError}
        onClose={() => {
          if (!savingPhoto) {
            setCameraModalTarget(null);
            setPhotoSaveError('');
          }
        }}
        onSavePhoto={async (photoDataUrl) => {
          if (!cameraModalTarget) return;
          if (cameraModalTarget.mode === 'form') {
            setFormState((prev) => ({ ...prev, photoDataUrl }));
            setCameraModalTarget(null);
            return;
          }

          setSavingPhoto(true);
          setPhotoSaveError('');
          try {
            await updateStudentPhoto(school.id, cameraModalTarget.student.id, photoDataUrl);
            setCodeBanner(
              photoDataUrl
                ? `Updated profile photo for ${cameraModalTarget.student.fullName}.`
                : `Removed profile photo for ${cameraModalTarget.student.fullName}.`
            );
            setCameraModalTarget(null);
          } catch (err) {
            setPhotoSaveError(
              err instanceof Error ? err.message : 'Unable to save student photo.'
            );
          } finally {
            setSavingPhoto(false);
          }
        }}
      />
    </div>
  );
};
