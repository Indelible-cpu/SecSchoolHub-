import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  BookCheck,
  BookmarkPlus,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  CloudOff,
  Download,
  FileText,
  Globe,
  History,
  Library,
  Pencil,
  Plus,
  QrCode,
  RotateCcw,
  ScanBarcode,
  ScanLine,
  Search,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  DigitalLibraryResource,
  DigitalResourceCategory,
  DigitalResourceFormLevel,
  FormLevel,
  LibraryBook,
  LibraryItemCondition,
  LibraryLoan,
  LibraryLoanStatus,
  LibraryMaterialCategory,
  LibraryReadingSession,
  LibraryReservation,
  LibraryReservationStatus,
  LibraryTransaction,
  LibraryTransactionAction,
  School,
  SchoolSubject,
  Student,
  WorkspaceRole,
} from '../../school/types';
import {
  addDaysToIsoDate,
  DIGITAL_RESOURCE_CATEGORIES,
  DIGITAL_RESOURCE_FORM_LEVELS,
  downloadCSV,
  FORM_LEVELS,
  getLibraryDaysOverdue,
  getLibraryDueReminderLabel,
  getSubjectsForForm,
  isLibraryLoanDueWithin48Hours,
  isLibraryLoanOverdue,
  isTeacherOnlyDigitalCategory,
  LIBRARY_MATERIAL_CATEGORIES,
  LIBRARY_RETURN_CONDITIONS,
  MALAWI_SUBJECTS,
  STUDENT_DIGITAL_RESOURCE_CATEGORIES,
  TEACHER_DIGITAL_RESOURCE_CATEGORIES,
} from '../../school/malawi';
import {
  createLibraryReservation,
  fetchDigitalResourceBytes,
  flushPendingOfflineReadingSyncs,
  markLibraryLoanReturned,
  purgeLegacyRawTextDigitalResources,
  removeDigitalResource,
  removeLibraryBook,
  removeLibraryLoan,
  removeLibraryReservation,
  reopenLibraryLoan,
  saveDigitalResource,
  saveLibraryBook,
  saveLibraryLoan,
  seedDefaultLibraryBooks,
  subscribeLibraryReadingSessions,
  syncStudentCatalogMirror,
  updateLibraryReservationStatus,
} from '../../school/firestoreService';
import {
  formatFileSizeLabel,
  parseUploadedDigitalMaterial,
  type ParsedDigitalUpload,
} from '../../school/digitalMaterialParser';
import {
  getOfflineDigitalResources,
  purgeOfflineRawTextResources,
  removeOfflineDigitalResource,
  saveDigitalResourceOffline,
  saveDigitalResourcesBatchOffline,
} from '../../school/offlineLibraryDb';
import {
  formatLastReadLabel,
  useLibraryReadingProgress,
} from '../../school/readingProgressStore';
import {
  buildModalDraftKey,
  clearModalDraft,
  loadModalDraft,
  saveModalDraft,
} from '../../school/modalDrafts';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';
import { LibraryBookQrModal, LibraryQrScannerModal } from './LibraryQrModals';
import { LibraryBookScanModal } from './LibraryBookScanModal';
import { LibraryCsvImportModal } from './LibraryCsvImportModal';
import type { ScanCirculationMode } from '../../school/libraryScannerUtils';
import { DraftRestoredNotice, ModalBackdrop } from './ModalBackdrop';
import {
  OnlineLibraryReaderModal,
  type ReadableDigitalResource,
} from './OnlineLibraryReaderModal';

interface SchoolLibraryProps {
  school: School;
  ownerId: string;
  students: Student[];
  schoolSubjects: SchoolSubject[];
  libraryLoans: LibraryLoan[];
  libraryBooks?: LibraryBook[];
  libraryTransactions?: LibraryTransaction[];
  libraryReservations?: LibraryReservation[];
  digitalResources?: DigitalLibraryResource[];
  canWriteLibrary: boolean;
  viewerRole?: WorkspaceRole;
  initialTab?: LibraryModuleTab;
  initialAudienceFilter?: DigitalAudienceFilter;
  tabRequestNonce?: number;
}

type LibraryModuleTab = 'catalog' | 'reservations' | 'online';
type DigitalAudienceFilter = 'all' | 'teaching' | 'student';
type LibraryStatusFilter = 'All' | 'Checked Out' | 'Due Soon' | 'Overdue' | 'Returned';
type TxActionFilter = 'All' | LibraryTransactionAction;
type ReservationFilter = 'All' | LibraryReservationStatus;
type DigitalCategoryFilter = 'All' | DigitalResourceCategory;

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

function suggestCopyCode(subject: string, existingLoans: LibraryLoan[], customPrefix?: string): string {
  const cleanCustom = (customPrefix || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+$/, '');
  const token =
    (subject || 'GEN')
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase()
      .slice(0, 3) || 'GEN';
  const prefix = cleanCustom ? `${cleanCustom}-` : `LIB-${token}-`;
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

function compactIsbn(value?: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '');
}

