import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookCheck,
  BookOpen,
  Download,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  FormLevel,
  LibraryItemCondition,
  LibraryLoan,
  LibraryLoanStatus,
  LibraryMaterialCategory,
  School,
  SchoolSubject,
  Student,
} from '../../school/types';
import {
  addDaysToIsoDate,
  downloadCSV,
  FORM_LEVELS,
  getLibraryDaysOverdue,
  getSubjectsForForm,
  isLibraryLoanOverdue,
  LIBRARY_MATERIAL_CATEGORIES,
  LIBRARY_RETURN_CONDITIONS,
} from '../../school/malawi';
import {
  markLibraryLoanReturned,
  reopenLibraryLoan,
  removeLibraryLoan,
  saveLibraryLoan,
} from '../../school/firestoreService';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';

interface SchoolLibraryProps {
  school: School;
  ownerId: string;
  students: Student[];
  schoolSubjects: SchoolSubject[];
  libraryLoans: LibraryLoan[];
  canWriteLibrary: boolean;
}

type LibraryStatusFilter = 'All' | 'Checked Out' | 'Overdue' | 'Returned';

const COMMON_MATERIAL_TITLES = [
  'MSCE English Grammar & Composition',
  'The Pearl (John Steinbeck)',
  'Macbeth (William Shakespeare)',
  'Excel & Succeed Mathematics Form 4',
  'Excel & Succeed Mathematics Form 3',
  'Excel & Succeed Biology Form 4',
  'Excel & Succeed Physical Science Form 3',
  'Chichewa Chathu Form 1–2',
  'MSCE Geography Revision Atlas',
  'JCE Integrated Science Practical Manual',
  'MSCE Past Papers Compilation',
];

function suggestCopyCode(subject: string, existingLoans: LibraryLoan[]): string {
  const token =
    (subject || 'GEN')
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase()
      .slice(0, 3) || 'GEN';
  const prefix = `LIB-${token}-`;
  let maxNum = 0;
  for (const loan of existingLoans) {
    const code = (loan.bookCode || '').toUpperCase();
    if (code.startsWith(prefix)) {
      const tail = Number(code.slice(prefix.length));
      if (Number.isFinite(tail) && tail > maxNum) {
        maxNum = tail;
      }
    }
  }
  return `${prefix}${String(maxNum + 1).padStart(3, '0')}`;
}

