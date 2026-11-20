import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import {
  LayoutDashboard,
  Users,
  Award,
  Banknote,
  CalendarCheck,
  BookOpen,
  Settings,
  LogOut,
  Moon,
  Sun,
  ShieldAlert,
} from 'lucide-react';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  signInWithGoogle,
  signOutUser,
  testConnection,
} from './firebase';
import {
  Assessment,
  AttendanceRecord,
  DigitalLibraryResource,
  FeeInvoice,
  FeePayment,
  LibraryBook,
  LibraryLoan,
  LibraryReservation,
  LibraryTransaction,
  School,
  SchoolSection,
  SchoolSubject,
  SmsConfig,
  SmsLog,
  StaffLink,
  Student,
  Teacher,
  WorkspaceRole,
} from './school/types';
import { getRolePermissions, normalizeRegistrationCode } from './school/malawi';
import { upsertUserProfile } from './school/firestoreService';
import { SchoolOnboarding } from './components/school/SchoolOnboarding';
import { OverviewDashboard } from './components/school/OverviewDashboard';
import { StudentsManager } from './components/school/StudentsManager';
import { MarksGradebook } from './components/school/MarksGradebook';
import { FeesBursar } from './components/school/FeesBursar';
import { AttendanceRegister } from './components/school/AttendanceRegister';
import { SchoolLibrary } from './components/school/SchoolLibrary';
import { StaffAndSettings } from './components/school/StaffAndSettings';
import { StudentResultsPortal } from './components/school/StudentResultsPortal';
import { LandingPage } from './components/school/LandingPage';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';