export const SchoolLibrary: React.FC<SchoolLibraryProps> = ({
  school,
  ownerId,
  students,
  schoolSubjects,
  libraryLoans,
  libraryBooks = [],
  libraryTransactions = [],
  libraryReservations = [],
  digitalResources = [],
  canWriteLibrary,
  viewerRole,
  initialTab,
  initialAudienceFilter,
  tabRequestNonce,
}) => {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const isTeachingRole =
    viewerRole === 'Subject Teacher' ||
    viewerRole === 'Form Teacher' ||
    viewerRole === 'Form Master' ||
    viewerRole === 'Head of Department';
  const [activeLibraryTab, setActiveLibraryTab] = useState<LibraryModuleTab>(
    () => initialTab || (isTeachingRole ? 'online' : 'catalog')
  );

  // Ensure student catalog availability mirror stays synced for existing schools
  const syncedSchoolRef = useRef<string | null>(null);
  useEffect(() => {
    if (!canWriteLibrary || libraryBooks.length === 0) return;
    if (syncedSchoolRef.current === school.id) return;
    syncedSchoolRef.current = school.id;
    void syncStudentCatalogMirror(school.id, ownerId);
  }, [canWriteLibrary, libraryBooks.length, ownerId, school.id]);

  // Available Book Inventory State
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryStockFilter, setInventoryStockFilter] = useState<'available' | 'checked_out' | 'all'>('available');
  const [seedingCatalog, setSeedingCatalog] = useState(false);

  // Add / Edit Inventory Book Modal State
  const [bookModalOpen, setBookModalOpen] = useState(false);
  const [editingBook, setEditingBook] = useState<LibraryBook | null>(null);
  const [bookIsbnInput, setBookIsbnInput] = useState('');
  const [bookTitleInput, setBookTitleInput] = useState('');
  const [bookAuthorInput, setBookAuthorInput] = useState('');
  const [bookSubjectInput, setBookSubjectInput] = useState('English');
  const [bookTypeInput, setBookTypeInput] = useState<LibraryMaterialCategory>('Textbook');
  const [bookShelfInput, setBookShelfInput] = useState('LIB-ENG');
  const [bookCopiesInput, setBookCopiesInput] = useState(10);
  const [bookNotesInput, setBookNotesInput] = useState('');
  const [savingBook, setSavingBook] = useState(false);
  const [bookFormError, setBookFormError] = useState('');

  // Safe Delete Inventory Book State
  const [deleteBookTarget, setDeleteBookTarget] = useState<LibraryBook | null>(null);
  const [deletingBook, setDeletingBook] = useState(false);
  const [deleteBookError, setDeleteBookError] = useState('');

  // QR Code Generator & Camera Scanner State
  const [qrBookTarget, setQrBookTarget] = useState<{
    book: LibraryBook;
    availableCopies: number;
    totalCopies: number;
  } | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerInitialBook, setScannerInitialBook] = useState<LibraryBook | null>(null);
  const [scannerInitialMode, setScannerInitialMode] = useState<ScanCirculationMode>('auto');
  const [bookScanModalOpen, setBookScanModalOpen] = useState(false);
  const [bookScanInitialIsbn, setBookScanInitialIsbn] = useState('');
  const [csvImportOpen, setCsvImportOpen] = useState(false);

  // Circulation Register Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<LibraryStatusFilter>('All');
  const [formFilter, setFormFilter] = useState<FormLevel | 'All'>('All');
  const [categoryFilter, setCategoryFilter] = useState<LibraryMaterialCategory | 'All'>('All');

  // Transaction History Audit Log Filters
  const [txActionFilter, setTxActionFilter] = useState<TxActionFilter>('All');
  const [txSearchQuery, setTxSearchQuery] = useState('');
  const [showAllTransactions, setShowAllTransactions] = useState(false);

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

  // Book Reservation Modal & Reservations Tab State
  const [reservationFilter, setReservationFilter] = useState<ReservationFilter>('All');
  const [reservationSearch, setReservationSearch] = useState('');
  const [reserveModalOpen, setReserveModalOpen] = useState(false);
  const [reserveBookTarget, setReserveBookTarget] = useState<LibraryBook | null>(null);
  const [reserveStudentId, setReserveStudentId] = useState('');
  const [reserveNotes, setReserveNotes] = useState('');
  const [savingReservation, setSavingReservation] = useState(false);
  const [reserveFormError, setReserveFormError] = useState('');
  const [deleteReservationTarget, setDeleteReservationTarget] = useState<LibraryReservation | null>(null);
  const [deletingReservation, setDeletingReservation] = useState(false);
  const [deleteReservationError, setDeleteReservationError] = useState('');
  const [fulfillingReservation, setFulfillingReservation] = useState<LibraryReservation | null>(null);
  const [reservationFeedback, setReservationFeedback] = useState('');

  // Online / Offline Digital Library State
  const [digitalAudienceFilter, setDigitalAudienceFilter] = useState<DigitalAudienceFilter>(
    () => initialAudienceFilter || (isTeachingRole ? 'teaching' : 'all')
  );
  const [digitalCategoryFilter, setDigitalCategoryFilter] = useState<DigitalCategoryFilter>('All');
  const [digitalFormFilter, setDigitalFormFilter] = useState<DigitalResourceFormLevel | 'All'>('All');
  const [digitalSearch, setDigitalSearch] = useState('');

  useEffect(() => {
    if (!tabRequestNonce) return;
    if (initialTab) setActiveLibraryTab(initialTab);
    if (initialAudienceFilter) {
      setDigitalAudienceFilter(initialAudienceFilter);
      setDigitalCategoryFilter('All');
    }
  }, [initialAudienceFilter, initialTab, tabRequestNonce]);
  const [readerTarget, setReaderTarget] = useState<ReadableDigitalResource | null>(null);
  const [offlineIds, setOfflineIds] = useState<Set<string>>(() => new Set());
  const [savingOfflineId, setSavingOfflineId] = useState<string | null>(null);
  const [savingAllOffline, setSavingAllOffline] = useState(false);
  const [readingSessions, setReadingSessions] = useState<LibraryReadingSession[]>([]);
  const [digitalModalOpen, setDigitalModalOpen] = useState(false);
  const [editingDigital, setEditingDigital] = useState<DigitalLibraryResource | null>(null);
  const [digTitle, setDigTitle] = useState('');
  const [digAuthor, setDigAuthor] = useState('');
  const [digSubject, setDigSubject] = useState('English');
  const [digFormLevel, setDigFormLevel] = useState<DigitalResourceFormLevel>('Form 4');
  const [digCategory, setDigCategory] = useState<DigitalResourceCategory>('Book');
  const [digExamYear, setDigExamYear] = useState('');
  const [digSummary, setDigSummary] = useState('');
  const [digUploadedFile, setDigUploadedFile] = useState<ParsedDigitalUpload | null>(null);
  const [digParsingFile, setDigParsingFile] = useState(false);
  const [digUploadProgress, setDigUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const digFileInputRef = useRef<HTMLInputElement | null>(null);
  const inlineDigFileInputRef = useRef<HTMLInputElement | null>(null);
  const [inlineUploadError, setInlineUploadError] = useState('');
  const [digAllowOffline, setDigAllowOffline] = useState(true);
  const [savingDigital, setSavingDigital] = useState(false);
  const [digitalFormError, setDigitalFormError] = useState('');
  const [deleteDigitalTarget, setDeleteDigitalTarget] = useState<DigitalLibraryResource | null>(null);
  const [deletingDigital, setDeletingDigital] = useState(false);
  const [deleteDigitalError, setDeleteDigitalError] = useState('');

  const [loanDraftRestored, setLoanDraftRestored] = useState(false);
  const [returnDraftRestored, setReturnDraftRestored] = useState(false);
  const [bookDraftRestored, setBookDraftRestored] = useState(false);
  const [reserveDraftRestored, setReserveDraftRestored] = useState(false);
  const [digitalDraftRestored, setDigitalDraftRestored] = useState(false);

  const loanDraftKey = useMemo(
    () => buildModalDraftKey(school.id, 'lib_loan', editingLoan?.id || 'new'),
    [school.id, editingLoan?.id]
  );
  const returnDraftKey = useMemo(
    () => buildModalDraftKey(school.id, 'lib_return', returningLoan?.id || 'none'),
    [school.id, returningLoan?.id]
  );
  const bookDraftKey = useMemo(
    () => buildModalDraftKey(school.id, 'lib_book', editingBook?.id || 'new'),
    [school.id, editingBook?.id]
  );
  const reserveDraftKey = useMemo(
    () => buildModalDraftKey(school.id, 'lib_reserve', 'new'),
    [school.id]
  );
  const digitalDraftKey = useMemo(
    () => buildModalDraftKey(school.id, 'lib_digital', editingDigital?.id || 'new'),
    [school.id, editingDigital?.id]
  );

  useEffect(() => {
    if (!modalOpen) return;
    saveModalDraft(loanDraftKey, {
      selectedStudentId,
      bookTitle,
      materialType,
      subject,
      bookCode,
      quantity,
      checkoutDate,
      dueDate,
      loanStatus,
      returnedDate,
      conditionOnReturn,
      notes,
    });
  }, [
    modalOpen,
    loanDraftKey,
    selectedStudentId,
    bookTitle,
    materialType,
    subject,
    bookCode,
    quantity,
    checkoutDate,
    dueDate,
    loanStatus,
    returnedDate,
    conditionOnReturn,
    notes,
  ]);

  useEffect(() => {
    if (!returningLoan) return;
    saveModalDraft(returnDraftKey, {
      returnDateInput,
      returnConditionInput,
      returnNotesInput,
    });
  }, [returningLoan, returnDraftKey, returnDateInput, returnConditionInput, returnNotesInput]);

  useEffect(() => {
    if (!bookModalOpen) return;
    saveModalDraft(bookDraftKey, {
      bookIsbnInput,
      bookTitleInput,
      bookAuthorInput,
      bookSubjectInput,
      bookTypeInput,
      bookShelfInput,
      bookCopiesInput,
      bookNotesInput,
    });
  }, [
    bookModalOpen,
    bookDraftKey,
    bookIsbnInput,
    bookTitleInput,
    bookAuthorInput,
    bookSubjectInput,
    bookTypeInput,
    bookShelfInput,
    bookCopiesInput,
    bookNotesInput,
  ]);

  useEffect(() => {
    if (!reserveModalOpen) return;
    saveModalDraft(reserveDraftKey, {
      reserveBookId: reserveBookTarget?.id || '',
      reserveStudentId,
      reserveNotes,
    });
  }, [reserveModalOpen, reserveDraftKey, reserveBookTarget?.id, reserveStudentId, reserveNotes]);

  useEffect(() => {
    if (!digitalModalOpen) return;
    saveModalDraft(digitalDraftKey, {
      digTitle,
      digAuthor,
      digSubject,
      digFormLevel,
      digCategory,
      digExamYear,
      digSummary,
      digAllowOffline,
    });
  }, [
    digitalModalOpen,
    digitalDraftKey,
    digTitle,
    digAuthor,
    digSubject,
    digFormLevel,
    digCategory,
    digExamYear,
    digSummary,
    digAllowOffline,
  ]);

  const staffScopeKey = `staff:${school.id}`;
  const {
    progressMap,
    counts: readingCounts,
    toggleMarkAsRead,
    recordPageProgress,
  } = useLibraryReadingProgress(staffScopeKey, school.id, readingSessions);

  useEffect(() => {
    let active = true;
    purgeOfflineRawTextResources(school.id)
      .then(() => getOfflineDigitalResources(school.id))
      .then((records) => {
        if (!active) return;
        setOfflineIds(new Set(records.map((r) => r.id)));
      });
    return () => {
      active = false;
    };
  }, [school.id]);

  useEffect(() => {
    if (!canWriteLibrary) return;
    void purgeLegacyRawTextDigitalResources(school.id);
  }, [canWriteLibrary, school.id]);

  useEffect(() => {
    const unsub = subscribeLibraryReadingSessions(school.id, setReadingSessions);
    void flushPendingOfflineReadingSyncs(school.id);
    const onReconnect = () => {
      void flushPendingOfflineReadingSyncs(school.id);
    };
    window.addEventListener('online', onReconnect);
    return () => {
      unsub();
      window.removeEventListener('online', onReconnect);
    };
  }, [school.id]);

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

  const allSubjectChoices = useMemo(() => {
    const names = new Set<string>(
      schoolSubjects.length > 0 ? schoolSubjects.map((s) => s.name) : MALAWI_SUBJECTS
    );
    names.add('General');
    if (bookSubjectInput) names.add(bookSubjectInput);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [bookSubjectInput, schoolSubjects]);

  const titleSuggestions = useMemo(() => {
    const set = new Set<string>(COMMON_MATERIAL_TITLES);
    for (const book of libraryBooks) {
      if (book.title) set.add(book.title);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [libraryBooks]);

  const activeReservationsByBook = useMemo(() => {
    const byId = new Map<string, number>();
    const byTitle = new Map<string, number>();
    for (const res of libraryReservations) {
      if (res.status !== 'Pending' && res.status !== 'Ready') continue;
      if (res.bookId) {
        byId.set(res.bookId, (byId.get(res.bookId) || 0) + 1);
      }
      const titleKey = (res.bookTitle || '').trim().toLowerCase();
      if (titleKey) {
        byTitle.set(titleKey, (byTitle.get(titleKey) || 0) + 1);
      }
    }
    return { byId, byTitle };
  }, [libraryReservations]);

  const inventoryMetrics = useMemo(() => {
    const activeLoanCountByTitle = new Map<string, number>();
    for (const loan of libraryLoans) {
      if (loan.status !== 'Checked Out') continue;
      const key = loan.bookTitle.trim().toLowerCase();
      const qty = Math.max(1, Number(loan.quantity) || 1);
      activeLoanCountByTitle.set(key, (activeLoanCountByTitle.get(key) || 0) + qty);
    }

    let totalCatalogCopies = 0;
    let totalAvailableCopies = 0;
    let availableTitlesCount = 0;
    let checkedOutTitlesCount = 0;

    const items = libraryBooks.map((book) => {
      const total = Math.max(1, Number(book.totalCopies) || 1);
      const titleKey = book.title.trim().toLowerCase();
      const checkedOutCopies = activeLoanCountByTitle.get(titleKey) || 0;
      const availableCopies = Math.max(0, total - checkedOutCopies);
      const activeReservationsCount =
        activeReservationsByBook.byId.get(book.id) ??
        activeReservationsByBook.byTitle.get(titleKey) ??
        0;
      totalCatalogCopies += total;
      totalAvailableCopies += availableCopies;
      if (availableCopies > 0) {
        availableTitlesCount += 1;
      } else {
        checkedOutTitlesCount += 1;
      }
      return {
        book,
        totalCopies: total,
        checkedOutCopies,
        availableCopies,
        activeReservationsCount,
      };
    });

    const rawQuery = inventorySearch.trim();
    const q = rawQuery.toLowerCase();
    const qIsbnCompact = compactIsbn(rawQuery);

    const filtered = items.filter((item) => {
      if (inventoryStockFilter === 'available' && item.availableCopies <= 0) {
        return false;
      }
      if (inventoryStockFilter === 'checked_out' && item.availableCopies > 0) {
        return false;
      }
      if (!q) return true;
      const titleMatch = item.book.title.toLowerCase().includes(q);
      const authorMatch = item.book.author.toLowerCase().includes(q);
      const isbnMatch =
        item.book.isbn.toLowerCase().includes(q) ||
        (qIsbnCompact.length > 0 && compactIsbn(item.book.isbn).includes(qIsbnCompact));
      return titleMatch || authorMatch || isbnMatch;
    });

    return {
      items,
      filtered,
      totalCatalogCopies,
      totalAvailableCopies,
      availableTitlesCount,
      checkedOutTitlesCount,
    };
  }, [activeReservationsByBook.byId, activeReservationsByBook.byTitle, inventorySearch, inventoryStockFilter, libraryBooks, libraryLoans]);

  const stats = useMemo(() => {
    let checkedOutLoans = 0;
    let checkedOutCopies = 0;
    let dueSoonLoans = 0;
    let dueSoonCopies = 0;
    let overdueLoans = 0;
    let overdueCopies = 0;
    let returnedLoans = 0;
    let returnedCopies = 0;
    let totalCopies = 0;
    let damagedOrLost = 0;
    const activeBorrowerIds = new Set<string>();
    const dueSoonItems: LibraryLoan[] = [];

    const subjectMap = new Map<
      string,
      {
        subject: string;
        totalLoans: number;
        totalCopies: number;
        checkedOutCopies: number;
        dueSoonCopies: number;
        overdueCopies: number;
        returnedCopies: number;
      }
    >();

    for (const loan of libraryLoans) {
      const qty = Math.max(1, Number(loan.quantity) || 1);
      totalCopies += qty;
      const subjName = (loan.subject || 'General').trim() || 'General';
      const entry = subjectMap.get(subjName) || {
        subject: subjName,
        totalLoans: 0,
        totalCopies: 0,
        checkedOutCopies: 0,
        dueSoonCopies: 0,
        overdueCopies: 0,
        returnedCopies: 0,
      };
      entry.totalLoans += 1;
      entry.totalCopies += qty;

      if (loan.status === 'Checked Out') {
        checkedOutLoans += 1;
        checkedOutCopies += qty;
        activeBorrowerIds.add(loan.studentId);
        entry.checkedOutCopies += qty;
        if (isLibraryLoanOverdue(loan, todayIso)) {
          overdueLoans += 1;
          overdueCopies += qty;
          entry.overdueCopies += qty;
        } else if (isLibraryLoanDueWithin48Hours(loan, todayIso)) {
          dueSoonLoans += 1;
          dueSoonCopies += qty;
          entry.dueSoonCopies += qty;
          dueSoonItems.push(loan);
        }
      } else {
        returnedLoans += 1;
        returnedCopies += qty;
        entry.returnedCopies += qty;
        if (loan.conditionOnReturn === 'Damaged' || loan.conditionOnReturn === 'Lost') {
          damagedOrLost += 1;
        }
      }

      subjectMap.set(subjName, entry);
    }

    dueSoonItems.sort(
      (a, b) => a.dueDate.localeCompare(b.dueDate) || a.studentName.localeCompare(b.studentName)
    );

    const mostBorrowedSubjects = Array.from(subjectMap.values()).sort(
      (a, b) =>
        b.totalCopies - a.totalCopies ||
        b.totalLoans - a.totalLoans ||
        a.subject.localeCompare(b.subject)
    );

    const overdueSharePct =
      checkedOutLoans > 0 ? Math.round((overdueLoans / checkedOutLoans) * 100) : 0;
    const returnRatePct =
      libraryLoans.length > 0 ? Math.round((returnedLoans / libraryLoans.length) * 100) : 0;

    return {
      checkedOutLoans,
      checkedOutCopies,
      dueSoonLoans,
      dueSoonCopies,
      dueSoonItems,
      overdueLoans,
      overdueCopies,
      returnedLoans,
      returnedCopies,
      totalCopies,
      damagedOrLost,
      totalRecords: libraryLoans.length,
      activeBorrowersCount: activeBorrowerIds.size,
      overdueSharePct,
      returnRatePct,
      mostBorrowedSubjects,
    };
  }, [libraryLoans, todayIso]);

  const sortedAndFilteredLoans = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return libraryLoans
      .filter((loan) => {
        if (formFilter !== 'All' && loan.formLevel !== formFilter) return false;
        if (categoryFilter !== 'All' && loan.materialType !== categoryFilter) return false;
        if (statusFilter === 'Checked Out' && loan.status !== 'Checked Out') return false;
        if (statusFilter === 'Due Soon' && !isLibraryLoanDueWithin48Hours(loan, todayIso)) return false;
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
        const rankLoan = (l: LibraryLoan) => {
          if (isLibraryLoanOverdue(l, todayIso)) return 0;
          if (isLibraryLoanDueWithin48Hours(l, todayIso)) return 1;
          if (l.status === 'Checked Out') return 2;
          return 3;
        };
        const rankDiff = rankLoan(a) - rankLoan(b);
        if (rankDiff !== 0) return rankDiff;
        if (a.status === 'Checked Out' && b.status === 'Checked Out') {
          return a.dueDate.localeCompare(b.dueDate);
        }
        return b.checkoutDate.localeCompare(a.checkoutDate);
      });
  }, [categoryFilter, formFilter, libraryLoans, searchQuery, statusFilter, todayIso]);

  const openAssignModal = (
    prefillBook?: LibraryBook,
    prefillStudent?: Student,
    fromReservation?: LibraryReservation
  ) => {
    const defaultStu = prefillStudent || activeStudents[0] || students[0] || null;
    const defaultForm = (defaultStu?.formLevel || 1) as FormLevel;
    const defaultSubjects = getSubjectsForForm(schoolSubjects, defaultForm);
    const defaultSubj = prefillBook?.subject || fromReservation?.subject || defaultSubjects[0] || 'English';

    const key = buildModalDraftKey(school.id, 'lib_loan', 'new');
    const draft =
      !prefillBook && !prefillStudent && !fromReservation
        ? loadModalDraft<{
            selectedStudentId: string;
            bookTitle: string;
            materialType: LibraryMaterialCategory;
            subject: string;
            bookCode: string;
            quantity: number;
            checkoutDate: string;
            dueDate: string;
            loanStatus: LibraryLoanStatus;
            returnedDate: string;
            conditionOnReturn: LibraryItemCondition;
            notes: string;
          }>(key)
        : null;

    setEditingLoan(null);
    setFulfillingReservation(fromReservation || null);
    if (draft) {
      setSelectedStudentId(draft.selectedStudentId || defaultStu?.id || '');
      setBookTitle(draft.bookTitle || '');
      setMaterialType(draft.materialType || 'Textbook');
      setSubject(draft.subject || defaultSubj);
      setBookCode(draft.bookCode || suggestCopyCode(defaultSubj, libraryLoans));
      setQuantity(draft.quantity || 1);
      setCheckoutDate(draft.checkoutDate || todayIso);
      setDueDate(draft.dueDate || addDaysToIsoDate(todayIso, 14));
      setLoanStatus(draft.loanStatus || 'Checked Out');
      setReturnedDate(draft.returnedDate || '');
      setConditionOnReturn(draft.conditionOnReturn || 'Good');
      setNotes(draft.notes || '');
      setLoanDraftRestored(true);
    } else {
      setSelectedStudentId(defaultStu?.id || '');
      setBookTitle(prefillBook?.title || fromReservation?.bookTitle || '');
      setMaterialType(prefillBook?.materialType || fromReservation?.materialType || 'Textbook');
      setSubject(defaultSubj);
      setBookCode(suggestCopyCode(defaultSubj, libraryLoans, prefillBook?.shelfCode));
      setQuantity(1);
      setCheckoutDate(todayIso);
      setDueDate(addDaysToIsoDate(todayIso, 14));
      setLoanStatus('Checked Out');
      setReturnedDate('');
      setConditionOnReturn('Good');
      setNotes(
        prefillBook?.isbn
          ? `ISBN ${prefillBook.isbn}`
          : fromReservation?.isbn
          ? `ISBN ${fromReservation.isbn}`
          : ''
      );
      setLoanDraftRestored(false);
    }
    setFormError('');
    setModalOpen(true);
  };

  const openReserveModal = (book?: LibraryBook) => {
    const defaultBook =
      book ||
      inventoryMetrics.items.find((item) => item.availableCopies === 0)?.book ||
      libraryBooks[0] ||
      null;
    const defaultStu = activeStudents[0] || students[0] || null;
    const key = buildModalDraftKey(school.id, 'lib_reserve', 'new');
    const draft = !book
      ? loadModalDraft<{
          reserveBookId: string;
          reserveStudentId: string;
          reserveNotes: string;
        }>(key)
      : null;

    if (draft) {
      const foundBook = libraryBooks.find((b) => b.id === draft.reserveBookId) || defaultBook;
      setReserveBookTarget(foundBook);
      setReserveStudentId(draft.reserveStudentId || defaultStu?.id || '');
      setReserveNotes(draft.reserveNotes || '');
      setReserveDraftRestored(true);
    } else {
      setReserveBookTarget(defaultBook);
      setReserveStudentId(defaultStu?.id || '');
      setReserveNotes('');
      setReserveDraftRestored(false);
    }
    setReserveFormError('');
    setReserveModalOpen(true);
  };

  const handleDiscardReserveDraft = () => {
    clearModalDraft(reserveDraftKey);
    const defaultBook =
      inventoryMetrics.items.find((item) => item.availableCopies === 0)?.book ||
      libraryBooks[0] ||
      null;
    const defaultStu = activeStudents[0] || students[0] || null;
    setReserveBookTarget(defaultBook);
    setReserveStudentId(defaultStu?.id || '');
    setReserveNotes('');
    setReserveDraftRestored(false);
  };

  const handleSaveReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reserveBookTarget) {
      setReserveFormError('Select a library book to reserve.');
      return;
    }
    const stu = students.find((s) => s.id === reserveStudentId);
    if (!stu) {
      setReserveFormError('Select a student requesting this book.');
      return;
    }
    const alreadyQueued = libraryReservations.some(
      (r) =>
        (r.status === 'Pending' || r.status === 'Ready') &&
        r.studentId === stu.id &&
        (r.bookId === reserveBookTarget.id ||
          r.bookTitle.trim().toLowerCase() === reserveBookTarget.title.trim().toLowerCase())
    );
    if (alreadyQueued) {
      setReserveFormError(`${stu.fullName} already has an active reservation for this title.`);
      return;
    }

    setSavingReservation(true);
    setReserveFormError('');
    try {
      await createLibraryReservation({
        schoolId: school.id,
        ownerId,
        bookId: reserveBookTarget.id,
        isbn: reserveBookTarget.isbn,
        bookTitle: reserveBookTarget.title,
        subject: reserveBookTarget.subject || 'General',
        materialType: reserveBookTarget.materialType,
        studentId: stu.id,
        studentName: stu.fullName,
        admissionNo: stu.admissionNo || 'N/A',
        formLevel: stu.formLevel,
        stream: stu.stream || 'A',
        registrationCode: stu.registrationCode || '',
        requestedDate: todayIso,
        notes: reserveNotes.trim(),
      });
      clearModalDraft(reserveDraftKey);
      setReserveDraftRestored(false);
      setReserveModalOpen(false);
      setReservationFeedback(`Reserved "${reserveBookTarget.title}" for ${stu.fullName}.`);
    } catch (err) {
      setReserveFormError(err instanceof Error ? err.message : 'Unable to save reservation.');
    } finally {
      setSavingReservation(false);
    }
  };

  const handleUpdateReservationStatus = async (
    res: LibraryReservation,
    nextStatus: LibraryReservationStatus
  ) => {
    if (!canWriteLibrary) return;
    setActionBusyId(res.id);
    try {
      await updateLibraryReservationStatus(school.id, res.id, nextStatus, res.registrationCode);
    } finally {
      setActionBusyId(null);
    }
  };

  const handleConfirmDeleteReservation = async () => {
    if (!deleteReservationTarget || !canWriteLibrary) return;
    setDeletingReservation(true);
    setDeleteReservationError('');
    try {
      await removeLibraryReservation(
        school.id,
        deleteReservationTarget.id,
        deleteReservationTarget.registrationCode
      );
      setDeleteReservationTarget(null);
    } catch (err) {
      setDeleteReservationError(
        err instanceof Error ? err.message : 'Unable to remove reservation.'
      );
    } finally {
      setDeletingReservation(false);
    }
  };

  const openAddDigitalModal = () => {
    const key = buildModalDraftKey(school.id, 'lib_digital', 'new');
    const draft = loadModalDraft<{
      digTitle: string;
      digAuthor: string;
      digSubject: string;
      digFormLevel: DigitalResourceFormLevel;
      digCategory: DigitalResourceCategory;
      digExamYear: string;
      digSummary: string;
      digAllowOffline: boolean;
    }>(key);
    setEditingDigital(null);
    if (draft) {
      setDigTitle(draft.digTitle || '');
      setDigAuthor(draft.digAuthor || '');
      setDigSubject(draft.digSubject || allSubjectChoices[0] || 'English');
      setDigFormLevel(draft.digFormLevel || 'Form 4');
      setDigCategory(draft.digCategory || 'Past Paper');
      setDigExamYear(draft.digExamYear ?? '2025');
      setDigSummary(draft.digSummary || '');
      setDigAllowOffline(Boolean(draft.digAllowOffline));
      setDigitalDraftRestored(true);
    } else {
      setDigTitle('');
      setDigAuthor('');
      setDigSubject(allSubjectChoices[0] || 'English');
      setDigFormLevel('Form 4');
      setDigCategory(
        digitalAudienceFilter === 'teaching' || isTeachingRole
          ? 'Teaching Resource'
          : 'Past Paper'
      );
      setDigExamYear('2025');
      setDigSummary('');
      setDigAllowOffline(true);
      setDigitalDraftRestored(false);
    }
    setDigUploadedFile(null);
    setDigParsingFile(false);
    setDigUploadProgress(null);
    setDigitalFormError('');
    setDigitalModalOpen(true);
  };

  const openEditDigitalModal = (res: DigitalLibraryResource) => {
    const key = buildModalDraftKey(school.id, 'lib_digital', res.id);
    const draft = loadModalDraft<{
      digTitle: string;
      digAuthor: string;
      digSubject: string;
      digFormLevel: DigitalResourceFormLevel;
      digCategory: DigitalResourceCategory;
      digExamYear: string;
      digSummary: string;
      digAllowOffline: boolean;
    }>(key);
    setEditingDigital(res);
    if (draft) {
      setDigTitle(draft.digTitle || res.title);
      setDigAuthor(draft.digAuthor || res.author);
      setDigSubject(draft.digSubject || res.subject || 'General');
      setDigFormLevel(draft.digFormLevel || res.formLevel);
      setDigCategory(draft.digCategory || res.category);
      setDigExamYear(draft.digExamYear ?? (res.examYear || ''));
      setDigSummary(draft.digSummary ?? (res.summary || ''));
      setDigAllowOffline(Boolean(draft.digAllowOffline));
      setDigitalDraftRestored(true);
    } else {
      setDigTitle(res.title);
      setDigAuthor(res.author);
      setDigSubject(res.subject || 'General');
      setDigFormLevel(res.formLevel);
      setDigCategory(res.category);
      setDigExamYear(res.examYear || '');
      setDigSummary(res.summary || '');
      setDigAllowOffline(Boolean(res.allowOffline));
      setDigitalDraftRestored(false);
    }
    setDigUploadedFile(null);
    setDigParsingFile(false);
    setDigUploadProgress(null);
    setDigitalFormError('');
    setDigitalModalOpen(true);
  };

  const handleDiscardDigitalDraft = () => {
    clearModalDraft(digitalDraftKey);
    if (editingDigital) {
      setDigTitle(editingDigital.title);
      setDigAuthor(editingDigital.author);
      setDigSubject(editingDigital.subject || 'General');
      setDigFormLevel(editingDigital.formLevel);
      setDigCategory(editingDigital.category);
      setDigExamYear(editingDigital.examYear || '');
      setDigSummary(editingDigital.summary || '');
      setDigAllowOffline(Boolean(editingDigital.allowOffline));
    } else {
      setDigTitle('');
      setDigAuthor('');
      setDigSubject(allSubjectChoices[0] || 'English');
      setDigFormLevel('Form 4');
      setDigCategory('Past Paper');
      setDigExamYear('2025');
      setDigSummary('');
      setDigAllowOffline(true);
    }
    setDigitalDraftRestored(false);
  };

  const handleDigitalFileSelected = async (file: File | undefined | null) => {
    if (!file) return;
    setDigParsingFile(true);
    setDigitalFormError('');
    try {
      const parsed = await parseUploadedDigitalMaterial(file);
      setDigUploadedFile(parsed);
      if (!digTitle.trim() && parsed.suggestedTitle) {
        setDigTitle(parsed.suggestedTitle);
      }
    } catch (err) {
      setDigitalFormError(
        err instanceof Error ? err.message : 'Unable to read the selected file.'
      );
    } finally {
      setDigParsingFile(false);
      if (digFileInputRef.current) {
        digFileInputRef.current.value = '';
      }
    }
  };

  const handleInlineDigitalFileSelected = async (file: File | undefined | null) => {
    if (!file || !canWriteLibrary) return;
    setDigParsingFile(true);
    setInlineUploadError('');
    try {
      const parsed = await parseUploadedDigitalMaterial(file);
      setEditingDigital(null);
      setDigUploadedFile(parsed);
      setDigTitle(parsed.suggestedTitle || '');
      setDigAuthor('');
      setDigSubject(allSubjectChoices[0] || 'English');
      setDigFormLevel('Form 4');
      setDigCategory(
        digitalAudienceFilter === 'teaching' || isTeachingRole
          ? 'Teaching Resource'
          : parsed.suggestedTitle.toLowerCase().includes('paper')
          ? 'Past Paper'
          : 'Book'
      );
      setDigExamYear('2025');
      setDigSummary('');
      setDigUploadProgress(null);
      setDigAllowOffline(true);
      setDigitalFormError('');
      setDigitalModalOpen(true);
    } catch (err) {
      setInlineUploadError(
        err instanceof Error ? err.message : 'Unable to read the selected file.'
      );
    } finally {
      setDigParsingFile(false);
      if (inlineDigFileInputRef.current) {
        inlineDigFileInputRef.current.value = '';
      }
    }
  };

  const handleSaveDigitalResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteLibrary) return;
    if (digTitle.trim().length < 2) {
      setDigitalFormError('Enter a material title (at least 2 characters).');
      return;
    }
    if (digAuthor.trim().length < 2) {
      setDigitalFormError('Enter an author or department name (at least 2 characters).');
      return;
    }
    if (!editingDigital && !digUploadedFile) {
      setDigitalFormError('Upload a reading file (PDF, Word .docx, TXT/MD, or scanned image).');
      return;
    }

    setSavingDigital(true);
    setDigitalFormError('');
    setDigUploadProgress(null);
    try {
      const hasNewUpload = Boolean(digUploadedFile);
      await saveDigitalResource(
        school.id,
        ownerId,
        {
          title: digTitle.trim(),
          author: digAuthor.trim(),
          subject: digSubject.trim() || 'General',
          formLevel: digFormLevel,
          category: digCategory,
          examYear: digExamYear.trim(),
          summary: digSummary.trim(),
          content: hasNewUpload
            ? digUploadedFile!.content
            : editingDigital?.content || '',
          storageFormat: hasNewUpload
            ? digUploadedFile!.storageFormat
            : editingDigital?.storageFormat || 'text',
          fileName: hasNewUpload
            ? digUploadedFile!.fileName
            : editingDigital?.fileName || '',
          mimeType: hasNewUpload
            ? digUploadedFile!.mimeType
            : editingDigital?.mimeType || '',
          fileSizeBytes: hasNewUpload
            ? digUploadedFile!.fileSizeBytes
            : editingDigital?.fileSizeBytes || 0,
          chunkCount: hasNewUpload
            ? undefined
            : editingDigital?.chunkCount || 0,
          allowOffline: digAllowOffline,
        },
        editingDigital?.id,
        hasNewUpload ? digUploadedFile!.fileBytes : undefined,
        (done, total) => setDigUploadProgress({ done, total })
      );
      clearModalDraft(digitalDraftKey);
      setDigitalDraftRestored(false);
      setDigitalModalOpen(false);
    } catch (err) {
      setDigitalFormError(
        err instanceof Error ? err.message : 'Unable to save uploaded reading material.'
      );
    } finally {
      setSavingDigital(false);
      setDigUploadProgress(null);
    }
  };

  const handleConfirmDeleteDigital = async () => {
    if (!deleteDigitalTarget || !canWriteLibrary) return;
    setDeletingDigital(true);
    setDeleteDigitalError('');
    try {
      await removeDigitalResource(school.id, deleteDigitalTarget.id);
      await removeOfflineDigitalResource(deleteDigitalTarget.id);
      setOfflineIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteDigitalTarget.id);
        return next;
      });
      setDeleteDigitalTarget(null);
    } catch (err) {
      setDeleteDigitalError(
        err instanceof Error ? err.message : 'Unable to delete digital resource.'
      );
    } finally {
      setDeletingDigital(false);
    }
  };

  const handleToggleOfflineDigital = async (resource: ReadableDigitalResource) => {
    setSavingOfflineId(resource.id);
    try {
      if (offlineIds.has(resource.id)) {
        const removed = await removeOfflineDigitalResource(resource.id);
        if (removed) {
          setOfflineIds((prev) => {
            const next = new Set(prev);
            next.delete(resource.id);
            return next;
          });
        }
      } else if (resource.allowOffline) {
        let fileBytes: Uint8Array | undefined =
          'fileBytes' in resource && resource.fileBytes instanceof Uint8Array
            ? resource.fileBytes
            : undefined;
        if (!fileBytes && resource.chunkCount && resource.chunkCount > 0) {
          const fetched = await fetchDigitalResourceBytes(school.id, resource.id);
          if (fetched) fileBytes = fetched;
        }

        const saved = await saveDigitalResourceOffline({
          id: resource.id,
          schoolId: school.id,
          title: resource.title,
          author: resource.author,
          subject: resource.subject,
          formLevel: resource.formLevel,
          category: resource.category,
          examYear: resource.examYear,
          summary: resource.summary,
          content: resource.content,
          storageFormat: resource.storageFormat,
          fileName: resource.fileName,
          mimeType: resource.mimeType,
          fileSizeBytes: resource.fileSizeBytes,
          chunkCount: resource.chunkCount,
          fileBytes,
          allowOffline: resource.allowOffline,
          savedAt: new Date().toISOString(),
        });
        if (saved) {
          setOfflineIds((prev) => new Set(prev).add(resource.id));
        }
      }
    } finally {
      setSavingOfflineId(null);
    }
  };

  const handleSaveAllDigitalOffline = async () => {
    const eligible = digitalResources.filter((r) => r.allowOffline);
    if (eligible.length === 0) return;
    setSavingAllOffline(true);
    try {
      const nowIso = new Date().toISOString();
      const prepared = await Promise.all(
        eligible.map(async (r) => {
          let fileBytes: Uint8Array | undefined;
          if (r.chunkCount && r.chunkCount > 0) {
            const fetched = await fetchDigitalResourceBytes(school.id, r.id);
            if (fetched) fileBytes = fetched;
          }
          return {
            id: r.id,
            schoolId: school.id,
            title: r.title,
            author: r.author,
            subject: r.subject,
            formLevel: r.formLevel,
            category: r.category,
            examYear: r.examYear,
            summary: r.summary,
            content: r.content,
            storageFormat: r.storageFormat,
            fileName: r.fileName,
            mimeType: r.mimeType,
            fileSizeBytes: r.fileSizeBytes,
            chunkCount: r.chunkCount,
            fileBytes,
            allowOffline: r.allowOffline,
            savedAt: nowIso,
          };
        })
      );
      await saveDigitalResourcesBatchOffline(prepared);
      setOfflineIds((prev) => {
        const next = new Set(prev);
        for (const r of eligible) next.add(r.id);
        return next;
      });
    } finally {
      setSavingAllOffline(false);
    }
  };

  const openAddBookModal = () => {
    const defaultSubj = allSubjectChoices[0] || 'English';
    const token =
      defaultSubj
        .replace(/[^A-Za-z]/g, '')
        .toUpperCase()
        .slice(0, 3) || 'GEN';
    const key = buildModalDraftKey(school.id, 'lib_book', 'new');
    const draft = loadModalDraft<{
      bookIsbnInput: string;
      bookTitleInput: string;
      bookAuthorInput: string;
      bookSubjectInput: string;
      bookTypeInput: LibraryMaterialCategory;
      bookShelfInput: string;
      bookCopiesInput: number;
      bookNotesInput: string;
    }>(key);
    setEditingBook(null);
    if (draft) {
      setBookIsbnInput(draft.bookIsbnInput || '');
      setBookTitleInput(draft.bookTitleInput || '');
      setBookAuthorInput(draft.bookAuthorInput || '');
      setBookSubjectInput(draft.bookSubjectInput || defaultSubj);
      setBookTypeInput(draft.bookTypeInput || 'Textbook');
      setBookShelfInput(draft.bookShelfInput || `LIB-${token}`);
      setBookCopiesInput(draft.bookCopiesInput || 10);
      setBookNotesInput(draft.bookNotesInput || '');
      setBookDraftRestored(true);
    } else {
      setBookIsbnInput('');
      setBookTitleInput('');
      setBookAuthorInput('');
      setBookSubjectInput(defaultSubj);
      setBookTypeInput('Textbook');
      setBookShelfInput(`LIB-${token}`);
      setBookCopiesInput(10);
      setBookNotesInput('');
      setBookDraftRestored(false);
    }
    setBookFormError('');
    setBookModalOpen(true);
  };

  const openEditBookModal = (book: LibraryBook) => {
    const key = buildModalDraftKey(school.id, 'lib_book', book.id);
    const draft = loadModalDraft<{
      bookIsbnInput: string;
      bookTitleInput: string;
      bookAuthorInput: string;
      bookSubjectInput: string;
      bookTypeInput: LibraryMaterialCategory;
      bookShelfInput: string;
      bookCopiesInput: number;
      bookNotesInput: string;
    }>(key);
    setEditingBook(book);
    if (draft) {
      setBookIsbnInput(draft.bookIsbnInput || book.isbn);
      setBookTitleInput(draft.bookTitleInput || book.title);
      setBookAuthorInput(draft.bookAuthorInput || book.author);
      setBookSubjectInput(draft.bookSubjectInput || book.subject || 'General');
      setBookTypeInput(draft.bookTypeInput || book.materialType);
      setBookShelfInput(draft.bookShelfInput ?? (book.shelfCode || ''));
      setBookCopiesInput(draft.bookCopiesInput || book.totalCopies || 1);
      setBookNotesInput(draft.bookNotesInput ?? (book.notes || ''));
      setBookDraftRestored(true);
    } else {
      setBookIsbnInput(book.isbn);
      setBookTitleInput(book.title);
      setBookAuthorInput(book.author);
      setBookSubjectInput(book.subject || 'General');
      setBookTypeInput(book.materialType);
      setBookShelfInput(book.shelfCode || '');
      setBookCopiesInput(book.totalCopies || 1);
      setBookNotesInput(book.notes || '');
      setBookDraftRestored(false);
    }
    setBookFormError('');
    setBookModalOpen(true);
  };

  const handleDiscardBookDraft = () => {
    clearModalDraft(bookDraftKey);
    if (editingBook) {
      setBookIsbnInput(editingBook.isbn);
      setBookTitleInput(editingBook.title);
      setBookAuthorInput(editingBook.author);
      setBookSubjectInput(editingBook.subject || 'General');
      setBookTypeInput(editingBook.materialType);
      setBookShelfInput(editingBook.shelfCode || '');
      setBookCopiesInput(editingBook.totalCopies || 1);
      setBookNotesInput(editingBook.notes || '');
    } else {
      const defaultSubj = allSubjectChoices[0] || 'English';
      const token =
        defaultSubj
          .replace(/[^A-Za-z]/g, '')
          .toUpperCase()
          .slice(0, 3) || 'GEN';
      setBookIsbnInput('');
      setBookTitleInput('');
      setBookAuthorInput('');
      setBookSubjectInput(defaultSubj);
      setBookTypeInput('Textbook');
      setBookShelfInput(`LIB-${token}`);
      setBookCopiesInput(10);
      setBookNotesInput('');
    }
    setBookDraftRestored(false);
  };

  const handleSaveBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteLibrary) return;

    if (bookIsbnInput.trim().length < 3) {
      setBookFormError('Enter a valid ISBN (at least 3 characters, e.g. 978-0-14-017737-4).');
      return;
    }
    if (bookTitleInput.trim().length < 2) {
      setBookFormError('Enter the book title (at least 2 characters).');
      return;
    }
    if (bookAuthorInput.trim().length < 2) {
      setBookFormError('Enter the author name (at least 2 characters).');
      return;
    }

    setSavingBook(true);
    setBookFormError('');
    try {
      await saveLibraryBook(
        school.id,
        ownerId,
        {
          isbn: bookIsbnInput.trim(),
          title: bookTitleInput.trim(),
          author: bookAuthorInput.trim(),
          subject: bookSubjectInput.trim() || 'General',
          materialType: bookTypeInput,
          shelfCode: bookShelfInput.trim().toUpperCase(),
          totalCopies: Math.min(500, Math.max(1, Math.round(Number(bookCopiesInput) || 1))),
          notes: bookNotesInput.trim(),
        },
        editingBook?.id
      );
      clearModalDraft(bookDraftKey);
      setBookDraftRestored(false);
      setBookModalOpen(false);
    } catch (err) {
      setBookFormError(err instanceof Error ? err.message : 'Unable to save book to inventory.');
    } finally {
      setSavingBook(false);
    }
  };

  const handleConfirmDeleteBook = async () => {
    if (!deleteBookTarget || !canWriteLibrary) return;
    setDeletingBook(true);
    setDeleteBookError('');
    try {
      await removeLibraryBook(school.id, deleteBookTarget.id);
      setDeleteBookTarget(null);
    } catch (err) {
      setDeleteBookError(err instanceof Error ? err.message : 'Unable to delete book from catalog.');
    } finally {
      setDeletingBook(false);
    }
  };

  const handleLoadSampleCatalog = async () => {
    if (!canWriteLibrary) return;
    setSeedingCatalog(true);
    try {
      await seedDefaultLibraryBooks(school.id, ownerId, libraryBooks);
    } finally {
      setSeedingCatalog(false);
    }
  };

  const openEditModal = (loan: LibraryLoan) => {
    const key = buildModalDraftKey(school.id, 'lib_loan', loan.id);
    const draft = loadModalDraft<{
      selectedStudentId: string;
      bookTitle: string;
      materialType: LibraryMaterialCategory;
      subject: string;
      bookCode: string;
      quantity: number;
      checkoutDate: string;
      dueDate: string;
      loanStatus: LibraryLoanStatus;
      returnedDate: string;
      conditionOnReturn: LibraryItemCondition;
      notes: string;
    }>(key);
    setEditingLoan(loan);
    if (draft) {
      setSelectedStudentId(draft.selectedStudentId || loan.studentId);
      setBookTitle(draft.bookTitle || loan.bookTitle);
      setMaterialType(draft.materialType || loan.materialType);
      setSubject(draft.subject || loan.subject || 'General');
      setBookCode(draft.bookCode || loan.bookCode);
      setQuantity(draft.quantity || loan.quantity || 1);
      setCheckoutDate(draft.checkoutDate || loan.checkoutDate);
      setDueDate(draft.dueDate || loan.dueDate);
      setLoanStatus(draft.loanStatus || loan.status);
      setReturnedDate(draft.returnedDate ?? (loan.returnedDate || ''));
      setConditionOnReturn(draft.conditionOnReturn || loan.conditionOnReturn || 'Good');
      setNotes(draft.notes ?? (loan.notes || ''));
      setLoanDraftRestored(true);
    } else {
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
      setLoanDraftRestored(false);
    }
    setFormError('');
    setModalOpen(true);
  };

  const handleDiscardLoanDraft = () => {
    clearModalDraft(loanDraftKey);
    if (editingLoan) {
      setSelectedStudentId(editingLoan.studentId);
      setBookTitle(editingLoan.bookTitle);
      setMaterialType(editingLoan.materialType);
      setSubject(editingLoan.subject || 'General');
      setBookCode(editingLoan.bookCode);
      setQuantity(editingLoan.quantity || 1);
      setCheckoutDate(editingLoan.checkoutDate);
      setDueDate(editingLoan.dueDate);
      setLoanStatus(editingLoan.status);
      setReturnedDate(editingLoan.returnedDate || '');
      setConditionOnReturn(editingLoan.conditionOnReturn || 'Good');
      setNotes(editingLoan.notes || '');
    } else {
      const defaultStu = activeStudents[0] || students[0] || null;
      const defaultForm = (defaultStu?.formLevel || 1) as FormLevel;
      const defaultSubjects = getSubjectsForForm(schoolSubjects, defaultForm);
      const defaultSubj = defaultSubjects[0] || 'English';
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
    }
    setLoanDraftRestored(false);
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
      if (fulfillingReservation && fulfillingReservation.status !== 'Fulfilled') {
        await updateLibraryReservationStatus(
          school.id,
          fulfillingReservation.id,
          'Fulfilled',
          fulfillingReservation.registrationCode
        );
      }
      clearModalDraft(loanDraftKey);
      setLoanDraftRestored(false);
      setFulfillingReservation(null);
      setModalOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save library loan.');
    } finally {
      setSaving(false);
    }
  };

  const openReturnModal = (loan: LibraryLoan) => {
    const key = buildModalDraftKey(school.id, 'lib_return', loan.id);
    const draft = loadModalDraft<{
      returnDateInput: string;
      returnConditionInput: LibraryItemCondition;
      returnNotesInput: string;
    }>(key);
    setReturningLoan(loan);
    if (draft) {
      setReturnDateInput(draft.returnDateInput || todayIso);
      setReturnConditionInput(draft.returnConditionInput || 'Good');
      setReturnNotesInput(draft.returnNotesInput ?? (loan.notes || ''));
      setReturnDraftRestored(true);
    } else {
      setReturnDateInput(todayIso);
      setReturnConditionInput('Good');
      setReturnNotesInput(loan.notes || '');
      setReturnDraftRestored(false);
    }
    setReturnError('');
  };

  const handleDiscardReturnDraft = () => {
    clearModalDraft(returnDraftKey);
    setReturnDateInput(todayIso);
    setReturnConditionInput('Good');
    setReturnNotesInput(returningLoan?.notes || '');
    setReturnDraftRestored(false);
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
      clearModalDraft(returnDraftKey);
      setReturnDraftRestored(false);
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
      const dueWithin48h = isLibraryLoanDueWithin48Hours(loan, todayIso);
      const statusText = overdue
        ? `Overdue (${getLibraryDaysOverdue(loan.dueDate, todayIso)}d)`
        : dueWithin48h
        ? `Due Within 48h (${getLibraryDueReminderLabel(loan.dueDate, todayIso).urgencyLabel})`
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

  const txActionCounts = useMemo(() => {
    const counts: Record<LibraryTransactionAction, number> = {
      'Checked Out': 0,
      Returned: 0,
      Reopened: 0,
      Edited: 0,
      Deleted: 0,
    };
    for (const tx of libraryTransactions) {
      if (tx.action in counts) {
        counts[tx.action] += 1;
      }
    }
    return counts;
  }, [libraryTransactions]);

  const filteredTransactions = useMemo(() => {
    const q = txSearchQuery.trim().toLowerCase();
    return libraryTransactions.filter((tx) => {
      if (txActionFilter !== 'All' && tx.action !== txActionFilter) return false;
      if (!q) return true;
      return (
        tx.bookTitle.toLowerCase().includes(q) ||
        tx.bookCode.toLowerCase().includes(q) ||
        tx.studentName.toLowerCase().includes(q) ||
        tx.admissionNo.toLowerCase().includes(q) ||
        tx.subject.toLowerCase().includes(q) ||
        tx.actorName.toLowerCase().includes(q) ||
        (tx.notes || '').toLowerCase().includes(q)
      );
    });
  }, [libraryTransactions, txActionFilter, txSearchQuery]);

  const visibleTransactions = useMemo(
    () => (showAllTransactions ? filteredTransactions : filteredTransactions.slice(0, 15)),
    [filteredTransactions, showAllTransactions]
  );

  const formatTxTimestamp = (tx: LibraryTransaction) => {
    const dt = tx.createdAt?.toDate?.();
    if (!dt) return tx.eventDate;
    return `${dt.toISOString().slice(0, 10)} ${dt.toTimeString().slice(0, 5)}`;
  };

  const handleExportTransactionsCsv = () => {
    const headers = [
      'Logged At',
      'Event Date',
      'Action',
      'Material Title',
      'Copy Code',
      'Subject',
      'Qty',
      'Student Name',
      'Admission No',
      'Form',
      'Due Date',
      'Condition',
      'Recorded By',
      'Notes',
    ];
    const rows = filteredTransactions.map((tx) => [
      formatTxTimestamp(tx),
      tx.eventDate,
      tx.action,
      tx.bookTitle,
      tx.bookCode,
      tx.subject || 'General',
      tx.quantity || 1,
      tx.studentName,
      tx.admissionNo,
      `Form ${tx.formLevel}${tx.stream}`,
      tx.dueDate,
      tx.condition || 'Good',
      tx.actorName,
      tx.notes || '',
    ]);
    downloadCSV(
      `${school.name.replace(/\s+/g, '_')}_Library_Transaction_Log_${todayIso}.csv`,
      headers,
      rows
    );
  };

  const reservationStats = useMemo(() => {
    let pending = 0;
    let ready = 0;
    let fulfilled = 0;
    let cancelled = 0;
    for (const r of libraryReservations) {
      if (r.status === 'Pending') pending += 1;
      else if (r.status === 'Ready') ready += 1;
      else if (r.status === 'Fulfilled') fulfilled += 1;
      else if (r.status === 'Cancelled') cancelled += 1;
    }
    return { pending, ready, fulfilled, cancelled, active: pending + ready };
  }, [libraryReservations]);

  const filteredReservations = useMemo(() => {
    const q = reservationSearch.trim().toLowerCase();
    return libraryReservations.filter((r) => {
      if (reservationFilter !== 'All' && r.status !== reservationFilter) return false;
      if (!q) return true;
      return (
        r.bookTitle.toLowerCase().includes(q) ||
        r.isbn.toLowerCase().includes(q) ||
        r.studentName.toLowerCase().includes(q) ||
        r.admissionNo.toLowerCase().includes(q) ||
        r.subject.toLowerCase().includes(q)
      );
    });
  }, [libraryReservations, reservationFilter, reservationSearch]);

  const filteredDigitalResources = useMemo(() => {
    const q = digitalSearch.trim().toLowerCase();
    return digitalResources.filter((r) => {
      if (digitalAudienceFilter === 'teaching' && !isTeacherOnlyDigitalCategory(r.category)) {
        return false;
      }
      if (digitalAudienceFilter === 'student' && isTeacherOnlyDigitalCategory(r.category)) {
        return false;
      }
      if (digitalCategoryFilter !== 'All' && r.category !== digitalCategoryFilter) return false;
      if (digitalFormFilter !== 'All' && r.formLevel !== digitalFormFilter && r.formLevel !== 'All') {
        return false;
      }
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.author.toLowerCase().includes(q) ||
        r.subject.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        r.summary.toLowerCase().includes(q)
      );
    });
  }, [
    digitalAudienceFilter,
    digitalCategoryFilter,
    digitalFormFilter,
    digitalResources,
    digitalSearch,
  ]);

  const visibleDigitalCategories = useMemo(() => {
    if (digitalAudienceFilter === 'teaching') return TEACHER_DIGITAL_RESOURCE_CATEGORIES;
    if (digitalAudienceFilter === 'student') return STUDENT_DIGITAL_RESOURCE_CATEGORIES;
    return DIGITAL_RESOURCE_CATEGORIES;
  }, [digitalAudienceFilter]);

  return (
    <div className="space-y-6">
      {/* Library Module Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="School library views"
          className="inline-flex flex-wrap items-center gap-1 rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-1.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeLibraryTab === 'catalog'}
            onClick={() => setActiveLibraryTab('catalog')}
            className={`inline-flex items-center gap-2 min-h-[38px] px-4 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeLibraryTab === 'catalog'
                ? 'bg-emerald-700 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Library className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Catalog &amp; Loans</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeLibraryTab === 'reservations'}
            onClick={() => setActiveLibraryTab('reservations')}
            className={`inline-flex items-center gap-2 min-h-[38px] px-4 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeLibraryTab === 'reservations'
                ? 'bg-emerald-700 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <BookmarkPlus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              Reservations ({reservationStats.active > 0 ? reservationStats.active : libraryReservations.length})
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeLibraryTab === 'online'}
            onClick={() => setActiveLibraryTab('online')}
            className={`inline-flex items-center gap-2 min-h-[38px] px-4 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeLibraryTab === 'online'
                ? 'bg-emerald-700 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Globe className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Online Library ({digitalResources.length})</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canWriteLibrary && activeLibraryTab !== 'online' && (
            <button
              type="button"
              onClick={() => {
                setActiveLibraryTab('online');
                openAddDigitalModal();
              }}
              className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Upload Digital Document</span>
            </button>
          )}

          {reservationFeedback && (
            <div className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 px-3.5 py-2 text-xs text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{reservationFeedback}</span>
              <button
                type="button"
                onClick={() => setReservationFeedback('')}
                aria-label="Dismiss reservation notice"
                className="ml-1 opacity-70 hover:opacity-100 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {activeLibraryTab === 'catalog' && (
        <>
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

      {/* Library Usage Analytics Dashboard Widget */}
      <section
        aria-label="Library usage analytics"
        className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-start gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
              <BarChart3 className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Library Usage Analytics
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
                {stats.totalCopies} total {stats.totalCopies === 1 ? 'copy' : 'copies'} circulated ·{' '}
                {stats.activeBorrowersCount} active student{' '}
                {stats.activeBorrowersCount === 1 ? 'borrower' : 'borrowers'} ·{' '}
                {stats.mostBorrowedSubjects.length}{' '}
                {stats.mostBorrowedSubjects.length === 1 ? 'subject' : 'subjects'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setStatusFilter('Checked Out')}
              className="min-h-[34px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Filter Checked Out ({stats.checkedOutLoans})
            </button>
            {stats.dueSoonLoans > 0 && (
              <button
                type="button"
                onClick={() => setStatusFilter('Due Soon')}
                className="inline-flex items-center gap-1.5 min-h-[34px] px-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 font-semibold text-amber-800 dark:text-amber-300 hover:opacity-90 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Due in 48h ({stats.dueSoonLoans})</span>
              </button>
            )}
            {stats.overdueLoans > 0 && (
              <button
                type="button"
                onClick={() => setStatusFilter('Overdue')}
                className="min-h-[34px] px-3 rounded-lg border border-rose-200 dark:border-rose-900/70 bg-rose-50/70 dark:bg-rose-950/30 font-semibold text-rose-700 dark:text-rose-300 hover:opacity-90 whitespace-nowrap shrink-0 cursor-pointer"
              >
                View Overdue ({stats.overdueLoans})
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Active Checkout, 48h Due-Soon & Overdue Snapshot */}
          <div className="lg:col-span-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800 p-4">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Checked Out
                </div>
                <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  {stats.checkedOutCopies}{' '}
                  <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                    {stats.checkedOutCopies === 1 ? 'copy' : 'copies'}
                  </span>
                </div>
                <div className="mt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  {stats.checkedOutLoans} active {stats.checkedOutLoans === 1 ? 'loan' : 'loans'}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setStatusFilter(stats.dueSoonLoans > 0 ? 'Due Soon' : 'All')}
                className={`text-left rounded-xl border p-4 transition-colors cursor-pointer ${
                  stats.dueSoonLoans > 0
                    ? 'bg-amber-50/70 dark:bg-amber-950/25 border-amber-200 dark:border-amber-900/60 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                    : 'bg-slate-50 dark:bg-slate-900/60 border-slate-200/70 dark:border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <span>Due in 48h</span>
                  <Clock
                    className={`w-3.5 h-3.5 ${
                      stats.dueSoonLoans > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'
                    }`}
                    aria-hidden="true"
                  />
                </div>
                <div
                  className={`mt-1.5 text-xl font-bold font-mono tabular-nums ${
                    stats.dueSoonLoans > 0
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-slate-900 dark:text-white'
                  }`}
                >
                  {stats.dueSoonLoans}
                </div>
                <div className="mt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  {stats.dueSoonCopies} {stats.dueSoonCopies === 1 ? 'copy' : 'copies'} flagged
                </div>
              </button>

              <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800 p-4">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Overdue Items
                </div>
                <div
                  className={`mt-1.5 text-xl font-bold font-mono tabular-nums ${
                    stats.overdueLoans > 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {stats.overdueLoans}{' '}
                  <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                    ({stats.overdueSharePct}%)
                  </span>
                </div>
                <div className="mt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  {stats.overdueCopies} overdue {stats.overdueCopies === 1 ? 'copy' : 'copies'}
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  Return Clearance Rate
                </span>
                <span className="font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
                  {stats.returnRatePct}% ({stats.returnedLoans}/{stats.totalRecords})
                </span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden flex">
                {stats.returnedLoans > 0 && (
                  <div
                    style={{ width: `${stats.returnRatePct}%` }}
                    className="h-full bg-emerald-600 dark:bg-emerald-500"
                  />
                )}
                {stats.dueSoonLoans > 0 && stats.totalRecords > 0 && (
                  <div
                    style={{
                      width: `${Math.round((stats.dueSoonLoans / stats.totalRecords) * 100)}%`,
                    }}
                    className="h-full bg-amber-500"
                  />
                )}
                {stats.overdueLoans > 0 && stats.totalRecords > 0 && (
                  <div
                    style={{
                      width: `${Math.round((stats.overdueLoans / stats.totalRecords) * 100)}%`,
                    }}
                    className="h-full bg-rose-500"
                  />
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                <span className="inline-flex items-center gap-1">
                  <Users className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                  {stats.activeBorrowersCount} active borrowers
                </span>
                <span>
                  {stats.returnedCopies} returned ·{' '}
                  {Math.max(0, stats.checkedOutCopies - stats.overdueCopies - stats.dueSoonCopies)}{' '}
                  normal · {stats.dueSoonCopies} due in 48h
                </span>
              </div>
            </div>
          </div>

          {/* Right Column: Most Borrowed Subjects */}
          <div className="lg:col-span-7 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Most Borrowed Subjects
              </h3>
              {searchQuery &&
                stats.mostBorrowedSubjects.some(
                  (s) => s.subject.toLowerCase() === searchQuery.trim().toLowerCase()
                ) && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                  >
                    Clear subject filter
                  </button>
                )}
            </div>

            {stats.mostBorrowedSubjects.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 py-8 px-4 text-center text-xs text-slate-500 dark:text-slate-400">
                Issue textbooks or reading materials to see subject borrowing demand here.
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-center">
                <div className="xl:col-span-6 h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={stats.mostBorrowedSubjects.slice(0, 6)}
                      margin={{ top: 6, right: 8, left: -18, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} />
                      <XAxis
                        dataKey="subject"
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        tickFormatter={(val: string) =>
                          val.length > 9 ? `${val.slice(0, 8)}…` : val
                        }
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: '#64748b' }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0f172a',
                          borderColor: '#1e293b',
                          borderRadius: '0.75rem',
                          color: '#f8fafc',
                          fontSize: '12px',
                        }}
                      />
                      <Bar
                        dataKey="checkedOutCopies"
                        name="Checked Out"
                        stackId="loans"
                        fill="#d97706"
                        radius={[0, 0, 0, 0]}
                      />
                      <Bar
                        dataKey="returnedCopies"
                        name="Returned"
                        stackId="loans"
                        fill="#059669"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="xl:col-span-6 divide-y divide-slate-100 dark:divide-slate-800/80">
                  {stats.mostBorrowedSubjects.slice(0, 6).map((item, idx) => {
                    const maxCopies = stats.mostBorrowedSubjects[0]?.totalCopies || 1;
                    const barPct = Math.max(8, Math.round((item.totalCopies / maxCopies) * 100));
                    const isActiveSubject =
                      searchQuery.trim().toLowerCase() === item.subject.toLowerCase();

                    return (
                      <button
                        key={item.subject}
                        type="button"
                        onClick={() =>
                          setSearchQuery(isActiveSubject ? '' : item.subject)
                        }
                        className={`w-full text-left py-2 px-2 -mx-2 rounded-lg transition-colors cursor-pointer ${
                          isActiveSubject
                            ? 'bg-emerald-50/80 dark:bg-emerald-950/35'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                            <span className="font-mono text-slate-400 mr-1.5">
                              #{idx + 1}
                            </span>
                            {item.subject}
                          </span>
                          <span className="font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-300 shrink-0">
                            {item.totalCopies} {item.totalCopies === 1 ? 'copy' : 'copies'} ·{' '}
                            {item.checkedOutCopies} out
                            {item.overdueCopies > 0 && (
                              <span className="text-rose-600 dark:text-rose-400 font-semibold">
                                {' '}
                                · {item.overdueCopies} overdue
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            style={{ width: `${barPct}%` }}
                            className="h-full rounded-full bg-emerald-700 dark:bg-emerald-500"
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Automated 48-Hour Return Reminders Strip inside Dashboard Widget */}
        <div className="pt-5 border-t border-slate-100 dark:border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Clock
                className={`w-4 h-4 shrink-0 ${
                  stats.dueSoonLoans > 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-slate-400'
                }`}
                aria-hidden="true"
              />
              <div>
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Automated 48-Hour Return Reminders
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {stats.dueSoonLoans > 0
                    ? `${stats.dueSoonLoans} active ${stats.dueSoonLoans === 1 ? 'loan' : 'loans'} (${stats.dueSoonCopies} ${stats.dueSoonCopies === 1 ? 'copy' : 'copies'}) due for return within 48 hours`
                    : `No books due for return within 48 hours (checked ${todayIso})`}
                </p>
              </div>
            </div>

            {stats.dueSoonLoans > 0 && (
              <button
                type="button"
                onClick={() => setStatusFilter('Due Soon')}
                className="text-xs font-semibold text-amber-700 dark:text-amber-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                Show Only Due in 48h ({stats.dueSoonLoans})
              </button>
            )}
          </div>

          {stats.dueSoonItems.length > 0 && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 divide-y divide-amber-200/70 dark:divide-amber-900/50 overflow-hidden">
              {stats.dueSoonItems.slice(0, 6).map((loan) => {
                const reminder = getLibraryDueReminderLabel(loan.dueDate, todayIso);
                return (
                  <div
                    key={loan.id}
                    className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {loan.bookTitle}
                      </div>
                      <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300 truncate">
                        {loan.studentName} · Form {loan.formLevel}
                        {loan.stream} · {loan.admissionNo} · Copy {loan.bookCode}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right font-mono tabular-nums">
                        <div className="font-semibold text-amber-800 dark:text-amber-300">
                          {reminder.urgencyLabel}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          Due {loan.dueDate}
                        </div>
                      </div>
                      {canWriteLibrary && (
                        <button
                          type="button"
                          onClick={() => openReturnModal(loan)}
                          className="min-h-[32px] px-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Return
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Available Book Inventory & Search */}
      <section
        aria-label="Available book inventory"
        className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
              <Library className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Available Book Inventory
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
                {inventoryMetrics.totalAvailableCopies} of {inventoryMetrics.totalCatalogCopies} copies
                available · {inventoryMetrics.items.length}{' '}
                {inventoryMetrics.items.length === 1 ? 'title' : 'titles'} in catalog
              </p>
            </div>
          </div>

          {(canWriteLibrary || libraryBooks.length > 0 || libraryLoans.length > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              {(canWriteLibrary || libraryBooks.length > 0 || libraryLoans.length > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    setScannerInitialBook(null);
                    setScannerInitialMode('auto');
                    setScannerOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/70 dark:bg-emerald-950/35 text-xs font-semibold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/80 dark:hover:bg-emerald-950/60 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <ScanLine className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Scan Check In / Out</span>
                </button>
              )}
              {canWriteLibrary && libraryBooks.length === 0 && (
                <button
                  type="button"
                  onClick={handleLoadSampleCatalog}
                  disabled={seedingCatalog}
                  className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{seedingCatalog ? 'Loading Catalog...' : 'Load Standard Catalog'}</span>
                </button>
              )}
              {canWriteLibrary && (
                <button
                  type="button"
                  onClick={() => setCsvImportOpen(true)}
                  className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Import CSV</span>
                </button>
              )}
              {canWriteLibrary && (
                <button
                  type="button"
                  onClick={() => {
                    setBookScanInitialIsbn('');
                    setBookScanModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/70 dark:bg-emerald-950/35 text-xs font-semibold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/80 dark:hover:bg-emerald-950/60 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <ScanBarcode className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Scan Book to Add</span>
                </button>
              )}
              {canWriteLibrary && (
                <button
                  type="button"
                  onClick={openAddBookModal}
                  className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Add Book</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Inventory Search Bar & Stock Toggle */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Search book inventory by ISBN, title, or author name"
              value={inventorySearch}
              onChange={(e) => setInventorySearch(e.target.value)}
              placeholder="Search available books by ISBN, title, or author name..."
              className="w-full min-h-[42px] pl-10 pr-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
            />
          </div>

          <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-900 p-1 shrink-0 self-start md:self-auto">
            <button
              type="button"
              onClick={() => setInventoryStockFilter('available')}
              className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                inventoryStockFilter === 'available'
                  ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Available ({inventoryMetrics.availableTitlesCount})
            </button>
            <button
              type="button"
              onClick={() => setInventoryStockFilter('checked_out')}
              className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                inventoryStockFilter === 'checked_out'
                  ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Checked Out ({inventoryMetrics.checkedOutTitlesCount})
            </button>
            <button
              type="button"
              onClick={() => setInventoryStockFilter('all')}
              className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                inventoryStockFilter === 'all'
                  ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              All Catalog ({inventoryMetrics.items.length})
            </button>
          </div>
        </div>

        {/* Inventory Table */}
        {libraryBooks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 py-8 px-4 text-center space-y-2">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              No books registered in the school library inventory yet.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {canWriteLibrary
                ? 'Load the standard secondary textbook catalog or add books with ISBN, title, and author.'
                : 'Ask the School Librarian to catalog available textbooks and set books.'}
            </p>
          </div>
        ) : inventoryMetrics.filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 py-8 px-4 text-center space-y-2">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              No catalog books match &ldquo;{inventorySearch.trim()}&rdquo;.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Try searching a partial ISBN (e.g. 978-0-14), book title, or author name, or switch to All Catalog.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 pr-3 font-medium">Title &amp; Author</th>
                  <th className="py-2.5 px-3 font-medium">ISBN &amp; Shelf</th>
                  <th className="py-2.5 px-3 font-medium">Subject &amp; Type</th>
                  <th className="py-2.5 px-3 font-medium">Availability</th>
                  <th className="py-2.5 pl-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {inventoryMetrics.filtered.map(
                  ({
                    book,
                    totalCopies,
                    checkedOutCopies,
                    availableCopies,
                    activeReservationsCount,
                  }) => (
                    <tr
                      key={book.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 align-top"
                    >
                      <td className="py-3 pr-3 min-w-[220px]">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {book.title}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                          by {book.author}
                        </div>
                        {book.notes && (
                          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">
                            {book.notes}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 text-xs font-mono tabular-nums whitespace-nowrap">
                        <div className="text-slate-800 dark:text-slate-200">
                          ISBN {book.isbn}
                        </div>
                        <div className="mt-0.5 text-slate-500 dark:text-slate-400">
                          Shelf: {book.shelfCode || 'General'}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {book.subject || 'General'} · {book.materialType}
                      </td>

                      <td className="py-3 px-3 text-xs font-mono tabular-nums whitespace-nowrap">
                        <div
                          className={
                            availableCopies > 0
                              ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                              : 'font-semibold text-rose-600 dark:text-rose-400'
                          }
                        >
                          {availableCopies} / {totalCopies} available
                        </div>
                        {checkedOutCopies > 0 && (
                          <div className="mt-0.5 text-slate-500 dark:text-slate-400">
                            {checkedOutCopies} checked out
                          </div>
                        )}
                        {activeReservationsCount > 0 && (
                          <div className="mt-0.5 text-amber-700 dark:text-amber-400 font-semibold">
                            {activeReservationsCount}{' '}
                            {activeReservationsCount === 1 ? 'reservation' : 'reservations'}
                          </div>
                        )}
                      </td>

                      <td className="py-3 pl-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setQrBookTarget({
                                book,
                                availableCopies,
                                totalCopies,
                              })
                            }
                            aria-label={`Generate QR code for ${book.title}`}
                            title="View / Download Book QR Code"
                            className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <QrCode className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>QR</span>
                          </button>
                          {availableCopies === 0 && (
                            <button
                              type="button"
                              onClick={() => openReserveModal(book)}
                              disabled={students.length === 0}
                              className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 hover:bg-amber-100/80 dark:hover:bg-amber-950/70 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
                            >
                              <BookmarkPlus className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Reserve</span>
                            </button>
                          )}
                          {canWriteLibrary && (
                            <>
                              {availableCopies > 0 && (
                                <button
                                  type="button"
                                  onClick={() => openAssignModal(book)}
                                  disabled={students.length === 0}
                                  className="min-h-[34px] px-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
                                >
                                  Issue Copy
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openEditBookModal(book)}
                                aria-label={`Edit inventory book ${book.title}`}
                                className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteBookError('');
                                  setDeleteBookTarget(book);
                                }}
                                aria-label={`Delete inventory book ${book.title}`}
                                className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
            {canWriteLibrary && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setScannerInitialBook(null);
                    setScannerInitialMode('check_in');
                    setScannerOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/70 dark:bg-emerald-950/35 text-xs font-semibold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/80 dark:hover:bg-emerald-950/60 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Scan Check In</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setScannerInitialBook(null);
                    setScannerInitialMode('check_out');
                    setScannerOpen(true);
                  }}
                  disabled={students.length === 0}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/70 dark:bg-emerald-950/35 text-xs font-semibold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/80 dark:hover:bg-emerald-950/60 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <ScanBarcode className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Scan Check Out</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={sortedAndFilteredLoans.length === 0}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Export CSV</span>
            </button>
            {canWriteLibrary && (
              <button
                type="button"
                onClick={() => openAssignModal()}
                disabled={students.length === 0}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
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
            <div className="inline-flex flex-wrap rounded-xl bg-slate-100 dark:bg-slate-900 p-1">
              {(
                [
                  { id: 'All', label: `All (${libraryLoans.length})` },
                  { id: 'Checked Out', label: `Checked Out (${stats.checkedOutLoans})` },
                  { id: 'Due Soon', label: `Due in 48h (${stats.dueSoonLoans})` },
                  { id: 'Overdue', label: `Overdue (${stats.overdueLoans})` },
                  { id: 'Returned', label: `Returned (${stats.returnedLoans})` },
                ] as { id: LibraryStatusFilter; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
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
                  const dueWithin48h = isLibraryLoanDueWithin48Hours(loan, todayIso);
                  const reminder = getLibraryDueReminderLabel(loan.dueDate, todayIso);
                  const daysLate = overdue ? getLibraryDaysOverdue(loan.dueDate, todayIso) : 0;
                  const isBusy = actionBusyId === loan.id;

                  return (
                    <tr
                      key={loan.id}
                      className={`align-top ${
                        overdue
                          ? 'bg-rose-50/40 dark:bg-rose-950/15 hover:bg-rose-50/70 dark:hover:bg-rose-950/25'
                          : dueWithin48h
                          ? 'bg-amber-50/45 dark:bg-amber-950/15 hover:bg-amber-50/75 dark:hover:bg-amber-950/25'
                          : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                      }`}
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
                              : dueWithin48h
                              ? 'text-amber-700 dark:text-amber-400 font-semibold mt-0.5'
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
                        ) : dueWithin48h ? (
                          <div>
                            <div className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400">
                              <Clock className="w-3 h-3" aria-hidden="true" />
                              <span>Due Within 48h</span>
                            </div>
                            <div className="mt-0.5 font-mono text-amber-700 dark:text-amber-400">
                              {reminder.urgencyLabel}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="font-semibold text-slate-700 dark:text-slate-300">
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

      {/* Borrowing Transaction History Log (Audit Trail) */}
      <section
        aria-label="Borrowing transaction history log"
        className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300 shrink-0">
              <History className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Borrowing Transaction History Log
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
                {libraryTransactions.length} immutable audit{' '}
                {libraryTransactions.length === 1 ? 'entry' : 'entries'} ·{' '}
                {txActionCounts['Checked Out']} checkouts · {txActionCounts.Returned} returns
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleExportTransactionsCsv}
            disabled={filteredTransactions.length === 0}
            className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 self-start sm:self-auto cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Export Audit CSV</span>
          </button>
        </div>

        {/* Transaction Filters */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 dark:bg-slate-900 p-1">
            {(
              [
                { id: 'All', label: `All (${libraryTransactions.length})` },
                { id: 'Checked Out', label: `Checked Out (${txActionCounts['Checked Out']})` },
                { id: 'Returned', label: `Returned (${txActionCounts.Returned})` },
                { id: 'Reopened', label: `Reopened (${txActionCounts.Reopened})` },
                { id: 'Edited', label: `Edited (${txActionCounts.Edited})` },
                { id: 'Deleted', label: `Deleted (${txActionCounts.Deleted})` },
              ] as { id: TxActionFilter; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setTxActionFilter(tab.id);
                  setShowAllTransactions(false);
                }}
                className={`min-h-[32px] px-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  txActionFilter === tab.id
                    ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full lg:w-72">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Search transaction history log"
              value={txSearchQuery}
              onChange={(e) => {
                setTxSearchQuery(e.target.value);
                setShowAllTransactions(false);
              }}
              placeholder="Search book, code, student, or staff..."
              className="w-full min-h-[40px] pl-9 pr-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
            />
          </div>
        </div>

        {/* Audit Table */}
        {libraryTransactions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 py-8 px-4 text-center space-y-1.5">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              No borrowing transactions logged yet.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Every checkout, return, re-issue, edit, and deletion is recorded here automatically for audit tracking.
            </p>
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 py-8 px-4 text-center space-y-1.5">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              No audit log entries match your current filter.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Try clearing the search box or switching the action tab.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 pr-3 font-medium">Logged At</th>
                    <th className="py-2.5 px-3 font-medium">Action</th>
                    <th className="py-2.5 px-3 font-medium">Material &amp; Copy</th>
                    <th className="py-2.5 px-3 font-medium">Student</th>
                    <th className="py-2.5 px-3 font-medium">Details</th>
                    <th className="py-2.5 pl-3 font-medium text-right">Recorded By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {visibleTransactions.map((tx) => {
                    const actionColor =
                      tx.action === 'Returned'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : tx.action === 'Checked Out'
                        ? 'text-amber-700 dark:text-amber-400'
                        : tx.action === 'Deleted'
                        ? 'text-rose-600 dark:text-rose-400'
                        : tx.action === 'Reopened'
                        ? 'text-sky-700 dark:text-sky-400'
                        : 'text-slate-700 dark:text-slate-300';

                    return (
                      <tr
                        key={tx.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 align-top"
                      >
                        <td className="py-3 pr-3 text-xs font-mono tabular-nums whitespace-nowrap">
                          <div className="text-slate-800 dark:text-slate-200">
                            {formatTxTimestamp(tx)}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                            Event: {tx.eventDate}
                          </div>
                        </td>

                        <td className="py-3 px-3 text-xs whitespace-nowrap">
                          <div className={`font-semibold ${actionColor}`}>{tx.action}</div>
                          {(tx.action === 'Returned' || tx.condition !== 'Good') && (
                            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                              Condition: {tx.condition}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3 min-w-[200px]">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {tx.bookTitle}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 font-mono">
                            {tx.bookCode} · {tx.subject || 'General'}
                            {tx.quantity > 1 ? ` · Qty ${tx.quantity}` : ''}
                          </div>
                        </td>

                        <td className="py-3 px-3 min-w-[150px]">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {tx.studentName}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 font-mono">
                            Form {tx.formLevel}
                            {tx.stream} · {tx.admissionNo}
                          </div>
                        </td>

                        <td className="py-3 px-3 text-xs min-w-[170px]">
                          <div className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                            Due: {tx.dueDate}
                          </div>
                          {tx.notes && (
                            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
                              {tx.notes}
                            </div>
                          )}
                        </td>

                        <td className="py-3 pl-3 text-xs text-right text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {tx.actorName}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {filteredTransactions.length > 15 && (
              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/80 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-mono tabular-nums">
                  Showing {visibleTransactions.length} of {filteredTransactions.length} entries
                </span>
                <button
                  type="button"
                  onClick={() => setShowAllTransactions((prev) => !prev)}
                  className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                >
                  {showAllTransactions
                    ? 'Show Latest 15'
                    : `Show All (${filteredTransactions.length})`}
                </button>
              </div>
            )}
          </div>
        )}
      </section>
        </>
      )}

      {/* Reservations Tab */}
      {activeLibraryTab === 'reservations' && (
        <section
          aria-label="Book reservations queue"
          className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center text-amber-700 dark:text-amber-400 shrink-0">
                <BookmarkPlus className="w-4 h-4" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  Book Reservations &amp; Hold Queue
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
                  {reservationStats.pending} pending · {reservationStats.ready} ready for pickup ·{' '}
                  {reservationStats.fulfilled} fulfilled
                </p>
              </div>
            </div>

            {libraryBooks.length > 0 && (
              <button
                type="button"
                onClick={() => openReserveModal()}
                disabled={students.length === 0}
                className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 self-start sm:self-auto cursor-pointer disabled:opacity-40"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Reserve Book for Student</span>
              </button>
            )}
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="inline-flex flex-wrap rounded-xl bg-slate-100 dark:bg-slate-900 p-1">
              {(
                [
                  { id: 'All', label: `All (${libraryReservations.length})` },
                  { id: 'Pending', label: `Pending (${reservationStats.pending})` },
                  { id: 'Ready', label: `Ready (${reservationStats.ready})` },
                  { id: 'Fulfilled', label: `Fulfilled (${reservationStats.fulfilled})` },
                  { id: 'Cancelled', label: `Cancelled (${reservationStats.cancelled})` },
                ] as { id: ReservationFilter; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setReservationFilter(tab.id)}
                  className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                    reservationFilter === tab.id
                      ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="relative w-full lg:w-72">
              <Search
                className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Search reservations"
                value={reservationSearch}
                onChange={(e) => setReservationSearch(e.target.value)}
                placeholder="Search book, ISBN, or student..."
                className="w-full min-h-[40px] pl-9 pr-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
              />
            </div>
          </div>

          {libraryReservations.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 py-10 px-4 text-center">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                No book reservations requested yet.
              </p>
            </div>
          ) : filteredReservations.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 py-10 px-4 text-center text-xs text-slate-500 dark:text-slate-400">
              No reservations match your current filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 pr-3 font-medium">Requested</th>
                    <th className="py-2.5 px-3 font-medium">Book &amp; ISBN</th>
                    <th className="py-2.5 px-3 font-medium">Student</th>
                    <th className="py-2.5 px-3 font-medium">Catalog Stock</th>
                    <th className="py-2.5 px-3 font-medium">Status</th>
                    {canWriteLibrary && (
                      <th className="py-2.5 pl-3 font-medium text-right">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {filteredReservations.map((res) => {
                    const matchedInv = inventoryMetrics.items.find(
                      (item) =>
                        item.book.id === res.bookId ||
                        item.book.title.trim().toLowerCase() === res.bookTitle.trim().toLowerCase()
                    );
                    const matchedStudent = students.find((s) => s.id === res.studentId);
                    const isBusy = actionBusyId === res.id;

                    const statusColor =
                      res.status === 'Ready'
                        ? 'text-sky-700 dark:text-sky-400'
                        : res.status === 'Fulfilled'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : res.status === 'Cancelled'
                        ? 'text-slate-500 dark:text-slate-400'
                        : 'text-amber-700 dark:text-amber-400';

                    return (
                      <tr
                        key={res.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 align-top"
                      >
                        <td className="py-3 pr-3 font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          {res.requestedDate}
                        </td>
                        <td className="py-3 px-3 min-w-[200px]">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {res.bookTitle}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 font-mono">
                            {res.isbn ? `ISBN ${res.isbn} · ` : ''}
                            {res.subject} · {res.materialType}
                          </div>
                          {res.notes && (
                            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">
                              {res.notes}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 min-w-[160px]">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {res.studentName}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 font-mono">
                            Form {res.formLevel}
                            {res.stream} · {res.admissionNo}
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono text-xs tabular-nums whitespace-nowrap">
                          {matchedInv ? (
                            <span
                              className={
                                matchedInv.availableCopies > 0
                                  ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                                  : 'text-rose-600 dark:text-rose-400'
                              }
                            >
                              {matchedInv.availableCopies} / {matchedInv.totalCopies} avail.
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-xs whitespace-nowrap">
                          <span className={`font-semibold ${statusColor}`}>
                            {res.status === 'Ready' ? 'Ready for Pickup' : res.status}
                          </span>
                        </td>
                        {canWriteLibrary && (
                          <td className="py-3 pl-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              {res.status === 'Pending' && (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateReservationStatus(res, 'Ready')}
                                  disabled={isBusy}
                                  className="min-h-[34px] px-2.5 rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-300 hover:bg-sky-100/80 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
                                >
                                  Mark Ready
                                </button>
                              )}
                              {(res.status === 'Pending' || res.status === 'Ready') && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openAssignModal(matchedInv?.book, matchedStudent, res)
                                    }
                                    disabled={isBusy || !matchedStudent}
                                    className="min-h-[34px] px-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
                                  >
                                    Issue Book
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateReservationStatus(res, 'Cancelled')}
                                    disabled={isBusy}
                                    className="min-h-[34px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
                                  >
                                    Cancel
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteReservationError('');
                                  setDeleteReservationTarget(res);
                                }}
                                disabled={isBusy}
                                aria-label={`Delete reservation for ${res.bookTitle}`}
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
      )}

      {/* Online & Offline Library Tab */}
      {activeLibraryTab === 'online' && (
        <section
          aria-label="Online and offline digital library"
          className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
                <Globe className="w-4 h-4" aria-hidden="true" />
              </div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Online &amp; Offline Digital Library
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {digitalResources.some((r) => r.allowOffline) && (
                <button
                  type="button"
                  onClick={handleSaveAllDigitalOffline}
                  disabled={savingAllOffline}
                  className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
                >
                  <CloudOff className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {savingAllOffline ? 'Caching...' : `Save All Offline (${offlineIds.size}/${digitalResources.filter((r) => r.allowOffline).length})`}
                  </span>
                </button>
              )}
              {canWriteLibrary && (
                <button
                  type="button"
                  onClick={openAddDigitalModal}
                  className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Upload Document</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 border-y border-slate-200/80 dark:border-slate-800 py-3">
            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Reading Online Now
              </div>
              <div className="text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                {readingCounts.onlineActiveTotal}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Offline Readers Now
              </div>
              <div className="text-lg font-bold tabular-nums text-amber-700 dark:text-amber-400">
                {readingCounts.offlineActiveTotal}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Marked Read
              </div>
              <div className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                {digitalResources.filter((r) => progressMap[r.id]?.isRead).length}
                <span className="text-xs font-normal text-slate-400">
                  {' '}
                  / {digitalResources.length}
                </span>
              </div>
            </div>
          </div>

          {canWriteLibrary && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleInlineDigitalFileSelected(e.dataTransfer.files?.[0]);
              }}
              className="rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/50 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <input
                ref={inlineDigFileInputRef}
                type="file"
                aria-label="Upload document to digital library"
                accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp"
                onChange={(e) => handleInlineDigitalFileSelected(e.target.files?.[0])}
                className="hidden"
              />
              <div className="flex items-start gap-3 min-w-0">
                <div className="h-10 w-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
                  <Upload className="w-4 h-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white">
                    Upload Digital Resource
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                    PDF, DOCX, TXT, MD, or Image · Max 10 MB
                  </div>
                  {inlineUploadError && (
                    <div className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">
                      {inlineUploadError}
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => inlineDigFileInputRef.current?.click()}
                disabled={digParsingFile}
                className="inline-flex items-center justify-center gap-1.5 min-h-[38px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{digParsingFile ? 'Reading File...' : 'Choose Document'}</span>
              </button>
            </div>
          )}

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-900 p-1">
                {(
                  [
                    { id: 'all', label: 'All Resources' },
                    { id: 'teaching', label: 'Teaching Resources' },
                    { id: 'student', label: 'Student Study' },
                  ] as const
                ).map((scope) => (
                  <button
                    key={scope.id}
                    type="button"
                    onClick={() => {
                      setDigitalAudienceFilter(scope.id);
                      setDigitalCategoryFilter('All');
                    }}
                    className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                      digitalAudienceFilter === scope.id
                        ? 'bg-emerald-700 text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {scope.label}
                  </button>
                ))}
              </div>

              <div className="inline-flex flex-wrap rounded-xl bg-slate-100 dark:bg-slate-900 p-1">
                {(['All', ...visibleDigitalCategories] as DigitalCategoryFilter[]).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setDigitalCategoryFilter(cat)}
                    className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                      digitalCategoryFilter === cat
                        ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <select
                aria-label="Filter digital materials by form level"
                value={digitalFormFilter}
                onChange={(e) =>
                  setDigitalFormFilter(e.target.value as DigitalResourceFormLevel | 'All')
                }
                className="min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200"
              >
                <option value="All">All Forms</option>
                {DIGITAL_RESOURCE_FORM_LEVELS.filter((lvl) => lvl !== 'All').map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl}
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
                aria-label="Search digital books and teaching resources"
                value={digitalSearch}
                onChange={(e) => setDigitalSearch(e.target.value)}
                placeholder="Search title, subject, or author..."
                className="w-full min-h-[40px] pl-9 pr-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
              />
            </div>
          </div>

          {digitalResources.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 py-10 px-4 text-center">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                No digital materials uploaded yet.
              </p>
            </div>
          ) : filteredDigitalResources.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 py-10 px-4 text-center text-xs text-slate-500 dark:text-slate-400">
              No digital library items match your current filter.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredDigitalResources.map((res) => {
                const isCached = offlineIds.has(res.id);
                const progress = progressMap[res.id];
                const isRead = Boolean(progress?.isRead);
                const lastReadPage = progress?.lastReadPage || 0;
                const totalPages = progress?.totalPages || 0;
                const lastReadLabel = formatLastReadLabel(progress?.lastReadAt);
                const onlineCount = readingCounts.onlineByResource[res.id] || 0;
                const offlineCount = readingCounts.offlineByResource[res.id] || 0;

                return (
                  <article
                    key={res.id}
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 p-5 flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-2">
                      <div className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 font-semibold">
                        {res.category} · {res.subject} · {res.formLevel}
                        {res.examYear ? ` · ${res.examYear}` : ''}
                        {res.storageFormat === 'pdf'
                          ? ` · PDF${res.fileSizeBytes ? ` (${formatFileSizeLabel(res.fileSizeBytes)})` : ''}`
                          : res.storageFormat === 'image'
                          ? ` · Image${res.fileSizeBytes ? ` (${formatFileSizeLabel(res.fileSizeBytes)})` : ''}`
                          : ''}
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-snug">
                        {res.title}
                      </h3>
                      <div className="text-xs text-slate-600 dark:text-slate-300">
                        by {res.author}
                        {res.fileName ? ` · ${res.fileName}` : ''}
                      </div>
                      {res.summary && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                          {res.summary}
                        </p>
                      )}
                      {(lastReadPage > 0 || lastReadLabel || onlineCount > 0 || offlineCount > 0 || isRead) && (
                        <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 pt-0.5">
                          {isRead ? 'Read' : lastReadPage > 0 ? `Page ${lastReadPage}${totalPages > 1 ? `/${totalPages}` : ''}` : ''}
                          {lastReadLabel ? `${isRead || lastReadPage > 0 ? ' · ' : ''}Last read ${lastReadLabel}` : ''}
                          {(onlineCount > 0 || offlineCount > 0)
                            ? `${isRead || lastReadPage > 0 || lastReadLabel ? ' · ' : ''}${onlineCount} online · ${offlineCount} offline`
                            : ''}
                        </div>
                      )}
                    </div>

                    <div className="pt-3 border-t border-slate-200/70 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setReaderTarget(res)}
                          className="inline-flex items-center gap-1.5 min-h-[34px] px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>{lastReadPage > 1 ? `Continue p.${lastReadPage}` : 'Open Reader'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleMarkAsRead(res.id)}
                          aria-pressed={isRead}
                          className={`inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg border text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                            isRead
                              ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                              : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>{isRead ? 'Marked Read' : 'Mark as Read'}</span>
                        </button>
                        {res.allowOffline && (
                          <button
                            type="button"
                            onClick={() => handleToggleOfflineDigital(res)}
                            disabled={savingOfflineId === res.id}
                            className={`inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg border text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 ${
                              isCached
                                ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800'
                            }`}
                          >
                            {isCached ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Saved Offline</span>
                              </>
                            ) : (
                              <>
                                <CloudOff className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Save Offline</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>

                      {canWriteLibrary && (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditDigitalModal(res)}
                            aria-label={`Edit ${res.title}`}
                            className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteDigitalError('');
                              setDeleteDigitalTarget(res);
                            }}
                            aria-label={`Delete ${res.title}`}
                            className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Assign / Edit Material Modal */}
      {modalOpen && (
        <ModalBackdrop
          open={modalOpen}
          disabled={saving}
          ariaLabelledBy="library-loan-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4"
          onClose={() => setModalOpen(false)}
        >
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between gap-4">
              <h2
                id="library-loan-modal-title"
                className="text-base font-semibold text-slate-900 dark:text-white"
              >
                {editingLoan ? 'Edit Library Loan' : 'Assign Library Material'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close library dialog"
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <DraftRestoredNotice
              visible={loanDraftRestored}
              onDiscard={handleDiscardLoanDraft}
            />

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
                    {titleSuggestions.map((title) => (
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
        </ModalBackdrop>
      )}

      {/* Mark Material Returned Modal */}
      {returningLoan && (
        <ModalBackdrop
          open={Boolean(returningLoan)}
          disabled={processingReturn}
          ariaLabelledBy="library-return-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4"
          onClose={() => setReturningLoan(null)}
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

            <DraftRestoredNotice
              visible={returnDraftRestored}
              onDiscard={handleDiscardReturnDraft}
            />

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
        </ModalBackdrop>
      )}

      {/* Add / Edit Inventory Book Modal */}
      {bookModalOpen && (
        <ModalBackdrop
          open={bookModalOpen}
          disabled={savingBook}
          ariaLabelledBy="library-book-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4"
          onClose={() => setBookModalOpen(false)}
        >
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between gap-4">
              <h2
                id="library-book-modal-title"
                className="text-base font-semibold text-slate-900 dark:text-white"
              >
                {editingBook ? 'Edit Library Inventory Book' : 'Add Book to Library Inventory'}
              </h2>
              <div className="flex items-center gap-2 shrink-0">
                {!editingBook && canWriteLibrary && (
                  <button
                    type="button"
                    onClick={() => {
                      setBookModalOpen(false);
                      setBookScanInitialIsbn('');
                      setBookScanModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 min-h-[34px] px-3 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/35 text-xs font-semibold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/80 whitespace-nowrap cursor-pointer"
                  >
                    <ScanBarcode className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Scan Book</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setBookModalOpen(false)}
                  aria-label="Close inventory dialog"
                  className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <DraftRestoredNotice
              visible={bookDraftRestored}
              onDiscard={handleDiscardBookDraft}
            />

            {bookFormError && (
              <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                {bookFormError}
              </div>
            )}

            <form onSubmit={handleSaveBook} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-5">
                  <label
                    htmlFor="inv-isbn"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    ISBN
                  </label>
                  <input
                    id="inv-isbn"
                    type="text"
                    required
                    maxLength={32}
                    value={bookIsbnInput}
                    onChange={(e) => setBookIsbnInput(e.target.value)}
                    placeholder="978-99908-87-12-4"
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                  />
                </div>

                <div className="sm:col-span-7">
                  <label
                    htmlFor="inv-title"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Book Title
                  </label>
                  <input
                    id="inv-title"
                    type="text"
                    required
                    maxLength={140}
                    value={bookTitleInput}
                    onChange={(e) => setBookTitleInput(e.target.value)}
                    placeholder="e.g. Excel & Succeed Biology Form 4"
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-8">
                  <label
                    htmlFor="inv-author"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Author Name(s)
                  </label>
                  <input
                    id="inv-author"
                    type="text"
                    required
                    maxLength={120}
                    value={bookAuthorInput}
                    onChange={(e) => setBookAuthorInput(e.target.value)}
                    placeholder="e.g. John Steinbeck"
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                  />
                </div>

                <div className="sm:col-span-4">
                  <label
                    htmlFor="inv-copies"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Total Copies
                  </label>
                  <input
                    id="inv-copies"
                    type="number"
                    min={1}
                    max={500}
                    required
                    value={bookCopiesInput}
                    onChange={(e) =>
                      setBookCopiesInput(Math.max(1, Math.min(500, Number(e.target.value) || 1)))
                    }
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="inv-subject"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Subject
                  </label>
                  <select
                    id="inv-subject"
                    value={bookSubjectInput}
                    onChange={(e) => {
                      const nextSubj = e.target.value;
                      setBookSubjectInput(nextSubj);
                      if (!editingBook && (!bookShelfInput || bookShelfInput.startsWith('LIB-'))) {
                        const tok =
                          nextSubj
                            .replace(/[^A-Za-z]/g, '')
                            .toUpperCase()
                            .slice(0, 3) || 'GEN';
                        setBookShelfInput(`LIB-${tok}`);
                      }
                    }}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100"
                  >
                    {allSubjectChoices.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="inv-type"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Material Type
                  </label>
                  <select
                    id="inv-type"
                    value={bookTypeInput}
                    onChange={(e) => setBookTypeInput(e.target.value as LibraryMaterialCategory)}
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
                    htmlFor="inv-shelf"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Shelf / Copy Prefix
                  </label>
                  <input
                    id="inv-shelf"
                    type="text"
                    maxLength={40}
                    value={bookShelfInput}
                    onChange={(e) => setBookShelfInput(e.target.value.toUpperCase())}
                    placeholder="LIB-ENG"
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm uppercase text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="inv-notes"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Catalog Notes (Optional)
                </label>
                <input
                  id="inv-notes"
                  type="text"
                  maxLength={240}
                  value={bookNotesInput}
                  onChange={(e) => setBookNotesInput(e.target.value)}
                  placeholder="Edition details, syllabus level, or shelf bay..."
                  className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setBookModalOpen(false)}
                  disabled={savingBook}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingBook}
                  className="min-h-[42px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-40 cursor-pointer"
                >
                  {savingBook ? 'Saving...' : editingBook ? 'Save Changes' : 'Add to Catalog'}
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}

      {/* Safe Delete Loan Confirmation Modal */}
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

      {/* Safe Delete Inventory Book Confirmation Modal */}
      <ConfirmDeleteModal
        open={Boolean(deleteBookTarget)}
        title="Remove Book from Inventory"
        itemName={
          deleteBookTarget
            ? `${deleteBookTarget.title} (ISBN ${deleteBookTarget.isbn})`
            : ''
        }
        description="This removes the title from the available book inventory catalog. Existing student circulation records will remain intact."
        confirmLabel="Remove Book"
        deleting={deletingBook}
        error={deleteBookError}
        onCancel={() => {
          if (!deletingBook) {
            setDeleteBookTarget(null);
            setDeleteBookError('');
          }
        }}
        onConfirm={handleConfirmDeleteBook}
      />

      {/* Library Book QR Generator Modal */}
      <LibraryBookQrModal
        open={Boolean(qrBookTarget)}
        school={school}
        book={qrBookTarget?.book || null}
        availableCopies={qrBookTarget?.availableCopies ?? 0}
        totalCopies={qrBookTarget?.totalCopies ?? 0}
        onClose={() => setQrBookTarget(null)}
        onOpenScannerWithBook={(bk) => {
          setQrBookTarget(null);
          setScannerInitialBook(bk);
          setScannerInitialMode('auto');
          setScannerOpen(true);
        }}
      />

      {/* Library Camera QR Scanner & Quick Status Update Modal */}
      <LibraryQrScannerModal
        open={scannerOpen}
        school={school}
        ownerId={ownerId}
        libraryBooks={libraryBooks}
        libraryLoans={libraryLoans}
        students={students}
        canWriteLibrary={canWriteLibrary}
        initialBook={scannerInitialBook}
        initialMode={scannerInitialMode}
        onAddNewBookFromScan={(rawCode) => {
          setBookScanInitialIsbn(rawCode);
          setBookScanModalOpen(true);
        }}
        onClose={() => {
          setScannerOpen(false);
          setScannerInitialBook(null);
          setScannerInitialMode('auto');
        }}
      />

      {/* Scan Book Barcode / Cover to Add to Catalog Modal */}
      <LibraryBookScanModal
        open={bookScanModalOpen}
        school={school}
        ownerId={ownerId}
        libraryBooks={libraryBooks}
        allSubjectChoices={allSubjectChoices}
        initialIsbn={bookScanInitialIsbn}
        onClose={() => {
          setBookScanModalOpen(false);
          setBookScanInitialIsbn('');
        }}
      />

      {/* Bulk CSV Book Inventory Import Modal */}
      <LibraryCsvImportModal
        open={csvImportOpen}
        school={school}
        ownerId={ownerId}
        libraryBooks={libraryBooks}
        onClose={() => setCsvImportOpen(false)}
      />

      {/* Reserve Book Modal */}
      {reserveModalOpen && (
        <ModalBackdrop
          open={reserveModalOpen}
          disabled={savingReservation}
          ariaLabelledBy="reserve-book-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4"
          onClose={() => setReserveModalOpen(false)}
        >
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h2
                id="reserve-book-modal-title"
                className="text-base font-semibold text-slate-900 dark:text-white"
              >
                Reserve Checked-Out Book
              </h2>
              <button
                type="button"
                onClick={() => setReserveModalOpen(false)}
                disabled={savingReservation}
                aria-label="Close reserve modal"
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <DraftRestoredNotice
              visible={reserveDraftRestored}
              onDiscard={handleDiscardReserveDraft}
            />

            {reserveFormError && (
              <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                {reserveFormError}
              </div>
            )}

            <form onSubmit={handleSaveReservation} className="space-y-4">
              <div>
                <label
                  htmlFor="res-book-select"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Book Title
                </label>
                <select
                  id="res-book-select"
                  value={reserveBookTarget?.id || ''}
                  onChange={(e) => {
                    const found = libraryBooks.find((b) => b.id === e.target.value) || null;
                    setReserveBookTarget(found);
                  }}
                  className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100"
                >
                  {libraryBooks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title} (ISBN {b.isbn})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="res-student-select"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Student
                </label>
                <select
                  id="res-student-select"
                  value={reserveStudentId}
                  onChange={(e) => setReserveStudentId(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100"
                >
                  {activeStudents.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName} — Form {s.formLevel}
                      {s.stream} ({s.admissionNo})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="res-notes"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Request Note (Optional)
                </label>
                <input
                  id="res-notes"
                  type="text"
                  maxLength={240}
                  value={reserveNotes}
                  onChange={(e) => setReserveNotes(e.target.value)}
                  placeholder="e.g. Needed for Form 4 Literature essay prep"
                  className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReserveModalOpen(false)}
                  disabled={savingReservation}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingReservation}
                  className="min-h-[42px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-40 cursor-pointer"
                >
                  {savingReservation ? 'Reserving...' : 'Confirm Reservation'}
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}

      {/* Safe Delete Reservation Modal */}
      <ConfirmDeleteModal
        open={Boolean(deleteReservationTarget)}
        title="Delete Book Reservation"
        itemName={
          deleteReservationTarget
            ? `${deleteReservationTarget.bookTitle} — ${deleteReservationTarget.studentName}`
            : ''
        }
        description="This permanently removes this reservation request from both the school queue and the student portal."
        confirmLabel="Delete Reservation"
        deleting={deletingReservation}
        error={deleteReservationError}
        onCancel={() => {
          if (!deletingReservation) {
            setDeleteReservationTarget(null);
            setDeleteReservationError('');
          }
        }}
        onConfirm={handleConfirmDeleteReservation}
      />

      {/* Publish / Edit Digital Library Resource Modal */}
      {digitalModalOpen && (
        <ModalBackdrop
          open={digitalModalOpen}
          disabled={savingDigital || digParsingFile}
          ariaLabelledBy="digital-resource-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4"
          onClose={() => setDigitalModalOpen(false)}
        >
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-5">
            <div className="flex items-start justify-between gap-3">
              <h2
                id="digital-resource-modal-title"
                className="text-base font-semibold text-slate-900 dark:text-white"
              >
                {editingDigital
                  ? 'Update Digital Resource'
                  : 'Upload Digital Resource'}
              </h2>
              <button
                type="button"
                onClick={() => setDigitalModalOpen(false)}
                disabled={savingDigital}
                aria-label="Close digital material modal"
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <DraftRestoredNotice
              visible={digitalDraftRestored}
              onDiscard={handleDiscardDigitalDraft}
            />

            {digitalFormError && (
              <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                {digitalFormError}
              </div>
            )}

            <form onSubmit={handleSaveDigitalResource} className="space-y-4">
              {/* File Upload Zone */}
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Reading Material File {editingDigital ? '(Optional replacement)' : '(Required)'}
                </label>
                <input
                  ref={digFileInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp"
                  onChange={(e) => handleDigitalFileSelected(e.target.files?.[0])}
                  className="hidden"
                />
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDigitalFileSelected(e.dataTransfer.files?.[0]);
                  }}
                  className="rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/60 p-4 text-center space-y-2"
                >
                  {digParsingFile ? (
                    <div className="py-3 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      Reading and preparing file...
                    </div>
                  ) : digUploadedFile ? (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="h-9 w-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
                          <FileText className="w-4 h-4" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                            {digUploadedFile.fileName}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                            {digUploadedFile.storageFormat.toUpperCase()} ·{' '}
                            {formatFileSizeLabel(digUploadedFile.fileSizeBytes)}
                            {digUploadedFile.pageCount ? ` · ${digUploadedFile.pageCount} pages` : ''}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => digFileInputRef.current?.click()}
                        className="min-h-[36px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#161B22] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Choose Different File
                      </button>
                    </div>
                  ) : editingDigital ? (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="h-9 w-9 rounded-xl bg-slate-200/70 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300 shrink-0">
                          <FileText className="w-4 h-4" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                            {editingDigital.fileName || `${editingDigital.title} (attached material)`}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                            {(editingDigital.storageFormat || 'text').toUpperCase()}
                            {editingDigital.fileSizeBytes
                              ? ` · ${formatFileSizeLabel(editingDigital.fileSizeBytes)}`
                              : ''}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => digFileInputRef.current?.click()}
                        className="min-h-[36px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#161B22] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Replace File
                      </button>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-6 h-6 text-emerald-700 dark:text-emerald-400 mx-auto" aria-hidden="true" />
                      <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
                        Drag &amp; drop a book, past paper, or notes file here
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Supports PDF (.pdf), Word (.docx), Text (.txt, .md), or Scanned Image (.png, .jpg) · Max 10 MB
                      </div>
                      <button
                        type="button"
                        onClick={() => digFileInputRef.current?.click()}
                        className="mt-1 inline-flex items-center gap-1.5 min-h-[38px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Select File to Upload</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-7">
                  <label
                    htmlFor="dig-title"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Material Title
                  </label>
                  <input
                    id="dig-title"
                    type="text"
                    required
                    maxLength={140}
                    value={digTitle}
                    onChange={(e) => setDigTitle(e.target.value)}
                    placeholder="e.g. MSCE Physical Science 2024 Past Paper"
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                  />
                </div>
                <div className="sm:col-span-5">
                  <label
                    htmlFor="dig-author"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Author / Department
                  </label>
                  <input
                    id="dig-author"
                    type="text"
                    required
                    maxLength={120}
                    value={digAuthor}
                    onChange={(e) => setDigAuthor(e.target.value)}
                    placeholder="e.g. Science Department"
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label
                    htmlFor="dig-category"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Category
                  </label>
                  <select
                    id="dig-category"
                    value={digCategory}
                    onChange={(e) => setDigCategory(e.target.value as DigitalResourceCategory)}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100"
                  >
                    {DIGITAL_RESOURCE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="dig-subject"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Subject
                  </label>
                  <select
                    id="dig-subject"
                    value={digSubject}
                    onChange={(e) => setDigSubject(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100"
                  >
                    {allSubjectChoices.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="dig-form"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Form Level
                  </label>
                  <select
                    id="dig-form"
                    value={digFormLevel}
                    onChange={(e) =>
                      setDigFormLevel(e.target.value as DigitalResourceFormLevel)
                    }
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100"
                  >
                    {DIGITAL_RESOURCE_FORM_LEVELS.map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {lvl}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="dig-year"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Exam Year / Edition
                  </label>
                  <input
                    id="dig-year"
                    type="text"
                    maxLength={16}
                    value={digExamYear}
                    onChange={(e) => setDigExamYear(e.target.value)}
                    placeholder="2025 or MSCE"
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="dig-summary"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Short Summary (Optional)
                </label>
                <input
                  id="dig-summary"
                  type="text"
                  maxLength={280}
                  value={digSummary}
                  onChange={(e) => setDigSummary(e.target.value)}
                  placeholder="Topics covered, paper sections, or syllabus chapters..."
                  className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                />
              </div>

              <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={digAllowOffline}
                  onChange={(e) => setDigAllowOffline(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                />
                <span>Allow offline reading</span>
              </label>

              {digUploadProgress && (
                <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 px-3.5 py-2.5 text-xs text-emerald-800 dark:text-emerald-300 font-mono tabular-nums">
                  Uploading file chunks: {digUploadProgress.done} / {digUploadProgress.total}
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDigitalModalOpen(false)}
                  disabled={savingDigital}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingDigital || digParsingFile}
                  className="min-h-[42px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-40 cursor-pointer"
                >
                  {savingDigital
                    ? digUploadProgress
                      ? `Uploading (${digUploadProgress.done}/${digUploadProgress.total})...`
                      : 'Saving...'
                    : editingDigital
                    ? 'Save Changes'
                    : 'Upload & Publish'}
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}

      {/* Safe Delete Digital Resource Modal */}
      <ConfirmDeleteModal
        open={Boolean(deleteDigitalTarget)}
        title="Remove Online Library Material"
        itemName={deleteDigitalTarget ? deleteDigitalTarget.title : ''}
        description="This removes this digital book or past paper from both staff and student online libraries."
        confirmLabel="Remove Material"
        deleting={deletingDigital}
        error={deleteDigitalError}
        onCancel={() => {
          if (!deletingDigital) {
            setDeleteDigitalTarget(null);
            setDeleteDigitalError('');
          }
        }}
        onConfirm={handleConfirmDeleteDigital}
      />

      {/* Protected Non-Downloadable Reader Modal */}
      <OnlineLibraryReaderModal
        resource={readerTarget}
        isSavedOffline={readerTarget ? offlineIds.has(readerTarget.id) : false}
        savingOffline={readerTarget ? savingOfflineId === readerTarget.id : false}
        onToggleOffline={handleToggleOfflineDigital}
        scopeKey={staffScopeKey}
        ownerId={ownerId}
        isRead={readerTarget ? Boolean(progressMap[readerTarget.id]?.isRead) : false}
        lastReadPage={readerTarget ? progressMap[readerTarget.id]?.lastReadPage || 0 : 0}
        onlineReadersCount={
          readerTarget ? readingCounts.onlineByResource[readerTarget.id] || 0 : 0
        }
        offlineReadersCount={
          readerTarget ? readingCounts.offlineByResource[readerTarget.id] || 0 : 0
        }
        onToggleRead={(res) => toggleMarkAsRead(res.id)}
        onProgressChange={(resourceId, page, total, mode) =>
          recordPageProgress(resourceId, page, total, mode)
        }
        onClose={() => setReaderTarget(null)}
      />
    </div>
  );
};
