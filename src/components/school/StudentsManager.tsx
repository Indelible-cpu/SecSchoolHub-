import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  Clock,
  Copy,
  Download,
  Eye,
  FileText,
  KeyRound,
  Pencil,
  Phone,
  Printer,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import {
  Assessment,
  BoardingStatus,
  FeeInvoice,
  FormLevel,
  Gender,
  LibraryLoan,
  School,
  Student,
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
  inferStudentEntryYear,
  isLibraryLoanDueWithin48Hours,
  isLibraryLoanOverdue,
  normalizeAssessmentComponents,
  normalizeRegistrationCode,
  STREAMS,
} from '../../school/malawi';
import {
  issueMissingRegistrationCodes,
  removeStudent,
  saveStudent,
  StudentPayload,
} from '../../school/firestoreService';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';
import { StudentPerformanceTrends } from './StudentPerformanceTrends';

interface StudentsManagerProps {
  school: School;
  ownerId: string;
  students: Student[];
  assessments: Assessment[];
  invoices: FeeInvoice[];
  libraryLoans?: LibraryLoan[];
  canManageStudents?: boolean;
  canViewAcademicReport?: boolean;
  canViewFees?: boolean;
  canViewLibrary?: boolean;
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
  status: 'Active',
};

export const StudentsManager: React.FC<StudentsManagerProps> = ({
  school,
  ownerId,
  students,
  assessments,
  invoices,
  libraryLoans = [],
  canManageStudents = true,
  canViewAcademicReport = true,
  canViewFees = true,
  canViewLibrary = false,
  onOpenLibrary,
}) => {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [search, setSearch] = useState('');
  const [formFilter, setFormFilter] = useState<'all' | FormLevel>('all');
  const [boardingFilter, setBoardingFilter] = useState<'all' | BoardingStatus>('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formState, setFormState] = useState<StudentPayload>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students
      .filter((s) => {
        if (formFilter !== 'all' && s.formLevel !== formFilter) return false;
        if (boardingFilter !== 'all' && s.boardingStatus !== boardingFilter) return false;
        if (!q) return true;
        return (
          s.fullName.toLowerCase().includes(q) ||
          s.admissionNo.toLowerCase().includes(q) ||
          s.guardianName.toLowerCase().includes(q) ||
          (s.guardianPhone || '').toLowerCase().includes(q) ||
          (s.guardianSecondaryPhone || '').toLowerCase().includes(q) ||
          (s.emergencyContactName || '').toLowerCase().includes(q) ||
          (s.registrationCode || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.formLevel - b.formLevel || a.fullName.localeCompare(b.fullName));
  }, [boardingFilter, formFilter, search, students]);

  const openCreateModal = () => {
    const nextNumber = String(students.length + 1).padStart(3, '0');
    const defaultEntryYear = getDefaultEntryYear(1, school.academicYear);
    setEditingId(null);
    setEntryYearAuto(true);
    setRegCodeAuto(true);
    setFormState({
      ...EMPTY_FORM,
      admissionNo: `SCH/${defaultEntryYear}/${nextNumber}`,
      entryYear: defaultEntryYear,
      registrationCode: makeUniqueRegCode(1, 'A', defaultEntryYear, null),
    });
    setErrorMsg('');
    setModalOpen(true);
  };

  const openEditModal = (student: Student) => {
    const inferredYear = inferStudentEntryYear(student, school.academicYear);
    const hasExistingCode = normalizeRegistrationCode(student.registrationCode).length >= 6;
    setEditingId(student.id);
    setEntryYearAuto(!student.entryYear);
    setRegCodeAuto(!hasExistingCode);
    setFormState({
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
      status: student.status,
    });
    setErrorMsg('');
    setModalOpen(true);
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
      setModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save student.');
    } finally {
      setSaving(false);
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
      filtered.map((s) => [
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
    return {
      student: liveStudent,
      billed,
      paid,
      balance: Math.max(0, billed - paid),
      standing,
      librarySummary,
    };
  }, [assessments, detailStudent, invoices, libraryByStudentId, school.currentTerm, students]);

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
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Student Registry
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
              {filtered.length} of {students.length} students
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
                onClick={openCreateModal}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Add Student</span>
              </button>
            )}
          </div>
        </div>

        {codeBanner && (
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

        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="relative flex-1">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search student, admission #, reg code, guardian, or phone..."
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
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-12 px-6 text-center space-y-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {students.length === 0
                ? 'No students enrolled yet. Register your first Form 1–4 student.'
                : 'No students match your current search or filter.'}
            </p>
            {students.length === 0 && canManageStudents && (
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex items-center gap-2 min-h-[42px] px-4 rounded-xl bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
              >
                <UserPlus className="w-4 h-4" />
                <span>Enroll First Student</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
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
                {filtered.map((s) => {
                  const stuLib = canViewLibrary ? libraryByStudentId.get(s.id) : undefined;
                  return (
                  <tr key={s.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30">
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {s.admissionNo}
                    </td>
                    <td className="py-3 px-4">
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
                      <span
                        className={`text-xs font-semibold ${
                          s.status === 'Active'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : s.status === 'Suspended'
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Student Detail View Modal (Guardian Contact Numbers + Emergency Details) */}
      {detailData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl max-h-[92vh] overflow-y-auto space-y-5">
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  Student Profile &amp; Emergency Record · {school.name}
                </div>
                <h2 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">
                  {detailData.student.fullName}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
                  {detailData.student.admissionNo} · Form {detailData.student.formLevel}{detailData.student.stream} ({detailData.student.formLevel <= 2 ? 'JCE' : 'MSCE'}) · Entry {inferStudentEntryYear(detailData.student, school.academicYear)} · {detailData.student.boardingStatus} · {detailData.student.gender}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailStudent(null)}
                aria-label="Close student details"
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
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
        </div>
      )}

      {/* Add / Edit Student Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
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
              {errorMsg && (
                <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                  {errorMsg}
                </div>
              )}

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
                    <option value="Active">Active</option>
                    <option value="Transferred">Transferred</option>
                    <option value="Suspended">Suspended</option>
                    <option value="Graduated">Graduated</option>
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
        </div>
      )}

      {/* Student Term Report Card Modal */}
      {reportStudent && reportData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
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
        </div>
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
    </div>
  );
};
