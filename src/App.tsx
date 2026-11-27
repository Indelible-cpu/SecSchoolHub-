import { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import {
  LayoutDashboard,
  Users,
  Award,
  Banknote,
  BookOpen,
  Settings,
  LogOut,
  Moon,
  Sun,
  ShieldAlert,
  Clock,
  Camera,
  GraduationCap,
} from 'lucide-react';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  signInWithGoogle,
  signInWithEmail,
  registerWithEmail,
  signOutUser,
  testConnection,
} from './firebase';
import {
  Assessment,
  AttendanceRecord,
  BackupSettings,
  BackupSnapshotLog,
  DigitalLibraryResource,
  FeeInvoice,
  FeePayment,
  LibraryBook,
  LibraryLoan,
  LibraryReservation,
  LibraryTransaction,
  School,
  SchoolAnnouncement,
  SchoolSection,
  SchoolSubject,
  SmsConfig,
  SmsLog,
  StaffAttendanceRecord,
  StaffLink,
  StaffTimebookEntry,
  Student,
  StudentCase,
  StudentFeeSubmission,
  StudentReportRemark,
  Teacher,
  TimebookAuditLog,
  TimebookCorrectionRequest,
  TimebookSettings,
  TimebookSuspiciousLog,
  WorkspaceRole,
} from './school/types';
import {
  formatSchoolTypeLabel,
  getRolePermissions,
  normalizeRegistrationCode,
  sortStudentsForRegister,
} from './school/malawi';
import {
  updateSchoolSettings,
  syncMissingPortalFeeInvoices,
  syncMissingPortalResults,
  updateOwnUserProfilePhoto,
  upsertUserProfile,
} from './school/firestoreService';
import { getStudentInitials, isValidStudentPhotoDataUrl } from './school/studentPhotoHelper';
import { isScheduledBackupDue } from './school/backupSnapshotUtils';
import { runFullSchoolBackup } from './school/backupService';
import { buildDefaultTimebookSettings } from './school/timebookUtils';
import { syncTimebookPolicyToServer } from './school/timebookApi';
import { SchoolOnboarding } from './components/school/SchoolOnboarding';
import { OverviewDashboard } from './components/school/OverviewDashboard';
import { StudentsManager } from './components/school/StudentsManager';
import { MarksGradebook } from './components/school/MarksGradebook';
import { FeesBursar } from './components/school/FeesBursar';
import { SchoolLibrary } from './components/school/SchoolLibrary';
import { StaffAndSettings } from './components/school/StaffAndSettings';
import { StaffTimebookStaffView } from './components/school/StaffTimebookStaffView';
import { StudentResultsPortal } from './components/school/StudentResultsPortal';
import { StudentPhotoCaptureModal } from './components/school/StudentPhotoCaptureModal';
import { LandingPage } from './components/school/LandingPage';
import { SecSchoolHubLoader } from './components/SecSchoolHubLoader';
import { OfflineIndicator } from './components/OfflineIndicator';

const NAV_ITEMS: { id: SchoolSection; label: string; shortLabel: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Dashboard', shortLabel: 'Dashboard', icon: LayoutDashboard },
  { id: 'students', label: 'Students (Form 1–4)', shortLabel: 'Students', icon: Users },
  { id: 'marks', label: 'CA & End Term Exam', shortLabel: 'CA & Exam', icon: Award },
  { id: 'fees', label: 'Fees & Bursar (MK)', shortLabel: 'Fees', icon: Banknote },
  { id: 'library', label: 'School Library', shortLabel: 'Library', icon: BookOpen },
  { id: 'timebook', label: 'Staff Timebook', shortLabel: 'Timebook', icon: Clock },
  { id: 'staff', label: 'Staff & Settings', shortLabel: 'Staff', icon: Settings },
];

const MOBILE_GRID_COLS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
  7: 'grid-cols-7',
};

