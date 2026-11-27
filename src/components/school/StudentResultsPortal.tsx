import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  Banknote,
  BookmarkCheck,
  BookmarkPlus,
  BookOpen,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  CloudOff,
  Eye,
  FileDown,
  FileText,
  Globe,
  Image as ImageIcon,
  KeyRound,
  LogOut,
  Moon,
  Printer,
  Search,
  Sun,
  Trash2,
  Upload,
  WifiOff,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import {
  createLibraryReservation,
  fetchDigitalResourceBytes,
  flushPendingOfflineReadingSyncs,
  submitStudentFeePaymentReference,
  subscribeLibraryReadingSessions,
} from '../../school/firestoreService';
import { formatFileSizeLabel } from '../../school/digitalMaterialParser';
import {
  parsePaymentProofFile,
  type ParsedPaymentProofFile,
} from '../../school/paymentProofParser';
import {
  calculateTermReportSummary,
  canStudentSeeAnnouncement,
  countStudentAssessmentsByTerm,
  findStudentTermRemark,
  formatMWK,
  getLibraryDaysOverdue,
  getLibraryDueReminderLabel,
  isLibraryLoanDueWithin48Hours,
  isLibraryLoanOverdue,
  isTeacherOnlyDigitalCategory,
  resolveStudentPortalTerm,
  STUDENT_DIGITAL_RESOURCE_CATEGORIES,
  TERMS,
} from '../../school/malawi';
import { buildStudentReportCardPayload } from '../../school/reportCardTemplates';
import {
  getOfflineDigitalResources,
  OfflineDigitalResourceRecord,
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
import { downloadStudentTermReportCardPdf } from '../../school/pdfReports';
import {
  Assessment,
  CatalogBookMirror,
  DigitalLibraryResource,
  DigitalResourceCategory,
  DigitalResourceFormLevel,
  LibraryLoan,
  LibraryReadingSession,
  LibraryReservation,
  PaymentMethod,
  School,
  SchoolAnnouncement,
  Student,
  StudentFeeSubmission,
  StudentPortal,
  StudentPortalFeeInvoice,
  StudentReportRemark,
  TermName,
} from '../../school/types';
import { OfflineIndicator } from '../OfflineIndicator';
import { SubjectComponentBarChart } from './AnalyticsCharts';
import { DraftRestoredNotice, ModalBackdrop } from './ModalBackdrop';
import { OnlineLibraryReaderModal, ReadableDigitalResource } from './OnlineLibraryReaderModal';
import { PaymentProofPreviewModal } from './PaymentProofPreviewModal';
import { StudentPerformanceTrends } from './StudentPerformanceTrends';
import { StudentPortalDashboard } from './StudentPortalDashboard';

type StudentPortalTab = 'dashboard' | 'results' | 'library' | 'fees';

const STUDENT_PAYMENT_METHODS: Extract<
  PaymentMethod,
  'Bank Deposit' | 'Airtel Money' | 'TNM Mpamba'
>[] = ['Bank Deposit', 'Airtel Money', 'TNM Mpamba'];

interface StudentResultsPortalProps {
  registrationCode: string;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onSignOut: () => void;
  hasAdminWorkspace?: boolean;
  onSwitchToAdmin?: () => void;
}

function isFirestoreOfflineError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return msg.includes('offline') || msg.includes('unavailable') || msg.includes('network');
}

function readCachedJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeCachedJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }
}

function toOfflineRecord(
  resource: DigitalLibraryResource,
  fileBytes?: Uint8Array
): OfflineDigitalResourceRecord {
  return {
    id: resource.id,
    schoolId: resource.schoolId,
    title: resource.title,
    author: resource.author,
    subject: resource.subject,
    formLevel: resource.formLevel,
    category: resource.category,
    examYear: resource.examYear || '',
    summary: resource.summary || '',
    content: resource.content,
    storageFormat: resource.storageFormat,
    fileName: resource.fileName,
    mimeType: resource.mimeType,
    fileSizeBytes: resource.fileSizeBytes,
    chunkCount: resource.chunkCount,
    fileBytes,
    allowOffline: resource.allowOffline,
    savedAt: new Date().toISOString(),
  };
}