const NAV_ITEMS: { id: SchoolSection; label: string; shortLabel: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Home Dashboard', shortLabel: 'Home', icon: LayoutDashboard },
  { id: 'students', label: 'Students (Form 1–4)', shortLabel: 'Students', icon: Users },
  { id: 'marks', label: 'Exam Marks', shortLabel: 'Marks', icon: Award },
  { id: 'fees', label: 'Fees & Bursar (MK)', shortLabel: 'Fees', icon: Banknote },
  { id: 'attendance', label: 'Attendance', shortLabel: 'Roll Call', icon: CalendarCheck },
  { id: 'library', label: 'School Library', shortLabel: 'Library', icon: BookOpen },
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

  const [activeSection, setActiveSection] = useState<SchoolSection>('overview');
  const [loginIntent, setLoginIntent] = useState<'admin' | 'staff' | 'student'>('admin');
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

  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [schoolSubjects, setSchoolSubjects] = useState<SchoolSubject[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [invoices, setInvoices] = useState<FeeInvoice[]>([]);
  const [payments, setPayments] = useState<FeePayment[]>([]);
  const [smsLogs, setSmsLogs] = useState<SmsLog[]>([]);
  const [smsConfig, setSmsConfig] = useState<SmsConfig | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [libraryLoans, setLibraryLoans] = useState<LibraryLoan[]>([]);
  const [libraryBooks, setLibraryBooks] = useState<LibraryBook[]>([]);
  const [libraryTransactions, setLibraryTransactions] = useState<LibraryTransaction[]>([]);
  const [libraryReservations, setLibraryReservations] = useState<LibraryReservation[]>([]);
  const [digitalLibraryResources, setDigitalLibraryResources] = useState<DigitalLibraryResource[]>([]);

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
        setPortalOverride('auto');
        setCreatingAnotherSchool(false);
        setStudents([]);
        setTeachers([]);
        setSchoolSubjects([]);
        setAssessments([]);
        setInvoices([]);
        setPayments([]);
        setSmsLogs([]);
        setSmsConfig(null);
        setAttendance([]);
        setLibraryLoans([]);
        setLibraryBooks([]);
        setLibraryTransactions([]);
        setLibraryReservations([]);
        setDigitalLibraryResources([]);
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
          const data = profileSnap.data() as { activeSchoolId?: string };
          if (data.activeSchoolId) {
            setActiveSchoolId(data.activeSchoolId);
          }
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
    if (loginIntent === 'staff' && portalOverride === 'auto') {
      const staffMatch =
        workspaceEntries.find((e) => e.staffLink && e.school.id === activeSchoolId) ||
        workspaceEntries.find((e) => e.staffLink);
      if (staffMatch) return staffMatch;
    }
    return (
      workspaceEntries.find((e) => e.school.id === activeSchoolId) || workspaceEntries[0]
    );
  }, [activeSchoolId, loginIntent, portalOverride, workspaceEntries]);

  const activeSchool = activeEntry?.school || null;
  const activeRole: WorkspaceRole = activeEntry?.role || 'Owner';
  const activeStaffLink = activeEntry?.staffLink || null;
  const rolePermissions = useMemo(() => getRolePermissions(activeRole), [activeRole]);
  const isPlatformAdmin = useMemo(() => {
    if (!user) return false;
    const normalizedEmail = (user.email || '').trim().toLowerCase();
    return normalizedEmail === 'dicksonpetroj1@gmail.com' || isAdminDoc;
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
      setInvoices([]);
      setPayments([]);
      setSmsLogs([]);
      setSmsConfig(null);
      setAttendance([]);
      setLibraryLoans([]);
      setLibraryBooks([]);
      setLibraryTransactions([]);
      setLibraryReservations([]);
      setDigitalLibraryResources([]);
      return;
    }

    const schoolId = activeSchool.id;
    const schoolOwnerId = activeSchool.ownerId;

    const unsubs: (() => void)[] = [];

    // Students list is readable by all active school staff (Owner, Head, Deputy, Teachers, Bursar)
    unsubs.push(
      onSnapshot(
        query(collection(db, 'schools', schoolId, 'students'), where('ownerId', '==', schoolOwnerId)),
        (snap) => {
          setStudents(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Student, 'id'>) })));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/students`)
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
    } else {
      setAssessments([]);
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
    rolePermissions.canReadAttendance,
    rolePermissions.canReadFees,
    rolePermissions.canReadLibrary,
    rolePermissions.canReadMarks,
    rolePermissions.canReadTeachers,
    user,
  ]);

  const handleGoogleSignIn = async () => {
    setAuthError('');
    setSigningIn(true);
    try {
      await signInWithGoogle();
      setStudentSessionCode('');
      setPortalOverride('workspace');
      try {
        window.localStorage.removeItem('malawisec_student_code');
      } catch {
        // Ignore storage error
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign-in cancelled or failed.');
    } finally {
      setSigningIn(false);
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
    setVerifyingStudentCode(true);
    try {
      const portalSnap = await getDoc(doc(db, 'studentPortals', normalized));
      if (!portalSnap.exists()) {
        setAuthError(
          'Registration code not found. Check the code with your school administrator or form master.'
        );
        return;
      }
      try {
        window.localStorage.setItem('malawisec_student_code', normalized);
      } catch {
        // Ignore storage error
      }
      setStudentSessionCode(normalized);
      setPortalOverride('student');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.toLowerCase().includes('offline') || msg.toLowerCase().includes('unavailable')) {
        let hasOfflinePortal = false;
        try {
          hasOfflinePortal = Boolean(
            window.localStorage.getItem(`malawisec_student_portal_${normalized}`)
          );
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
    setAuthError('');
    setPortalOverride('auto');
    setLoginIntent('student');
  };

  const handleSchoolSelected = async (schoolId: string) => {
    setActiveSchoolId(schoolId);
    setCreatingAnotherSchool(false);
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
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F8FA] dark:bg-[#0D1117]">
        <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
          Connecting to school portal...
        </div>
      </div>
    );
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

  // Unauthenticated Landing / Role-Based Sign-In Gate
  if (!user) {
    return (
      <>
        <LandingPage
          loginIntent={loginIntent}
          onChangeLoginIntent={(intent) => {
            setLoginIntent(intent);
            setAuthError('');
          }}
          studentCodeInput={studentCodeInput}
          onChangeStudentCodeInput={setStudentCodeInput}
          verifyingStudentCode={verifyingStudentCode}
          signingIn={signingIn}
          authError={authError}
          onGoogleSignIn={handleGoogleSignIn}
          onStudentCodeSignIn={handleStudentCodeSignIn}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        />
        <OfflineIndicator />
      </>
    );
  }

  // Loading schools / staff links / admin authorization skeleton
  if (schoolsLoading || staffLinksLoading || waitingForStaffSchoolDoc || adminCheckLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F8FA] dark:bg-[#0D1117]">
        <div className="w-full max-w-md px-6 space-y-3">
          <div className="h-5 w-48 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
          <div className="h-24 w-full bg-slate-200 dark:bg-slate-800 rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  // Strict authorization gate: unlinked or unauthorized Google accounts only see Sign Out (no school creation bypass)
  if (!activeSchool && (loginIntent === 'staff' || !isPlatformAdmin)) {
    const isStaffIntent = loginIntent === 'staff';
    return (
      <div className="min-h-screen flex flex-col bg-[#F7F8FA] dark:bg-[#0D1117] text-slate-900 dark:text-slate-100">
        <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#161B22]">
          <div className="max-w-4xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between">
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
                {isStaffIntent ? 'Staff Account Not Linked Yet' : 'Account Not Authorized Yet'}
              </h1>
              <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Signed in as{' '}
                <strong className="text-slate-900 dark:text-slate-200">{user.email}</strong>.{' '}
                {isStaffIntent
                  ? 'Ask your Head Teacher or School Owner to add this exact Google email to your staff profile in Staff & Settings with your role (Teacher, Form Teacher, HOD, School Librarian, Bursar, or Deputy Head).'
                  : 'Access to institutional records is restricted to authorized school administrators and pre-linked staff accounts. Ask your Head Teacher or School Owner to add this exact Google email in Staff & Settings.'}
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
      <div className="min-h-screen bg-[#F7F8FA] dark:bg-[#0D1117]">
        <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#161B22]">
          <div className="max-w-5xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between">
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
    visibleNavItems.find((n) => n.id === activeSection)?.label || 'Home Dashboard';
  const mobileGridClass = MOBILE_GRID_COLS[visibleNavItems.length] || 'grid-cols-4';

  return (
    <div className="min-h-screen flex bg-[#F7F8FA] dark:bg-[#0D1117] text-slate-900 dark:text-slate-100">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#161B22]">
        <div className="h-16 px-5 flex items-center border-b border-slate-200 dark:border-slate-800">
          <span className="text-base font-bold tracking-tight text-slate-900 dark:text-white truncate">
            {activeSchool.name}
          </span>
        </div>

        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800/80 text-xs text-slate-500 dark:text-slate-400 space-y-1.5">
          <div>{activeSchool.district} District · {activeSchool.schoolType}</div>
          <div className="font-mono text-slate-700 dark:text-slate-300">
            {activeSchool.currentTerm} · {activeSchool.academicYear}
          </div>
          {workspaceEntries.length > 1 && (
            <select
              aria-label="Switch school workspace"
              value={activeSchool.id}
              onChange={(e) => handleSchoolSelected(e.target.value)}
              className="mt-1 w-full min-h-[34px] px-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-800 dark:text-slate-200"
            >
              {workspaceEntries.map((entry) => (
                <option key={entry.school.id} value={entry.school.id}>
                  {entry.school.name} ({entry.role})
                </option>
              ))}
            </select>
          )}
        </div>

        <nav className="flex-1 p-3 space-y-1" aria-label="School management modules">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                className={`w-full min-h-[42px] px-3.5 py-2 rounded-xl flex items-center gap-3 text-sm font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <div className="text-xs">
            <div className="font-semibold text-emerald-700 dark:text-emerald-400 truncate">
              {rolePermissions.roleLabel}
            </div>
            <div className="font-semibold text-slate-900 dark:text-slate-100 truncate mt-0.5">
              {activeStaffLink?.staffName || user.displayName || 'Administrator'}
            </div>
            <div className="text-slate-500 dark:text-slate-400 truncate">{user.email}</div>
          </div>
          <button
            type="button"
            onClick={() => signOutUser()}
            className="w-full min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 h-14 lg:h-16 bg-white/95 dark:bg-[#161B22]/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
          <div className="h-full px-4 sm:px-6 flex items-center justify-between gap-4">
            <div className="min-w-0 flex items-center gap-2 text-sm">
              <span className="lg:hidden font-bold text-slate-900 dark:text-white truncate">
                {activeSchool.name}
              </span>
              <span className="hidden lg:inline text-slate-500 dark:text-slate-400">
                {activeSchool.name}
              </span>
              <span className="hidden lg:inline text-slate-300 dark:text-slate-700">/</span>
              <span className="hidden lg:inline font-semibold text-slate-900 dark:text-white">
                {currentNavLabel}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                aria-label="Toggle light or dark theme"
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <PWAInstallButton variant="header" />
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
        <main className="flex-1 p-4 sm:p-6 pb-24 lg:pb-8 max-w-7xl w-full mx-auto">
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
              libraryLoans={libraryLoans}
              onNavigate={setActiveSection}
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
              canManageStudents={rolePermissions.canManageStudents}
              canViewAcademicReport={rolePermissions.canReadMarks}
              canViewFees={rolePermissions.canReadFees}
              canViewLibrary={rolePermissions.canReadLibrary}
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
              schoolSubjects={schoolSubjects}
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
              smsLogs={smsLogs}
              smsConfig={smsConfig}
            />
          )}

          {activeSection === 'attendance' && rolePermissions.canReadAttendance && (
            <AttendanceRegister
              school={activeSchool}
              ownerId={activeSchool.ownerId}
              students={students}
              attendance={attendance}
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
            />
          )}

          {activeSection === 'staff' && rolePermissions.allowedSections.includes('staff') && (
            <StaffAndSettings
              school={activeSchool}
              schools={accessibleSchools}
              ownerId={activeSchool.ownerId}
              teachers={teachers}
              schoolSubjects={schoolSubjects}
              canManageStaffAndSettings={rolePermissions.canManageStaff}
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

      {/* Mobile Bottom Navigation Bar */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-[#161B22]/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 pb-safe"
        aria-label="Mobile sections"
      >
        <div className={`grid ${mobileGridClass} h-[60px]`}>
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                className={`flex flex-col items-center justify-center min-h-[44px] gap-0.5 cursor-pointer ${
                  active
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon className="w-4 h-4" strokeWidth={active ? 2.4 : 1.8} aria-hidden="true" />
                <span className="text-[10px] font-medium tracking-tight truncate max-w-full px-0.5">
                  {item.shortLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <OfflineIndicator />
    </div>
  );
}