export const SchoolLibrary: React.FC<SchoolLibraryProps> = ({
  school,
  ownerId,
  students,
  schoolSubjects,
  libraryLoans,
  canWriteLibrary,
}) => {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<LibraryStatusFilter>('All');
  const [formFilter, setFormFilter] = useState<FormLevel | 'All'>('All');
  const [categoryFilter, setCategoryFilter] = useState<LibraryMaterialCategory | 'All'>('All');

  // Assign / Edit Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingLoan, setEditingLoan] = useState<LibraryLoan | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [bookTitle, setBookTitle] = useState('');
  const [materialType, setMaterialType] = useState<LibraryMaterialCategory>('Textbook');
  const [subject, setSubject] = useState('English');
  const [bookCode, setBookCode] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [checkoutDate, setCheckoutDate] = useState(todayIso);
  const [dueDate, setDueDate] = useState(() => addDaysToIsoDate(todayIso, 14));
  const [loanStatus, setLoanStatus] = useState<LibraryLoanStatus>('Checked Out');
  const [returnedDate, setReturnedDate] = useState('');
  const [conditionOnReturn, setConditionOnReturn] = useState<LibraryItemCondition>('Good');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Return Confirmation Modal State
  const [returningLoan, setReturningLoan] = useState<LibraryLoan | null>(null);
  const [returnDateInput, setReturnDateInput] = useState(todayIso);
  const [returnConditionInput, setReturnConditionInput] = useState<LibraryItemCondition>('Good');
  const [returnNotesInput, setReturnNotesInput] = useState('');
  const [processingReturn, setProcessingReturn] = useState(false);
  const [returnError, setReturnError] = useState('');

  // Safe Delete Modal State
  const [deleteTarget, setDeleteTarget] = useState<LibraryLoan | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const activeStudents = useMemo(
    () =>
      students
        .filter((s) => s.status === 'Active')
        .sort(
          (a, b) =>
            a.formLevel - b.formLevel ||
            a.stream.localeCompare(b.stream) ||
            a.fullName.localeCompare(b.fullName)
        ),
    [students]
  );

  const selectedStudent = useMemo(
    () => students.find((s) => s.id === selectedStudentId) || null,
    [students, selectedStudentId]
  );

  const subjectOptionsForForm = useMemo(() => {
    const targetForm = (selectedStudent?.formLevel || editingLoan?.formLevel || 1) as FormLevel;
    const base = getSubjectsForForm(schoolSubjects, targetForm);
    const list = base.includes('General') ? base : [...base, 'General'];
    if (subject && !list.includes(subject)) {
      return [subject, ...list];
    }
    return list;
  }, [editingLoan?.formLevel, schoolSubjects, selectedStudent?.formLevel, subject]);

  const stats = useMemo(() => {
    let checkedOutLoans = 0;
    let checkedOutCopies = 0;
    let overdueLoans = 0;
    let overdueCopies = 0;
    let returnedLoans = 0;
    let damagedOrLost = 0;

    for (const loan of libraryLoans) {
      const qty = Math.max(1, Number(loan.quantity) || 1);
      if (loan.status === 'Checked Out') {
        checkedOutLoans += 1;
        checkedOutCopies += qty;
        if (isLibraryLoanOverdue(loan, todayIso)) {
          overdueLoans += 1;
          overdueCopies += qty;
        }
      } else {
        returnedLoans += 1;
        if (loan.conditionOnReturn === 'Damaged' || loan.conditionOnReturn === 'Lost') {
          damagedOrLost += 1;
        }
      }
    }

    return {
      checkedOutLoans,
      checkedOutCopies,
      overdueLoans,
      overdueCopies,
      returnedLoans,
      damagedOrLost,
      totalRecords: libraryLoans.length,
    };
  }, [libraryLoans, todayIso]);

  const sortedAndFilteredLoans = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return libraryLoans
      .filter((loan) => {
        if (formFilter !== 'All' && loan.formLevel !== formFilter) return false;
        if (categoryFilter !== 'All' && loan.materialType !== categoryFilter) return false;
        if (statusFilter === 'Checked Out' && loan.status !== 'Checked Out') return false;
        if (statusFilter === 'Overdue' && !isLibraryLoanOverdue(loan, todayIso)) return false;
        if (statusFilter === 'Returned' && loan.status !== 'Returned') return false;
        if (!q) return true;
        return (
          loan.bookTitle.toLowerCase().includes(q) ||
          loan.bookCode.toLowerCase().includes(q) ||
          loan.studentName.toLowerCase().includes(q) ||
          loan.admissionNo.toLowerCase().includes(q) ||
          loan.subject.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const aOverdue = isLibraryLoanOverdue(a, todayIso) ? 0 : a.status === 'Checked Out' ? 1 : 2;
        const bOverdue = isLibraryLoanOverdue(b, todayIso) ? 0 : b.status === 'Checked Out' ? 1 : 2;
        if (aOverdue !== bOverdue) return aOverdue - bOverdue;
        if (a.status === 'Checked Out' && b.status === 'Checked Out') {
          return a.dueDate.localeCompare(b.dueDate);
        }
        return b.checkoutDate.localeCompare(a.checkoutDate);
      });
  }, [categoryFilter, formFilter, libraryLoans, searchQuery, statusFilter, todayIso]);

  const openAssignModal = () => {
    const defaultStu = activeStudents[0] || students[0] || null;
    const defaultForm = (defaultStu?.formLevel || 1) as FormLevel;
    const defaultSubjects = getSubjectsForForm(schoolSubjects, defaultForm);
    const defaultSubj = defaultSubjects[0] || 'English';

    setEditingLoan(null);
    setSelectedStudentId(defaultStu?.id || '');
    setBookTitle('');
    setMaterialType('Textbook');
    setSubject(defaultSubj);
    setBookCode(suggestCopyCode(defaultSubj, libraryLoans));
    setQuantity(1);
    setCheckoutDate(todayIso);
    setDueDate(addDaysToIsoDate(todayIso, 14));
    setLoanStatus('Checked Out');
    setReturnedDate('');
    setConditionOnReturn('Good');
    setNotes('');
    setFormError('');
    setModalOpen(true);
  };

  const openEditModal = (loan: LibraryLoan) => {
    setEditingLoan(loan);
    setSelectedStudentId(loan.studentId);
    setBookTitle(loan.bookTitle);
    setMaterialType(loan.materialType);
    setSubject(loan.subject || 'General');
    setBookCode(loan.bookCode);
    setQuantity(loan.quantity || 1);
    setCheckoutDate(loan.checkoutDate);
    setDueDate(loan.dueDate);
    setLoanStatus(loan.status);
    setReturnedDate(loan.returnedDate || '');
    setConditionOnReturn(loan.conditionOnReturn || 'Good');
    setNotes(loan.notes || '');
    setFormError('');
    setModalOpen(true);
  };

  const handleSaveLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteLibrary) return;

    const student = students.find((s) => s.id === selectedStudentId);
    if (!student) {
      setFormError('Select a student from the registry before issuing material.');
      return;
    }
    if (bookTitle.trim().length < 2) {
      setFormError('Enter a book or reading material title (at least 2 characters).');
      return;
    }
    if (!bookCode.trim()) {
      setFormError('Enter a library copy or inventory code (e.g. LIB-ENG-001).');
      return;
    }
    if (dueDate < checkoutDate) {
      setFormError('Due date cannot be earlier than the checkout date.');
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      await saveLibraryLoan(
        school.id,
        ownerId,
        {
          studentId: student.id,
          studentName: student.fullName,
          admissionNo: student.admissionNo || 'N/A',
          formLevel: student.formLevel,
          stream: student.stream || 'A',
          bookTitle: bookTitle.trim(),
          materialType,
          subject: subject.trim() || 'General',
          bookCode: bookCode.trim().toUpperCase(),
          quantity: Math.min(20, Math.max(1, Math.round(Number(quantity) || 1))),
          checkoutDate,
          dueDate,
          returnedDate: loanStatus === 'Returned' ? returnedDate || todayIso : '',
          status: loanStatus,
          conditionOnReturn: loanStatus === 'Returned' ? conditionOnReturn : 'Good',
          notes: notes.trim(),
        },
        editingLoan?.id
      );
      setModalOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save library loan.');
    } finally {
      setSaving(false);
    }
  };

  const openReturnModal = (loan: LibraryLoan) => {
    setReturningLoan(loan);
    setReturnDateInput(todayIso);
    setReturnConditionInput('Good');
    setReturnNotesInput(loan.notes || '');
    setReturnError('');
  };

  const handleConfirmReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returningLoan || !canWriteLibrary) return;
    if (returnDateInput < returningLoan.checkoutDate) {
      setReturnError('Return date cannot be earlier than the checkout date.');
      return;
    }

    setProcessingReturn(true);
    setReturnError('');
    try {
      await markLibraryLoanReturned(school.id, returningLoan.id, {
        returnedDate: returnDateInput,
        conditionOnReturn: returnConditionInput,
        notes: returnNotesInput.trim(),
      });
      setReturningLoan(null);
    } catch (err) {
      setReturnError(err instanceof Error ? err.message : 'Unable to mark material as returned.');
    } finally {
      setProcessingReturn(false);
    }
  };

  const handleReopenLoan = async (loan: LibraryLoan) => {
    if (!canWriteLibrary) return;
    setActionBusyId(loan.id);
    try {
      await reopenLibraryLoan(school.id, loan.id);
    } finally {
      setActionBusyId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !canWriteLibrary) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await removeLibraryLoan(school.id, deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unable to remove library record.');
    } finally {
      setDeleting(false);
    }
  };

  const handleExportCsv = () => {
    const headers = [
      'Copy Code',
      'Material Title',
      'Category',
      'Subject',
      'Qty',
      'Student Name',
      'Admission No',
      'Form',
      'Stream',
      'Checkout Date',
      'Due Date',
      'Returned Date',
      'Status',
      'Condition',
      'Notes',
    ];
    const rows = sortedAndFilteredLoans.map((loan) => {
      const overdue = isLibraryLoanOverdue(loan, todayIso);
      const statusText = overdue
        ? `Overdue (${getLibraryDaysOverdue(loan.dueDate, todayIso)}d)`
        : loan.status;
      return [
        loan.bookCode,
        loan.bookTitle,
        loan.materialType,
        loan.subject || 'General',
        loan.quantity || 1,
        loan.studentName,
        loan.admissionNo,
        `Form ${loan.formLevel}`,
        loan.stream,
        loan.checkoutDate,
        loan.dueDate,
        loan.returnedDate || '',
        statusText,
        loan.status === 'Returned' ? loan.conditionOnReturn : '—',
        loan.notes || '',
      ];
    });
    downloadCSV(
      `${school.name.replace(/\s+/g, '_')}_Library_Loans_${todayIso}.csv`,
      headers,
      rows
    );
  };

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Checked Out</span>
            <BookOpen className="w-4 h-4 text-emerald-600" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {stats.checkedOutLoans}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {stats.checkedOutCopies} {stats.checkedOutCopies === 1 ? 'copy' : 'copies'} with students
          </div>
        </div>

        <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Overdue Returns</span>
            <AlertTriangle
              className={`w-4 h-4 ${stats.overdueLoans > 0 ? 'text-rose-600' : 'text-slate-400'}`}
              aria-hidden="true"
            />
          </div>
          <div
            className={`mt-2 text-2xl font-bold font-mono tabular-nums ${
              stats.overdueLoans > 0
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-slate-900 dark:text-white'
            }`}
          >
            {stats.overdueLoans}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {stats.overdueLoans > 0
              ? `${stats.overdueCopies} past due (${todayIso})`
              : 'No overdue books'}
          </div>
        </div>

        <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Returned</span>
            <BookCheck className="w-4 h-4 text-emerald-600" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
            {stats.returnedLoans}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {stats.damagedOrLost > 0
              ? `${stats.damagedOrLost} damaged or lost`
              : 'All returned intact'}
          </div>
        </div>

        <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Total Circulation</span>
            <BookOpen className="w-4 h-4 text-slate-400" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {stats.totalRecords}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Textbooks &amp; reading materials
          </div>
        </div>
      </div>

      {/* Main Circulation Card */}
      <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
              School Library &amp; Textbook Register
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Track textbooks, literature set books, past papers, and return due dates across Forms 1–4.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={sortedAndFilteredLoans.length === 0}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Export CSV</span>
            </button>
            {canWriteLibrary && (
              <button
                type="button"
                onClick={openAssignModal}
                disabled={students.length === 0}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-40 cursor-pointer"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Assign Material</span>
              </button>
            )}
          </div>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-900 p-1">
              {(
                [
                  { id: 'All', label: `All (${libraryLoans.length})` },
                  { id: 'Checked Out', label: `Checked Out (${stats.checkedOutLoans})` },
                  { id: 'Overdue', label: `Overdue (${stats.overdueLoans})` },
                  { id: 'Returned', label: `Returned (${stats.returnedLoans})` },
                ] as { id: LibraryStatusFilter; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    statusFilter === tab.id
                      ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <select
              aria-label="Filter by form level"
              value={formFilter}
              onChange={(e) =>
                setFormFilter(e.target.value === 'All' ? 'All' : (Number(e.target.value) as FormLevel))
              }
              className="min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200"
            >
              <option value="All">All Forms</option>
              {FORM_LEVELS.map((f) => (
                <option key={f} value={f}>
                  Form {f}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by material type"
              value={categoryFilter}
              onChange={(e) =>
                setCategoryFilter(e.target.value as LibraryMaterialCategory | 'All')
              }
              className="min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200"
            >
              <option value="All">All Material Types</option>
              {LIBRARY_MATERIAL_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="relative w-full lg:w-72">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search title, code, or student..."
              className="w-full min-h-[40px] pl-9 pr-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
            />
          </div>
        </div>

        {/* Circulation Table */}
        {students.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            Add students in the Students registry first before assigning library materials.
          </div>
        ) : sortedAndFilteredLoans.length === 0 ? (
          <div className="py-12 text-center space-y-2">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {libraryLoans.length === 0
                ? 'No library materials checked out yet.'
                : 'No circulation records match your current filters.'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {libraryLoans.length === 0
                ? 'Use Assign Material to issue textbooks, set books, or revision manuals to students.'
                : 'Try clearing the search box or switching the status tab.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 pr-3 font-medium">Material &amp; Copy Code</th>
                  <th className="py-2.5 px-3 font-medium">Student</th>
                  <th className="py-2.5 px-3 font-medium">Subject</th>
                  <th className="py-2.5 px-3 font-medium">Dates</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  {canWriteLibrary && (
                    <th className="py-2.5 pl-3 font-medium text-right">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {sortedAndFilteredLoans.map((loan) => {
                  const overdue = isLibraryLoanOverdue(loan, todayIso);
                  const daysLate = overdue ? getLibraryDaysOverdue(loan.dueDate, todayIso) : 0;
                  const isBusy = actionBusyId === loan.id;

                  return (
                    <tr
                      key={loan.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 align-top"
                    >
                      <td className="py-3 pr-3 min-w-[220px]">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {loan.bookTitle}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 font-mono">
                          {loan.bookCode} · {loan.materialType}
                          {loan.quantity > 1 ? ` · Qty ${loan.quantity}` : ''}
                        </div>
                        {loan.notes && (
                          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">
                            {loan.notes}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 min-w-[160px]">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {loan.studentName}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 font-mono">
                          Form {loan.formLevel}
                          {loan.stream} · {loan.admissionNo}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {loan.subject || 'General'}
                      </td>

                      <td className="py-3 px-3 text-xs font-mono tabular-nums whitespace-nowrap">
                        <div className="text-slate-600 dark:text-slate-300">
                          Out: {loan.checkoutDate}
                        </div>
                        <div
                          className={
                            overdue
                              ? 'text-rose-600 dark:text-rose-400 font-semibold mt-0.5'
                              : 'text-slate-500 dark:text-slate-400 mt-0.5'
                          }
                        >
                          Due: {loan.dueDate}
                        </div>
                        {loan.status === 'Returned' && loan.returnedDate && (
                          <div className="text-emerald-700 dark:text-emerald-400 mt-0.5">
                            In: {loan.returnedDate}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 text-xs whitespace-nowrap">
                        {loan.status === 'Returned' ? (
                          <div>
                            <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                              Returned
                            </div>
                            <div
                              className={`mt-0.5 ${
                                loan.conditionOnReturn === 'Damaged' ||
                                loan.conditionOnReturn === 'Lost'
                                  ? 'text-rose-600 dark:text-rose-400 font-medium'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              Condition: {loan.conditionOnReturn}
                            </div>
                          </div>
                        ) : overdue ? (
                          <div>
                            <div className="font-semibold text-rose-600 dark:text-rose-400">
                              Overdue
                            </div>
                            <div className="mt-0.5 font-mono text-rose-600 dark:text-rose-400">
                              {daysLate} {daysLate === 1 ? 'day' : 'days'} late
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="font-semibold text-amber-700 dark:text-amber-400">
                              Checked Out
                            </div>
                            <div className="mt-0.5 text-slate-500 dark:text-slate-400">
                              Active loan
                            </div>
                          </div>
                        )}
                      </td>

                      {canWriteLibrary && (
                        <td className="py-3 pl-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {loan.status === 'Checked Out' ? (
                              <button
                                type="button"
                                onClick={() => openReturnModal(loan)}
                                disabled={isBusy}
                                className="min-h-[34px] px-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer disabled:opacity-40"
                              >
                                Return
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleReopenLoan(loan)}
                                disabled={isBusy}
                                title="Mark as checked out again"
                                className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-40"
                              >
                                <RotateCcw className="w-3 h-3" aria-hidden="true" />
                                <span>Re-issue</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openEditModal(loan)}
                              disabled={isBusy}
                              aria-label={`Edit loan for ${loan.bookTitle}`}
                              className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-40"
                            >
                              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteError('');
                                setDeleteTarget(loan);
                              }}
                              disabled={isBusy}
                              aria-label={`Delete loan for ${loan.bookTitle}`}
                              className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 cursor-pointer disabled:opacity-40"
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Assign / Edit Material Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="library-loan-modal-title"
        >
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2
                  id="library-loan-modal-title"
                  className="text-base font-semibold text-slate-900 dark:text-white"
                >
                  {editingLoan ? 'Edit Library Loan' : 'Assign Library Material'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Issue textbooks or reading materials and set the return due date.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close library dialog"
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveLoan} className="space-y-4">
              <div>
                <label
                  htmlFor="lib-student"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Student
                </label>
                <select
                  id="lib-student"
                  value={selectedStudentId}
                  disabled={Boolean(editingLoan)}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 disabled:opacity-60"
                >
                  {activeStudents.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName} — Form {s.formLevel}
                      {s.stream} ({s.admissionNo})
                    </option>
                  ))}
                  {editingLoan &&
                    !activeStudents.some((s) => s.id === editingLoan.studentId) && (
                      <option value={editingLoan.studentId}>
                        {editingLoan.studentName} — Form {editingLoan.formLevel}
                        {editingLoan.stream} ({editingLoan.admissionNo})
                      </option>
                    )}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-8">
                  <label
                    htmlFor="lib-title"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Book / Material Title
                  </label>
                  <input
                    id="lib-title"
                    type="text"
                    required
                    maxLength={140}
                    list="malawi-library-titles"
                    value={bookTitle}
                    onChange={(e) => setBookTitle(e.target.value)}
                    placeholder="e.g. Excel & Succeed Biology Form 4"
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                  />
                  <datalist id="malawi-library-titles">
                    {COMMON_MATERIAL_TITLES.map((title) => (
                      <option key={title} value={title} />
                    ))}
                  </datalist>
                </div>

                <div className="sm:col-span-4">
                  <label
                    htmlFor="lib-qty"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Quantity
                  </label>
                  <input
                    id="lib-qty"
                    type="number"
                    min={1}
                    max={20}
                    required
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="lib-category"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Material Type
                  </label>
                  <select
                    id="lib-category"
                    value={materialType}
                    onChange={(e) => setMaterialType(e.target.value as LibraryMaterialCategory)}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100"
                  >
                    {LIBRARY_MATERIAL_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="lib-subject"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Subject
                  </label>
                  <select
                    id="lib-subject"
                    value={subject}
                    onChange={(e) => {
                      const nextSubj = e.target.value;
                      setSubject(nextSubj);
                      if (!editingLoan && (!bookCode || bookCode.startsWith('LIB-'))) {
                        setBookCode(suggestCopyCode(nextSubj, libraryLoans));
                      }
                    }}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100"
                  >
                    {subjectOptionsForForm.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="lib-code"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Copy / Asset Code
                  </label>
                  <input
                    id="lib-code"
                    type="text"
                    required
                    maxLength={40}
                    value={bookCode}
                    onChange={(e) => setBookCode(e.target.value.toUpperCase())}
                    placeholder="LIB-ENG-001"
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm uppercase text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="lib-checkout"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Checkout Date
                  </label>
                  <input
                    id="lib-checkout"
                    type="date"
                    required
                    value={checkoutDate}
                    onChange={(e) => setCheckoutDate(e.target.value)}
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="lib-due"
                      className="text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      Return Due Date
                    </label>
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                      <button
                        type="button"
                        onClick={() => setDueDate(addDaysToIsoDate(checkoutDate, 14))}
                        className="hover:underline cursor-pointer"
                      >
                        +14d
                      </button>
                      <button
                        type="button"
                        onClick={() => setDueDate(addDaysToIsoDate(checkoutDate, 30))}
                        className="hover:underline cursor-pointer"
                      >
                        +30d
                      </button>
                      <button
                        type="button"
                        onClick={() => setDueDate(addDaysToIsoDate(checkoutDate, 90))}
                        className="hover:underline cursor-pointer"
                      >
                        Term (+90d)
                      </button>
                    </div>
                  </div>
                  <input
                    id="lib-due"
                    type="date"
                    required
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              {editingLoan && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <label
                      htmlFor="lib-status"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                    >
                      Loan Status
                    </label>
                    <select
                      id="lib-status"
                      value={loanStatus}
                      onChange={(e) => {
                        const next = e.target.value as LibraryLoanStatus;
                        setLoanStatus(next);
                        if (next === 'Returned' && !returnedDate) {
                          setReturnedDate(todayIso);
                        }
                      }}
                      className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100"
                    >
                      <option value="Checked Out">Checked Out</option>
                      <option value="Returned">Returned</option>
                    </select>
                  </div>

                  {loanStatus === 'Returned' && (
                    <>
                      <div>
                        <label
                          htmlFor="lib-returned-date"
                          className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                        >
                          Returned Date
                        </label>
                        <input
                          id="lib-returned-date"
                          type="date"
                          value={returnedDate || todayIso}
                          onChange={(e) => setReturnedDate(e.target.value)}
                          className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm text-slate-900 dark:text-slate-100"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="lib-condition"
                          className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                        >
                          Condition
                        </label>
                        <select
                          id="lib-condition"
                          value={conditionOnReturn}
                          onChange={(e) =>
                            setConditionOnReturn(e.target.value as LibraryItemCondition)
                          }
                          className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100"
                        >
                          {LIBRARY_RETURN_CONDITIONS.map((cond) => (
                            <option key={cond} value={cond}>
                              {cond}
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div>
                <label
                  htmlFor="lib-notes"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Notes (Optional)
                </label>
                <input
                  id="lib-notes"
                  type="text"
                  maxLength={240}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Condition on issue, shelf number, or exam preparation notes..."
                  className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  disabled={saving}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[42px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-40 cursor-pointer"
                >
                  {saving ? 'Saving...' : editingLoan ? 'Save Changes' : 'Issue Material'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Mark Material Returned Modal */}
      {returningLoan && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="library-return-modal-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id="library-return-modal-title"
                  className="text-base font-semibold text-slate-900 dark:text-white"
                >
                  Check In Library Material
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {returningLoan.bookTitle} ({returningLoan.bookCode}) · {returningLoan.studentName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReturningLoan(null)}
                disabled={processingReturn}
                aria-label="Close return dialog"
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {returnError && (
              <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                {returnError}
              </div>
            )}

            <form onSubmit={handleConfirmReturn} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="lib-return-date"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Return Date
                  </label>
                  <input
                    id="lib-return-date"
                    type="date"
                    required
                    value={returnDateInput}
                    onChange={(e) => setReturnDateInput(e.target.value)}
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label
                    htmlFor="lib-return-condition"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Condition on Return
                  </label>
                  <select
                    id="lib-return-condition"
                    value={returnConditionInput}
                    onChange={(e) =>
                      setReturnConditionInput(e.target.value as LibraryItemCondition)
                    }
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100"
                  >
                    {LIBRARY_RETURN_CONDITIONS.map((cond) => (
                      <option key={cond} value={cond}>
                        {cond}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="lib-return-notes"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Return Remarks (Optional)
                </label>
                <input
                  id="lib-return-notes"
                  type="text"
                  maxLength={240}
                  value={returnNotesInput}
                  onChange={(e) => setReturnNotesInput(e.target.value)}
                  placeholder="Missing cover, torn pages, or cleared cleanly..."
                  className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReturningLoan(null)}
                  disabled={processingReturn}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={processingReturn}
                  className="min-h-[42px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-40 cursor-pointer"
                >
                  {processingReturn ? 'Recording...' : 'Confirm Return'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Safe Delete Confirmation Modal */}
      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title="Delete Library Loan Record"
        itemName={
          deleteTarget
            ? `${deleteTarget.bookTitle} (${deleteTarget.bookCode}) — ${deleteTarget.studentName}`
            : ''
        }
        description="This permanently removes this circulation record from the school library log. If the book was returned, consider keeping the record for audit history."
        confirmLabel="Delete Record"
        deleting={deleting}
        error={deleteError}
        onCancel={() => {
          if (!deleting) {
            setDeleteTarget(null);
            setDeleteError('');
          }
        }}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};