export const StudentResultsPortal: React.FC<StudentResultsPortalProps> = ({
  registrationCode,
  theme,
  onToggleTheme,
  onSignOut,
  hasAdminWorkspace = false,
  onSwitchToAdmin,
}) => {
  const isOnline = useOnlineStatus();
  const [activeTab, setActiveTab] = useState<StudentPortalTab>('dashboard');
  const [portalLoading, setPortalLoading] = useState(true);
  const [activePortal, setActivePortal] = useState<StudentPortal | null>(() =>
    registrationCode ? readCachedJson<StudentPortal>(`malawisec_student_portal_${registrationCode}`) : null
  );
  const [selectedTerm, setSelectedTerm] = useState<TermName>('Term 2');
  const [manualTermSelected, setManualTermSelected] = useState(false);
  const [termInitializedForCode, setTermInitializedForCode] = useState<string>('');
  const [pdfFeedback, setPdfFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [assessments, setAssessments] = useState<Assessment[]>(() =>
    registrationCode ? readCachedJson<Assessment[]>(`malawisec_student_results_${registrationCode}`) || [] : []
  );
  const [loadingResults, setLoadingResults] = useState(true);
  const [reportRemarks, setReportRemarks] = useState<StudentReportRemark[]>(() =>
    registrationCode
      ? readCachedJson<StudentReportRemark[]>(`malawisec_student_remarks_${registrationCode}`) || []
      : []
  );
  const [libraryLoans, setLibraryLoans] = useState<LibraryLoan[]>(() =>
    registrationCode ? readCachedJson<LibraryLoan[]>(`malawisec_student_loans_${registrationCode}`) || [] : []
  );
  const [loadingLibrary, setLoadingLibrary] = useState(true);

  // Fees & Payment Reference Uploads
  const [feeInvoices, setFeeInvoices] = useState<StudentPortalFeeInvoice[]>(() =>
    registrationCode
      ? readCachedJson<StudentPortalFeeInvoice[]>(`malawisec_student_fees_${registrationCode}`) || []
      : []
  );
  const [loadingFees, setLoadingFees] = useState(true);
  const [feeSubmissions, setFeeSubmissions] = useState<StudentFeeSubmission[]>(() =>
    registrationCode
      ? readCachedJson<StudentFeeSubmission[]>(`malawisec_student_fee_subs_${registrationCode}`) || []
      : []
  );
  const [loadingFeeSubmissions, setLoadingFeeSubmissions] = useState(true);
  const [proofInvoiceId, setProofInvoiceId] = useState<string>('');
  const [proofTerm, setProofTerm] = useState<TermName>('Term 2');
  const [proofMethod, setProofMethod] = useState<'Bank Deposit' | 'Airtel Money' | 'TNM Mpamba'>(
    'Bank Deposit'
  );
  const [proofAmountStr, setProofAmountStr] = useState('');
  const [proofReference, setProofReference] = useState('');
  const [proofNotes, setProofNotes] = useState('');
  const [parsedProofFile, setParsedProofFile] = useState<ParsedPaymentProofFile | null>(null);
  const [proofFileDragActive, setProofFileDragActive] = useState(false);
  const [proofFileError, setProofFileError] = useState('');
  const [submittingProof, setSubmittingProof] = useState(false);
  const [proofProgress, setProofProgress] = useState('');
  const [proofSubmitError, setProofSubmitError] = useState('');
  const [proofSubmitSuccess, setProofSubmitSuccess] = useState('');
  const [previewSubmission, setPreviewSubmission] = useState<StudentFeeSubmission | null>(null);

  // Physical Catalog & Reservations
  const [catalogBooks, setCatalogBooks] = useState<CatalogBookMirror[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogFilter, setCatalogFilter] = useState<'all' | 'checked_out' | 'available'>('all');
  const [reservations, setReservations] = useState<LibraryReservation[]>([]);
  const [loadingReservations, setLoadingReservations] = useState(true);
  const [reserveModalBook, setReserveModalBook] = useState<CatalogBookMirror | null>(null);
  const [reserveNotes, setReserveNotes] = useState('');
  const [reserveDraftRestored, setReserveDraftRestored] = useState(false);
  const [submittingReservation, setSubmittingReservation] = useState(false);
  const [reservationError, setReservationError] = useState('');
  const [reservationFeedback, setReservationFeedback] = useState('');

  // Online / Offline Non-Downloadable Library
  const [liveDigitalResources, setLiveDigitalResources] = useState<DigitalLibraryResource[]>([]);
  const [offlineDigitalRecords, setOfflineDigitalRecords] = useState<OfflineDigitalResourceRecord[]>([]);
  const [loadingDigitalLibrary, setLoadingDigitalLibrary] = useState(true);
  const [digitalSearch, setDigitalSearch] = useState('');
  const [digitalSubjectFilter, setDigitalSubjectFilter] = useState<string>('All');
  const [digitalCategoryFilter, setDigitalCategoryFilter] = useState<
    'All' | DigitalResourceCategory | 'Saved Offline'
  >('All');
  const [digitalFormFilter, setDigitalFormFilter] = useState<'All' | DigitalResourceFormLevel>('All');
  const [activeReaderResource, setActiveReaderResource] = useState<ReadableDigitalResource | null>(null);
  const [savingOfflineId, setSavingOfflineId] = useState<string | null>(null);
  const [savingAllOffline, setSavingAllOffline] = useState(false);
  const [offlineSyncFeedback, setOfflineSyncFeedback] = useState('');
  const [readingSessions, setReadingSessions] = useState<LibraryReadingSession[]>([]);
  const [announcements, setAnnouncements] = useState<SchoolAnnouncement[]>([]);

  // Student Portal Password / PIN Management
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [passwordModalSaving, setPasswordModalSaving] = useState(false);
  const [passwordModalError, setPasswordModalError] = useState('');
  const [passwordModalSuccess, setPasswordModalSuccess] = useState('');

  const studentScopeKey = `student:${registrationCode}`;
  const {
    progressMap,
    counts: readingCounts,
    toggleMarkAsRead,
    recordPageProgress,
  } = useLibraryReadingProgress(
    studentScopeKey,
    activePortal?.schoolId || '',
    readingSessions
  );

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Load Student Portal document (with offline cache fallback)
  useEffect(() => {
    if (!registrationCode) {
      setActivePortal(null);
      setPortalLoading(false);
      return;
    }

    const cached = readCachedJson<StudentPortal>(`malawisec_student_portal_${registrationCode}`);
    if (cached) {
      setActivePortal(cached);
      setPortalLoading(false);
    } else {
      setPortalLoading(true);
    }

    const portalRef = doc(db, 'studentPortals', registrationCode);
    const unsub = onSnapshot(
      portalRef,
      (snap) => {
        if (snap.exists()) {
          const portal = { id: snap.id, ...(snap.data() as Omit<StudentPortal, 'id'>) };
          setActivePortal(portal);
          writeCachedJson(`malawisec_student_portal_${registrationCode}`, portal);
        } else {
          setActivePortal(null);
        }
        setPortalLoading(false);
      },
      (err) => {
        setPortalLoading(false);
        if (isFirestoreOfflineError(err)) {
          if (cached) setActivePortal(cached);
          return;
        }
        handleFirestoreError(err, OperationType.GET, `studentPortals/${registrationCode}`);
      }
    );

    return () => unsub();
  }, [registrationCode]);

  useEffect(() => {
    if (activePortal && termInitializedForCode !== activePortal.registrationCode) {
      setManualTermSelected(false);
      setPdfFeedback(null);
      setSelectedTerm(activePortal.currentTerm);
      setProofTerm(activePortal.currentTerm);
      setActiveTab('dashboard');
      setTermInitializedForCode(activePortal.registrationCode);
    }
  }, [activePortal, termInitializedForCode]);

  useEffect(() => {
    if (!activePortal || loadingResults || manualTermSelected || assessments.length === 0) return;
    if (assessments.some((a) => a.term === selectedTerm)) return;
    const resolved = resolveStudentPortalTerm(activePortal.currentTerm, assessments);
    if (resolved !== selectedTerm) {
      setSelectedTerm(resolved);
    }
  }, [activePortal, assessments, loadingResults, manualTermSelected, selectedTerm]);

  const handleSelectTerm = (nextTerm: TermName) => {
    setManualTermSelected(true);
    setSelectedTerm(nextTerm);
    setPdfFeedback(null);
  };

  // Load Exam Results (with offline cache fallback)
  useEffect(() => {
    if (!registrationCode || !activePortal) {
      setAssessments([]);
      setLoadingResults(false);
      return;
    }

    const cachedResults =
      readCachedJson<Assessment[]>(`malawisec_student_results_${registrationCode}`) || [];
    if (cachedResults.length > 0) {
      setAssessments(cachedResults);
      setLoadingResults(false);
    } else {
      setLoadingResults(true);
    }

    const resultsQuery = query(
      collection(db, 'studentPortals', registrationCode, 'results'),
      where('registrationCode', '==', registrationCode)
    );
    const unsub = onSnapshot(
      resultsQuery,
      (snap) => {
        const docs = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Assessment, 'id'>) }))
          .filter((a) => a.studentId === activePortal.studentId);
        setAssessments(docs);
        writeCachedJson(`malawisec_student_results_${registrationCode}`, docs);
        setLoadingResults(false);
      },
      (err) => {
        setLoadingResults(false);
        if (isFirestoreOfflineError(err)) {
          if (cachedResults.length > 0) setAssessments(cachedResults);
          return;
        }
        handleFirestoreError(
          err,
          OperationType.LIST,
          `studentPortals/${registrationCode}/results`
        );
      }
    );

    return () => unsub();
  }, [activePortal, registrationCode]);

  // Load Published Term Report Card Remarks (with offline cache fallback)
  useEffect(() => {
    if (!registrationCode || !activePortal) {
      setReportRemarks([]);
      return;
    }

    const cacheKey = `malawisec_student_remarks_${registrationCode}`;
    const cachedRemarks = readCachedJson<StudentReportRemark[]>(cacheKey) || [];
    if (cachedRemarks.length > 0) {
      setReportRemarks(cachedRemarks);
    }

    const remarksQuery = query(
      collection(db, 'studentPortals', registrationCode, 'reportRemarks'),
      where('registrationCode', '==', registrationCode)
    );
    const unsub = onSnapshot(
      remarksQuery,
      (snap) => {
        const docs = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<StudentReportRemark, 'id'>) }))
          .filter((r) => r.studentId === activePortal.studentId);
        setReportRemarks(docs);
        writeCachedJson(cacheKey, docs);
      },
      (err) => {
        if (isFirestoreOfflineError(err)) {
          if (cachedRemarks.length > 0) setReportRemarks(cachedRemarks);
          return;
        }
        handleFirestoreError(
          err,
          OperationType.LIST,
          `studentPortals/${registrationCode}/reportRemarks`
        );
      }
    );

    return () => unsub();
  }, [activePortal, registrationCode]);

  // Load Student Assigned Library Loans (with offline cache fallback)
  useEffect(() => {
    if (!registrationCode || !activePortal) {
      setLibraryLoans([]);
      setLoadingLibrary(false);
      return;
    }

    const cachedLoans =
      readCachedJson<LibraryLoan[]>(`malawisec_student_loans_${registrationCode}`) || [];
    if (cachedLoans.length > 0) {
      setLibraryLoans(cachedLoans);
      setLoadingLibrary(false);
    } else {
      setLoadingLibrary(true);
    }

    const loansQuery = query(
      collection(db, 'studentPortals', registrationCode, 'libraryLoans'),
      where('registrationCode', '==', registrationCode)
    );
    const unsub = onSnapshot(
      loansQuery,
      (snap) => {
        const docs = snap.docs
          .map((d) => ({
            id: d.id,
            admissionNo: activePortal.admissionNo,
            ...(d.data() as Omit<LibraryLoan, 'id' | 'admissionNo'>),
          }))
          .filter((l) => l.studentId === activePortal.studentId)
          .sort((a, b) => {
            if (a.status !== b.status) return a.status === 'Checked Out' ? -1 : 1;
            if (a.status === 'Checked Out') return a.dueDate.localeCompare(b.dueDate);
            return b.checkoutDate.localeCompare(a.checkoutDate);
          });
        setLibraryLoans(docs);
        writeCachedJson(`malawisec_student_loans_${registrationCode}`, docs);
        setLoadingLibrary(false);
      },
      (err) => {
        setLoadingLibrary(false);
        if (isFirestoreOfflineError(err)) {
          if (cachedLoans.length > 0) setLibraryLoans(cachedLoans);
          return;
        }
        handleFirestoreError(
          err,
          OperationType.LIST,
          `studentPortals/${registrationCode}/libraryLoans`
        );
      }
    );

    return () => unsub();
  }, [activePortal, registrationCode]);

  // Load Student Fee Invoices (with offline cache fallback)
  useEffect(() => {
    if (!registrationCode || !activePortal) {
      setFeeInvoices([]);
      setLoadingFees(false);
      return;
    }

    const cachedFees =
      readCachedJson<StudentPortalFeeInvoice[]>(`malawisec_student_fees_${registrationCode}`) || [];
    if (cachedFees.length > 0) {
      setFeeInvoices(cachedFees);
      setLoadingFees(false);
    } else {
      setLoadingFees(true);
    }

    const feeQuery = query(
      collection(db, 'studentPortals', registrationCode, 'feeInvoices'),
      where('registrationCode', '==', registrationCode)
    );
    const unsub = onSnapshot(
      feeQuery,
      (snap) => {
        const docs = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<StudentPortalFeeInvoice, 'id'>) }))
          .filter((inv) => inv.studentId === activePortal.studentId)
          .sort((a, b) => {
            const termDiff = TERMS.indexOf(b.term) - TERMS.indexOf(a.term);
            if (termDiff !== 0) return termDiff;
            return (b.academicYear || '').localeCompare(a.academicYear || '');
          });
        setFeeInvoices(docs);
        writeCachedJson(`malawisec_student_fees_${registrationCode}`, docs);
        setLoadingFees(false);
      },
      (err) => {
        setLoadingFees(false);
        if (isFirestoreOfflineError(err)) {
          if (cachedFees.length > 0) setFeeInvoices(cachedFees);
          return;
        }
        handleFirestoreError(
          err,
          OperationType.LIST,
          `studentPortals/${registrationCode}/feeInvoices`
        );
      }
    );

    return () => unsub();
  }, [activePortal, registrationCode]);

  // Load Student Fee Payment Proof Submissions (with offline cache fallback)
  useEffect(() => {
    if (!registrationCode || !activePortal) {
      setFeeSubmissions([]);
      setLoadingFeeSubmissions(false);
      return;
    }

    const cachedSubs =
      readCachedJson<StudentFeeSubmission[]>(`malawisec_student_fee_subs_${registrationCode}`) || [];
    if (cachedSubs.length > 0) {
      setFeeSubmissions(cachedSubs);
      setLoadingFeeSubmissions(false);
    } else {
      setLoadingFeeSubmissions(true);
    }

    const subQuery = query(
      collection(db, 'studentPortals', registrationCode, 'feeSubmissions'),
      where('registrationCode', '==', registrationCode)
    );
    const unsub = onSnapshot(
      subQuery,
      (snap) => {
        const docs = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<StudentFeeSubmission, 'id'>) }))
          .filter((sub) => sub.studentId === activePortal.studentId)
          .sort((a, b) => {
            const tA = a.createdAt?.toMillis?.() || 0;
            const tB = b.createdAt?.toMillis?.() || 0;
            if (tA !== tB) return tB - tA;
            return (b.submittedDate || '').localeCompare(a.submittedDate || '');
          });
        setFeeSubmissions(docs);
        writeCachedJson(`malawisec_student_fee_subs_${registrationCode}`, docs);
        setLoadingFeeSubmissions(false);
      },
      (err) => {
        setLoadingFeeSubmissions(false);
        if (isFirestoreOfflineError(err)) {
          if (cachedSubs.length > 0) setFeeSubmissions(cachedSubs);
          return;
        }
        handleFirestoreError(
          err,
          OperationType.LIST,
          `studentPortals/${registrationCode}/feeSubmissions`
        );
      }
    );

    return () => unsub();
  }, [activePortal, registrationCode]);

  // Hydrate Offline IndexedDB Digital Library (purging any legacy raw-text entries first)
  useEffect(() => {
    let cancelled = false;
    if (!activePortal?.schoolId) {
      setOfflineDigitalRecords([]);
      return;
    }
    purgeOfflineRawTextResources(activePortal.schoolId)
      .then(() => getOfflineDigitalResources(activePortal.schoolId))
      .then((records) => {
        if (!cancelled) {
          setOfflineDigitalRecords(records);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activePortal?.schoolId]);

  // Subscribe to real online/offline reading sessions for student's school
  useEffect(() => {
    const schoolId = activePortal?.schoolId;
    if (!schoolId) {
      setReadingSessions([]);
      return;
    }
    const unsub = subscribeLibraryReadingSessions(schoolId, setReadingSessions);
    void flushPendingOfflineReadingSyncs(schoolId);
    const onReconnect = () => {
      void flushPendingOfflineReadingSyncs(schoolId);
    };
    window.addEventListener('online', onReconnect);
    return () => {
      unsub();
      window.removeEventListener('online', onReconnect);
    };
  }, [activePortal?.schoolId]);

  // Subscribe to Physical Book Catalog Mirror (for Reservations)
  useEffect(() => {
    if (!activePortal?.schoolId) {
      setCatalogBooks([]);
      setLoadingCatalog(false);
      return;
    }

    setLoadingCatalog(true);
    const catalogQuery = query(
      collection(db, 'studentLibraries', activePortal.schoolId, 'books'),
      where('schoolId', '==', activePortal.schoolId)
    );
    const unsub = onSnapshot(
      catalogQuery,
      (snap) => {
        const docs = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<CatalogBookMirror, 'id'>) }))
          .sort((a, b) => a.title.localeCompare(b.title));
        setCatalogBooks(docs);
        setLoadingCatalog(false);
      },
      (err) => {
        setLoadingCatalog(false);
        if (isFirestoreOfflineError(err)) return;
        handleFirestoreError(
          err,
          OperationType.LIST,
          `studentLibraries/${activePortal.schoolId}/books`
        );
      }
    );

    return () => unsub();
  }, [activePortal?.schoolId]);

  // Subscribe to Student Reservations
  useEffect(() => {
    if (!registrationCode || !activePortal) {
      setReservations([]);
      setLoadingReservations(false);
      return;
    }

    setLoadingReservations(true);
    const resQuery = query(
      collection(db, 'studentPortals', registrationCode, 'reservations'),
      where('registrationCode', '==', registrationCode)
    );
    const unsub = onSnapshot(
      resQuery,
      (snap) => {
        const docs = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<LibraryReservation, 'id'>) }))
          .filter((r) => r.studentId === activePortal.studentId)
          .sort((a, b) => {
            const rank: Record<LibraryReservation['status'], number> = {
              Ready: 0,
              Pending: 1,
              Fulfilled: 2,
              Cancelled: 3,
            };
            const diff = rank[a.status] - rank[b.status];
            if (diff !== 0) return diff;
            return b.requestedDate.localeCompare(a.requestedDate);
          });
        setReservations(docs);
        setLoadingReservations(false);
      },
      (err) => {
        setLoadingReservations(false);
        if (isFirestoreOfflineError(err)) return;
        handleFirestoreError(
          err,
          OperationType.LIST,
          `studentPortals/${registrationCode}/reservations`
        );
      }
    );

    return () => unsub();
  }, [activePortal, registrationCode]);

  // Subscribe to Online Digital Library (books & past papers, zero-PII mirror)
  useEffect(() => {
    if (!activePortal?.schoolId) {
      setLiveDigitalResources([]);
      setLoadingDigitalLibrary(false);
      return;
    }

    setLoadingDigitalLibrary(true);
    const digitalQuery = query(
      collection(db, 'studentLibraries', activePortal.schoolId, 'digitalResources'),
      where('schoolId', '==', activePortal.schoolId)
    );
    const unsub = onSnapshot(
      digitalQuery,
      (snap) => {
        const docs = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<DigitalLibraryResource, 'id'>) }))
          .filter((item) => !isTeacherOnlyDigitalCategory(item.category))
          .sort((a, b) => a.title.localeCompare(b.title));
        setLiveDigitalResources(docs);
        setLoadingDigitalLibrary(false);
      },
      (err) => {
        setLoadingDigitalLibrary(false);
        if (isFirestoreOfflineError(err)) return;
        handleFirestoreError(
          err,
          OperationType.LIST,
          `studentLibraries/${activePortal.schoolId}/digitalResources`
        );
      }
    );

    return () => unsub();
  }, [activePortal?.schoolId]);

  // Subscribe to Student-Visible School Announcements (zero-PII mirror, offline cached)
  useEffect(() => {
    if (!activePortal?.schoolId) {
      setAnnouncements([]);
      return;
    }

    const filterStudentAnnouncements = (items: SchoolAnnouncement[]) =>
      items
        .filter((a) => canStudentSeeAnnouncement(a.targetAudiences))
        .sort((a, b) => {
          const dateCmp = (b.publishedDate || '').localeCompare(a.publishedDate || '');
          if (dateCmp !== 0) return dateCmp;
          const tA = a.createdAt?.toMillis?.() || 0;
          const tB = b.createdAt?.toMillis?.() || 0;
          return tB - tA;
        });

    const cacheKey = `malawisec_student_announcements_${activePortal.schoolId}`;
    const cached = filterStudentAnnouncements(readCachedJson<SchoolAnnouncement[]>(cacheKey) || []);
    if (cached.length > 0) {
      setAnnouncements(cached);
    }

    const annQuery = query(
      collection(db, 'studentLibraries', activePortal.schoolId, 'announcements'),
      where('targetAudiences', 'array-contains', 'Students')
    );
    const unsub = onSnapshot(
      annQuery,
      (snap) => {
        const docs = filterStudentAnnouncements(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SchoolAnnouncement, 'id'>) }))
        );
        setAnnouncements(docs);
        writeCachedJson(cacheKey, docs);
      },
      (err) => {
        if (isFirestoreOfflineError(err)) {
          if (cached.length > 0) setAnnouncements(cached);
          return;
        }
        handleFirestoreError(
          err,
          OperationType.LIST,
          `studentLibraries/${activePortal.schoolId}/announcements`
        );
      }
    );

    return () => unsub();
  }, [activePortal?.schoolId]);

  const offlineIds = useMemo(
    () => new Set(offlineDigitalRecords.map((r) => r.id)),
    [offlineDigitalRecords]
  );

  const offlineIdsKey = useMemo(
    () => Array.from(offlineIds).sort().join(','),
    [offlineIds]
  );

  // Refresh already-saved offline items whenever live metadata updates (preserving cached binary bytes)
  useEffect(() => {
    if (!activePortal?.schoolId || liveDigitalResources.length === 0 || !offlineIdsKey) {
      return;
    }
    let cancelled = false;
    getOfflineDigitalResources(activePortal.schoolId).then((cachedList) => {
      if (cancelled) return;
      const existingById = new Map(cachedList.map((r) => [r.id, r]));
      const toRefresh = liveDigitalResources
        .filter((item) => item.allowOffline && existingById.has(item.id))
        .map((item) => toOfflineRecord(item, existingById.get(item.id)?.fileBytes));
      if (toRefresh.length === 0) return;

      saveDigitalResourcesBatchOffline(toRefresh).then((count) => {
        if (!cancelled && count > 0) {
          getOfflineDigitalResources(activePortal.schoolId).then((updated) => {
            if (!cancelled) setOfflineDigitalRecords(updated);
          });
        }
      });
    });

    return () => {
      cancelled = true;
    };
  }, [activePortal?.schoolId, liveDigitalResources, offlineIdsKey]);

  const mergedDigitalResources = useMemo<ReadableDigitalResource[]>(() => {
    if (liveDigitalResources.length === 0) {
      return offlineDigitalRecords.filter((item) => !isTeacherOnlyDigitalCategory(item.category));
    }
    const byId = new Map<string, ReadableDigitalResource>();
    for (const item of liveDigitalResources) {
      if (!isTeacherOnlyDigitalCategory(item.category)) {
        byId.set(item.id, item);
      }
    }
    for (const cached of offlineDigitalRecords) {
      if (!isTeacherOnlyDigitalCategory(cached.category) && !byId.has(cached.id)) {
        byId.set(cached.id, cached);
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.title.localeCompare(b.title));
  }, [liveDigitalResources, offlineDigitalRecords]);

  const digitalSubjects = useMemo(() => {
    const unique = new Set<string>();
    for (const r of mergedDigitalResources) {
      const subj = (r.subject || '').trim();
      if (subj) unique.add(subj);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [mergedDigitalResources]);

  const filteredDigitalResources = useMemo(() => {
    const tokens = digitalSearch
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return mergedDigitalResources.filter((r) => {
      if (digitalCategoryFilter === 'Saved Offline') {
        if (!offlineIds.has(r.id)) return false;
      } else if (digitalCategoryFilter !== 'All' && r.category !== digitalCategoryFilter) {
        return false;
      }
      if (
        digitalSubjectFilter !== 'All' &&
        (r.subject || '').trim().toLowerCase() !== digitalSubjectFilter.toLowerCase()
      ) {
        return false;
      }
      if (digitalFormFilter !== 'All' && r.formLevel !== 'All' && r.formLevel !== digitalFormFilter) {
        return false;
      }
      if (tokens.length === 0) return true;
      const searchable = [
        r.title,
        r.subject,
        r.author,
        r.category,
        r.formLevel,
        r.examYear || '',
        r.fileName || '',
        r.summary || '',
      ]
        .join(' ')
        .toLowerCase();
      return tokens.every((tok) => searchable.includes(tok));
    });
  }, [
    digitalCategoryFilter,
    digitalFormFilter,
    digitalSearch,
    digitalSubjectFilter,
    mergedDigitalResources,
    offlineIds,
  ]);

  const activeReservationByBookId = useMemo(() => {
    const map = new Map<string, LibraryReservation>();
    for (const r of reservations) {
      if (r.status === 'Pending' || r.status === 'Ready') {
        map.set(r.bookId, r);
      }
    }
    return map;
  }, [reservations]);

  const filteredCatalogBooks = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return catalogBooks.filter((b) => {
      if (catalogFilter === 'checked_out' && b.availableCopies > 0) return false;
      if (catalogFilter === 'available' && b.availableCopies === 0) return false;
      if (!q) return true;
      return (
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.isbn.toLowerCase().includes(q) ||
        b.subject.toLowerCase().includes(q)
      );
    });
  }, [catalogBooks, catalogFilter, catalogSearch]);

  const termCounts = useMemo(
    () => countStudentAssessmentsByTerm(assessments),
    [assessments]
  );

  const fallbackTermWithMarks = useMemo<TermName | null>(() => {
    if (termCounts[selectedTerm] > 0) return null;
    const candidate = resolveStudentPortalTerm(selectedTerm, assessments);
    return termCounts[candidate] > 0 ? candidate : null;
  }, [assessments, selectedTerm, termCounts]);

  const termAssessments = useMemo(
    () => assessments.filter((a) => a.term === selectedTerm),
    [assessments, selectedTerm]
  );

  const summary = useMemo(() => {
    if (!activePortal) return null;
    return calculateTermReportSummary(activePortal.formLevel, termAssessments);
  }, [activePortal, termAssessments]);

  const activeTermRemark = useMemo(() => {
    if (!activePortal) return null;
    return findStudentTermRemark(
      reportRemarks,
      activePortal.studentId,
      selectedTerm,
      activePortal.academicYear
    );
  }, [activePortal, reportRemarks, selectedTerm]);

  const reportCardPayload = useMemo(() => {
    if (!activePortal || !summary || summary.rows.length === 0) return null;
    const viewSchool: School = {
      id: activePortal.schoolId,
      ownerId: activePortal.ownerId,
      name: activePortal.schoolName,
      district: activePortal.schoolDistrict,
      schoolType: activePortal.schoolType,
      motto: activePortal.motto,
      academicYear: activePortal.academicYear,
      currentTerm: activePortal.currentTerm,
      defaultTuitionMWK: 0,
      defaultGpfMWK: 0,
      defaultExamFeeMWK: 0,
      logoDataUrl: activePortal.logoDataUrl,
    };
    const viewStudent: Student = {
      id: activePortal.studentId,
      ownerId: activePortal.ownerId,
      admissionNo: activePortal.admissionNo,
      fullName: activePortal.studentName,
      gender: 'Female',
      formLevel: activePortal.formLevel,
      stream: activePortal.stream,
      boardingStatus: activePortal.boardingStatus,
      guardianName: '',
      guardianPhone: '',
      registrationCode: activePortal.registrationCode,
      status: activePortal.status,
    };
    return buildStudentReportCardPayload({
      school: viewSchool,
      student: viewStudent,
      term: selectedTerm,
      summary,
      formTeacherRemark: activeTermRemark?.formTeacherRemark || undefined,
      headTeacherRemark: activeTermRemark?.headTeacherRemark || undefined,
      formTeacherName: activeTermRemark?.formTeacherName || undefined,
      headTeacherName: activeTermRemark?.headTeacherName || undefined,
      nextTermOpens: activeTermRemark?.nextTermOpens || undefined,
    });
  }, [activePortal, activeTermRemark, selectedTerm, summary]);

  const libraryAlerts = useMemo(() => {
    const dueSoonLoans = libraryLoans.filter((l) => isLibraryLoanDueWithin48Hours(l, todayIso));
    const overdueLoans = libraryLoans.filter((l) => isLibraryLoanOverdue(l, todayIso));
    return { dueSoonLoans, overdueLoans };
  }, [libraryLoans, todayIso]);

  const feeTotals = useMemo(() => {
    const billed = feeInvoices.reduce((s, inv) => s + inv.totalBilled, 0);
    const paid = feeInvoices.reduce((s, inv) => s + inv.totalPaid, 0);
    const balance = Math.max(0, billed - paid);
    const pendingProofs = feeSubmissions.filter((sub) => sub.status === 'Pending').length;
    return { billed, paid, balance, pendingProofs };
  }, [feeInvoices, feeSubmissions]);

  const activeBorrowedLoansCount = useMemo(
    () => libraryLoans.filter((l) => l.status === 'Checked Out').length,
    [libraryLoans]
  );

  const readyReservationsCount = useMemo(
    () => reservations.filter((r) => r.status === 'Ready').length,
    [reservations]
  );

  useEffect(() => {
    if (feeInvoices.length === 0) return;
    if (proofInvoiceId && feeInvoices.some((inv) => inv.id === proofInvoiceId)) return;
    const unpaid = feeInvoices.find((inv) => inv.totalBilled > inv.totalPaid) || feeInvoices[0];
    if (unpaid) {
      setProofInvoiceId(unpaid.id);
      setProofTerm(unpaid.term);
      const rem = Math.max(0, unpaid.totalBilled - unpaid.totalPaid);
      if (!proofAmountStr && rem > 0) {
        setProofAmountStr(String(rem));
      }
    }
  }, [feeInvoices, proofAmountStr, proofInvoiceId]);

  const handleSelectProofInvoice = (nextInvoiceId: string) => {
    setProofInvoiceId(nextInvoiceId);
    const matched = feeInvoices.find((inv) => inv.id === nextInvoiceId);
    if (matched) {
      setProofTerm(matched.term);
      const rem = Math.max(0, matched.totalBilled - matched.totalPaid);
      if (rem > 0) {
        setProofAmountStr(String(rem));
      }
    }
  };

  const handleProofFileSelected = async (file: File | null) => {
    setProofFileError('');
    setProofSubmitError('');
    setProofSubmitSuccess('');
    if (!file) return;
    try {
      const parsed = await parsePaymentProofFile(file);
      setParsedProofFile(parsed);
    } catch (err) {
      setParsedProofFile(null);
      setProofFileError(err instanceof Error ? err.message : 'Unable to read file.');
    }
  };

  const handleSubmitPaymentProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePortal) return;
    setProofSubmitError('');
    setProofSubmitSuccess('');

    if (!isOnline) {
      setProofSubmitError('Connect to the internet to upload a payment reference.');
      return;
    }
    if (!parsedProofFile) {
      setProofSubmitError('Select a PDF or image payment slip/screenshot first.');
      return;
    }
    const amount = Math.round(Number(proofAmountStr) || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      setProofSubmitError('Enter the amount paid in MWK (greater than 0).');
      return;
    }

    setSubmittingProof(true);
    setProofProgress('Uploading...');
    try {
      const selectedInv = feeInvoices.find((inv) => inv.id === proofInvoiceId);
      await submitStudentFeePaymentReference(
        {
          ownerId: activePortal.ownerId,
          schoolId: activePortal.schoolId,
          studentId: activePortal.studentId,
          studentName: activePortal.studentName,
          admissionNo: activePortal.admissionNo,
          formLevel: activePortal.formLevel,
          stream: activePortal.stream,
          registrationCode: activePortal.registrationCode,
          invoiceId: selectedInv?.id || '',
          term: selectedInv ? selectedInv.term : proofTerm,
          academicYear: selectedInv?.academicYear || activePortal.academicYear,
          amount,
          method: proofMethod,
          reference: proofReference.trim(),
          notes: proofNotes.trim(),
          fileName: parsedProofFile.fileName,
          mimeType: parsedProofFile.mimeType,
          fileFormat: parsedProofFile.fileFormat,
          fileSizeBytes: parsedProofFile.fileSizeBytes,
          fileBytes: parsedProofFile.fileBytes,
        },
        (done, total) => {
          setProofProgress(`Uploading ${done}/${total}...`);
        }
      );

      setParsedProofFile(null);
      setProofReference('');
      setProofNotes('');
      setProofProgress('');
      setProofSubmitSuccess('Payment reference submitted to the School Bursar for verification.');
    } catch (err) {
      setProofSubmitError(
        err instanceof Error ? err.message : 'Unable to upload payment reference.'
      );
    } finally {
      setSubmittingProof(false);
      setProofProgress('');
    }
  };

  const handleDownloadPdf = () => {
    if (!activePortal || !summary || summary.rows.length === 0) return;
    setPdfFeedback(null);
    const viewSchool: School = {
      id: activePortal.schoolId,
      ownerId: activePortal.ownerId,
      name: activePortal.schoolName,
      district: activePortal.schoolDistrict,
      schoolType: activePortal.schoolType,
      motto: activePortal.motto,
      academicYear: activePortal.academicYear,
      currentTerm: activePortal.currentTerm,
      defaultTuitionMWK: 0,
      defaultGpfMWK: 0,
      defaultExamFeeMWK: 0,
      logoDataUrl: activePortal.logoDataUrl,
    };
    const viewStudent: Student = {
      id: activePortal.studentId,
      ownerId: activePortal.ownerId,
      admissionNo: activePortal.admissionNo,
      fullName: activePortal.studentName,
      gender: 'Female',
      formLevel: activePortal.formLevel,
      stream: activePortal.stream,
      boardingStatus: activePortal.boardingStatus,
      guardianName: '',
      guardianPhone: '',
      registrationCode: activePortal.registrationCode,
      status: activePortal.status,
    };
    try {
      downloadStudentTermReportCardPdf({
        school: viewSchool,
        student: viewStudent,
        term: selectedTerm,
        summary,
        formTeacherRemark: activeTermRemark?.formTeacherRemark || undefined,
        headTeacherRemark: activeTermRemark?.headTeacherRemark || undefined,
        nextTermOpens: activeTermRemark?.nextTermOpens || undefined,
      });
      setPdfFeedback({
        type: 'success',
        text: `${selectedTerm} Report Card PDF downloaded.`,
      });
    } catch (err) {
      setPdfFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to generate Report Card PDF right now.',
      });
    }
  };

  const handleToggleOfflineResource = async (resource: ReadableDigitalResource) => {
    if (!activePortal?.schoolId || !resource.allowOffline) return;
    setSavingOfflineId(resource.id);
    setOfflineSyncFeedback('');
    try {
      if (offlineIds.has(resource.id)) {
        await removeOfflineDigitalResource(resource.id);
        setOfflineSyncFeedback(`Removed "${resource.title}" from offline storage.`);
      } else {
        let fileBytes: Uint8Array | undefined =
          'fileBytes' in resource && resource.fileBytes instanceof Uint8Array
            ? resource.fileBytes
            : undefined;
        if (!fileBytes && resource.chunkCount && resource.chunkCount > 0) {
          const fetched = await fetchDigitalResourceBytes(activePortal.schoolId, resource.id);
          if (fetched) fileBytes = fetched;
        }
        const saved = await saveDigitalResourceOffline({
          id: resource.id,
          schoolId: activePortal.schoolId,
          title: resource.title,
          author: resource.author,
          subject: resource.subject,
          formLevel: resource.formLevel,
          category: resource.category,
          examYear: resource.examYear || '',
          summary: resource.summary || '',
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
        setOfflineSyncFeedback(
          saved
            ? `"${resource.title}" saved in-app for offline revision.`
            : 'Offline browser storage is unavailable on this device.'
        );
      }
      const nextRecords = await getOfflineDigitalResources(activePortal.schoolId);
      setOfflineDigitalRecords(nextRecords);
    } finally {
      setSavingOfflineId(null);
    }
  };

  const handleSaveAllOffline = async () => {
    if (!activePortal?.schoolId || mergedDigitalResources.length === 0) return;
    setSavingAllOffline(true);
    setOfflineSyncFeedback('');
    try {
      const eligibleRaw = mergedDigitalResources.filter((r) => r.allowOffline);
      const eligible = await Promise.all(
        eligibleRaw.map(async (r) => {
          let fileBytes: Uint8Array | undefined =
            'fileBytes' in r && r.fileBytes instanceof Uint8Array ? r.fileBytes : undefined;
          if (!fileBytes && r.chunkCount && r.chunkCount > 0) {
            const fetched = await fetchDigitalResourceBytes(activePortal.schoolId, r.id);
            if (fetched) fileBytes = fetched;
          }
          return {
            id: r.id,
            schoolId: activePortal.schoolId,
            title: r.title,
            author: r.author,
            subject: r.subject,
            formLevel: r.formLevel,
            category: r.category,
            examYear: r.examYear || '',
            summary: r.summary || '',
            content: r.content,
            storageFormat: r.storageFormat,
            fileName: r.fileName,
            mimeType: r.mimeType,
            fileSizeBytes: r.fileSizeBytes,
            chunkCount: r.chunkCount,
            fileBytes,
            allowOffline: r.allowOffline,
            savedAt: new Date().toISOString(),
          };
        })
      );
      const savedCount = await saveDigitalResourcesBatchOffline(eligible);
      const nextRecords = await getOfflineDigitalResources(activePortal.schoolId);
      setOfflineDigitalRecords(nextRecords);
      setOfflineSyncFeedback(
        savedCount > 0
          ? `${savedCount} digital ${savedCount === 1 ? 'material' : 'materials'} cached in-app for offline reading.`
          : 'No offline-enabled digital materials available yet.'
      );
    } finally {
      setSavingAllOffline(false);
    }
  };

  const studentReserveDraftKey = buildModalDraftKey(
    registrationCode,
    'student_reserve',
    reserveModalBook?.id || 'none'
  );

  useEffect(() => {
    if (!reserveModalBook || !activePortal) return;
    if (reserveNotes.trim()) {
      saveModalDraft(studentReserveDraftKey, { notes: reserveNotes });
    } else {
      clearModalDraft(studentReserveDraftKey);
    }
  }, [reserveModalBook, activePortal, reserveNotes, studentReserveDraftKey]);

  const openReserveModal = (book: CatalogBookMirror) => {
    const draftKey = buildModalDraftKey(registrationCode, 'student_reserve', book.id);
    const savedDraft = loadModalDraft<{ notes?: string }>(draftKey);
    setReserveModalBook(book);
    setReserveNotes(savedDraft?.notes ?? '');
    setReserveDraftRestored(Boolean(savedDraft?.notes));
    setReservationError('');
  };

  const handleDiscardReserveDraft = () => {
    clearModalDraft(studentReserveDraftKey);
    setReserveNotes('');
    setReserveDraftRestored(false);
  };

  const handleConfirmReserve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePortal || !reserveModalBook) return;
    if (activePortal.status !== 'Active') {
      setReservationError('Only students with Active status can request book reservations.');
      return;
    }
    if (!isOnline) {
      setReservationError('Connect to the internet to send a book reservation request.');
      return;
    }

    setSubmittingReservation(true);
    setReservationError('');
    try {
      await createLibraryReservation({
        schoolId: activePortal.schoolId,
        ownerId: activePortal.ownerId,
        bookId: reserveModalBook.id,
        isbn: reserveModalBook.isbn,
        bookTitle: reserveModalBook.title,
        subject: reserveModalBook.subject,
        materialType: reserveModalBook.materialType,
        studentId: activePortal.studentId,
        studentName: activePortal.studentName,
        admissionNo: activePortal.admissionNo,
        formLevel: activePortal.formLevel,
        stream: activePortal.stream,
        registrationCode: activePortal.registrationCode,
        requestedDate: todayIso,
        notes: reserveNotes.trim(),
      });
      clearModalDraft(studentReserveDraftKey);
      setReservationFeedback(
        `Reservation requested for "${reserveModalBook.title}". The librarian will mark it Ready when a copy is returned.`
      );
      setReserveModalBook(null);
      setReserveNotes('');
      setReserveDraftRestored(false);
    } catch (err) {
      setReservationError(
        err instanceof Error ? err.message : 'Unable to submit book reservation right now.'
      );
    } finally {
      setSubmittingReservation(false);
    }
  };

  const studentFormLabel = activePortal
    ? (`Form ${activePortal.formLevel}` as DigitalResourceFormLevel)
    : 'All';

  const handleUpdateStudentPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePortal) return;
    const enteredCurrent = currentPasswordInput.trim();
    const enteredNew = newPasswordInput.trim();
    const enteredConfirm = confirmPasswordInput.trim();

    const expectedCurrent = (activePortal.portalPassword || activePortal.admissionNo || '').trim();
    const isCurrentMatch = activePortal.portalPassword
      ? activePortal.portalPassword.trim() === enteredCurrent
      : expectedCurrent.toLowerCase() === enteredCurrent.toLowerCase();

    if (!isCurrentMatch) {
      setPasswordModalError(
        'Current password / PIN is incorrect. (Default is your school Admission Number).'
      );
      return;
    }

    if (enteredNew.length < 4) {
      setPasswordModalError('New password / PIN must be at least 4 characters long.');
      return;
    }

    if (enteredNew !== enteredConfirm) {
      setPasswordModalError('New passwords do not match. Please re-enter.');
      return;
    }

    setPasswordModalSaving(true);
    setPasswordModalError('');
    setPasswordModalSuccess('');
    try {
      await updateDoc(doc(db, 'studentPortals', registrationCode), {
        portalPassword: enteredNew,
        updatedAt: serverTimestamp(),
      });

      const updatedPortal: StudentPortal = {
        ...activePortal,
        portalPassword: enteredNew,
      };
      setActivePortal(updatedPortal);
      writeCachedJson(`malawisec_student_portal_${registrationCode}`, updatedPortal);

      setPasswordModalSuccess('Your Password / PIN has been updated successfully!');
      setCurrentPasswordInput('');
      setNewPasswordInput('');
      setConfirmPasswordInput('');
    } catch (err) {
      setPasswordModalError(
        err instanceof Error
          ? err.message
          : 'Failed to update password. Ensure you are connected to the internet.'
      );
    } finally {
      setPasswordModalSaving(false);
    }
  };

  const handleSelectTab = (nextTab: StudentPortalTab) => {
    setActiveTab(nextTab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-[#F7F8FA] dark:bg-[#0D1117] text-slate-900 dark:text-slate-100">
      <header className="sticky top-0 z-30 h-14 w-full bg-white/95 dark:bg-[#161B22]/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 print:hidden">
        <div className="w-full h-full px-3 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            {activePortal?.logoDataUrl ? (
              <div className="h-9 w-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden flex items-center justify-center shrink-0">
                <img
                  src={activePortal.logoDataUrl}
                  alt={activePortal.schoolName}
                  className="h-full w-full object-contain p-0.5"
                />
              </div>
            ) : (
              <div className="h-9 w-9 rounded-full border border-sky-400/30 bg-white dark:bg-slate-900 overflow-hidden flex items-center justify-center shrink-0 shadow-xs">
                <img src="/brand-logo.png" alt="SecSchoolHub" className="h-full w-full object-contain" />
              </div>
            )}
            <div className="min-w-0">
              <div className="text-sm font-bold tracking-tight text-slate-900 dark:text-white truncate">
                {activePortal ? activePortal.schoolName : 'Student Portal'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {hasAdminWorkspace && onSwitchToAdmin && (
              <button
                type="button"
                onClick={onSwitchToAdmin}
                className="min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Staff Workspace
              </button>
            )}
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label="Toggle light or dark theme"
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowPasswordModal(true);
                setPasswordModalError('');
                setPasswordModalSuccess('');
                setCurrentPasswordInput('');
                setNewPasswordInput('');
                setConfirmPasswordInput('');
              }}
              title="Change your portal password or PIN"
              className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <span className="hidden sm:inline">Change PIN</span>
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      <main
        className={`flex-1 w-full px-3 sm:px-6 pt-4 sm:pt-6 space-y-5 ${
          !portalLoading && activePortal && summary ? 'pb-20 sm:pb-20' : 'pb-8'
        }`}
      >
        {portalLoading ? (
          <div className="max-w-md mx-auto py-12 space-y-3">
            <div className="h-5 w-48 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
            <div className="h-24 w-full bg-slate-200 dark:bg-slate-800 rounded-2xl animate-pulse" />
          </div>
        ) : !activePortal || !summary ? (
          <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 max-w-2xl mx-auto text-center space-y-4">
            <div className="mx-auto h-12 w-12 rounded-2xl bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center text-amber-700 dark:text-amber-400">
              <KeyRound className="w-6 h-6" aria-hidden="true" />
            </div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">
              Registration Code Not Found or Revoked
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              No active student record matches registration code{' '}
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                {registrationCode}
              </span>
              . Please check the code carefully or ask your school administrator or form teacher to
              issue a valid registration code.
            </p>
            <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={onSignOut}
                className="min-h-[42px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
              >
                Enter Different Registration Code
              </button>
              {hasAdminWorkspace && onSwitchToAdmin && (
                <button
                  type="button"
                  onClick={onSwitchToAdmin}
                  className="inline-flex items-center gap-1.5 min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Open Staff Workspace</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Student Profile Header (Dashboard opens by default) */}
            <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                    {activePortal.studentName}
                  </h1>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-mono font-semibold">{activePortal.admissionNo}</span> ·{' '}
                    Form {activePortal.formLevel}
                    {activePortal.stream} ({activePortal.formLevel <= 2 ? 'JCE' : 'MSCE'}) ·{' '}
                    {activePortal.boardingStatus} · {activePortal.academicYear}
                    {activePortal.status !== 'Active' ? ` · ${activePortal.status}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-3 text-xs font-mono text-slate-500 dark:text-slate-400">
                  {activeTab !== 'dashboard' && (
                    <button
                      type="button"
                      onClick={() => handleSelectTab('dashboard')}
                      className="inline-flex items-center gap-1.5 min-h-[34px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 font-sans text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer print:hidden"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Back</span>
                    </button>
                  )}
                  {!isOnline && (
                    <>
                      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
                        <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Offline</span>
                      </span>
                      <span>·</span>
                    </>
                  )}
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    {activePortal.registrationCode}
                  </span>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPasswordModal(true);
                      setPasswordModalError('');
                      setPasswordModalSuccess('');
                      setCurrentPasswordInput('');
                      setNewPasswordInput('');
                      setConfirmPasswordInput('');
                    }}
                    className="inline-flex items-center gap-1 font-sans text-xs text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                  >
                    <KeyRound className="w-3 h-3" aria-hidden="true" />
                    <span>Change PIN</span>
                  </button>
                  <span className="hidden">
                  </span>
                </div>
              </div>

              {(libraryAlerts.dueSoonLoans.length > 0 ||
                libraryAlerts.overdueLoans.length > 0 ||
                readyReservationsCount > 0) && (
                <div className="space-y-2 pt-1">
                  {libraryAlerts.dueSoonLoans.length > 0 && (
                    <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/75 dark:bg-amber-950/30 px-4 py-3 text-xs text-amber-950 dark:text-amber-200 flex items-start gap-2.5">
                      <Clock
                        className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                      <div className="space-y-1 min-w-0">
                        <div className="font-semibold">
                          Library Return Reminder: {libraryAlerts.dueSoonLoans.length}{' '}
                          {libraryAlerts.dueSoonLoans.length === 1 ? 'book' : 'books'} due within 48 hours
                        </div>
                        <div className="text-[11px] font-mono text-amber-800 dark:text-amber-300">
                          {libraryAlerts.dueSoonLoans
                            .map(
                              (l) =>
                                `${l.bookTitle} (${l.bookCode} · ${getLibraryDueReminderLabel(l.dueDate, todayIso).urgencyLabel} · Due ${l.dueDate})`
                            )
                            .join(' · ')}
                        </div>
                      </div>
                    </div>
                  )}

                  {libraryAlerts.overdueLoans.length > 0 && (
                    <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/75 dark:bg-rose-950/30 px-4 py-3 text-xs text-rose-950 dark:text-rose-200 flex items-start gap-2.5">
                      <AlertTriangle
                        className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                      <div className="space-y-1 min-w-0">
                        <div className="font-semibold">
                          Overdue Library Material: Please return {libraryAlerts.overdueLoans.length}{' '}
                          {libraryAlerts.overdueLoans.length === 1 ? 'book' : 'books'} immediately
                        </div>
                        <div className="text-[11px] font-mono text-rose-800 dark:text-rose-300">
                          {libraryAlerts.overdueLoans
                            .map(
                              (l) =>
                                `${l.bookTitle} (${l.bookCode} · ${getLibraryDaysOverdue(l.dueDate, todayIso)}d late)`
                            )
                            .join(' · ')}
                        </div>
                      </div>
                    </div>
                  )}

                  {readyReservationsCount > 0 && (
                    <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/75 dark:bg-emerald-950/30 px-4 py-3 text-xs text-emerald-950 dark:text-emerald-200 flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-2 font-semibold">
                        <BookmarkCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                        <span>
                          {readyReservationsCount} reserved{' '}
                          {readyReservationsCount === 1 ? 'book is' : 'books are'} ready for library pickup
                        </span>
                      </span>
                      {activeTab !== 'library' && (
                        <button
                          type="button"
                          onClick={() => handleSelectTab('library')}
                          className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 hover:underline cursor-pointer"
                        >
                          Open Library
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* SECTION 1: STUDENT ACADEMIC DASHBOARD */}
            {activeTab === 'dashboard' && (
              <StudentPortalDashboard
                portal={activePortal}
                assessments={assessments}
                summary={summary}
                selectedTerm={selectedTerm}
                termCounts={termCounts}
                fallbackTermWithMarks={fallbackTermWithMarks}
                reportCardPayload={reportCardPayload}
                activeTermRemark={activeTermRemark}
                announcements={announcements}
                libraryLoans={libraryLoans}
                libraryAlerts={libraryAlerts}
                activeBorrowedLoansCount={activeBorrowedLoansCount}
                readyReservationsCount={readyReservationsCount}
                offlineSavedCount={offlineIds.size}
                digitalResourcesCount={mergedDigitalResources.length}
                feeInvoices={feeInvoices}
                feeSubmissions={feeSubmissions}
                feeTotals={feeTotals}
                loadingResults={loadingResults}
                pdfFeedback={pdfFeedback}
                onSelectTerm={handleSelectTerm}
                onDownloadPdf={handleDownloadPdf}
                onNavigateTab={handleSelectTab}
              />
            )}

            {/* SECTION 2: CONTINUOUS ASSESSMENTS, EXAM RESULTS & REPORT CARD */}
            {activeTab === 'results' && (
              <>
                <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
                  <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
                    {TERMS.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => handleSelectTerm(t)}
                        className={`min-h-[36px] px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                          selectedTerm === t
                            ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {t}
                        {termCounts[t] > 0 ? ` (${termCounts[t]})` : ''}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => window.print()}
                      disabled={summary.rows.length === 0}
                      className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Print Report Card</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadPdf}
                      disabled={summary.rows.length === 0}
                      className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <FileDown className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Download PDF Report Card</span>
                    </button>
                  </div>
                </section>

                {pdfFeedback && (
                  <div
                    role="status"
                    className={`rounded-xl px-4 py-2.5 text-xs font-medium border print:hidden ${
                      pdfFeedback.type === 'success'
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/60 text-emerald-800 dark:text-emerald-300'
                        : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/60 text-rose-800 dark:text-rose-300'
                    }`}
                  >
                    {pdfFeedback.text}
                  </div>
                )}

                {/* Summary KPIs */}
                <section className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                  <div className="rounded-2xl bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-900/60 p-4">
                    <div className="text-xs text-emerald-800 dark:text-emerald-300 font-medium">
                      {activePortal.formLevel >= 3 ? 'MSCE Best 6' : 'Subjects Passed'}
                    </div>
                    <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-emerald-900 dark:text-emerald-200">
                      {summary.subjectCount === 0
                        ? '—'
                        : activePortal.formLevel >= 3
                        ? summary.standing.bestSixPoints !== null
                          ? `${summary.standing.bestSixPoints} pts`
                          : `${summary.subjectCount}/6`
                        : `${summary.passedSubjectCount}/${summary.subjectCount}`}
                    </div>
                    <div className="mt-0.5 text-[11px] text-emerald-700 dark:text-emerald-400 font-mono">
                      {activePortal.formLevel >= 3 && summary.meanManebPoint !== null
                        ? `Mean Pt ${summary.meanManebPoint}`
                        : `${summary.creditSubjectCount} credit${summary.creditSubjectCount === 1 ? '' : 's'}`}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-4">
                    <div className="text-xs text-slate-500 dark:text-slate-400">Overall Grade</div>
                    <div className="mt-1.5 text-2xl font-bold font-mono text-slate-900 dark:text-white">
                      {summary.overallGrade}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                      {summary.overallRemark} · {summary.system}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-4">
                    <div className="text-xs text-slate-500 dark:text-slate-400">Term Average</div>
                    <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                      {summary.subjectCount > 0 ? `${summary.weightedAverage.toFixed(1)}%` : '—'}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                      CA {summary.caAverage.toFixed(1)} + Exam {summary.summativeAverage.toFixed(1)}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-4">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {summary.system} Standing
                    </div>
                    <div
                      className={`mt-1.5 text-2xl font-bold ${
                        summary.standing.outcome === 'Pass'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : summary.standing.outcome === 'Fail'
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {summary.standing.outcome}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {summary.subjectCount} graded
                    </div>
                  </div>
                </section>

            {/* Subject Component Visual Breakdown */}
            {summary.rows.length > 0 && (
              <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
                  Subject Score Breakdown
                </h2>
                <SubjectComponentBarChart
                  items={summary.rows.map((r) => ({
                    subject: r.assessment.subject,
                    ca1: r.ca1Score,
                    ca2: r.ca2Score,
                    exam: r.examScore,
                    total: r.totalScore,
                    grade: r.grade,
                  }))}
                  maxItems={12}
                />
              </section>
            )}

            {/* Term-Over-Term Performance Trends (Recharts) */}
            {assessments.length > 0 && (
              <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
                <StudentPerformanceTrends
                  studentId={activePortal.studentId}
                  studentName={activePortal.studentName}
                  formLevel={activePortal.formLevel}
                  academicYear={activePortal.academicYear}
                  assessments={assessments}
                />
              </section>
            )}

            {/* Official Student Term Report Card & Continuous Assessment Table */}
            <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50/60 dark:bg-slate-900/40">
                <div className="flex items-center gap-2.5">
                  <Award className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Official {selectedTerm} Report Card &amp; Continuous Assessments
                    </h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {activePortal.schoolName} · {activePortal.academicYear} · Weights: CA 1 (20%) + CA 2 (20%) + Summative (60%)
                    </p>
                  </div>
                </div>
                {summary.rows.length > 0 && (
                  <span className="text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                    {summary.system} Standing: {summary.standing.outcome}
                  </span>
                )}
              </div>

              {loadingResults ? (
                <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                  Loading continuous assessments and report card...
                </div>
              ) : summary.rows.length === 0 ? (
                <div className="py-12 px-6 text-center space-y-3 text-sm text-slate-500 dark:text-slate-400">
                  <div>
                    No published marks for {selectedTerm} ({activePortal.academicYear}).
                  </div>
                  {fallbackTermWithMarks && (
                    <button
                      type="button"
                      onClick={() => handleSelectTerm(fallbackTermWithMarks)}
                      className="inline-flex items-center gap-1.5 min-h-[36px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
                    >
                      <span>
                        View {fallbackTermWithMarks} Results ({termCounts[fallbackTermWithMarks]})
                      </span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                        <th className="py-3 px-4 font-medium">Subject</th>
                        <th className="py-3 px-3 font-medium text-right">CA 1 (20%)</th>
                        <th className="py-3 px-3 font-medium text-right">CA 2 (20%)</th>
                        <th className="py-3 px-3 font-medium text-right">Summative (60%)</th>
                        <th className="py-3 px-3 font-medium text-right">Total (100%)</th>
                        <th className="py-3 px-3 font-medium text-right">Pts (1–9)</th>
                        <th className="py-3 px-3 font-medium text-right">Grade</th>
                        <th className="py-3 px-4 font-medium text-right">Remark</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {summary.rows.map((r) => {
                        const a = r.assessment;
                        return (
                          <tr key={a.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                            <td className="py-3 px-4 font-medium text-slate-900 dark:text-slate-100">
                              <div>{a.subject}</div>
                              {a.teacherComment && (
                                <div className="mt-0.5 text-[11px] font-normal text-slate-500 dark:text-slate-400 max-w-xs">
                                  {a.teacherComment}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums">
                              {r.hasCa1 ? (
                                <div>
                                  <div>{Math.round(r.ca1Score)}</div>
                                  {typeof a.ca1Raw === 'number' && typeof a.ca1Max === 'number' && a.ca1Max > 0 && (
                                    <div className="text-[10px] text-slate-400">
                                      {a.ca1Raw}/{a.ca1Max}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums">
                              {r.hasCa2 ? (
                                <div>
                                  <div>{Math.round(r.ca2Score)}</div>
                                  {typeof a.ca2Raw === 'number' && typeof a.ca2Max === 'number' && a.ca2Max > 0 && (
                                    <div className="text-[10px] text-slate-400">
                                      {a.ca2Raw}/{a.ca2Max}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums">
                              {r.hasExam ? (
                                <div>
                                  <div>{Math.round(r.examScore)}</div>
                                  {typeof a.examRaw === 'number' && typeof a.examMax === 'number' && a.examMax > 0 && (
                                    <div className="text-[10px] text-slate-400">
                                      {a.examRaw}/{a.examMax}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold">
                              {Math.round(r.totalScore)}%
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                              {r.gradePoint}
                            </td>
                            <td
                              className={`py-3 px-3 text-right font-mono font-bold ${
                                r.gradePoint <= 6
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : r.gradePoint <= 8
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {r.grade}
                            </td>
                            <td className="py-3 px-4 text-right text-xs text-slate-600 dark:text-slate-400">
                              {r.remark}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-900/70 font-semibold text-xs">
                        <td className="py-3 px-4 text-slate-900 dark:text-white">
                          Term Average ({summary.subjectCount} Subjects)
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums">
                          {summary.ca1Average.toFixed(1)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums">
                          {summary.ca2Average.toFixed(1)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums">
                          {summary.summativeAverage.toFixed(1)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-white">
                          {summary.weightedAverage.toFixed(1)}%
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                          {summary.meanManebPoint !== null ? summary.meanManebPoint.toFixed(1) : '—'}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                          {summary.overallGrade}
                        </td>
                        <td className="py-3 px-4 text-right">{summary.overallRemark}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {reportCardPayload && (
                <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 space-y-2.5 text-xs">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        Form Teacher Remark
                        {reportCardPayload.formTeacherName
                          ? ` (${reportCardPayload.formTeacherName})`
                          : ''}
                        :{' '}
                      </span>
                      <span className="text-slate-600 dark:text-slate-300">
                        {reportCardPayload.formTeacherRemark}
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        Head Teacher Remark
                        {reportCardPayload.headTeacherName
                          ? ` (${reportCardPayload.headTeacherName})`
                          : ''}
                        :{' '}
                      </span>
                      <span className="text-slate-600 dark:text-slate-300">
                        {reportCardPayload.headTeacherRemark}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                    <span>
                      {activePortal.formLevel <= 2
                        ? 'JCE Key: A (80–100% Distinction) · B (70–79% Very Good) · C (60–69% Credit) · D (50–59% Pass) · F (0–49% Fail)'
                        : 'MSCE Key: 1–2 (75–100% Distinction) · 3 (70–74% Strong Credit) · 4–6 (55–69% Credit) · 7–8 (40–54% Pass) · 9 (0–39% Fail)'}
                    </span>
                    {reportCardPayload.nextTermOpens && (
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                        Next Term Opens: {reportCardPayload.nextTermOpens}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </section>
              </>
            )}

            {/* SECTION 3: LIBRARY */}
            {activeTab === 'library' && (
              <>
            {/* Student Library Materials & Due Dates */}
            <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    School Library Books Assigned
                  </h2>
                </div>
                {libraryLoans.some((l) => l.status === 'Checked Out') && (
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                    {libraryLoans.filter((l) => l.status === 'Checked Out').length} checked out
                    {libraryAlerts.dueSoonLoans.length > 0 && (
                      <span className="text-amber-700 dark:text-amber-400 font-semibold">
                        {' '}
                        · {libraryAlerts.dueSoonLoans.length} due in 48h
                      </span>
                    )}
                  </span>
                )}
              </div>

              {loadingLibrary ? (
                <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                  Loading library records...
                </div>
              ) : libraryLoans.length === 0 ? (
                <div className="py-10 px-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  No library books assigned.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                        <th className="py-3 px-4 font-medium">Material &amp; Code</th>
                        <th className="py-3 px-3 font-medium">Subject</th>
                        <th className="py-3 px-3 font-medium">Checked Out</th>
                        <th className="py-3 px-3 font-medium">Return Due</th>
                        <th className="py-3 px-4 font-medium text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {libraryLoans.map((loan) => {
                        const overdue = isLibraryLoanOverdue(loan, todayIso);
                        const dueWithin48h = isLibraryLoanDueWithin48Hours(loan, todayIso);
                        const reminder = getLibraryDueReminderLabel(loan.dueDate, todayIso);
                        const daysLate = overdue ? getLibraryDaysOverdue(loan.dueDate, todayIso) : 0;
                        return (
                          <tr
                            key={loan.id}
                            className={
                              overdue
                                ? 'bg-rose-50/40 dark:bg-rose-950/15 hover:bg-rose-50/70 dark:hover:bg-rose-950/25'
                                : dueWithin48h
                                ? 'bg-amber-50/45 dark:bg-amber-950/15 hover:bg-amber-50/75 dark:hover:bg-amber-950/25'
                                : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/30'
                            }
                          >
                            <td className="py-3 px-4">
                              <div className="font-medium text-slate-900 dark:text-slate-100">
                                {loan.bookTitle}
                              </div>
                              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                {loan.bookCode} · {loan.materialType}
                                {loan.quantity > 1 ? ` · Qty ${loan.quantity}` : ''}
                              </div>
                            </td>
                            <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-300">
                              {loan.subject || 'General'}
                            </td>
                            <td className="py-3 px-3 font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
                              {loan.checkoutDate}
                            </td>
                            <td
                              className={`py-3 px-3 font-mono text-xs tabular-nums ${
                                overdue
                                  ? 'text-rose-600 dark:text-rose-400 font-semibold'
                                  : dueWithin48h
                                  ? 'text-amber-700 dark:text-amber-400 font-semibold'
                                  : 'text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              {loan.dueDate}
                            </td>
                            <td className="py-3 px-4 text-right text-xs whitespace-nowrap">
                              {loan.status === 'Returned' ? (
                                <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                  Returned ({loan.returnedDate || 'Cleared'})
                                </span>
                              ) : overdue ? (
                                <span className="font-semibold text-rose-600 dark:text-rose-400">
                                  Overdue · {daysLate}d late
                                </span>
                              ) : dueWithin48h ? (
                                <span className="inline-flex items-center justify-end gap-1 font-semibold text-amber-700 dark:text-amber-400">
                                  <Clock className="w-3 h-3" aria-hidden="true" />
                                  <span>Due Within 48h · {reminder.urgencyLabel}</span>
                                </span>
                              ) : (
                                <span className="font-semibold text-slate-700 dark:text-slate-300">
                                  Checked Out
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Online & Offline Digital Library (Non-Downloadable Books & Past Papers) */}
            <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Globe className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Online Library · Digital Books &amp; Past Papers
                  </h2>
                </div>

                {mergedDigitalResources.length > 0 && (
                  <button
                    type="button"
                    onClick={handleSaveAllOffline}
                    disabled={savingAllOffline}
                    className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <CloudOff className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>
                      {savingAllOffline
                        ? 'Caching...'
                        : `Save All Offline (${mergedDigitalResources.filter((r) => r.allowOffline).length})`}
                    </span>
                  </button>
                )}
              </div>

              <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800/80 bg-white dark:bg-[#161B22] grid grid-cols-3 gap-3">
                <div>
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Reading Online Now
                  </div>
                  <div className="text-base sm:text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {readingCounts.onlineActiveTotal}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Offline Reading Now
                  </div>
                  <div className="text-base sm:text-lg font-bold tabular-nums text-amber-700 dark:text-amber-400">
                    {readingCounts.offlineActiveTotal}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Marked Read
                  </div>
                  <div className="text-base sm:text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                    {mergedDigitalResources.filter((r) => progressMap[r.id]?.isRead).length}
                    <span className="text-xs font-normal text-slate-400">
                      {' '}
                      / {mergedDigitalResources.length}
                    </span>
                  </div>
                </div>
              </div>

              <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/60 dark:bg-slate-900/40 space-y-3">
                {/* Prominent Search Bar + Form Level & Count */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                  <div className="relative flex-1 min-w-0">
                    <Search
                      className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      type="text"
                      aria-label="Search uploaded digital resources by title or subject tags"
                      value={digitalSearch}
                      onChange={(e) => setDigitalSearch(e.target.value)}
                      placeholder="Search uploaded resources by title or subject..."
                      className="w-full min-h-[42px] pl-9 pr-9 rounded-xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
                    />
                    {digitalSearch && (
                      <button
                        type="button"
                        onClick={() => setDigitalSearch('')}
                        aria-label="Clear digital library search"
                        className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[30px] min-w-[30px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0">
                    <select
                      aria-label="Filter digital library by form level"
                      value={digitalFormFilter}
                      onChange={(e) =>
                        setDigitalFormFilter(e.target.value as 'All' | DigitalResourceFormLevel)
                      }
                      className="min-h-[42px] px-3 rounded-xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
                    >
                      <option value="All">All Forms</option>
                      <option value={studentFormLabel}>My Level ({studentFormLabel})</option>
                      <option value="Form 1">Form 1</option>
                      <option value="Form 2">Form 2</option>
                      <option value="Form 3">Form 3</option>
                      <option value="Form 4">Form 4</option>
                    </select>

                    <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {filteredDigitalResources.length} of {mergedDigitalResources.length}
                    </span>
                  </div>
                </div>

                {/* Category Filter Buttons */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {(['All', ...STUDENT_DIGITAL_RESOURCE_CATEGORIES, 'Saved Offline'] as const).map((cat) => {
                    const active = digitalCategoryFilter === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setDigitalCategoryFilter(cat)}
                        aria-pressed={active}
                        className={`min-h-[34px] px-3 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                          active
                            ? 'bg-emerald-700 text-white'
                            : 'bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        {cat === 'Saved Offline' ? `Saved Offline (${offlineIds.size})` : cat}
                      </button>
                    );
                  })}
                </div>

                {/* Subject Tag Filter Buttons */}
                {digitalSubjects.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-200/70 dark:border-slate-800">
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mr-1">
                      Subjects:
                    </span>
                    <button
                      type="button"
                      onClick={() => setDigitalSubjectFilter('All')}
                      aria-pressed={digitalSubjectFilter === 'All'}
                      className={`min-h-[30px] px-2.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                        digitalSubjectFilter === 'All'
                          ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                          : 'bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      All Subjects
                    </button>
                    {digitalSubjects.map((subj) => {
                      const active = digitalSubjectFilter === subj;
                      return (
                        <button
                          key={subj}
                          type="button"
                          onClick={() => setDigitalSubjectFilter(active ? 'All' : subj)}
                          aria-pressed={active}
                          className={`min-h-[30px] px-2.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                            active
                              ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                              : 'bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          {subj}
                        </button>
                      );
                    })}
                  </div>
                )}

                {offlineSyncFeedback && (
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
                    <span className="inline-flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>{offlineSyncFeedback}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setOfflineSyncFeedback('')}
                      aria-label="Dismiss offline storage message"
                      className="opacity-70 hover:opacity-100 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="p-5">
                {loadingDigitalLibrary && mergedDigitalResources.length === 0 ? (
                  <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                    Loading online study materials...
                  </div>
                ) : filteredDigitalResources.length === 0 ? (
                  <div className="py-10 px-4 text-center space-y-3 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {mergedDigitalResources.length === 0
                        ? isOnline
                          ? 'No online books or past papers published yet.'
                          : 'No offline books or past papers saved on this device.'
                        : 'No uploaded digital resources match your search or subject filter.'}
                    </div>
                    {mergedDigitalResources.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setDigitalSearch('');
                          setDigitalSubjectFilter('All');
                          setDigitalCategoryFilter('All');
                          setDigitalFormFilter('All');
                        }}
                        className="inline-flex items-center min-h-[34px] px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#161B22] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        Reset Search &amp; Filters
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredDigitalResources.map((item) => {
                      const isSaved = offlineIds.has(item.id);
                      const isPastPaper = item.category === 'Past Paper';
                      const progress = progressMap[item.id];
                      const isRead = Boolean(progress?.isRead);
                      const lastReadPage = progress?.lastReadPage || 0;
                      const totalPages = progress?.totalPages || 0;
                      const lastReadLabel = formatLastReadLabel(progress?.lastReadAt);
                      const onlineCount = readingCounts.onlineByResource[item.id] || 0;
                      const offlineCount = readingCounts.offlineByResource[item.id] || 0;

                      return (
                        <article
                          key={item.id}
                          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 p-4 flex flex-col justify-between gap-3"
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                                {item.category} · {item.subject} · {item.formLevel}
                                {item.examYear ? ` · ${item.examYear}` : ''}
                                {item.storageFormat === 'pdf'
                                  ? ` · PDF${item.fileSizeBytes ? ` (${formatFileSizeLabel(item.fileSizeBytes)})` : ''}`
                                  : item.storageFormat === 'image'
                                  ? ` · Image${item.fileSizeBytes ? ` (${formatFileSizeLabel(item.fileSizeBytes)})` : ''}`
                                  : ''}
                              </div>
                              {isSaved && (
                                <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap shrink-0">
                                  Saved Offline
                                </span>
                              )}
                            </div>

                            <div className="flex items-start gap-2">
                              {isPastPaper ? (
                                <FileText
                                  className="w-4 h-4 text-slate-500 dark:text-slate-400 mt-0.5 shrink-0"
                                  aria-hidden="true"
                                />
                              ) : (
                                <BookOpen
                                  className="w-4 h-4 text-slate-500 dark:text-slate-400 mt-0.5 shrink-0"
                                  aria-hidden="true"
                                />
                              )}
                              <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-snug">
                                {item.title}
                              </h3>
                            </div>

                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              By {item.author}
                            </div>

                            {item.summary && (
                              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-2">
                                {item.summary}
                              </p>
                            )}

                            {(lastReadPage > 0 || lastReadLabel || onlineCount > 0 || offlineCount > 0 || isRead) && (
                              <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 pt-0.5">
                                {isRead
                                  ? 'Read'
                                  : lastReadPage > 0
                                  ? `Page ${lastReadPage}${totalPages > 1 ? `/${totalPages}` : ''}`
                                  : ''}
                                {lastReadLabel
                                  ? `${isRead || lastReadPage > 0 ? ' · ' : ''}Last read ${lastReadLabel}`
                                  : ''}
                                {onlineCount > 0 || offlineCount > 0
                                  ? `${isRead || lastReadPage > 0 || lastReadLabel ? ' · ' : ''}${onlineCount} online · ${offlineCount} offline`
                                  : ''}
                              </div>
                            )}
                          </div>

                          <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setActiveReaderResource(item)}
                                className="inline-flex items-center gap-1.5 min-h-[36px] px-3.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>
                                  {lastReadPage > 1
                                    ? `Continue p.${lastReadPage}`
                                    : isOnline
                                    ? 'Read Online'
                                    : 'Read Offline'}
                                </span>
                              </button>

                              <button
                                type="button"
                                onClick={() => toggleMarkAsRead(item.id)}
                                aria-pressed={isRead}
                                className={`inline-flex items-center gap-1 min-h-[36px] px-3 rounded-lg border text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                                  isRead
                                    ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-[#161B22] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                                }`}
                              >
                                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>{isRead ? 'Marked Read' : 'Mark as Read'}</span>
                              </button>
                            </div>

                            {item.allowOffline ? (
                              <button
                                type="button"
                                onClick={() => handleToggleOfflineResource(item)}
                                disabled={savingOfflineId === item.id}
                                className={`inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 ${
                                  isSaved
                                    ? 'border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                                    : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#161B22] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                                }`}
                              >
                                {isSaved ? (
                                  <>
                                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                                    <span>Saved Offline</span>
                                    <Trash2 className="w-3 h-3 ml-0.5 opacity-70" aria-hidden="true" />
                                  </>
                                ) : (
                                  <>
                                    <CloudOff className="w-3.5 h-3.5" aria-hidden="true" />
                                    <span>
                                      {savingOfflineId === item.id ? 'Saving...' : 'Save Offline'}
                                    </span>
                                  </>
                                )}
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-400">Online only</span>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            {/* Physical School Book Catalog & Book Reservations */}
            <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <BookmarkPlus
                    className="w-4 h-4 text-emerald-700 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Physical Book Catalog &amp; Reservations
                  </h2>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
                    {(
                      [
                        { id: 'all', label: 'All' },
                        { id: 'checked_out', label: 'Checked Out' },
                        { id: 'available', label: 'Available' },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setCatalogFilter(tab.id)}
                        className={`min-h-[30px] px-2.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                          catalogFilter === tab.id
                            ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="relative min-w-[200px]">
                    <Search
                      className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      aria-label="Search school book catalog by title, author, or ISBN"
                      value={catalogSearch}
                      onChange={(e) => setCatalogSearch(e.target.value)}
                      placeholder="Search title, author, ISBN..."
                      className="w-full min-h-[34px] pl-8 pr-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
                    />
                  </div>
                </div>
              </div>

              {reservationFeedback && (
                <div className="mx-5 mt-4 flex items-center justify-between gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 px-3.5 py-2.5 text-xs text-emerald-800 dark:text-emerald-300">
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>{reservationFeedback}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setReservationFeedback('')}
                    aria-label="Dismiss reservation confirmation"
                    className="opacity-70 hover:opacity-100 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {loadingCatalog ? (
                <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                  Loading school book inventory...
                </div>
              ) : filteredCatalogBooks.length === 0 ? (
                <div className="py-10 px-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  {catalogBooks.length === 0
                    ? isOnline
                      ? 'No physical library titles have been published to the student catalog yet.'
                      : 'Physical catalog availability requires an active internet connection. Use the Online Library above for cached offline reading.'
                    : 'No books match your search or stock filter.'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                        <th className="py-3 px-4 font-medium">Title &amp; Author</th>
                        <th className="py-3 px-3 font-medium">ISBN &amp; Shelf</th>
                        <th className="py-3 px-3 font-medium">Subject</th>
                        <th className="py-3 px-3 font-medium text-right">Stock</th>
                        <th className="py-3 px-4 font-medium text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {filteredCatalogBooks.map((book) => {
                        const existingReq = activeReservationByBookId.get(book.id);
                        const isCheckedOut = book.availableCopies === 0;
                        const reserveDisabled =
                          activePortal.status !== 'Active' || !isOnline || Boolean(existingReq);

                        return (
                          <tr key={book.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                            <td className="py-3 px-4">
                              <div className="font-medium text-slate-900 dark:text-slate-100">
                                {book.title}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                {book.author} · {book.materialType}
                              </div>
                            </td>
                            <td className="py-3 px-3 font-mono text-xs text-slate-600 dark:text-slate-300">
                              <div>{book.isbn}</div>
                              {book.shelfCode && (
                                <div className="text-[11px] text-slate-400">Shelf {book.shelfCode}</div>
                              )}
                            </td>
                            <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-300">
                              {book.subject || 'General'}
                            </td>
                            <td className="py-3 px-3 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                              <span
                                className={
                                  isCheckedOut
                                    ? 'font-semibold text-amber-700 dark:text-amber-400'
                                    : 'font-semibold text-emerald-700 dark:text-emerald-400'
                                }
                              >
                                {book.availableCopies}/{book.totalCopies}
                              </span>
                              <div className="text-[10px] text-slate-400">
                                {isCheckedOut ? 'Checked Out' : 'On Shelf'}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              {existingReq ? (
                                <span
                                  className={`inline-flex items-center gap-1 text-xs font-semibold ${
                                    existingReq.status === 'Ready'
                                      ? 'text-emerald-700 dark:text-emerald-400'
                                      : 'text-amber-700 dark:text-amber-400'
                                  }`}
                                >
                                  <BookmarkCheck className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>
                                    {existingReq.status === 'Ready' ? 'Ready for Pickup' : 'Reserved (Pending)'}
                                  </span>
                                </span>
                              ) : isCheckedOut ? (
                                <button
                                  type="button"
                                  onClick={() => openReserveModal(book)}
                                  disabled={reserveDisabled}
                                  title={
                                    activePortal.status !== 'Active'
                                      ? 'Only active students can reserve books'
                                      : !isOnline
                                      ? 'Connect to the internet to reserve books'
                                      : 'Reserve this checked-out book'
                                  }
                                  className="inline-flex items-center gap-1.5 min-h-[34px] px-3 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-45 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  <BookmarkPlus className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>Reserve</span>
                                </button>
                              ) : (
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                  Available at desk
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Student's Book Reservation Requests */}
              <div className="border-t border-slate-200 dark:border-slate-800 px-5 py-4 bg-slate-50/50 dark:bg-slate-900/30">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    My Book Reservations ({reservations.length})
                  </h3>
                  {!isOnline && (
                    <span className="text-[11px] text-amber-700 dark:text-amber-400">
                      Offline · Reservation requests sync when online
                    </span>
                  )}
                </div>

                {loadingReservations ? (
                  <div className="py-4 text-xs text-slate-500 dark:text-slate-400">
                    Checking your reservations...
                  </div>
                ) : reservations.length === 0 ? (
                  <div className="py-4 text-xs text-slate-500 dark:text-slate-400">
                    No book reservations yet.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200/80 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#161B22]">
                    {reservations.map((res) => (
                      <div
                        key={res.id}
                        className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 dark:text-white truncate">
                            {res.bookTitle}
                          </div>
                          <div className="mt-0.5 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            {res.subject} · ISBN {res.isbn || 'N/A'} · Requested {res.requestedDate}
                          </div>
                          {res.notes && (
                            <div className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                              Note: {res.notes}
                            </div>
                          )}
                        </div>
                        <div className="text-right whitespace-nowrap shrink-0">
                          <span
                            className={`font-semibold ${
                              res.status === 'Ready'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : res.status === 'Pending'
                                ? 'text-amber-700 dark:text-amber-400'
                                : res.status === 'Fulfilled'
                                ? 'text-slate-700 dark:text-slate-300'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {res.status === 'Ready' ? 'Ready for Pickup at Library' : res.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
              </>
            )}

            {/* SECTION 4: FEES & PAYMENT REFERENCE UPLOAD */}
            {activeTab === 'fees' && (
              <div className="space-y-5">
                {/* Fee Summary KPIs */}
                <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
                    <div className="text-xs text-slate-500 dark:text-slate-400">Total Billed</div>
                    <div className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                      {formatMWK(feeTotals.billed)}
                    </div>
                  </div>
                  <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
                    <div className="text-xs text-slate-500 dark:text-slate-400">Total Paid</div>
                    <div className="mt-1 text-xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatMWK(feeTotals.paid)}
                    </div>
                  </div>
                  <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
                    <div className="text-xs text-slate-500 dark:text-slate-400">Balance Due</div>
                    <div
                      className={`mt-1 text-xl font-bold font-mono tabular-nums ${
                        feeTotals.balance > 0
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {formatMWK(feeTotals.balance)}
                    </div>
                  </div>
                </section>

                {/* Term Fee Invoices */}
                <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
                    <Banknote className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Fee Invoices
                    </h2>
                  </div>

                  {loadingFees ? (
                    <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                      Loading fee invoices...
                    </div>
                  ) : feeInvoices.length === 0 ? (
                    <div className="py-8 px-6 text-center text-xs text-slate-500 dark:text-slate-400">
                      No term fee invoices billed yet.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                            <th className="py-3 px-4 font-medium">Term</th>
                            <th className="py-3 px-3 font-medium text-right">Tuition</th>
                            <th className="py-3 px-3 font-medium text-right">GPF / Exam / Other</th>
                            <th className="py-3 px-3 font-medium text-right">Billed</th>
                            <th className="py-3 px-3 font-medium text-right">Paid</th>
                            <th className="py-3 px-3 font-medium text-right">Balance</th>
                            <th className="py-3 px-4 font-medium text-right">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                          {feeInvoices.map((inv) => {
                            const balance = Math.max(0, inv.totalBilled - inv.totalPaid);
                            const extras = inv.gpfFee + inv.examFee + inv.otherFee;
                            return (
                              <tr key={inv.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                                <td className="py-3 px-4">
                                  <div className="font-medium text-slate-900 dark:text-slate-100">
                                    {inv.term}
                                  </div>
                                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                    {inv.academicYear}
                                  </div>
                                </td>
                                <td className="py-3 px-3 text-right font-mono text-xs tabular-nums">
                                  {formatMWK(inv.tuitionFee)}
                                </td>
                                <td className="py-3 px-3 text-right font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
                                  {formatMWK(extras)}
                                </td>
                                <td className="py-3 px-3 text-right font-mono text-xs tabular-nums">
                                  {formatMWK(inv.totalBilled)}
                                </td>
                                <td className="py-3 px-3 text-right font-mono text-xs tabular-nums text-emerald-700 dark:text-emerald-400">
                                  {formatMWK(inv.totalPaid)}
                                </td>
                                <td className="py-3 px-3 text-right font-mono text-xs tabular-nums font-semibold">
                                  {formatMWK(balance)}
                                </td>
                                <td className="py-3 px-4 text-right text-xs font-semibold">
                                  <span
                                    className={
                                      inv.status === 'Paid'
                                        ? 'text-emerald-700 dark:text-emerald-400'
                                        : inv.status === 'Partial'
                                        ? 'text-amber-700 dark:text-amber-400'
                                        : 'text-rose-600 dark:text-rose-400'
                                    }
                                  >
                                    {inv.status}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                {/* Upload Payment Reference (PDF or Image) */}
                <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Upload className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        Upload Payment Reference (PDF or Image)
                      </h2>
                    </div>
                  </div>

                  {proofSubmitError && (
                    <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                      {proofSubmitError}
                    </div>
                  )}

                  {proofSubmitSuccess && (
                    <div className="flex items-center justify-between gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 px-3.5 py-2.5 text-xs text-emerald-800 dark:text-emerald-300">
                      <span className="inline-flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>{proofSubmitSuccess}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setProofSubmitSuccess('')}
                        aria-label="Dismiss upload confirmation"
                        className="opacity-70 hover:opacity-100 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <form onSubmit={handleSubmitPaymentProof} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      {feeInvoices.length > 0 ? (
                        <div>
                          <label
                            htmlFor="student-proof-invoice"
                            className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                          >
                            Invoice / Term
                          </label>
                          <select
                            id="student-proof-invoice"
                            value={proofInvoiceId}
                            onChange={(e) => handleSelectProofInvoice(e.target.value)}
                            className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium"
                          >
                            {feeInvoices.map((inv) => {
                              const rem = Math.max(0, inv.totalBilled - inv.totalPaid);
                              return (
                                <option key={inv.id} value={inv.id}>
                                  {inv.term} ({inv.academicYear}) · Bal {formatMWK(rem)}
                                </option>
                              );
                            })}
                            <option value="">Other Term</option>
                          </select>
                        </div>
                      ) : (
                        <div>
                          <label
                            htmlFor="student-proof-term"
                            className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                          >
                            Term
                          </label>
                          <select
                            id="student-proof-term"
                            value={proofTerm}
                            onChange={(e) => setProofTerm(e.target.value as TermName)}
                            className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium"
                          >
                            {TERMS.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {feeInvoices.length > 0 && !proofInvoiceId && (
                        <div>
                          <label
                            htmlFor="student-proof-other-term"
                            className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                          >
                            Term
                          </label>
                          <select
                            id="student-proof-other-term"
                            value={proofTerm}
                            onChange={(e) => setProofTerm(e.target.value as TermName)}
                            className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium"
                          >
                            {TERMS.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div>
                        <label
                          htmlFor="student-proof-method"
                          className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                        >
                          Payment Method
                        </label>
                        <select
                          id="student-proof-method"
                          value={proofMethod}
                          onChange={(e) =>
                            setProofMethod(
                              e.target.value as 'Bank Deposit' | 'Airtel Money' | 'TNM Mpamba'
                            )
                          }
                          className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium"
                        >
                          {STUDENT_PAYMENT_METHODS.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label
                          htmlFor="student-proof-amount"
                          className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                        >
                          Amount Paid (MWK)
                        </label>
                        <input
                          id="student-proof-amount"
                          type="number"
                          min="1"
                          max="100000000"
                          required
                          value={proofAmountStr}
                          onChange={(e) => setProofAmountStr(e.target.value)}
                          placeholder="e.g. 50000"
                          className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm font-semibold"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="student-proof-reference"
                          className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                        >
                          Transaction / Slip Reference
                        </label>
                        <input
                          id="student-proof-reference"
                          type="text"
                          maxLength={80}
                          value={proofReference}
                          onChange={(e) => setProofReference(e.target.value)}
                          placeholder="e.g. NBM-88412 or Airtel ID"
                          className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-xs"
                        />
                      </div>
                    </div>

                    {/* PDF / Image Drop Zone */}
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        Payment Proof File (PDF or Image, max 8 MB)
                      </label>
                      <div
                        onDragOver={(e) => {
                          e.preventDefault();
                          setProofFileDragActive(true);
                        }}
                        onDragLeave={() => setProofFileDragActive(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setProofFileDragActive(false);
                          const dropped = e.dataTransfer.files?.[0] || null;
                          void handleProofFileSelected(dropped);
                        }}
                        className={`rounded-xl border border-dashed p-4 transition-colors ${
                          proofFileDragActive
                            ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/30'
                            : 'border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/50'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-9 w-9 rounded-xl bg-emerald-100/80 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
                              {parsedProofFile?.fileFormat === 'image' ? (
                                <ImageIcon className="w-4 h-4" aria-hidden="true" />
                              ) : (
                                <FileText className="w-4 h-4" aria-hidden="true" />
                              )}
                            </div>
                            <div className="min-w-0">
                              {parsedProofFile ? (
                                <>
                                  <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                                    {parsedProofFile.fileName}
                                  </div>
                                  <div className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
                                    {parsedProofFile.fileFormat === 'pdf' ? 'PDF Document' : 'Image'} ·{' '}
                                    {formatFileSizeLabel(parsedProofFile.fileSizeBytes)}
                                  </div>
                                </>
                              ) : (
                                <div className="text-xs text-slate-600 dark:text-slate-300">
                                  Drop bank deposit slip or mobile money screenshot (.pdf, .png, .jpg, .webp)
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {parsedProofFile && (
                              <button
                                type="button"
                                onClick={() => setParsedProofFile(null)}
                                className="min-h-[34px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 cursor-pointer"
                              >
                                Clear
                              </button>
                            )}
                            <label className="inline-flex items-center gap-1.5 min-h-[36px] px-3.5 rounded-xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>{parsedProofFile ? 'Replace File' : 'Choose PDF / Image'}</span>
                              <input
                                type="file"
                                accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"
                                className="sr-only"
                                onChange={(e) => {
                                  const f = e.target.files?.[0] || null;
                                  e.currentTarget.value = '';
                                  void handleProofFileSelected(f);
                                }}
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                      {proofFileError && (
                        <div className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">
                          {proofFileError}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div className="flex-1 min-w-[220px]">
                        <label
                          htmlFor="student-proof-notes"
                          className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                        >
                          Optional Note
                        </label>
                        <input
                          id="student-proof-notes"
                          type="text"
                          maxLength={240}
                          value={proofNotes}
                          onChange={(e) => setProofNotes(e.target.value)}
                          placeholder="e.g. Payer name or deposit branch"
                          className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={submittingProof || !isOnline || !parsedProofFile}
                        className="inline-flex items-center gap-2 min-h-[40px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-45 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>
                          {submittingProof
                            ? proofProgress || 'Uploading...'
                            : 'Submit Payment Reference'}
                        </span>
                      </button>
                    </div>
                  </form>
                </section>

                {/* Submitted Payment References History */}
                <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Submitted Payment References ({feeSubmissions.length})
                    </h2>
                  </div>

                  {loadingFeeSubmissions ? (
                    <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                      Loading submitted proofs...
                    </div>
                  ) : feeSubmissions.length === 0 ? (
                    <div className="py-10 px-6 text-center text-xs text-slate-500 dark:text-slate-400">
                      No payment references submitted yet.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                            <th className="py-3 px-4 font-medium">Date &amp; Term</th>
                            <th className="py-3 px-3 font-medium">Channel &amp; Ref</th>
                            <th className="py-3 px-3 font-medium">File</th>
                            <th className="py-3 px-3 font-medium text-right">Amount</th>
                            <th className="py-3 px-3 font-medium">Status</th>
                            <th className="py-3 px-4 font-medium text-right">Proof</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                          {feeSubmissions.map((sub) => (
                            <tr key={sub.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                              <td className="py-3 px-4">
                                <div className="font-mono text-xs text-slate-900 dark:text-slate-100">
                                  {sub.submittedDate}
                                </div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                  {sub.term} · {sub.academicYear}
                                </div>
                              </td>
                              <td className="py-3 px-3">
                                <div className="text-xs font-medium text-slate-800 dark:text-slate-200">
                                  {sub.method}
                                </div>
                                <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                  {sub.reference || '—'}
                                </div>
                              </td>
                              <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-300">
                                <div className="truncate max-w-[180px]">{sub.fileName}</div>
                                <div className="text-[11px] font-mono text-slate-400">
                                  {sub.fileFormat === 'pdf' ? 'PDF' : 'Image'} ·{' '}
                                  {formatFileSizeLabel(sub.fileSizeBytes)}
                                </div>
                              </td>
                              <td className="py-3 px-3 text-right font-mono text-xs tabular-nums font-semibold">
                                {formatMWK(sub.amount)}
                              </td>
                              <td className="py-3 px-3 text-xs">
                                <div
                                  className={`font-semibold ${
                                    sub.status === 'Approved'
                                      ? 'text-emerald-700 dark:text-emerald-400'
                                      : sub.status === 'Rejected'
                                      ? 'text-rose-600 dark:text-rose-400'
                                      : 'text-amber-700 dark:text-amber-400'
                                  }`}
                                >
                                  {sub.status}
                                </div>
                                {sub.receiptNo && (
                                  <div className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
                                    {sub.receiptNo}
                                  </div>
                                )}
                                {sub.reviewNote && (
                                  <div className="text-[11px] text-slate-500 dark:text-slate-400 max-w-[200px]">
                                    {sub.reviewNote}
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-4 text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => setPreviewSubmission(sub)}
                                  className="inline-flex items-center gap-1 min-h-[34px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                                >
                                  <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>View</span>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </main>

      {/* Reserve Checked-Out Book Modal */}
      <ModalBackdrop
        open={Boolean(reserveModalBook && activePortal)}
        disabled={submittingReservation}
        ariaLabelledBy="reserve-book-modal-title"
        onClose={() => setReserveModalBook(null)}
      >
        {reserveModalBook && activePortal && (
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookmarkPlus className="w-4 h-4 text-amber-600" aria-hidden="true" />
                <h2
                  id="reserve-book-modal-title"
                  className="text-sm font-bold text-slate-900 dark:text-white"
                >
                  Reserve Library Book
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setReserveModalBook(null)}
                aria-label="Close reservation dialog"
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmReserve} className="p-5 space-y-4">
              <DraftRestoredNotice
                visible={reserveDraftRestored}
                onDiscard={handleDiscardReserveDraft}
              />

              <div className="rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5 space-y-1">
                <div className="text-xs font-bold text-slate-900 dark:text-white">
                  {reserveModalBook.title}
                </div>
                <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  {reserveModalBook.author} · ISBN {reserveModalBook.isbn} · {reserveModalBook.subject}
                </div>
                <div className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                  All {reserveModalBook.totalCopies}{' '}
                  {reserveModalBook.totalCopies === 1 ? 'copy is' : 'copies are'} currently checked out
                </div>
              </div>

              <div>
                <label
                  htmlFor="student-reserve-notes"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Optional Note to School Librarian
                </label>
                <textarea
                  id="student-reserve-notes"
                  rows={2}
                  maxLength={240}
                  value={reserveNotes}
                  onChange={(e) => setReserveNotes(e.target.value)}
                  placeholder="e.g. Needed for Form 4 term revision"
                  className="w-full rounded-xl bg-white dark:bg-[#0D1117] border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
                />
              </div>

              {reservationError && (
                <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                  {reservationError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setReserveModalBook(null)}
                  className="min-h-[38px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingReservation}
                  className="min-h-[38px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-45 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {submittingReservation ? 'Sending Request...' : 'Submit Reservation'}
                </button>
              </div>
            </form>
          </div>
        )}
      </ModalBackdrop>

      {/* Protected Read-Only Online/Offline Reader */}
      <OnlineLibraryReaderModal
        resource={activeReaderResource}
        isSavedOffline={activeReaderResource ? offlineIds.has(activeReaderResource.id) : false}
        savingOffline={
          activeReaderResource ? savingOfflineId === activeReaderResource.id : false
        }
        onToggleOffline={handleToggleOfflineResource}
        scopeKey={studentScopeKey}
        ownerId={activePortal?.ownerId}
        registrationCode={registrationCode}
        isRead={activeReaderResource ? Boolean(progressMap[activeReaderResource.id]?.isRead) : false}
        lastReadPage={
          activeReaderResource ? progressMap[activeReaderResource.id]?.lastReadPage || 0 : 0
        }
        onlineReadersCount={
          activeReaderResource ? readingCounts.onlineByResource[activeReaderResource.id] || 0 : 0
        }
        offlineReadersCount={
          activeReaderResource ? readingCounts.offlineByResource[activeReaderResource.id] || 0 : 0
        }
        onToggleRead={(res) => toggleMarkAsRead(res.id)}
        onProgressChange={(resourceId, page, total, mode) =>
          recordPageProgress(resourceId, page, total, mode)
        }
        onClose={() => setActiveReaderResource(null)}
      />

      {/* Student Change Password / PIN Modal */}
      <ModalBackdrop
        open={showPasswordModal}
        onClose={() => {
          if (!passwordModalSaving) {
            setShowPasswordModal(false);
          }
        }}
      >
        <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-7 max-w-md w-full space-y-4 shadow-xl">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400">
                <KeyRound className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Change Password / PIN
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Protect your report card, fee records, and library account
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowPasswordModal(false)}
              disabled={passwordModalSaving}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {passwordModalSuccess && (
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 px-3.5 py-2.5 text-xs text-emerald-800 dark:text-emerald-200">
              {passwordModalSuccess}
            </div>
          )}

          {passwordModalError && (
            <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
              {passwordModalError}
            </div>
          )}

          <form onSubmit={handleUpdateStudentPassword} className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Current Password or PIN
              </label>
              <input
                type="password"
                required
                value={currentPasswordInput}
                onChange={(e) => setCurrentPasswordInput(e.target.value)}
                placeholder="Default is Admission No. (e.g. 2026/001)"
                className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                New Password or PIN
              </label>
              <input
                type="password"
                required
                minLength={4}
                value={newPasswordInput}
                onChange={(e) => setNewPasswordInput(e.target.value)}
                placeholder="Min. 4 characters / numbers"
                className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Confirm New Password or PIN
              </label>
              <input
                type="password"
                required
                minLength={4}
                value={confirmPasswordInput}
                onChange={(e) => setConfirmPasswordInput(e.target.value)}
                placeholder="Re-enter new password or PIN"
                className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div className="pt-2 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowPasswordModal(false)}
                disabled={passwordModalSaving}
                className="min-h-[40px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={passwordModalSaving}
                className="min-h-[40px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                {passwordModalSaving ? 'Saving...' : 'Update Password'}
              </button>
            </div>
          </form>
        </div>
      </ModalBackdrop>

      {/* Payment Proof Preview Modal */}
      <PaymentProofPreviewModal
        submission={previewSubmission}
        onClose={() => setPreviewSubmission(null)}
      />

      {/* Docked Full-Width Bottom Navigation Bar: Exam Results, Library, Fees */}
      {!portalLoading && activePortal && summary && (
        <nav
          aria-label="Student portal sections"
          className="fixed bottom-0 left-0 right-0 z-30 w-full bg-white/95 dark:bg-[#161B22]/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 pb-[env(safe-area-inset-bottom)] print:hidden"
        >
          <div className="w-full grid grid-cols-3 items-stretch">
            {(
              [
                { id: 'results', label: 'Results & Report', icon: Award },
                { id: 'library', label: 'Library', icon: BookOpen },
                { id: 'fees', label: 'Fees', icon: Banknote },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectTab(active ? 'dashboard' : item.id)}
                  aria-pressed={active}
                  className={`flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-2 min-h-[52px] px-2 py-1.5 text-[11px] sm:text-xs font-semibold leading-none whitespace-nowrap cursor-pointer transition-colors ${
                    active
                      ? 'bg-emerald-700 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="truncate max-w-full">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}

      <OfflineIndicator hasBottomNav={!portalLoading && Boolean(activePortal && summary)} />
    </div>
  );
};