const ADMIN_ROLE_OPTIONS: { value: WorkspaceRole; label: string }[] = [
  { value: 'Owner', label: 'Head Teacher (School Admin)' },
  { value: 'Deputy Head', label: 'Act as Deputy Head' },
  { value: 'Head of Department', label: 'Act as Head of Department' },
  { value: 'Form Teacher', label: 'Act as Form Teacher' },
  { value: 'Subject Teacher', label: 'Act as Subject Teacher' },
  { value: 'School Bursar', label: 'Act as School Bursar' },
  { value: 'School Librarian', label: 'Act as School Librarian' },
];

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState('');

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return window.localStorage.getItem('malawisec_theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  const [activeSection, setActiveSection] = useState<SchoolSection>(() => {
    try {
      const sectionParam = new URLSearchParams(window.location.search).get('section');
      if (sectionParam === 'timebook') return 'timebook';
    } catch {
      // Ignore URL parse issues
    }
    return 'overview';
  });
  const [userPhotoDataUrl, setUserPhotoDataUrl] = useState('');
  const [userPhotoFailed, setUserPhotoFailed] = useState(false);
  const [userPhotoModalOpen, setUserPhotoModalOpen] = useState(false);
  const [savingUserPhoto, setSavingUserPhoto] = useState(false);
  const [userPhotoError, setUserPhotoError] = useState('');

  const [studentsLaunch, setStudentsLaunch] = useState<{
    tab: 'directory' | 'gallery' | 'attendance' | 'cases';
    nonce: number;
  } | null>(null);
  const [staffLaunch, setStaffLaunch] = useState<{
    tab: 'directory' | 'timebook' | 'backups';
    nonce: number;
  } | null>(null);
  const [libraryLaunch, setLibraryLaunch] = useState<{
    tab: 'catalog' | 'reservations' | 'online';
    audience?: 'all' | 'teaching' | 'student';
    nonce: number;
  } | null>(null);
  const [portalOverride, setPortalOverride] = useState<'auto' | 'workspace' | 'student'>('auto');

  const [studentSessionCode, setStudentSessionCode] = useState<string>(() => {
    try {
      const saved = window.localStorage.getItem('malawisec_student_code') || '';
      const norm = normalizeRegistrationCode(saved);
      return norm.length >= 6 ? norm : '';
    } catch {
      return '';
    }
  });
  const [studentCodeInput, setStudentCodeInput] = useState('');
  const [studentPasswordInput, setStudentPasswordInput] = useState('');
  const [verifyingStudentCode, setVerifyingStudentCode] = useState(false);

  const [schoolsLoading, setSchoolsLoading] = useState(true);
  const [ownedSchools, setOwnedSchools] = useState<School[]>([]);
  const [staffLinksLoading, setStaffLinksLoading] = useState(true);
  const [staffLinks, setStaffLinks] = useState<StaffLink[]>([]);
  const [staffSchoolsMap, setStaffSchoolsMap] = useState<Record<string, School>>({});
  const [activeSchoolId, setActiveSchoolId] = useState<string | null>(null);
  const [creatingAnotherSchool, setCreatingAnotherSchool] = useState(false);
  const [adminCheckLoading, setAdminCheckLoading] = useState(false);
  const [isAdminDoc, setIsAdminDoc] = useState(false);
  const [adminActingRole, setAdminActingRole] = useState<WorkspaceRole | null>(null);

  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [schoolSubjects, setSchoolSubjects] = useState<SchoolSubject[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [reportRemarks, setReportRemarks] = useState<StudentReportRemark[]>([]);
  const [invoices, setInvoices] = useState<FeeInvoice[]>([]);
  const [payments, setPayments] = useState<FeePayment[]>([]);
  const [feeSubmissions, setFeeSubmissions] = useState<StudentFeeSubmission[]>([]);
  const [smsLogs, setSmsLogs] = useState<SmsLog[]>([]);
  const [smsConfig, setSmsConfig] = useState<SmsConfig | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [staffAttendance, setStaffAttendance] = useState<StaffAttendanceRecord[]>([]);
  const [studentCases, setStudentCases] = useState<StudentCase[]>([]);
  const [libraryLoans, setLibraryLoans] = useState<LibraryLoan[]>([]);
  const [libraryBooks, setLibraryBooks] = useState<LibraryBook[]>([]);
  const [libraryTransactions, setLibraryTransactions] = useState<LibraryTransaction[]>([]);
  const [libraryReservations, setLibraryReservations] = useState<LibraryReservation[]>([]);
  const [digitalLibraryResources, setDigitalLibraryResources] = useState<DigitalLibraryResource[]>([]);
  const [announcements, setAnnouncements] = useState<SchoolAnnouncement[]>([]);
  const [timebookSettings, setTimebookSettings] = useState<TimebookSettings | null>(null);
  const [timebookEntries, setTimebookEntries] = useState<StaffTimebookEntry[]>([]);
  const [timebookCorrectionRequests, setTimebookCorrectionRequests] = useState<
    TimebookCorrectionRequest[]
  >([]);
  const [timebookAuditLogs, setTimebookAuditLogs] = useState<TimebookAuditLog[]>([]);
  const [timebookSuspiciousLogs, setTimebookSuspiciousLogs] = useState<TimebookSuspiciousLog[]>(
    []
  );
  const [backupSettings, setBackupSettings] = useState<BackupSettings | null>(null);
  const [backupLogs, setBackupLogs] = useState<BackupSnapshotLog[]>([]);
  const [autoBackupInFlight, setAutoBackupInFlight] = useState(false);
  const autoBackupRunningRef = useRef(false);
  const syncedFeeMirrorRef = useRef<Set<string>>(new Set());
  const syncedResultMirrorRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    testConnection();
  }, []);

  useEffect(() => {
    const isDark = theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    try {
      window.localStorage.setItem('malawisec_theme', theme);
    } catch {
      // Ignore storage error
    }
  }, [theme]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setOwnedSchools([]);
        setStaffLinks([]);
        setStaffSchoolsMap({});
        setActiveSchoolId(null);
        setSchoolsLoading(false);
        setStaffLinksLoading(false);
        setAdminCheckLoading(false);
        setIsAdminDoc(false);
        setAdminActingRole(null);
        setPortalOverride('auto');
        setCreatingAnotherSchool(false);
        setStudents([]);
        setTeachers([]);
        setSchoolSubjects([]);
        setAssessments([]);
        setInvoices([]);
        setPayments([]);
        setFeeSubmissions([]);
        setSmsLogs([]);
        setSmsConfig(null);
        setAttendance([]);
        setStaffAttendance([]);
        setStudentCases([]);
        setLibraryLoans([]);
        setLibraryBooks([]);
        setLibraryTransactions([]);
        setLibraryReservations([]);
        setDigitalLibraryResources([]);
        setAnnouncements([]);
        setTimebookSettings(null);
        setTimebookEntries([]);
        setTimebookCorrectionRequests([]);
        setTimebookAuditLogs([]);
        setTimebookSuspiciousLogs([]);
        setBackupSettings(null);
        setBackupLogs([]);
        setUserPhotoDataUrl('');
        setUserPhotoFailed(false);
        return;
      }

      setAdminCheckLoading(true);
      try {
        const [profileSnap, adminSnap] = await Promise.all([
          getDoc(doc(db, 'users', nextUser.uid)),
          getDoc(doc(db, 'admins', nextUser.uid)).catch(() => null),
        ]);
        setIsAdminDoc(Boolean(adminSnap?.exists()));
        if (profileSnap.exists()) {
          const data = profileSnap.data() as { activeSchoolId?: string; photoDataUrl?: string };
          if (data.activeSchoolId) {
            setActiveSchoolId(data.activeSchoolId);
          }
          setUserPhotoDataUrl(
            data.photoDataUrl && isValidStudentPhotoDataUrl(data.photoDataUrl)
              ? data.photoDataUrl
              : ''
          );
          setUserPhotoFailed(false);
        } else {
          setUserPhotoDataUrl('');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message.toLowerCase() : '';
        if (!msg.includes('offline') && !msg.includes('unavailable')) {
          handleFirestoreError(err, OperationType.GET, `users/${nextUser.uid}`);
        }
      } finally {
        setAdminCheckLoading(false);
      }
    });
    return () => unsub();
  }, []);

  // Subscribe to owned schools (School Owner / Admin)
  useEffect(() => {
    if (!authReady || !user) return;
    setSchoolsLoading(true);
    const schoolsQuery = query(collection(db, 'schools'), where('ownerId', '==', user.uid));
    const unsub = onSnapshot(
      schoolsQuery,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<School, 'id'>) }));
        setOwnedSchools(list);
        setSchoolsLoading(false);
      },
      (error) => {
        setSchoolsLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'schools');
      }
    );
    return () => unsub();
  }, [authReady, user]);

  // Subscribe to linked staff roles (Teachers, Bursars, Deputy Heads, Head Teachers)
  useEffect(() => {
    if (!authReady || !user) return;
    const normalizedEmail = (user.email || '').trim().toLowerCase();
    if (!normalizedEmail) {
      setStaffLinks([]);
      setStaffLinksLoading(false);
      return;
    }
    setStaffLinksLoading(true);
    const q = query(
      collection(db, 'staffLinks'),
      where('staffEmail', '==', normalizedEmail)
    );
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<StaffLink, 'id'>),
        }));
        setStaffLinks(list);
        setStaffLinksLoading(false);
      },
      (error) => {
        setStaffLinksLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'staffLinks');
      }
    );
    return () => unsub();
  }, [authReady, user]);

  const activeStaffLinks = useMemo(
    () => staffLinks.filter((l) => l.status === 'Active'),
    [staffLinks]
  );

  // Subscribe to live School documents for linked staff workspaces (excluding already owned schools)
  const staffSchoolIdsToFetch = useMemo(() => {
    const ownedIds = new Set(ownedSchools.map((s) => s.id));
    const unique = new Set<string>();
    for (const link of activeStaffLinks) {
      if (!ownedIds.has(link.schoolId)) {
        unique.add(link.schoolId);
      }
    }
    return Array.from(unique).sort();
  }, [activeStaffLinks, ownedSchools]);

  const staffSchoolIdsKey = staffSchoolIdsToFetch.join(',');

  useEffect(() => {
    if (!authReady || !user || staffSchoolIdsToFetch.length === 0) {
      setStaffSchoolsMap({});
      return;
    }

    const unsubs = staffSchoolIdsToFetch.map((sid) =>
      onSnapshot(
        doc(db, 'schools', sid),
        (snap) => {
          setStaffSchoolsMap((prev) => {
            if (!snap.exists()) {
              const next = { ...prev };
              delete next[sid];
              return next;
            }
            return {
              ...prev,
              [sid]: { id: snap.id, ...(snap.data() as Omit<School, 'id'>) },
            };
          });
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, `schools/${sid}`);
        }
      )
    );

    return () => {
      for (const unsub of unsubs) {
        unsub();
      }
    };
  }, [authReady, user, staffSchoolIdsKey]);

  const waitingForStaffSchoolDoc = useMemo(
    () => staffSchoolIdsToFetch.some((sid) => !staffSchoolsMap[sid]),
    [staffSchoolIdsToFetch, staffSchoolsMap]
  );

  // Unified list of accessible workspaces (owned first, then staff-linked)
  const workspaceEntries = useMemo(() => {
    const entries: { school: School; role: WorkspaceRole; staffLink: StaffLink | null }[] = [];
    const seen = new Set<string>();
    for (const s of ownedSchools) {
      seen.add(s.id);
      entries.push({ school: s, role: 'Owner', staffLink: null });
    }
    for (const link of activeStaffLinks) {
      if (seen.has(link.schoolId)) continue;
      const sch = staffSchoolsMap[link.schoolId];
      if (sch) {
        seen.add(link.schoolId);
        entries.push({ school: sch, role: link.roleTitle, staffLink: link });
      }
    }
    return entries;
  }, [activeStaffLinks, ownedSchools, staffSchoolsMap]);

  const accessibleSchools = useMemo(
    () => workspaceEntries.map((e) => e.school),
    [workspaceEntries]
  );

  const activeEntry = useMemo(() => {
    if (workspaceEntries.length === 0) return null;
    return (
      workspaceEntries.find((e) => e.school.id === activeSchoolId) || workspaceEntries[0]
    );
  }, [activeSchoolId, workspaceEntries]);

  const activeSchool = activeEntry?.school || null;
  const activeRole: WorkspaceRole = activeEntry?.role || 'Owner';
  const isTrueOwner = activeEntry?.role === 'Owner';
  const linkedStaffForActiveSchool = useMemo(() => {
    if (!activeSchool) return null;
    return activeStaffLinks.find((l) => l.schoolId === activeSchool.id) || null;
  }, [activeSchool, activeStaffLinks]);
  const effectiveRole: WorkspaceRole =
    isTrueOwner && adminActingRole ? adminActingRole : activeRole;
  const activeStaffLink =
    isTrueOwner && adminActingRole
      ? linkedStaffForActiveSchool && linkedStaffForActiveSchool.roleTitle === adminActingRole
        ? linkedStaffForActiveSchool
        : null
      : activeEntry?.staffLink || null;
  const rolePermissions = useMemo(() => getRolePermissions(effectiveRole), [effectiveRole]);
  const isPlatformAdmin = useMemo(() => {
    if (!user) return false;
    const normalizedEmail = (user.email || '').trim().toLowerCase();
    return normalizedEmail === 'firestore730@gmail.com' || normalizedEmail === 'dicksonpetroj1@gmail.com' || isAdminDoc;
  }, [isAdminDoc, user]);

  const visibleNavItems = useMemo(
    () => NAV_ITEMS.filter((item) => rolePermissions.allowedSections.includes(item.id)),
    [rolePermissions.allowedSections]
  );

  // Keep activeSection within the logged-in user's permitted modules
  useEffect(() => {
    if (!rolePermissions.allowedSections.includes(activeSection)) {
      setActiveSection('overview');
    }
  }, [activeSection, rolePermissions.allowedSections]);

  const effectivePortalMode: 'workspace' | 'student' = useMemo(() => {
    if (portalOverride !== 'auto') return portalOverride;
    if (studentSessionCode && !user) return 'student';
    return 'workspace';
  }, [portalOverride, studentSessionCode, user]);

  const canReadSubjects =
    rolePermissions.canReadMarks || rolePermissions.allowedSections.includes('staff');

  // Role-scoped subcollection subscriptions for activeSchool
  useEffect(() => {
    if (!authReady || !user || !activeSchool || effectivePortalMode !== 'workspace') {
      setStudents([]);
      setTeachers([]);
      setSchoolSubjects([]);
      setAssessments([]);
      setReportRemarks([]);
      setInvoices([]);
      setPayments([]);
      setSmsLogs([]);
      setSmsConfig(null);
      setAttendance([]);
      setStaffAttendance([]);
      setStudentCases([]);
      setLibraryLoans([]);
      setLibraryBooks([]);
      setLibraryTransactions([]);
      setLibraryReservations([]);
      setDigitalLibraryResources([]);
      setAnnouncements([]);
      setTimebookSettings(null);
      setTimebookEntries([]);
      setTimebookCorrectionRequests([]);
      setTimebookAuditLogs([]);
      setTimebookSuspiciousLogs([]);
      return;
    }

    const schoolId = activeSchool.id;
    const schoolOwnerId = activeSchool.ownerId;

    const unsubs: (() => void)[] = [];

    // Announcements readable by all active school staff
    unsubs.push(
      onSnapshot(
        query(collection(db, 'schools', schoolId, 'announcements'), where('ownerId', '==', schoolOwnerId)),
        (snap) => {
          const list = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<SchoolAnnouncement, 'id'>),
          }));
          list.sort((a, b) => {
            const dateCmp = (b.publishedDate || '').localeCompare(a.publishedDate || '');
            if (dateCmp !== 0) return dateCmp;
            const tA = a.createdAt?.toMillis?.() || 0;
            const tB = b.createdAt?.toMillis?.() || 0;
            return tB - tA;
          });
          setAnnouncements(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/announcements`)
      )
    );

    // Students list is readable by all active school staff (Owner, Head, Deputy, Teachers, Bursar)
    unsubs.push(
      onSnapshot(
        query(collection(db, 'schools', schoolId, 'students'), where('ownerId', '==', schoolOwnerId)),
        (snap) => {
          const list = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Student, 'id'>),
          }));
          setStudents(sortStudentsForRegister(list));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/students`)
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'schools', schoolId, 'studentCases'), where('ownerId', '==', schoolOwnerId)),
        (snap) => {
          const list = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<StudentCase, 'id'>),
          }));
          list.sort((a, b) => {
            const dateCmp = (b.incidentDate || '').localeCompare(a.incidentDate || '');
            if (dateCmp !== 0) return dateCmp;
            return (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0);
          });
          setStudentCases(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/studentCases`)
      )
    );

    if (rolePermissions.canReadTeachers) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'schools', schoolId, 'teachers'), where('ownerId', '==', schoolOwnerId)),
          (snap) => {
            setTeachers(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Teacher, 'id'>) })));
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/teachers`)
        )
      );
    } else {
      setTeachers([]);
    }

    if (rolePermissions.canReadMarks) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'schools', schoolId, 'assessments'), where('ownerId', '==', schoolOwnerId)),
          (snap) => {
            setAssessments(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Assessment, 'id'>) })));
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/assessments`)
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'schools', schoolId, 'reportRemarks'), where('ownerId', '==', schoolOwnerId)),
          (snap) => {
            setReportRemarks(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StudentReportRemark, 'id'>) }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/reportRemarks`)
        )
      );
    } else {
      setAssessments([]);
      setReportRemarks([]);
    }

    if (rolePermissions.canReadFees) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'schools', schoolId, 'feeInvoices'), where('ownerId', '==', schoolOwnerId)),
          (snap) => {
            setInvoices(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FeeInvoice, 'id'>) })));
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/feeInvoices`)
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'schools', schoolId, 'feePayments'), where('ownerId', '==', schoolOwnerId)),
          (snap) => {
            setPayments(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FeePayment, 'id'>) })));
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/feePayments`)
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'schools', schoolId, 'feeSubmissions'), where('ownerId', '==', schoolOwnerId)),
          (snap) => {
            const list = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<StudentFeeSubmission, 'id'>),
            }));
            list.sort((a, b) => {
              const tA = a.createdAt?.toMillis?.() || 0;
              const tB = b.createdAt?.toMillis?.() || 0;
              if (tA !== tB) return tB - tA;
              return (b.submittedDate || '').localeCompare(a.submittedDate || '');
            });
            setFeeSubmissions(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/feeSubmissions`)
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'schools', schoolId, 'smsLogs'), where('ownerId', '==', schoolOwnerId)),
          (snap) => {
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SmsLog, 'id'>) }));
            list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
            setSmsLogs(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/smsLogs`)
        )
      );
      unsubs.push(
        onSnapshot(
          doc(db, 'schools', schoolId, 'smsSettings', 'default'),
          (snap) => {
            if (snap.exists()) {
              setSmsConfig({ id: snap.id, ...(snap.data() as Omit<SmsConfig, 'id'>) });
            } else {
              setSmsConfig(null);
            }
          },
          (err) => handleFirestoreError(err, OperationType.GET, `schools/${schoolId}/smsSettings/default`)
        )
      );
    } else {
      setInvoices([]);
      setPayments([]);
      setFeeSubmissions([]);
      setSmsLogs([]);
      setSmsConfig(null);
    }

    if (rolePermissions.canReadAttendance) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'schools', schoolId, 'attendance'), where('ownerId', '==', schoolOwnerId)),
          (snap) => {
            setAttendance(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AttendanceRecord, 'id'>) })));
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/attendance`)
        )
      );
    } else {
      setAttendance([]);
    }

    if (rolePermissions.canReadStaffAttendance) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'schools', schoolId, 'staffAttendance'), where('ownerId', '==', schoolOwnerId)),
          (snap) => {
            setStaffAttendance(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StaffAttendanceRecord, 'id'>) }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/staffAttendance`)
        )
      );
    } else {
      setStaffAttendance([]);
    }

    // Staff Timebook Configuration (readable by all active school staff)
    unsubs.push(
      onSnapshot(
        doc(db, 'schools', schoolId, 'timebookSettings', 'default'),
        (snap) => {
          if (snap.exists()) {
            setTimebookSettings({
              id: snap.id,
              ...(snap.data() as Omit<TimebookSettings, 'id'>),
            });
          } else {
            setTimebookSettings(null);
          }
        },
        (err) => handleFirestoreError(err, OperationType.GET, `schools/${schoolId}/timebookSettings/default`)
      )
    );

    // Staff Timebook Entries: Heads/Owner read whole school; individual staff read only their own entries
    unsubs.push(
      onSnapshot(
        rolePermissions.canReadStaffAttendance
          ? query(collection(db, 'schools', schoolId, 'timebookEntries'), where('ownerId', '==', schoolOwnerId))
          : query(collection(db, 'schools', schoolId, 'timebookEntries'), where('staffUid', '==', user.uid)),
        (snap) => {
          const list = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<StaffTimebookEntry, 'id'>),
          }));
          list.sort((a, b) => b.date.localeCompare(a.date));
          setTimebookEntries(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/timebookEntries`)
      )
    );

    // Staff Timebook Correction Requests: Owner reads all requests; staff read only their own requests
    unsubs.push(
      onSnapshot(
        rolePermissions.canManageTimebook
          ? query(collection(db, 'schools', schoolId, 'timebookCorrectionRequests'), where('ownerId', '==', schoolOwnerId))
          : query(collection(db, 'schools', schoolId, 'timebookCorrectionRequests'), where('staffUid', '==', user.uid)),
        (snap) => {
          const list = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<TimebookCorrectionRequest, 'id'>),
          }));
          list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
          setTimebookCorrectionRequests(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/timebookCorrectionRequests`)
      )
    );

    if (rolePermissions.canReadStaffAttendance) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'schools', schoolId, 'timebookAuditLogs'), where('ownerId', '==', schoolOwnerId)),
          (snap) => {
            const list = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<TimebookAuditLog, 'id'>),
            }));
            list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
            setTimebookAuditLogs(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/timebookAuditLogs`)
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'schools', schoolId, 'timebookSuspiciousLogs'), where('ownerId', '==', schoolOwnerId)),
          (snap) => {
            const list = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<TimebookSuspiciousLog, 'id'>),
            }));
            list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
            setTimebookSuspiciousLogs(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/timebookSuspiciousLogs`)
        )
      );
    } else {
      setTimebookAuditLogs([]);
      setTimebookSuspiciousLogs([]);
    }

    if (canReadSubjects) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'schools', schoolId, 'subjects'), where('ownerId', '==', schoolOwnerId)),
          (snap) => {
            const list = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<SchoolSubject, 'id'>),
            }));
            list.sort((a, b) => a.name.localeCompare(b.name));
            setSchoolSubjects(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/subjects`)
        )
      );
    } else {
      setSchoolSubjects([]);
    }

    if (rolePermissions.canReadLibrary) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'schools', schoolId, 'libraryLoans'), where('ownerId', '==', schoolOwnerId)),
          (snap) => {
            setLibraryLoans(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LibraryLoan, 'id'>) }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/libraryLoans`)
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'schools', schoolId, 'libraryBooks'), where('ownerId', '==', schoolOwnerId)),
          (snap) => {
            const list = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<LibraryBook, 'id'>),
            }));
            list.sort((a, b) => a.title.localeCompare(b.title));
            setLibraryBooks(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/libraryBooks`)
        )
      );
      unsubs.push(
        onSnapshot(
          query(
            collection(db, 'schools', schoolId, 'libraryTransactions'),
            where('ownerId', '==', schoolOwnerId)
          ),
          (snap) => {
            const list = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<LibraryTransaction, 'id'>),
            }));
            list.sort((a, b) => {
              const tA = a.createdAt?.toMillis?.() || 0;
              const tB = b.createdAt?.toMillis?.() || 0;
              if (tA !== tB) return tB - tA;
              return (b.eventDate || '').localeCompare(a.eventDate || '');
            });
            setLibraryTransactions(list);
          },
          (err) =>
            handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/libraryTransactions`)
        )
      );
      unsubs.push(
        onSnapshot(
          query(
            collection(db, 'schools', schoolId, 'libraryReservations'),
            where('ownerId', '==', schoolOwnerId)
          ),
          (snap) => {
            const list = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<LibraryReservation, 'id'>),
            }));
            list.sort((a, b) => {
              const tA = a.createdAt?.toMillis?.() || 0;
              const tB = b.createdAt?.toMillis?.() || 0;
              if (tA !== tB) return tB - tA;
              return (b.requestedDate || '').localeCompare(a.requestedDate || '');
            });
            setLibraryReservations(list);
          },
          (err) =>
            handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/libraryReservations`)
        )
      );
      unsubs.push(
        onSnapshot(
          query(
            collection(db, 'schools', schoolId, 'digitalLibrary'),
            where('ownerId', '==', schoolOwnerId)
          ),
          (snap) => {
            const list = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<DigitalLibraryResource, 'id'>),
            }));
            list.sort((a, b) => a.title.localeCompare(b.title));
            setDigitalLibraryResources(list);
          },
          (err) =>
            handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/digitalLibrary`)
        )
      );
    } else {
      setLibraryLoans([]);
      setLibraryBooks([]);
      setLibraryTransactions([]);
      setLibraryReservations([]);
      setDigitalLibraryResources([]);
    }

    if (isTrueOwner && rolePermissions.role === 'Owner') {
      unsubs.push(
        onSnapshot(
          doc(db, 'schools', schoolId, 'backupSettings', 'default'),
          (snap) => {
            if (snap.exists()) {
              setBackupSettings({
                id: snap.id,
                ...(snap.data() as Omit<BackupSettings, 'id'>),
              });
            } else {
              setBackupSettings(null);
            }
          },
          (err) =>
            handleFirestoreError(err, OperationType.GET, `schools/${schoolId}/backupSettings/default`)
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'schools', schoolId, 'backupLogs'), where('ownerId', '==', schoolOwnerId)),
          (snap) => {
            const list = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<BackupSnapshotLog, 'id'>),
            }));
            list.sort((a, b) => (b.completedAtIso || '').localeCompare(a.completedAtIso || ''));
            setBackupLogs(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/backupLogs`)
        )
      );
    } else {
      setBackupSettings(null);
      setBackupLogs([]);
    }

    return () => {
      for (const unsub of unsubs) {
        unsub();
      }
    };
  }, [
    activeSchool,
    authReady,
    canReadSubjects,
    effectivePortalMode,
    isTrueOwner,
    rolePermissions.canReadAttendance,
    rolePermissions.canReadFees,
    rolePermissions.canReadLibrary,
    rolePermissions.canReadMarks,
    rolePermissions.canReadStaffAttendance,
    rolePermissions.canManageTimebook,
    rolePermissions.canReadTeachers,
    rolePermissions.role,
    user,
  ]);

  // Synchronize school geofence settings and active staff roster to backend enforcement & scheduler
  useEffect(() => {
    if (!activeSchool || !user || !rolePermissions.canManageTimebook) return;
    const effectiveSettings =
      timebookSettings || buildDefaultTimebookSettings(activeSchool.id, activeSchool.ownerId);
    syncTimebookPolicyToServer({
      schoolId: activeSchool.id,
      schoolName: activeSchool.name,
      ownerId: activeSchool.ownerId,
      settings: effectiveSettings,
      teachers,
    }).catch(() => undefined);
  }, [activeSchool, rolePermissions.canManageTimebook, teachers, timebookSettings, user]);

  // Automated Firestore database backup scheduler for verified School Owners
  useEffect(() => {
    if (!activeSchool || !user || !isTrueOwner || rolePermissions.role !== 'Owner') return;
    if (!backupSettings?.autoBackupEnabled) return;

    const cooldownKey = `secschoolhub_autobackup_attempt_${activeSchool.id}`;

    const maybeTriggerScheduledBackup = async () => {
      if (autoBackupRunningRef.current) return;
      if (!isScheduledBackupDue(backupSettings, Date.now())) return;
      try {
        const lastAttempt = Number(window.sessionStorage.getItem(cooldownKey) || '0');
        if (Number.isFinite(lastAttempt) && Date.now() - lastAttempt < 15 * 60 * 1000) {
          return;
        }
        window.sessionStorage.setItem(cooldownKey, String(Date.now()));
      } catch {
        // Ignore sessionStorage errors
      }

      autoBackupRunningRef.current = true;
      setAutoBackupInFlight(true);
      try {
        await runFullSchoolBackup({
          school: activeSchool,
          triggerType: 'automated',
          preferredTarget: backupSettings.storageTarget,
          existingSettings: backupSettings,
          existingLogs: backupLogs,
          triggeredByName: user.displayName || user.email || 'School Owner',
        });
      } catch {
        // Recorded in backupLogs as Failed; cooldown prevents retry loops
      } finally {
        autoBackupRunningRef.current = false;
        setAutoBackupInFlight(false);
      }
    };

    void maybeTriggerScheduledBackup();
    const interval = window.setInterval(() => {
      void maybeTriggerScheduledBackup();
    }, 15 * 60 * 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [activeSchool, backupLogs, backupSettings, isTrueOwner, rolePermissions.role, user]);

  const matchedTimebookTeacher: Teacher | null = useMemo(() => {
    if (activeStaffLink) {
      const fromRoster = teachers.find((t) => t.id === activeStaffLink.teacherId);
      if (fromRoster) return fromRoster;
      return {
        id: activeStaffLink.teacherId,
        ownerId: activeStaffLink.ownerId,
        staffCode: activeStaffLink.staffCode,
        fullName: activeStaffLink.staffName,
        roleTitle: activeStaffLink.roleTitle,
        subjects: activeStaffLink.subjects || [],
        assignedForm: activeStaffLink.assignedForm || 'Unassigned',
        phone: '',
        staffEmail: activeStaffLink.staffEmail,
        qualification: '',
        status: activeStaffLink.status,
      };
    }
    const email = user?.email?.trim().toLowerCase();
    if (!email) return null;
    return teachers.find((t) => t.staffEmail?.trim().toLowerCase() === email) || null;
  }, [activeStaffLink, teachers, user?.email]);

  // Backfill any pre-existing school invoices onto student portal mirrors once per school session
  useEffect(() => {
    if (
      !activeSchool ||
      !rolePermissions.canWriteFees ||
      students.length === 0 ||
      invoices.length === 0
    ) {
      return;
    }
    const syncKey = `${activeSchool.id}_${students.length}_${invoices.length}`;
    if (syncedFeeMirrorRef.current.has(syncKey)) return;
    syncedFeeMirrorRef.current.add(syncKey);
    syncMissingPortalFeeInvoices(activeSchool.id, activeSchool.ownerId, students, invoices).catch(
      () => undefined
    );
  }, [activeSchool, invoices, rolePermissions.canWriteFees, students]);

  // Backfill any missing or out-of-sync CA / exam marks onto student portal mirrors
  useEffect(() => {
    if (
      !activeSchool ||
      (!rolePermissions.canWriteMarks && !rolePermissions.canManageStudents) ||
      students.length === 0 ||
      assessments.length === 0
    ) {
      return;
    }
    const codedCount = students.filter((s) => (s.registrationCode || '').trim().length >= 6).length;
    const syncKey = `${activeSchool.id}_${students.length}_${codedCount}_${assessments.length}`;
    if (syncedResultMirrorRef.current.has(syncKey)) return;
    syncedResultMirrorRef.current.add(syncKey);
    syncMissingPortalResults(activeSchool, activeSchool.ownerId, students, assessments, {
      canCreatePortal: rolePermissions.canManageStudents,
    }).catch(() => undefined);
  }, [
    activeSchool,
    assessments,
    rolePermissions.canManageStudents,
    rolePermissions.canWriteMarks,
    students,
  ]);

  const handleGoogleSignIn = () => {
    let authPromise: ReturnType<typeof signInWithGoogle>;
    try {
      authPromise = signInWithGoogle();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign-in cancelled or failed.');
      return;
    }

    setAuthError('');
    setSigningIn(true);

    authPromise
      .then(() => {
        setStudentSessionCode('');
        setPortalOverride('workspace');
        try {
          window.localStorage.removeItem('malawisec_student_code');
        } catch {}
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Sign-in cancelled or failed.';
        if (msg.includes('closed-by-user') || msg.includes('cancelled-popup')) {
          return;
        }
        setAuthError(msg);
      })
      .finally(() => {
        setSigningIn(false);
      });
  };

  const handleEmailSignIn = async (email: string, pass: string) => {
    setAuthError('');
    setSigningIn(true);
    try {
      await signInWithEmail(email, pass);
      setStudentSessionCode('');
      setPortalOverride('workspace');
      try {
        window.localStorage.removeItem('malawisec_student_code');
      } catch {}
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (
        code === 'auth/invalid-credential' ||
        code === 'auth/wrong-password' ||
        code === 'auth/user-not-found'
      ) {
        setAuthError('Incorrect email or password. Please try again.');
      } else if (code === 'auth/too-many-requests') {
        setAuthError('Too many failed attempts. Please try again in a few moments.');
      } else {
        setAuthError(err instanceof Error ? err.message : 'Sign-in failed.');
      }
    } finally {
      setSigningIn(false);
    }
  };

  const handleEmailRegister = async (email: string, pass: string) => {
    setAuthError('');
    setSigningIn(true);
    try {
      await registerWithEmail(email, pass);
      setStudentSessionCode('');
      setPortalOverride('workspace');
      try {
        window.localStorage.removeItem('malawisec_student_code');
      } catch {}
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/email-already-in-use') {
        setAuthError('An account with this email already exists. Please sign in instead.');
      } else if (code === 'auth/weak-password') {
        setAuthError('Password must be at least 6 characters long.');
      } else {
        setAuthError(err instanceof Error ? err.message : 'Registration failed.');
      }
    } finally {
      setSigningIn(false);
    }
  };

  const handleUnifiedSignIn = async (identifier: string, pass: string) => {
    const trimmed = identifier.trim();
    if (trimmed.includes('@')) {
      await handleEmailSignIn(trimmed, pass);
    } else {
      const normalized = normalizeRegistrationCode(trimmed);
      if (normalized.length < 6) {
        setAuthError(
          'Enter the registration code given by your school administrator (at least 6 characters).'
        );
        return;
      }

      setAuthError('');
      const enteredPassword = pass.trim();
      if (!enteredPassword) {
        setAuthError(
          'Please enter your Student Password or PIN. Default password is your school Admission Number (e.g. 2026/001).'
        );
        return;
      }

      setVerifyingStudentCode(true);
      try {
        const portalSnap = await getDoc(doc(db, 'studentPortals', normalized));
        if (!portalSnap.exists()) {
          setAuthError(
            'Registration code not found. Check the code with your school administrator or form teacher.'
          );
          return;
        }
        const portalData = portalSnap.data() as StudentPortal;
        const expectedPassword = (portalData.portalPassword || portalData.admissionNo || '').trim();
        const isPasswordMatch = portalData.portalPassword
          ? portalData.portalPassword.trim() === enteredPassword
          : expectedPassword.toLowerCase() === enteredPassword.toLowerCase();
        if (!isPasswordMatch) {
          setAuthError(
            'Incorrect password or PIN. The default password is your school Admission Number (e.g. 2026/001). Contact your school administrator or form teacher if you need assistance.'
          );
          return;
        }
        try {
          window.localStorage.setItem('malawisec_student_code', normalized);
        } catch {
          // Ignore storage error
        }
        setStudentSessionCode(normalized);
        setStudentPasswordInput('');
        setPortalOverride('student');
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.toLowerCase().includes('offline') || msg.toLowerCase().includes('unavailable')) {
          let hasOfflinePortal = false;
          try {
            const cached = window.localStorage.getItem(`malawisec_student_portal_${normalized}`);
            if (cached) {
              const parsed = JSON.parse(cached) as StudentPortal;
              const expectedPassword = (parsed.portalPassword || parsed.admissionNo || '').trim();
              const isPasswordMatch = parsed.portalPassword
                ? parsed.portalPassword.trim() === enteredPassword
                : expectedPassword.toLowerCase() === enteredPassword.toLowerCase();
              if (isPasswordMatch) {
                hasOfflinePortal = true;
              }
            }
          } catch {
            hasOfflinePortal = false;
          }
          if (hasOfflinePortal) {
            try {
              window.localStorage.setItem('malawisec_student_code', normalized);
            } catch {
              // Ignore storage error
            }
            setStudentSessionCode(normalized);
            setPortalOverride('student');
            return;
          }
          setAuthError(
            'Unable to reach the school database right now. Connect to the internet once to sync your portal and offline library.'
          );
        } else {
          setAuthError(msg || 'Unable to verify registration code right now.');
        }
      } finally {
        setVerifyingStudentCode(false);
      }
    }
  };

  const handleStudentCodeSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeRegistrationCode(studentCodeInput);
    if (normalized.length < 6) {
      setAuthError(
        'Enter the registration code given by your school administrator (at least 6 characters).'
      );
      return;
    }

    setAuthError('');
    const enteredPassword = studentPasswordInput.trim();
    if (!enteredPassword) {
      setAuthError(
        'Please enter your Student Password or PIN. Default password is your school Admission Number (e.g. 2026/001).'
      );
      return;
    }

    setVerifyingStudentCode(true);
    try {
      const portalSnap = await getDoc(doc(db, 'studentPortals', normalized));
      if (!portalSnap.exists()) {
        setAuthError(
          'Registration code not found. Check the code with your school administrator or form teacher.'
        );
        return;
      }
      const portalData = portalSnap.data() as StudentPortal;
      const expectedPassword = (portalData.portalPassword || portalData.admissionNo || '').trim();
      const isPasswordMatch = portalData.portalPassword
        ? portalData.portalPassword.trim() === enteredPassword
        : expectedPassword.toLowerCase() === enteredPassword.toLowerCase();
      if (!isPasswordMatch) {
        setAuthError(
          'Incorrect password or PIN. The default password is your school Admission Number (e.g. 2026/001). Contact your school administrator or form teacher if you need assistance.'
        );
        return;
      }
      try {
        window.localStorage.setItem('malawisec_student_code', normalized);
      } catch {
        // Ignore storage error
      }
      setStudentSessionCode(normalized);
      setStudentPasswordInput('');
      setPortalOverride('student');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.toLowerCase().includes('offline') || msg.toLowerCase().includes('unavailable')) {
        let hasOfflinePortal = false;
        try {
          const cached = window.localStorage.getItem(`malawisec_student_portal_${normalized}`);
          if (cached) {
            const parsed = JSON.parse(cached) as StudentPortal;
            const expectedPassword = (parsed.portalPassword || parsed.admissionNo || '').trim();
            const isPasswordMatch = parsed.portalPassword
              ? parsed.portalPassword.trim() === enteredPassword
              : expectedPassword.toLowerCase() === enteredPassword.toLowerCase();
            if (isPasswordMatch) {
              hasOfflinePortal = true;
            }
          }
        } catch {
          hasOfflinePortal = false;
        }
        if (hasOfflinePortal) {
          try {
            window.localStorage.setItem('malawisec_student_code', normalized);
          } catch {
            // Ignore storage error
          }
          setStudentSessionCode(normalized);
          setPortalOverride('student');
          return;
        }
        setAuthError(
          'Unable to reach the school database right now. Connect to the internet once to sync your portal and offline library.'
        );
      } else {
        setAuthError(msg || 'Unable to verify registration code right now.');
      }
    } finally {
      setVerifyingStudentCode(false);
    }
  };

  const handleStudentSignOut = () => {
    try {
      window.localStorage.removeItem('malawisec_student_code');
    } catch {
      // Ignore storage error
    }
    setStudentSessionCode('');
    setStudentCodeInput('');
    setStudentPasswordInput('');
    setAuthError('');
    setPortalOverride('auto');
    setLoginIntent('student');
  };

  const handleSchoolSelected = async (schoolId: string) => {
    setActiveSchoolId(schoolId);
    setCreatingAnotherSchool(false);
    setAdminActingRole(null);
    setPortalOverride('workspace');
    setActiveSection('overview');
    if (user) {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        await upsertUserProfile({
          uid: user.uid,
          displayName: user.displayName || 'School Staff',
          email: user.email || '',
          activeSchoolId: schoolId,
          isNew: !snap.exists(),
        });
      } catch {
        // Profile pointer update is non-blocking
      }
    }
  };

  if (!authReady) {
    return <SecSchoolHubLoader message="Connecting to school portal..." />;
  }

  // Student Registration Code Portal (does not require Google email sign-in)
  if (studentSessionCode && (!user || portalOverride === 'student')) {
    return (
      <StudentResultsPortal
        registrationCode={studentSessionCode}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        onSignOut={handleStudentSignOut}
        hasAdminWorkspace={Boolean(user && workspaceEntries.length > 0)}
        onSwitchToAdmin={() => setPortalOverride('workspace')}
      />
    );
  }

  // Unauthenticated Landing / Portal Sign-In Gate
  if (!user) {
    return (
      <>
        <LandingPage
          signingIn={signingIn || verifyingStudentCode}
          authError={authError}
          onSignIn={handleUnifiedSignIn}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        />
        <OfflineIndicator />
      </>
    );
  }

  // Loading schools / staff links / admin authorization
  if (schoolsLoading || staffLinksLoading || waitingForStaffSchoolDoc || adminCheckLoading) {
    return <SecSchoolHubLoader message="Loading school workspace..." />;
  }

  // Strict authorization gate: unlinked or unauthorized accounts only see Sign Out (no school creation bypass)
  if (!activeSchool && !isPlatformAdmin) {
    return (
      <div className="min-h-[100dvh] w-full flex flex-col bg-[#F7F8FA] dark:bg-[#0D1117] text-slate-900 dark:text-slate-100">
        <header className="h-14 w-full border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#161B22]">
          <div className="w-full h-full px-4 sm:px-6 flex items-center justify-between">
            <span className="text-base font-bold text-slate-900 dark:text-white">SecSchoolHub</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => signOutUser()}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="h-11 w-11 rounded-xl bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center text-amber-700 dark:text-amber-400">
              <ShieldAlert className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">
                Account Not Authorized Yet
              </h1>
              <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Signed in as{' '}
                <strong className="text-slate-900 dark:text-slate-200">{user.email}</strong>.{' '}
                Access to institutional records is restricted to authorized school administrators and pre-linked staff accounts. Ask your Head Teacher or School Administrator to add this email in Staff &amp; Settings.
              </p>
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => signOutUser()}
                className="w-full min-h-[42px] px-4 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90 transition-opacity cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </main>
        <OfflineIndicator />
      </div>
    );
  }

  // Onboarding is strictly restricted to authorized platform administrators
  if (isPlatformAdmin && (!activeSchool || creatingAnotherSchool)) {
    return (
      <div className="min-h-[100dvh] w-full bg-[#F7F8FA] dark:bg-[#0D1117]">
        <header className="h-14 w-full border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#161B22]">
          <div className="w-full h-full px-4 sm:px-6 flex items-center justify-between">
            <span className="text-base font-bold text-slate-900 dark:text-white">SecSchoolHub</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => signOutUser()}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </header>
        <SchoolOnboarding
          ownerId={user.uid}
          ownerDisplayName={user.displayName || 'School Administrator'}
          ownerEmail={user.email || ''}
          onSchoolReady={handleSchoolSelected}
          onCancel={activeSchool ? () => setCreatingAnotherSchool(false) : undefined}
        />
      </div>
    );
  }

  if (!activeSchool) {
    return null;
  }

  const currentNavLabel =
    visibleNavItems.find((n) => n.id === activeSection)?.label || 'Dashboard';
  const mobileGridClass = MOBILE_GRID_COLS[visibleNavItems.length] || 'grid-cols-4';

  return (
    <div className="min-h-[100dvh] w-full flex bg-[#F7F8FA] dark:bg-[#0D1117] text-slate-900 dark:text-slate-100">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-68 shrink-0 border-r border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-[#11161F]/75 backdrop-blur-2xl sticky top-0 h-screen overflow-hidden z-20 shadow-[4px_0_24px_rgba(0,0,0,0.03)] dark:shadow-[4px_0_32px_rgba(0,0,0,0.4)]">
        <div className="h-18 px-4 sm:px-5 flex items-center gap-3 border-b border-slate-200/60 dark:border-white/10 shrink-0 bg-white/40 dark:bg-white/[0.02] backdrop-blur-md">
          {activeSchool.logoDataUrl ? (
            <div className="h-10 w-10 rounded-xl border border-emerald-600/20 dark:border-emerald-500/30 bg-white dark:bg-slate-900 overflow-hidden shrink-0 flex items-center justify-center shadow-xs ring-2 ring-emerald-500/10">
              <img
                src={activeSchool.logoDataUrl}
                alt={`${activeSchool.name} logo`}
                className="h-full w-full object-contain p-0.5"
              />
            </div>
          ) : (
            <div className="h-10 w-10 rounded-full border border-sky-400/30 bg-white dark:bg-slate-900 overflow-hidden shrink-0 flex items-center justify-center shadow-xs">
              <img
                src="/brand-logo.png"
                alt="SecSchoolHub logo"
                className="h-full w-full object-contain"
              />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <span className="block text-sm font-bold tracking-tight text-slate-900 dark:text-white truncate">
              {activeSchool.name}
            </span>
            <span className="block text-[11px] font-medium text-emerald-700 dark:text-emerald-400 font-mono truncate">
              SecSchoolHub
            </span>
          </div>
        </div>

        {workspaceEntries.length > 1 && (
          <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800/80 shrink-0">
            <select
              aria-label="Switch school workspace"
              value={activeSchool.id}
              onChange={(e) => handleSchoolSelected(e.target.value)}
              className="w-full min-h-[34px] px-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-800 dark:text-slate-200"
            >
              {workspaceEntries.map((entry) => (
                <option key={entry.school.id} value={entry.school.id}>
                  {entry.school.name} ({entry.role})
                </option>
              ))}
            </select>
          </div>
        )}

        <nav className="flex-1 p-3 space-y-1.5 overflow-y-auto" aria-label="School management modules">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                className={`relative group w-full min-h-[44px] px-3.5 py-2.5 rounded-xl flex items-center gap-3 text-xs sm:text-sm font-medium transition-all duration-150 cursor-pointer ${
                  active
                    ? 'bg-emerald-500/15 dark:bg-emerald-400/15 text-emerald-950 dark:text-emerald-200 font-semibold shadow-[0_4px_16px_rgba(16,185,129,0.12)] border border-emerald-500/25 dark:border-emerald-400/25 backdrop-blur-md'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-white/[0.06] hover:text-slate-900 dark:hover:text-white hover:backdrop-blur-md hover:shadow-xs'
                }`}
              >
                {active && (
                  <span
                    className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-emerald-600 dark:bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.6)]"
                    aria-hidden="true"
                  />
                )}
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                    active
                      ? 'bg-emerald-700 dark:bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-500 dark:text-slate-400 group-hover:bg-slate-200/60 dark:group-hover:bg-slate-700/60 group-hover:text-slate-800 dark:group-hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-4 h-4" aria-hidden="true" />
                </div>
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3.5 border-t border-slate-200/60 dark:border-white/10 bg-white/40 dark:bg-white/[0.02] backdrop-blur-md shrink-0 space-y-2.5">
          {/* Profile Card with Avatar & Live Online Dot */}
          <div className="rounded-2xl border border-white/80 dark:border-white/10 bg-white/70 dark:bg-white/[0.04] backdrop-blur-xl p-3 shadow-[0_4px_24px_rgba(0,0,0,0.03)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.35)] space-y-2.5">
            <div className="flex items-center gap-3">
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setUserPhotoError('');
                    setUserPhotoModalOpen(true);
                  }}
                  title="Update profile photo"
                  aria-label="Update profile photo"
                  className="w-10 h-10 rounded-full border border-white/80 dark:border-white/15 bg-white/80 dark:bg-slate-800/80 backdrop-blur-md overflow-hidden flex items-center justify-center cursor-pointer shadow-xs focus:outline-none focus:ring-2 focus:ring-emerald-600 transition-transform hover:scale-105"
                >
                  {userPhotoDataUrl && !userPhotoFailed ? (
                    <img
                      src={userPhotoDataUrl}
                      alt={activeStaffLink?.staffName || user.displayName || 'User profile'}
                      referrerPolicy="no-referrer"
                      onError={() => setUserPhotoFailed(true)}
                      className="w-full h-full object-cover rounded-full"
                    />
                  ) : (
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                      {getStudentInitials(activeStaffLink?.staffName || user.displayName || user.email || 'U')}
                    </span>
                  )}
                </button>
                <span
                  className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900"
                  title="Signed In"
                  aria-hidden="true"
                />
              </div>
              <div className="min-w-0 flex-1 text-xs">
                <span className="inline-block px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-emerald-100/80 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/50 truncate max-w-full">
                  {rolePermissions.roleLabel}
                </span>
                <div className="font-semibold text-slate-900 dark:text-slate-100 truncate mt-0.5">
                  {activeStaffLink?.staffName || user.displayName || 'Administrator'}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate font-mono">
                  {user.email}
                </div>
              </div>
            </div>

            {/* Compact Action Buttons */}
            <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-slate-200/60 dark:border-white/10">
              <button
                type="button"
                onClick={() => {
                  setUserPhotoError('');
                  setUserPhotoModalOpen(true);
                }}
                className="min-h-[32px] px-2 rounded-lg border border-slate-200/80 dark:border-white/10 bg-white/60 dark:bg-white/[0.04] backdrop-blur-md flex items-center justify-center gap-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-white/[0.1] cursor-pointer transition-colors"
                title="Change Profile Photo"
              >
                <Camera className="w-3 h-3 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                <span>Photo</span>
              </button>
              <button
                type="button"
                onClick={() => signOutUser()}
                className="min-h-[32px] px-2 rounded-lg border border-rose-200/60 dark:border-rose-900/40 bg-white/60 dark:bg-rose-950/20 backdrop-blur-md flex items-center justify-center gap-1.5 text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer transition-colors"
                title="Sign Out"
              >
                <LogOut className="w-3 h-3" aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>

          {/* Brand & Copyright Footer */}
          <div className="pt-0.5 text-center text-[10px] text-slate-400 dark:text-slate-500 select-none">
            <span className="block font-medium text-slate-600 dark:text-slate-400">
              © {new Date().getFullYear()} SecSchoolHub
            </span>
            <span className="block text-[9.5px] mt-0.5 text-slate-400 dark:text-slate-500">
              Powered by{' '}
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                Indelible Technologies
              </span>
            </span>
          </div>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 h-14 lg:h-16 bg-white/95 dark:bg-[#161B22]/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
          <div className="h-full px-4 sm:px-6 flex items-center justify-between gap-4">
            <div className="min-w-0 flex items-center gap-2">
              <h1 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
                {currentNavLabel}
              </h1>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {isTrueOwner && (
                <div className="flex items-center gap-1.5">
                  <label
                    htmlFor="header-admin-role-switcher"
                    className="hidden md:inline text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap"
                  >
                    Acting Role:
                  </label>
                  <select
                    id="header-admin-role-switcher"
                    aria-label="Acting Role Mode"
                    value={adminActingRole || 'Owner'}
                    onChange={(e) => {
                      const val = e.target.value as WorkspaceRole;
                      setAdminActingRole(val === 'Owner' ? null : val);
                    }}
                    className={`max-w-[150px] sm:max-w-[210px] min-h-[34px] sm:min-h-[36px] px-2.5 rounded-xl border text-xs font-medium cursor-pointer transition-colors shadow-xs ${
                      adminActingRole
                        ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 font-semibold'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    {ADMIN_ROLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  {adminActingRole && (
                    <button
                      type="button"
                      onClick={() => setAdminActingRole(null)}
                      title="Return to Head Teacher / Administrator mode"
                      className="px-2 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-100/80 dark:bg-amber-900/40 text-[11px] font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-900/60 whitespace-nowrap cursor-pointer transition-colors"
                    >
                      Reset
                    </button>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                aria-label="Toggle light or dark theme"
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setUserPhotoError('');
                  setUserPhotoModalOpen(true);
                }}
                title="Set or update your profile photo"
                aria-label="Set or update your profile photo"
                className="lg:hidden min-h-[38px] min-w-[38px] w-[38px] h-[38px] rounded-full border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 overflow-hidden flex items-center justify-center cursor-pointer"
              >
                {userPhotoDataUrl && !userPhotoFailed ? (
                  <img
                    src={userPhotoDataUrl}
                    alt={activeStaffLink?.staffName || user.displayName || 'User profile'}
                    referrerPolicy="no-referrer"
                    onError={() => setUserPhotoFailed(true)}
                    className="w-full h-full object-cover rounded-full"
                  />
                ) : (
                  <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                    {getStudentInitials(activeStaffLink?.staffName || user.displayName || user.email || 'U')}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => signOutUser()}
                aria-label="Sign out"
                className="lg:hidden min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Active Module Workspace */}
        <main className="flex-1 px-3 sm:px-6 py-4 sm:py-6 pb-[72px] lg:pb-8 w-full">
          {activeSection === 'overview' && (
            <OverviewDashboard
              school={activeSchool}
              rolePermissions={rolePermissions}
              activeStaffLink={activeStaffLink}
              students={students}
              teachers={teachers}
              assessments={assessments}
              invoices={invoices}
              payments={payments}
              attendance={attendance}
              staffAttendance={staffAttendance}
              timebookEntries={timebookEntries}
              studentCases={studentCases}
              libraryLoans={libraryLoans}
              announcements={announcements}
              backupSettings={isTrueOwner && rolePermissions.role === 'Owner' ? backupSettings : null}
              backupLogs={isTrueOwner && rolePermissions.role === 'Owner' ? backupLogs : []}
              authorDisplayName={activeStaffLink?.staffName || user.displayName || 'School Admin'}
              onNavigate={setActiveSection}
              onOpenStudents={(tab) => {
                setStudentsLaunch({ tab, nonce: Date.now() });
                setActiveSection('students');
              }}
              onOpenStaff={(tab) => {
                setStaffLaunch({ tab, nonce: Date.now() });
                setActiveSection('staff');
              }}
              onOpenLibrary={(tab, audience) => {
                setLibraryLaunch({ tab, audience, nonce: Date.now() });
                setActiveSection('library');
              }}
            />
          )}

          {activeSection === 'students' && rolePermissions.allowedSections.includes('students') && (
            <StudentsManager
              school={activeSchool}
              ownerId={activeSchool.ownerId}
              students={students}
              assessments={assessments}
              invoices={invoices}
              libraryLoans={rolePermissions.canReadLibrary ? libraryLoans : []}
              studentCases={studentCases}
              attendance={rolePermissions.canReadAttendance ? attendance : []}
              canManageStudents={rolePermissions.canManageStudents}
              canManageStudentCases={rolePermissions.canManageStudentCases}
              canReadAttendance={rolePermissions.canReadAttendance}
              canWriteAttendance={rolePermissions.canWriteAttendance}
              canViewAcademicReport={rolePermissions.canReadMarks}
              canViewFees={rolePermissions.canReadFees}
              canViewLibrary={rolePermissions.canReadLibrary}
              recordedByName={activeStaffLink?.staffName || user.displayName || 'School Admin'}
              initialTab={studentsLaunch?.tab}
              tabRequestNonce={studentsLaunch?.nonce}
              onOpenLibrary={
                rolePermissions.canReadLibrary ? () => setActiveSection('library') : undefined
              }
            />
          )}

          {activeSection === 'marks' && rolePermissions.canReadMarks && (
            <MarksGradebook
              school={activeSchool}
              ownerId={activeSchool.ownerId}
              students={students}
              assessments={assessments}
              reportRemarks={reportRemarks}
              attendance={rolePermissions.canReadAttendance ? attendance : []}
              schoolSubjects={schoolSubjects}
              canWriteMarks={rolePermissions.canWriteMarks}
              currentStaffName={activeStaffLink?.staffName || user.displayName || 'Administrator'}
              currentStaffRole={rolePermissions.roleLabel}
              onOpenStaffSettings={
                rolePermissions.allowedSections.includes('staff')
                  ? () => setActiveSection('staff')
                  : undefined
              }
            />
          )}

          {activeSection === 'fees' && rolePermissions.canReadFees && (
            <FeesBursar
              school={activeSchool}
              ownerId={activeSchool.ownerId}
              students={students}
              invoices={invoices}
              payments={payments}
              feeSubmissions={feeSubmissions}
              smsLogs={smsLogs}
              smsConfig={smsConfig}
              canWriteFees={rolePermissions.canWriteFees}
            />
          )}

          {activeSection === 'library' && rolePermissions.canReadLibrary && (
            <SchoolLibrary
              school={activeSchool}
              ownerId={activeSchool.ownerId}
              students={students}
              schoolSubjects={schoolSubjects}
              libraryLoans={libraryLoans}
              libraryBooks={libraryBooks}
              libraryTransactions={libraryTransactions}
              libraryReservations={libraryReservations}
              digitalResources={digitalLibraryResources}
              canWriteLibrary={rolePermissions.canWriteLibrary}
              viewerRole={rolePermissions.role}
              initialTab={libraryLaunch?.tab}
              initialAudienceFilter={libraryLaunch?.audience}
              tabRequestNonce={libraryLaunch?.nonce}
            />
          )}

          {activeSection === 'timebook' && rolePermissions.allowedSections.includes('timebook') && (
            <StaffTimebookStaffView
              school={activeSchool}
              user={user}
              matchedTeacher={matchedTimebookTeacher}
              timebookSettings={timebookSettings}
              entries={timebookEntries}
              correctionRequests={timebookCorrectionRequests}
            />
          )}

          {activeSection === 'staff' && rolePermissions.allowedSections.includes('staff') && (
            <StaffAndSettings
              school={activeSchool}
              schools={accessibleSchools}
              ownerId={activeSchool.ownerId}
              teachers={teachers}
              schoolSubjects={schoolSubjects}
              staffAttendance={rolePermissions.canReadStaffAttendance ? staffAttendance : []}
              timebookSettings={timebookSettings}
              timebookEntries={timebookEntries}
              timebookCorrectionRequests={timebookCorrectionRequests}
              timebookAuditLogs={timebookAuditLogs}
              timebookSuspiciousLogs={timebookSuspiciousLogs}
              backupSettings={isTrueOwner && rolePermissions.role === 'Owner' ? backupSettings : null}
              backupLogs={isTrueOwner && rolePermissions.role === 'Owner' ? backupLogs : []}
              autoBackupInFlight={autoBackupInFlight}
              isSchoolOwner={isTrueOwner && rolePermissions.role === 'Owner'}
              canManageStaffAndSettings={rolePermissions.canManageStaff}
              canReadStaffAttendance={rolePermissions.canReadStaffAttendance}
              canManageTimebook={rolePermissions.canManageTimebook}
              recordedByName={activeStaffLink?.staffName || user.displayName || 'School Admin'}
              initialTab={staffLaunch?.tab}
              tabRequestNonce={staffLaunch?.nonce}
              onSwitchSchool={handleSchoolSelected}
              onAddNewSchool={
                isPlatformAdmin && rolePermissions.role === 'Owner'
                  ? () => setCreatingAnotherSchool(true)
                  : undefined
              }
            />
          )}
        </main>
      </div>

      {/* Docked Full-Width Mobile Bottom Navigation Bar */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 w-full bg-white/95 dark:bg-[#161B22]/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 pb-[env(safe-area-inset-bottom)] print:hidden"
        aria-label="Mobile sections"
      >
        <div className={`w-full grid ${mobileGridClass} items-stretch`}>
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center justify-center min-h-[52px] px-1 py-1.5 gap-0.5 cursor-pointer transition-colors ${
                  active
                    ? 'bg-emerald-700 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" strokeWidth={active ? 2.25 : 1.85} aria-hidden="true" />
                <span className="text-[10px] font-semibold leading-none tracking-tight truncate max-w-full">
                  {item.shortLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <StudentPhotoCaptureModal
        open={userPhotoModalOpen}
        mode="immediate"
        headerLabel="My Profile Photo"
        saveButtonLabel="Save My Profile Photo"
        studentName={activeStaffLink?.staffName || user.displayName || 'School Staff'}
        admissionNo={rolePermissions.roleLabel}
        initialPhotoUrl={userPhotoDataUrl}
        saving={savingUserPhoto}
        saveError={userPhotoError}
        onClose={() => {
          if (!savingUserPhoto) {
            setUserPhotoModalOpen(false);
            setUserPhotoError('');
          }
        }}
        onSavePhoto={async (photoDataUrl) => {
          if (!user || !activeSchool) return;
          setSavingUserPhoto(true);
          setUserPhotoError('');
          try {
            await updateOwnUserProfilePhoto({
              uid: user.uid,
              displayName: activeStaffLink?.staffName || user.displayName || 'School Staff',
              email: user.email || '',
              activeSchoolId: activeSchool.id,
              photoDataUrl,
            });
            setUserPhotoDataUrl(photoDataUrl);
            setUserPhotoFailed(false);
            setUserPhotoModalOpen(false);
          } catch (err) {
            setUserPhotoError(
              err instanceof Error ? err.message : 'Unable to save profile photo.'
            );
          } finally {
            setSavingUserPhoto(false);
          }
        }}
      />

      <OfflineIndicator />
    </div>
  );
}
