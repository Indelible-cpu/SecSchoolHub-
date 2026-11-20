import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import {
  AlertTriangle,
  Award,
  BookmarkCheck,
  BookmarkPlus,
  BookOpen,
  Building2,
  CheckCircle2,
  Clock,
  CloudOff,
  FileDown,
  FileText,
  Globe,
  GraduationCap,
  KeyRound,
  Lock,
  LogOut,
  Moon,
  Printer,
  Search,
  Sun,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { createLibraryReservation } from '../../school/firestoreService';
import {
  calculateTermReportSummary,
  DIGITAL_RESOURCE_CATEGORIES,
  getLibraryDaysOverdue,
  getLibraryDueReminderLabel,
  isLibraryLoanDueWithin48Hours,
  isLibraryLoanOverdue,
  TERMS,
} from '../../school/malawi';
import {
  getOfflineDigitalResources,
  OfflineDigitalResourceRecord,
  removeOfflineDigitalResource,
  saveDigitalResourceOffline,
  saveDigitalResourcesBatchOffline,
} from '../../school/offlineLibraryDb';
import { downloadStudentTermReportCardPdf } from '../../school/pdfReports';
import {
  Assessment,
  CatalogBookMirror,
  DigitalLibraryResource,
  DigitalResourceCategory,
  DigitalResourceFormLevel,
  LibraryLoan,
  LibraryReservation,
  School,
  Student,
  StudentPortal,
  TermName,
} from '../../school/types';
import { OfflineIndicator } from '../OfflineIndicator';
import { PWAInstallButton } from '../PWAInstallButton';
import { SubjectComponentBarChart } from './AnalyticsCharts';
import { OnlineLibraryReaderModal, ReadableDigitalResource } from './OnlineLibraryReaderModal';

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

function toOfflineRecord(resource: DigitalLibraryResource): OfflineDigitalResourceRecord {
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
  const [portalLoading, setPortalLoading] = useState(true);
  const [activePortal, setActivePortal] = useState<StudentPortal | null>(() =>
    registrationCode ? readCachedJson<StudentPortal>(`malawisec_student_portal_${registrationCode}`) : null
  );
  const [selectedTerm, setSelectedTerm] = useState<TermName>('Term 2');
  const [termInitializedForCode, setTermInitializedForCode] = useState<string>('');
  const [assessments, setAssessments] = useState<Assessment[]>(() =>
    registrationCode ? readCachedJson<Assessment[]>(`malawisec_student_results_${registrationCode}`) || [] : []
  );
  const [loadingResults, setLoadingResults] = useState(true);
  const [libraryLoans, setLibraryLoans] = useState<LibraryLoan[]>(() =>
    registrationCode ? readCachedJson<LibraryLoan[]>(`malawisec_student_loans_${registrationCode}`) || [] : []
  );
  const [loadingLibrary, setLoadingLibrary] = useState(true);

  // Physical Catalog & Reservations
  const [catalogBooks, setCatalogBooks] = useState<CatalogBookMirror[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogFilter, setCatalogFilter] = useState<'all' | 'checked_out' | 'available'>('all');
  const [reservations, setReservations] = useState<LibraryReservation[]>([]);
  const [loadingReservations, setLoadingReservations] = useState(true);
  const [reserveModalBook, setReserveModalBook] = useState<CatalogBookMirror | null>(null);
  const [reserveNotes, setReserveNotes] = useState('');
  const [submittingReservation, setSubmittingReservation] = useState(false);
  const [reservationError, setReservationError] = useState('');
  const [reservationFeedback, setReservationFeedback] = useState('');

  // Online / Offline Non-Downloadable Library
  const [liveDigitalResources, setLiveDigitalResources] = useState<DigitalLibraryResource[]>([]);
  const [offlineDigitalRecords, setOfflineDigitalRecords] = useState<OfflineDigitalResourceRecord[]>([]);
  const [loadingDigitalLibrary, setLoadingDigitalLibrary] = useState(true);
  const [digitalSearch, setDigitalSearch] = useState('');
  const [digitalCategoryFilter, setDigitalCategoryFilter] = useState<
    'All' | DigitalResourceCategory | 'Saved Offline'
  >('All');
  const [digitalFormFilter, setDigitalFormFilter] = useState<'All' | DigitalResourceFormLevel>('All');
  const [activeReaderResource, setActiveReaderResource] = useState<ReadableDigitalResource | null>(null);
  const [savingOfflineId, setSavingOfflineId] = useState<string | null>(null);
  const [savingAllOffline, setSavingAllOffline] = useState(false);
  const [offlineSyncFeedback, setOfflineSyncFeedback] = useState('');

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
      setSelectedTerm(activePortal.currentTerm);
      setTermInitializedForCode(activePortal.registrationCode);
    }
  }, [activePortal, termInitializedForCode]);

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

    const resultsRef = collection(db, 'studentPortals', registrationCode, 'results');
    const unsub = onSnapshot(
      resultsRef,
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

  // Hydrate Offline IndexedDB Digital Library for student's school immediately
  useEffect(() => {
    let cancelled = false;
    if (!activePortal?.schoolId) {
      setOfflineDigitalRecords([]);
      return;
    }
    getOfflineDigitalResources(activePortal.schoolId).then((records) => {
      if (!cancelled) {
        setOfflineDigitalRecords(records);
      }
    });
    return () => {
      cancelled = true;
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

  const offlineIds = useMemo(
    () => new Set(offlineDigitalRecords.map((r) => r.id)),
    [offlineDigitalRecords]
  );

  // Refresh already-saved offline items whenever live copies update
  useEffect(() => {
    if (!activePortal?.schoolId || liveDigitalResources.length === 0 || offlineIds.size === 0) {
      return;
    }
    const toRefresh = liveDigitalResources
      .filter((item) => item.allowOffline && offlineIds.has(item.id))
      .map(toOfflineRecord);
    if (toRefresh.length === 0) return;

    saveDigitalResourcesBatchOffline(toRefresh).then((count) => {
      if (count > 0) {
        getOfflineDigitalResources(activePortal.schoolId).then(setOfflineDigitalRecords);
      }
    });
  }, [activePortal?.schoolId, liveDigitalResources, offlineIds]);

  const mergedDigitalResources = useMemo<ReadableDigitalResource[]>(() => {
    if (liveDigitalResources.length === 0) {
      return offlineDigitalRecords;
    }
    const byId = new Map<string, ReadableDigitalResource>();
    for (const item of liveDigitalResources) {
      byId.set(item.id, item);
    }
    for (const cached of offlineDigitalRecords) {
      if (!byId.has(cached.id)) {
        byId.set(cached.id, cached);
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.title.localeCompare(b.title));
  }, [liveDigitalResources, offlineDigitalRecords]);

  const filteredDigitalResources = useMemo(() => {
    const q = digitalSearch.trim().toLowerCase();
    return mergedDigitalResources.filter((r) => {
      if (digitalCategoryFilter === 'Saved Offline') {
        if (!offlineIds.has(r.id)) return false;
      } else if (digitalCategoryFilter !== 'All' && r.category !== digitalCategoryFilter) {
        return false;
      }
      if (digitalFormFilter !== 'All' && r.formLevel !== 'All' && r.formLevel !== digitalFormFilter) {
        return false;
      }
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.author.toLowerCase().includes(q) ||
        r.subject.toLowerCase().includes(q) ||
        (r.examYear || '').toLowerCase().includes(q) ||
        (r.summary || '').toLowerCase().includes(q)
      );
    });
  }, [
    digitalCategoryFilter,
    digitalFormFilter,
    digitalSearch,
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

  const termAssessments = useMemo(
    () => assessments.filter((a) => a.term === selectedTerm),
    [assessments, selectedTerm]
  );

  const summary = useMemo(() => {
    if (!activePortal) return null;
    return calculateTermReportSummary(activePortal.formLevel, termAssessments);
  }, [activePortal, termAssessments]);

  const libraryAlerts = useMemo(() => {
    const dueSoonLoans = libraryLoans.filter((l) => isLibraryLoanDueWithin48Hours(l, todayIso));
    const overdueLoans = libraryLoans.filter((l) => isLibraryLoanOverdue(l, todayIso));
    return { dueSoonLoans, overdueLoans };
  }, [libraryLoans, todayIso]);

  const handleDownloadPdf = () => {
    if (!activePortal || !summary || summary.rows.length === 0) return;
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
    downloadStudentTermReportCardPdf({
      school: viewSchool,
      student: viewStudent,
      term: selectedTerm,
      summary,
    });
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
      const eligible = mergedDigitalResources
        .filter((r) => r.allowOffline)
        .map((r) => ({
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
          allowOffline: r.allowOffline,
          savedAt: new Date().toISOString(),
        }));
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

  const openReserveModal = (book: CatalogBookMirror) => {
    setReserveModalBook(book);
    setReserveNotes('');
    setReservationError('');
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
      setReservationFeedback(
        `Reservation requested for "${reserveModalBook.title}". The librarian will mark it Ready when a copy is returned.`
      );
      setReserveModalBook(null);
      setReserveNotes('');
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

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F8FA] dark:bg-[#0D1117] text-slate-900 dark:text-slate-100">
      <header className="sticky top-0 z-30 h-16 bg-white/95 dark:bg-[#161B22]/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-5xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
              <GraduationCap className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold tracking-tight text-slate-900 dark:text-white truncate">
                {activePortal ? activePortal.schoolName : 'SecSchoolHub Student Portal'}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate font-mono">
                Student Portal · Code: {registrationCode}
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
            <PWAInstallButton variant="header" />
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

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
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
              . Please check the code carefully or ask your school administrator or form master to
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
            {/* Student Profile Header & Controls */}
            <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    {activePortal.schoolName} · {activePortal.schoolDistrict} District ·{' '}
                    {activePortal.schoolType}
                  </div>
                  <h1 className="mt-1 text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                    {activePortal.studentName}
                  </h1>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Admission #: <span className="font-mono font-semibold">{activePortal.admissionNo}</span> ·{' '}
                    Form {activePortal.formLevel}
                    {activePortal.stream} ({activePortal.formLevel <= 2 ? 'JCE' : 'MSCE'}) ·{' '}
                    {activePortal.boardingStatus} · {activePortal.academicYear}
                    {activePortal.status !== 'Active' ? ` · ${activePortal.status}` : ''}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    disabled={summary.rows.length === 0}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Print Report</span>
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
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
                  {TERMS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setSelectedTerm(t)}
                      className={`min-h-[36px] px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                        selectedTerm === t
                          ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-3 text-xs font-mono text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    {isOnline ? (
                      <Wifi className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                    ) : (
                      <WifiOff className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
                    )}
                    <span>{isOnline ? 'Online' : 'Offline Mode'}</span>
                  </span>
                  <span>·</span>
                  <span>
                    Reg. Code:{' '}
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {activePortal.registrationCode}
                    </span>
                  </span>
                </div>
              </div>

              {(libraryAlerts.dueSoonLoans.length > 0 || libraryAlerts.overdueLoans.length > 0) && (
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
                </div>
              )}
            </section>

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

            {/* Subject Results Table */}
            <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Award className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {selectedTerm} Examination Results
                  </h2>
                </div>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  CA1 20% + CA2 20% + Exam 60%
                </span>
              </div>

              {loadingResults ? (
                <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                  Loading exam results...
                </div>
              ) : summary.rows.length === 0 ? (
                <div className="py-12 px-6 text-center text-sm text-slate-500 dark:text-slate-400">
                  No published marks for {selectedTerm} ({activePortal.academicYear}).
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
                              {a.subject}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums">
                              {r.hasCa1 ? (
                                <div>
                                  <div>{r.ca1Score.toFixed(1)}</div>
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
                                  <div>{r.ca2Score.toFixed(1)}</div>
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
                                  <div>{r.examScore.toFixed(1)}</div>
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
                              {r.totalScore.toFixed(1)}%
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
            </section>

            {/* Student Library Materials & Due Dates */}
            <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    School Library Books Assigned
                  </h2>
                </div>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                  {libraryLoans.filter((l) => l.status === 'Checked Out').length} currently checked out
                  {libraryAlerts.dueSoonLoans.length > 0 && (
                    <span className="text-amber-700 dark:text-amber-400 font-semibold">
                      {' '}
                      · {libraryAlerts.dueSoonLoans.length} due in 48h
                    </span>
                  )}
                </span>
              </div>

              {loadingLibrary ? (
                <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                  Loading library records...
                </div>
              ) : libraryLoans.length === 0 ? (
                <div className="py-10 px-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  No library textbooks or reading materials are assigned to your registration code yet.
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
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Online Library · Digital Books &amp; Past Papers
                    </h2>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Read study guides, set books, and JCE/MSCE past papers when physical copies are unavailable · Save in-app for offline reading (downloads disabled).
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300">
                    <Lock className="w-3 h-3 text-slate-500" aria-hidden="true" />
                    <span>Read-Only · No Downloads</span>
                  </span>
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
              </div>

              <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/60 dark:bg-slate-900/40 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(['All', ...DIGITAL_RESOURCE_CATEGORIES, 'Saved Offline'] as const).map((cat) => {
                      const active = digitalCategoryFilter === cat;
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setDigitalCategoryFilter(cat)}
                          className={`min-h-[32px] px-3 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
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

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="Filter digital library by form level"
                      value={digitalFormFilter}
                      onChange={(e) =>
                        setDigitalFormFilter(e.target.value as 'All' | DigitalResourceFormLevel)
                      }
                      className="min-h-[34px] px-2.5 rounded-lg bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200"
                    >
                      <option value="All">All Forms</option>
                      <option value={studentFormLabel}>My Level ({studentFormLabel})</option>
                      <option value="Form 1">Form 1</option>
                      <option value="Form 2">Form 2</option>
                      <option value="Form 3">Form 3</option>
                      <option value="Form 4">Form 4</option>
                    </select>

                    <div className="relative min-w-[200px]">
                      <Search
                        className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                        aria-hidden="true"
                      />
                      <input
                        type="search"
                        aria-label="Search digital books and past papers"
                        value={digitalSearch}
                        onChange={(e) => setDigitalSearch(e.target.value)}
                        placeholder="Search title, subject, year..."
                        className="w-full min-h-[34px] pl-8 pr-3 rounded-lg bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
                      />
                    </div>
                  </div>
                </div>

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
                  <div className="py-10 px-4 text-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                    {mergedDigitalResources.length === 0
                      ? isOnline
                        ? 'Your school librarian has not published online books or past papers yet.'
                        : 'No offline books or past papers have been cached on this device yet. Connect to the internet once to save reading materials for offline study.'
                      : 'No digital books or past papers match your current search or filter.'}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredDigitalResources.map((item) => {
                      const isSaved = offlineIds.has(item.id);
                      const isPastPaper = item.category === 'Past Paper';
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
                          </div>

                          <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => setActiveReaderResource(item)}
                              className="inline-flex items-center gap-1.5 min-h-[36px] px-3.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>{isOnline ? 'Read Online' : 'Read Offline'}</span>
                            </button>

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
                <div>
                  <div className="flex items-center gap-2">
                    <BookmarkPlus
                      className="w-4 h-4 text-emerald-700 dark:text-emerald-400"
                      aria-hidden="true"
                    />
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Physical Book Catalog &amp; Reservations
                    </h2>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Check shelf availability or reserve a physical book that is currently checked out.
                  </p>
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
                    You have not reserved any checked-out books yet. Click Reserve on any checked-out book above to queue a request.
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
      </main>

      {/* Reserve Checked-Out Book Modal */}
      {reserveModalBook && activePortal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reserve-book-modal-title"
        >
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
        </div>
      )}

      {/* Protected Read-Only Online/Offline Reader */}
      <OnlineLibraryReaderModal
        resource={activeReaderResource}
        isSavedOffline={activeReaderResource ? offlineIds.has(activeReaderResource.id) : false}
        savingOffline={
          activeReaderResource ? savingOfflineId === activeReaderResource.id : false
        }
        onToggleOffline={handleToggleOfflineResource}
        onClose={() => setActiveReaderResource(null)}
      />

      <OfflineIndicator />
    </div>
  );
};
