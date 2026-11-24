import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import {
  addDaysToIsoDate,
  calculateManebGrade,
  calculateWeightedComponent,
  DEFAULT_LIBRARY_BOOKS_PRESETS,
  DEFAULT_MALAWI_SUBJECT_PRESETS,
  generateStudentRegistrationCode,
  getDefaultEntryYear,
  inferStudentEntryYear,
  isGovernmentSchool,
  isTeacherOnlyDigitalCategory,
  normalizeAssessmentComponents,
  normalizeRegistrationCode,
} from './malawi';
import {
  AnnouncementAudience,
  Assessment,
  AttendanceStatus,
  BoardingStatus,
  DigitalLibraryResource,
  DigitalResourceCategory,
  DigitalResourceFormLevel,
  DigitalStorageFormat,
  FeeInvoice,
  FeeSubmissionFileFormat,
  FormLevel,
  Gender,
  InvoiceStatus,
  LibraryBook,
  LibraryItemCondition,
  LibraryLoan,
  LibraryLoanStatus,
  LibraryMaterialCategory,
  LibraryReadingMode,
  LibraryReadingSession,
  LibraryReservationStatus,
  LibraryTransactionAction,
  PaymentMethod,
  School,
  SchoolSubject,
  SchoolType,
  StaffAttendanceStatus,
  StaffTimebookEntry,
  Student,
  StudentCaseSeverity,
  StudentCaseStatus,
  StudentCaseType,
  StudentFeeSubmission,
  StudentStatus,
  Teacher,
  TeacherRole,
  TermName,
  TimebookEntryStatus,
  TimebookGpsVerificationStatus,
  TimebookSettings,
} from './types';
import {
  DEFAULT_TIMEBOOK_DEADLINE,
  DEFAULT_TIMEBOOK_MAX_ACCURACY_METERS,
  DEFAULT_TIMEBOOK_RADIUS_METERS,
  DEFAULT_TIMEBOOK_REMINDER_SLOTS,
  DEFAULT_TIMEBOOK_TIMEZONE,
  DEFAULT_TIMEBOOK_WINDOW_START,
  DEFAULT_TIMEBOOK_WORKDAYS,
  isValidHHMM,
  isValidLatitude,
  isValidLongitude,
  isValidTimeZone,
} from './timebookUtils';
import { syncAdminEntryToServer, type VerifyCheckInResponse } from './timebookApi';
import { base64ToUint8Array, uint8ArrayToBase64 } from './digitalMaterialParser';
import {
  buildReadingSessionId,
  getPendingOfflineReadingSyncs,
  READING_SESSION_TTL_MS,
  removeQueuedOfflineReadingSync,
} from './readingProgressStore';

function clampStr(val: string, max: number): string {
  return String(val ?? '').trim().slice(0, max);
}

export function normalizeStudentEmail(val?: string): string {
  return String(val ?? '').trim().toLowerCase().slice(0, 160);
}

export function normalizeStaffEmail(val?: string): string {
  return String(val ?? '').trim().toLowerCase().slice(0, 120);
}

export function makeStaffAccessKey(email: string): string {
  return `stf_${normalizeStaffEmail(email).replace(/[^a-z0-9]/g, '_')}`;
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function upsertUserProfile(params: {
  uid: string;
  displayName: string;
  email: string;
  activeSchoolId: string;
  isNew: boolean;
}) {
  const path = `users/${params.uid}`;
  try {
    if (params.isNew) {
      await setDoc(doc(db, 'users', params.uid), {
        uid: params.uid,
        displayName: clampStr(params.displayName || 'School Administrator', 120),
        email: clampStr(params.email, 160),
        activeSchoolId: params.activeSchoolId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'users', params.uid), {
        displayName: clampStr(params.displayName || 'School Administrator', 120),
        email: clampStr(params.email, 160),
        activeSchoolId: params.activeSchoolId,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, params.isNew ? OperationType.CREATE : OperationType.UPDATE, path);
  }
}

export interface CreateSchoolInput {
  ownerId: string;
  ownerDisplayName: string;
  ownerEmail: string;
  name: string;
  district: string;
  schoolType: SchoolType;
  motto: string;
  academicYear: string;
  currentTerm: TermName;
  defaultTuitionMWK: number;
  defaultGpfMWK: number;
  defaultExamFeeMWK: number;
}

export async function createSchoolWorkspace(input: CreateSchoolInput): Promise<string> {
  const schoolId = makeId('sch');
  const path = `schools/${schoolId}`;
  const govTuitionOnly = isGovernmentSchool(input.schoolType);
  try {
    await setDoc(doc(db, 'schools', schoolId), {
      ownerId: input.ownerId,
      name: clampStr(input.name, 120),
      district: clampStr(input.district, 60),
      schoolType: input.schoolType,
      motto: clampStr(input.motto, 140),
      academicYear: clampStr(input.academicYear, 20),
      currentTerm: input.currentTerm,
      defaultTuitionMWK: Math.max(0, Number(input.defaultTuitionMWK) || 0),
      defaultGpfMWK: govTuitionOnly ? 0 : Math.max(0, Number(input.defaultGpfMWK) || 0),
      defaultExamFeeMWK: govTuitionOnly ? 0 : Math.max(0, Number(input.defaultExamFeeMWK) || 0),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return schoolId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateSchoolSettings(
  schoolId: string,
  updates: Partial<
    Pick<
      School,
      | 'name'
      | 'district'
      | 'schoolType'
      | 'motto'
      | 'academicYear'
      | 'currentTerm'
      | 'defaultTuitionMWK'
      | 'defaultGpfMWK'
      | 'defaultExamFeeMWK'
      | 'logoDataUrl'
    >
  >,
  ownerId?: string
) {
  const path = `schools/${schoolId}`;
  try {
    const govTuitionOnly = updates.schoolType ? isGovernmentSchool(updates.schoolType) : false;
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.name !== undefined) payload.name = clampStr(updates.name, 120);
    if (updates.district !== undefined) payload.district = clampStr(updates.district, 60);
    if (updates.schoolType !== undefined) payload.schoolType = updates.schoolType;
    if (updates.motto !== undefined) payload.motto = clampStr(updates.motto, 140);
    if (updates.academicYear !== undefined) payload.academicYear = clampStr(updates.academicYear, 20);
    if (updates.currentTerm !== undefined) payload.currentTerm = updates.currentTerm;
    if (updates.logoDataUrl !== undefined) {
      payload.logoDataUrl = String(updates.logoDataUrl || '').slice(0, 160000);
    }
    if (updates.defaultTuitionMWK !== undefined) {
      payload.defaultTuitionMWK = Math.max(0, Number(updates.defaultTuitionMWK) || 0);
    }
    if (govTuitionOnly) {
      payload.defaultGpfMWK = 0;
      payload.defaultExamFeeMWK = 0;
    } else {
      if (updates.defaultGpfMWK !== undefined) {
        payload.defaultGpfMWK = Math.max(0, Number(updates.defaultGpfMWK) || 0);
      }
      if (updates.defaultExamFeeMWK !== undefined) {
        payload.defaultExamFeeMWK = Math.max(0, Number(updates.defaultExamFeeMWK) || 0);
      }
    }
    await updateDoc(doc(db, 'schools', schoolId), payload);

    // Sync school header metadata & logo onto active studentLinks, studentPortals & staffLinks
    if (
      ownerId &&
      (updates.name !== undefined ||
        updates.district !== undefined ||
        updates.schoolType !== undefined ||
        updates.motto !== undefined ||
        updates.academicYear !== undefined ||
        updates.currentTerm !== undefined ||
        updates.logoDataUrl !== undefined)
    ) {
      const linksSnap = await getDocs(
        query(collection(db, 'studentLinks'), where('ownerId', '==', ownerId))
      );
      const matchingDocs = linksSnap.docs.filter((d) => d.data().schoolId === schoolId);
      if (matchingDocs.length > 0) {
        const linkUpdates: Record<string, unknown> = { updatedAt: serverTimestamp() };
        if (updates.name !== undefined) linkUpdates.schoolName = clampStr(updates.name, 120);
        if (updates.district !== undefined) linkUpdates.schoolDistrict = clampStr(updates.district, 60);
        if (updates.schoolType !== undefined) linkUpdates.schoolType = updates.schoolType;
        if (updates.motto !== undefined) linkUpdates.motto = clampStr(updates.motto, 140);
        if (updates.academicYear !== undefined) {
          linkUpdates.academicYear = clampStr(updates.academicYear, 20);
        }
        if (updates.currentTerm !== undefined) linkUpdates.currentTerm = updates.currentTerm;
        if (updates.logoDataUrl !== undefined) {
          linkUpdates.logoDataUrl = String(updates.logoDataUrl || '').slice(0, 160000);
        }

        const batch = writeBatch(db);
        for (const d of matchingDocs) {
          batch.update(d.ref, linkUpdates);
        }
        await batch.commit();
      }

      const portalsSnap = await getDocs(
        query(collection(db, 'studentPortals'), where('ownerId', '==', ownerId))
      );
      const matchingPortalDocs = portalsSnap.docs.filter((d) => d.data().schoolId === schoolId);
      if (matchingPortalDocs.length > 0) {
        const portalUpdates: Record<string, unknown> = { updatedAt: serverTimestamp() };
        if (updates.name !== undefined) portalUpdates.schoolName = clampStr(updates.name, 120);
        if (updates.district !== undefined) portalUpdates.schoolDistrict = clampStr(updates.district, 60);
        if (updates.schoolType !== undefined) portalUpdates.schoolType = updates.schoolType;
        if (updates.motto !== undefined) portalUpdates.motto = clampStr(updates.motto, 140);
        if (updates.academicYear !== undefined) {
          portalUpdates.academicYear = clampStr(updates.academicYear, 20);
        }
        if (updates.currentTerm !== undefined) portalUpdates.currentTerm = updates.currentTerm;
        if (updates.logoDataUrl !== undefined) {
          portalUpdates.logoDataUrl = String(updates.logoDataUrl || '').slice(0, 160000);
        }

        const portalBatch = writeBatch(db);
        for (const d of matchingPortalDocs) {
          portalBatch.update(d.ref, portalUpdates);
        }
        await portalBatch.commit();
      }

      if (
        updates.name !== undefined ||
        updates.district !== undefined ||
        updates.schoolType !== undefined ||
        updates.academicYear !== undefined ||
        updates.currentTerm !== undefined ||
        updates.logoDataUrl !== undefined
      ) {
        const staffLinksSnap = await getDocs(
          query(collection(db, 'staffLinks'), where('ownerId', '==', ownerId))
        );
        const matchingStaffDocs = staffLinksSnap.docs.filter((d) => d.data().schoolId === schoolId);
        if (matchingStaffDocs.length > 0) {
          const staffUpdates: Record<string, unknown> = { updatedAt: serverTimestamp() };
          if (updates.name !== undefined) staffUpdates.schoolName = clampStr(updates.name, 120);
          if (updates.district !== undefined) staffUpdates.schoolDistrict = clampStr(updates.district, 60);
          if (updates.schoolType !== undefined) staffUpdates.schoolType = updates.schoolType;
          if (updates.academicYear !== undefined) {
            staffUpdates.academicYear = clampStr(updates.academicYear, 20);
          }
          if (updates.currentTerm !== undefined) staffUpdates.currentTerm = updates.currentTerm;
          if (updates.logoDataUrl !== undefined) {
            staffUpdates.logoDataUrl = String(updates.logoDataUrl || '').slice(0, 160000);
          }

          const staffBatch = writeBatch(db);
          for (const d of matchingStaffDocs) {
            staffBatch.update(d.ref, staffUpdates);
          }
          await staffBatch.commit();
        }
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export interface StudentPayload {
  admissionNo: string;
  fullName: string;
  gender: Gender;
  formLevel: FormLevel;
  stream: string;
  entryYear?: number;
  boardingStatus: BoardingStatus;
  guardianName: string;
  guardianPhone: string;
  guardianSecondaryPhone?: string;
  guardianRelationship?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyNotes?: string;
  studentEmail?: string;
  registrationCode?: string;
  autoGeneratedCode?: boolean;
  status: StudentStatus;
}

async function resolveAvailablePortalCode(params: {
  schoolId: string;
  studentId: string;
  formLevel: FormLevel;
  stream: string;
  entryYear: number;
  usedCodes: Set<string>;
}): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = generateStudentRegistrationCode({
      formLevel: params.formLevel,
      stream: params.stream,
      entryYear: params.entryYear,
      usedCodes: params.usedCodes,
    });
    params.usedCodes.add(candidate);
    const snap = await getDoc(doc(db, 'studentPortals', candidate));
    if (!snap.exists()) {
      return candidate;
    }
    const existing = snap.data() as { schoolId?: string; studentId?: string };
    if (existing.schoolId === params.schoolId && existing.studentId === params.studentId) {
      return candidate;
    }
  }
  const base = generateStudentRegistrationCode({
    formLevel: params.formLevel,
    stream: params.stream,
    entryYear: params.entryYear,
    usedCodes: params.usedCodes,
  });
  const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${base.slice(0, 27)}-${suffix}`;
}

async function deleteStudentPortalByCode(regCode: string) {
  const cleanCode = normalizeRegistrationCode(regCode);
  if (cleanCode.length < 6) return;

  const resultsSnap = await getDocs(
    query(
      collection(db, 'studentPortals', cleanCode, 'results'),
      where('registrationCode', '==', cleanCode)
    )
  );
  const loansSnap = await getDocs(
    query(
      collection(db, 'studentPortals', cleanCode, 'libraryLoans'),
      where('registrationCode', '==', cleanCode)
    )
  );
  const reservationsSnap = await getDocs(
    query(
      collection(db, 'studentPortals', cleanCode, 'reservations'),
      where('registrationCode', '==', cleanCode)
    )
  );
  const feeInvoicesSnap = await getDocs(
    query(
      collection(db, 'studentPortals', cleanCode, 'feeInvoices'),
      where('registrationCode', '==', cleanCode)
    )
  );
  const feeSubmissionsSnap = await getDocs(
    query(
      collection(db, 'studentPortals', cleanCode, 'feeSubmissions'),
      where('registrationCode', '==', cleanCode)
    )
  );

  for (const subDoc of feeSubmissionsSnap.docs) {
    const chunksSnap = await getDocs(
      query(
        collection(db, 'studentPortals', cleanCode, 'feeSubmissions', subDoc.id, 'chunks'),
        where('registrationCode', '==', cleanCode),
        where('submissionId', '==', subDoc.id)
      )
    );
    if (chunksSnap.docs.length > 0) {
      for (let i = 0; i < chunksSnap.docs.length; i += 20) {
        const chunkBatch = writeBatch(db);
        for (const c of chunksSnap.docs.slice(i, i + 20)) {
          chunkBatch.delete(c.ref);
        }
        await chunkBatch.commit();
      }
    }
  }

  const docsToDelete = [
    ...resultsSnap.docs,
    ...loansSnap.docs,
    ...reservationsSnap.docs,
    ...feeInvoicesSnap.docs,
    ...feeSubmissionsSnap.docs,
  ];
  if (docsToDelete.length > 0) {
    for (let i = 0; i < docsToDelete.length; i += 200) {
      const batch = writeBatch(db);
      for (const d of docsToDelete.slice(i, i + 200)) {
        batch.delete(d.ref);
      }
      await batch.commit();
    }
  }

  const portalRef = doc(db, 'studentPortals', cleanCode);
  const portalSnap = await getDoc(portalRef);
  if (portalSnap.exists()) {
    await deleteDoc(portalRef);
  }
}

function buildPortalResultFields(
  ownerId: string,
  schoolId: string,
  registrationCode: string,
  assessment: Omit<Assessment, 'id'>
) {
  const norm = normalizeAssessmentComponents({ id: '', ...assessment } as Assessment);
  return {
    ownerId,
    schoolId,
    registrationCode,
    studentId: assessment.studentId,
    studentName: clampStr(assessment.studentName, 120),
    formLevel: Math.round(assessment.formLevel),
    stream: clampStr(assessment.stream, 20),
    term: assessment.term,
    academicYear: clampStr(assessment.academicYear, 20),
    subject: clampStr(assessment.subject, 60),
    ca1Raw: norm.ca1Raw,
    ca1Max: norm.ca1Max,
    ca1Score: norm.ca1Score,
    ca2Raw: norm.ca2Raw,
    ca2Max: norm.ca2Max,
    ca2Score: norm.ca2Score,
    caScore: norm.caScore,
    examRaw: norm.examRaw,
    examMax: norm.examMax,
    examScore: norm.examScore,
    totalScore: Number(assessment.totalScore) || 0,
    grade: clampStr(assessment.grade, 10),
    gradePoint: Math.round(Number(assessment.gradePoint) || 9),
    remark: clampStr(assessment.remark, 40),
  };
}

function buildPortalFeeInvoiceFields(
  ownerId: string,
  schoolId: string,
  registrationCode: string,
  invoice: {
    studentId: string;
    studentName: string;
    formLevel: number;
    stream: string;
    term: TermName;
    academicYear: string;
    tuitionFee: number;
    gpfFee: number;
    examFee: number;
    otherFee: number;
    totalBilled: number;
    totalPaid: number;
    status: InvoiceStatus;
  }
) {
  return {
    ownerId,
    schoolId,
    registrationCode,
    studentId: invoice.studentId,
    studentName: clampStr(invoice.studentName, 120),
    formLevel: Math.min(4, Math.max(1, Math.round(Number(invoice.formLevel) || 1))),
    stream: clampStr(invoice.stream || 'A', 20) || 'A',
    term: invoice.term,
    academicYear: clampStr(invoice.academicYear, 20),
    tuitionFee: Math.max(0, Number(invoice.tuitionFee) || 0),
    gpfFee: Math.max(0, Number(invoice.gpfFee) || 0),
    examFee: Math.max(0, Number(invoice.examFee) || 0),
    otherFee: Math.max(0, Number(invoice.otherFee) || 0),
    totalBilled: Math.max(0, Number(invoice.totalBilled) || 0),
    totalPaid: Math.max(0, Number(invoice.totalPaid) || 0),
    status: invoice.status,
  };
}

export async function saveStudent(
  schoolId: string,
  ownerId: string,
  data: StudentPayload,
  existingId?: string,
  school?: School
): Promise<string> {
  const studentId = existingId || makeId('stu');
  const path = `schools/${schoolId}/students/${studentId}`;
  const cleanEmail = normalizeStudentEmail(data.studentEmail);
  const cleanFormLevel = Math.min(4, Math.max(1, Math.round(data.formLevel))) as FormLevel;
  const cleanStream = clampStr(data.stream || 'A', 20) || 'A';
  const cleanEntryYear = inferStudentEntryYear(
    {
      entryYear: data.entryYear,
      admissionNo: data.admissionNo,
      formLevel: cleanFormLevel,
    },
    school?.academicYear
  );
  let cleanRegCode = normalizeRegistrationCode(data.registrationCode);
  const cleanSecondaryPhone = clampStr(data.guardianSecondaryPhone || '', 30);
  const cleanRelationship = clampStr(data.guardianRelationship || '', 40);
  const cleanEmergencyName = clampStr(data.emergencyContactName || '', 120);
  const cleanEmergencyPhone = clampStr(data.emergencyContactPhone || '', 30);
  const cleanEmergencyNotes = clampStr(data.emergencyNotes || '', 240);

  if (cleanRegCode.length > 0 && cleanRegCode.length < 6) {
    throw new Error('Registration code must be at least 6 characters (letters, numbers, or dashes).');
  }

  try {
    let previousRegCode = '';
    if (existingId) {
      const existingSnap = await getDoc(doc(db, 'schools', schoolId, 'students', existingId));
      if (existingSnap.exists()) {
        previousRegCode = normalizeRegistrationCode(
          (existingSnap.data() as { registrationCode?: string }).registrationCode
        );
      }
    }

    if (!existingId && cleanRegCode === '') {
      const usedLocal = new Set<string>();
      const existingStudentsSnap = await getDocs(
        query(collection(db, 'schools', schoolId, 'students'), where('ownerId', '==', ownerId))
      );
      for (const d of existingStudentsSnap.docs) {
        const code = normalizeRegistrationCode((d.data() as { registrationCode?: string }).registrationCode);
        if (code) usedLocal.add(code);
      }
      cleanRegCode = await resolveAvailablePortalCode({
        schoolId,
        studentId,
        formLevel: cleanFormLevel,
        stream: cleanStream,
        entryYear: cleanEntryYear,
        usedCodes: usedLocal,
      });
    } else if (cleanRegCode.length >= 6 && cleanRegCode !== previousRegCode) {
      const existingPortalSnap = await getDoc(doc(db, 'studentPortals', cleanRegCode));
      if (existingPortalSnap.exists()) {
        const p = existingPortalSnap.data() as { schoolId?: string; studentId?: string };
        if (p.schoolId !== schoolId || p.studentId !== studentId) {
          if (data.autoGeneratedCode) {
            const usedLocal = new Set<string>([cleanRegCode]);
            const existingStudentsSnap = await getDocs(
              query(collection(db, 'schools', schoolId, 'students'), where('ownerId', '==', ownerId))
            );
            for (const d of existingStudentsSnap.docs) {
              const code = normalizeRegistrationCode(
                (d.data() as { registrationCode?: string }).registrationCode
              );
              if (code) usedLocal.add(code);
            }
            cleanRegCode = await resolveAvailablePortalCode({
              schoolId,
              studentId,
              formLevel: cleanFormLevel,
              stream: cleanStream,
              entryYear: cleanEntryYear,
              usedCodes: usedLocal,
            });
          } else {
            throw new Error(
              `Registration code ${cleanRegCode} is already assigned to another student. Generate a new code.`
            );
          }
        }
      }
    }

    if (existingId) {
      await updateDoc(doc(db, 'schools', schoolId, 'students', existingId), {
        admissionNo: clampStr(data.admissionNo, 40),
        fullName: clampStr(data.fullName, 120),
        gender: data.gender,
        formLevel: cleanFormLevel,
        stream: cleanStream,
        entryYear: cleanEntryYear,
        boardingStatus: data.boardingStatus,
        guardianName: clampStr(data.guardianName, 120),
        guardianPhone: clampStr(data.guardianPhone, 30),
        guardianSecondaryPhone: cleanSecondaryPhone,
        guardianRelationship: cleanRelationship,
        emergencyContactName: cleanEmergencyName,
        emergencyContactPhone: cleanEmergencyPhone,
        emergencyNotes: cleanEmergencyNotes,
        studentEmail: cleanEmail,
        registrationCode: cleanRegCode,
        status: data.status,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'schools', schoolId, 'students', studentId), {
        ownerId,
        admissionNo: clampStr(data.admissionNo, 40),
        fullName: clampStr(data.fullName, 120),
        gender: data.gender,
        formLevel: cleanFormLevel,
        stream: cleanStream,
        entryYear: cleanEntryYear,
        boardingStatus: data.boardingStatus,
        guardianName: clampStr(data.guardianName, 120),
        guardianPhone: clampStr(data.guardianPhone, 30),
        guardianSecondaryPhone: cleanSecondaryPhone,
        guardianRelationship: cleanRelationship,
        emergencyContactName: cleanEmergencyName,
        emergencyContactPhone: cleanEmergencyPhone,
        emergencyNotes: cleanEmergencyNotes,
        studentEmail: cleanEmail,
        registrationCode: cleanRegCode,
        status: data.status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    if (school) {
      // Remove legacy email link if email was cleared
      const linkId = `${schoolId}_${studentId}`;
      const linkRef = doc(db, 'studentLinks', linkId);
      const linkSnap = await getDoc(linkRef);
      if (cleanEmail.length < 3 && linkSnap.exists()) {
        await deleteDoc(linkRef);
      }

      // Clean up superseded registration code portal if code changed or was cleared
      if (previousRegCode.length >= 6 && previousRegCode !== cleanRegCode) {
        await deleteStudentPortalByCode(previousRegCode);
      }

      // Sync /studentPortals/{registrationCode} & mirrored results
      if (cleanRegCode.length >= 6) {
        const portalRef = doc(db, 'studentPortals', cleanRegCode);
        const portalSnap = await getDoc(portalRef);
        const portalFields = {
          schoolName: clampStr(school.name, 120),
          schoolDistrict: clampStr(school.district, 60),
          schoolType: school.schoolType,
          motto: clampStr(school.motto, 140),
          academicYear: clampStr(school.academicYear, 20),
          currentTerm: school.currentTerm,
          studentName: clampStr(data.fullName, 120),
          admissionNo: clampStr(data.admissionNo, 40),
          formLevel: Math.round(data.formLevel),
          stream: clampStr(data.stream || 'A', 20),
          boardingStatus: data.boardingStatus,
          status: data.status,
          logoDataUrl: String(school.logoDataUrl || '').slice(0, 160000),
          updatedAt: serverTimestamp(),
        };

        if (portalSnap.exists()) {
          await updateDoc(portalRef, portalFields);
        } else {
          await setDoc(portalRef, {
            ownerId,
            schoolId,
            studentId,
            registrationCode: cleanRegCode,
            ...portalFields,
            createdAt: serverTimestamp(),
          });
        }

        const assessmentsSnap = await getDocs(
          query(collection(db, 'schools', schoolId, 'assessments'), where('ownerId', '==', ownerId))
        );
        const studentAssessments = assessmentsSnap.docs.filter(
          (d) => (d.data() as { studentId?: string }).studentId === studentId
        );

        if (studentAssessments.length > 0) {
          const isFreshCode = previousRegCode !== cleanRegCode || !portalSnap.exists();
          const batch = writeBatch(db);
          for (const d of studentAssessments) {
            const raw = d.data() as Omit<Assessment, 'id'>;
            const resRef = doc(db, 'studentPortals', cleanRegCode, 'results', d.id);
            if (isFreshCode) {
              batch.set(resRef, {
                ...buildPortalResultFields(ownerId, schoolId, cleanRegCode, {
                  ...raw,
                  studentName: clampStr(data.fullName, 120),
                }),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            } else {
              batch.update(resRef, {
                studentName: clampStr(data.fullName, 120),
                updatedAt: serverTimestamp(),
              });
            }
          }
          await batch.commit();
        }

        const loansSnap = await getDocs(
          query(collection(db, 'schools', schoolId, 'libraryLoans'), where('ownerId', '==', ownerId))
        );
        const studentLoans = loansSnap.docs.filter(
          (d) => (d.data() as { studentId?: string }).studentId === studentId
        );

        if (studentLoans.length > 0) {
          const isFreshCode = previousRegCode !== cleanRegCode || !portalSnap.exists();
          const loanBatch = writeBatch(db);
          for (const d of studentLoans) {
            const raw = d.data() as Omit<LibraryLoan, 'id'>;
            const loanPortalRef = doc(db, 'studentPortals', cleanRegCode, 'libraryLoans', d.id);
            if (isFreshCode) {
              loanBatch.set(loanPortalRef, {
                ownerId,
                schoolId,
                registrationCode: cleanRegCode,
                studentId,
                studentName: clampStr(data.fullName, 120),
                formLevel: cleanFormLevel,
                stream: cleanStream,
                bookTitle: clampStr(raw.bookTitle, 140),
                materialType: raw.materialType,
                subject: clampStr(raw.subject || 'General', 60),
                bookCode: clampStr(raw.bookCode, 40),
                quantity: Math.min(20, Math.max(1, Math.round(Number(raw.quantity) || 1))),
                checkoutDate: raw.checkoutDate,
                dueDate: raw.dueDate,
                returnedDate: raw.returnedDate || '',
                status: raw.status === 'Returned' ? 'Returned' : 'Checked Out',
                conditionOnReturn: raw.conditionOnReturn || 'Good',
                notes: clampStr(raw.notes || '', 240),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            } else {
              loanBatch.update(loanPortalRef, {
                studentName: clampStr(data.fullName, 120),
                formLevel: cleanFormLevel,
                stream: cleanStream,
                updatedAt: serverTimestamp(),
              });
            }
          }
          await loanBatch.commit();
        }

        const feeInvoicesSnap = await getDocs(
          query(collection(db, 'schools', schoolId, 'feeInvoices'), where('ownerId', '==', ownerId))
        );
        const studentInvoices = feeInvoicesSnap.docs.filter(
          (d) => (d.data() as { studentId?: string }).studentId === studentId
        );

        if (studentInvoices.length > 0) {
          const isFreshCode = previousRegCode !== cleanRegCode || !portalSnap.exists();
          const feeBatch = writeBatch(db);
          for (const d of studentInvoices) {
            const raw = d.data() as Omit<FeeInvoice, 'id'>;
            const feePortalRef = doc(db, 'studentPortals', cleanRegCode, 'feeInvoices', d.id);
            if (isFreshCode) {
              feeBatch.set(feePortalRef, {
                ...buildPortalFeeInvoiceFields(ownerId, schoolId, cleanRegCode, {
                  ...raw,
                  studentName: clampStr(data.fullName, 120),
                  formLevel: cleanFormLevel,
                  stream: cleanStream,
                }),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            } else {
              feeBatch.update(feePortalRef, {
                studentName: clampStr(data.fullName, 120),
                formLevel: cleanFormLevel,
                stream: cleanStream,
                updatedAt: serverTimestamp(),
              });
            }
          }
          await feeBatch.commit();
        }
      }
    }

    return studentId;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Registration code')) {
      throw error;
    }
    handleFirestoreError(error, existingId ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function issueMissingRegistrationCodes(
  school: School,
  ownerId: string,
  students: Student[]
): Promise<number> {
  const usedCodes = new Set(
    students
      .map((s) => normalizeRegistrationCode(s.registrationCode))
      .filter((c) => c.length >= 6)
  );
  const missing = students.filter(
    (s) => normalizeRegistrationCode(s.registrationCode).length < 6
  );
  if (missing.length === 0) return 0;

  let updated = 0;
  for (const s of missing) {
    const entryYear = inferStudentEntryYear(s, school.academicYear);
    const nextCode = generateStudentRegistrationCode({
      formLevel: s.formLevel,
      stream: s.stream,
      entryYear,
      usedCodes,
    });
    usedCodes.add(nextCode);

    await saveStudent(
      school.id,
      ownerId,
      {
        admissionNo: s.admissionNo,
        fullName: s.fullName,
        gender: s.gender,
        formLevel: s.formLevel,
        stream: s.stream,
        entryYear,
        boardingStatus: s.boardingStatus,
        guardianName: s.guardianName,
        guardianPhone: s.guardianPhone,
        guardianSecondaryPhone: s.guardianSecondaryPhone || '',
        guardianRelationship: s.guardianRelationship || '',
        emergencyContactName: s.emergencyContactName || '',
        emergencyContactPhone: s.emergencyContactPhone || '',
        emergencyNotes: s.emergencyNotes || '',
        studentEmail: s.studentEmail || '',
        registrationCode: nextCode,
        autoGeneratedCode: true,
        status: s.status,
      },
      s.id,
      school
    );
    updated += 1;
  }
  return updated;
}

export async function removeStudent(schoolId: string, studentId: string) {
  const path = `schools/${schoolId}/students/${studentId}`;
  try {
    const stuSnap = await getDoc(doc(db, 'schools', schoolId, 'students', studentId));
    if (stuSnap.exists()) {
      const regCode = normalizeRegistrationCode(
        (stuSnap.data() as { registrationCode?: string }).registrationCode
      );
      if (regCode.length >= 6) {
        await deleteStudentPortalByCode(regCode);
      }
    }

    const linkRef = doc(db, 'studentLinks', `${schoolId}_${studentId}`);
    const linkSnap = await getDoc(linkRef);
    if (linkSnap.exists()) {
      await deleteDoc(linkRef);
    }
    await deleteDoc(doc(db, 'schools', schoolId, 'students', studentId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export interface TeacherPayload {
  staffCode: string;
  fullName: string;
  roleTitle: TeacherRole;
  subjects: string[];
  assignedForm: string;
  phone: string;
  staffEmail?: string;
  status: 'Active' | 'On Leave';
}

export async function saveTeacher(
  schoolId: string,
  ownerId: string,
  data: TeacherPayload,
  existingId?: string,
  school?: School,
  previousEmail?: string
): Promise<string> {
  const teacherId = existingId || makeId('tch');
  const path = `schools/${schoolId}/teachers/${teacherId}`;
  const cleanSubjects = (data.subjects.length > 0 ? data.subjects : ['General']).slice(0, 8).map((s) => clampStr(s, 60));
  const cleanEmail = normalizeStaffEmail(data.staffEmail);
  const prevClean = normalizeStaffEmail(previousEmail);
  const cleanAssignedForm = clampStr(data.assignedForm || 'General', 30);

  try {
    if (existingId) {
      await updateDoc(doc(db, 'schools', schoolId, 'teachers', existingId), {
        staffCode: clampStr(data.staffCode, 40),
        fullName: clampStr(data.fullName, 120),
        roleTitle: data.roleTitle,
        subjects: cleanSubjects,
        assignedForm: cleanAssignedForm,
        phone: clampStr(data.phone, 30),
        staffEmail: cleanEmail,
        status: data.status,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'schools', schoolId, 'teachers', teacherId), {
        ownerId,
        staffCode: clampStr(data.staffCode, 40),
        fullName: clampStr(data.fullName, 120),
        roleTitle: data.roleTitle,
        subjects: cleanSubjects,
        assignedForm: cleanAssignedForm,
        phone: clampStr(data.phone, 30),
        staffEmail: cleanEmail,
        status: data.status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    // Revoke previous email's RBAC access if email changed or was cleared
    if (prevClean.length >= 3 && prevClean !== cleanEmail) {
      const prevAccessRef = doc(db, 'schools', schoolId, 'staffAccess', makeStaffAccessKey(prevClean));
      const prevAccessSnap = await getDoc(prevAccessRef);
      if (prevAccessSnap.exists()) {
        await deleteDoc(prevAccessRef);
      }
    }

    if (school) {
      const linkId = `${schoolId}_${teacherId}`;
      const linkRef = doc(db, 'staffLinks', linkId);
      const linkSnap = await getDoc(linkRef);

      if (cleanEmail.length >= 3) {
        const linkFields = {
          schoolName: clampStr(school.name, 120),
          schoolDistrict: clampStr(school.district, 60),
          schoolType: school.schoolType,
          academicYear: clampStr(school.academicYear, 20),
          currentTerm: school.currentTerm,
          staffName: clampStr(data.fullName, 120),
          staffCode: clampStr(data.staffCode, 40),
          roleTitle: data.roleTitle,
          subjects: cleanSubjects,
          assignedForm: cleanAssignedForm,
          staffEmail: cleanEmail,
          status: data.status,
          logoDataUrl: String(school.logoDataUrl || '').slice(0, 160000),
          updatedAt: serverTimestamp(),
        };
        if (linkSnap.exists()) {
          await updateDoc(linkRef, linkFields);
        } else {
          await setDoc(linkRef, {
            ownerId,
            schoolId,
            teacherId,
            ...linkFields,
            createdAt: serverTimestamp(),
          });
        }

        const accessKey = makeStaffAccessKey(cleanEmail);
        const accessRef = doc(db, 'schools', schoolId, 'staffAccess', accessKey);
        const accessSnap = await getDoc(accessRef);
        if (accessSnap.exists() && accessSnap.data().teacherId === teacherId) {
          await updateDoc(accessRef, {
            staffEmail: cleanEmail,
            roleTitle: data.roleTitle,
            status: data.status,
            updatedAt: serverTimestamp(),
          });
        } else {
          if (accessSnap.exists()) {
            await deleteDoc(accessRef);
          }
          await setDoc(accessRef, {
            ownerId,
            schoolId,
            teacherId,
            staffEmail: cleanEmail,
            roleTitle: data.roleTitle,
            status: data.status,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } else if (linkSnap.exists()) {
        await deleteDoc(linkRef);
      }
    }

    return teacherId;
  } catch (error) {
    handleFirestoreError(error, existingId ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function removeTeacher(schoolId: string, teacherId: string, staffEmail?: string) {
  const path = `schools/${schoolId}/teachers/${teacherId}`;
  try {
    let emailToRevoke = normalizeStaffEmail(staffEmail);
    if (!emailToRevoke) {
      const teacherSnap = await getDoc(doc(db, 'schools', schoolId, 'teachers', teacherId));
      if (teacherSnap.exists()) {
        emailToRevoke = normalizeStaffEmail((teacherSnap.data() as { staffEmail?: string }).staffEmail);
      }
    }

    const linkRef = doc(db, 'staffLinks', `${schoolId}_${teacherId}`);
    const linkSnap = await getDoc(linkRef);
    if (linkSnap.exists()) {
      await deleteDoc(linkRef);
    }

    if (emailToRevoke.length >= 3) {
      const accessRef = doc(db, 'schools', schoolId, 'staffAccess', makeStaffAccessKey(emailToRevoke));
      const accessSnap = await getDoc(accessRef);
      if (accessSnap.exists()) {
        await deleteDoc(accessRef);
      }
    }

    await deleteDoc(doc(db, 'schools', schoolId, 'teachers', teacherId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export interface SchoolSubjectPayload {
  name: string;
  code: string;
  formLevels: FormLevel[];
  isCore: boolean;
}

function normalizeFormLevels(levels: FormLevel[]): FormLevel[] {
  const valid = Array.from(
    new Set(
      levels
        .map((n) => Math.round(Number(n)))
        .filter((n): n is FormLevel => n === 1 || n === 2 || n === 3 || n === 4)
    )
  ).sort((a, b) => a - b);
  return valid.length > 0 ? valid : [1, 2, 3, 4];
}

export async function saveSchoolSubject(
  schoolId: string,
  ownerId: string,
  data: SchoolSubjectPayload,
  existingId?: string
): Promise<string> {
  const subjectId = existingId || makeId('sub');
  const path = `schools/${schoolId}/subjects/${subjectId}`;
  const cleanName = clampStr(data.name, 60);
  const cleanCode = clampStr(data.code.toUpperCase(), 16);
  const cleanForms = normalizeFormLevels(data.formLevels);
  const isCore = Boolean(data.isCore);

  try {
    if (existingId) {
      await updateDoc(doc(db, 'schools', schoolId, 'subjects', existingId), {
        name: cleanName,
        code: cleanCode,
        formLevels: cleanForms,
        isCore,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'schools', schoolId, 'subjects', subjectId), {
        ownerId,
        name: cleanName,
        code: cleanCode,
        formLevels: cleanForms,
        isCore,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return subjectId;
  } catch (error) {
    handleFirestoreError(error, existingId ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function removeSchoolSubject(schoolId: string, subjectId: string) {
  const path = `schools/${schoolId}/subjects/${subjectId}`;
  try {
    await deleteDoc(doc(db, 'schools', schoolId, 'subjects', subjectId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function seedDefaultSchoolSubjects(
  schoolId: string,
  ownerId: string,
  existingSubjects: SchoolSubject[]
): Promise<number> {
  const existingNames = new Set(existingSubjects.map((s) => s.name.trim().toLowerCase()));
  const missing = DEFAULT_MALAWI_SUBJECT_PRESETS.filter(
    (preset) => !existingNames.has(preset.name.trim().toLowerCase())
  );
  if (missing.length === 0) return 0;

  const path = `schools/${schoolId}/subjects`;
  try {
    const batch = writeBatch(db);
    for (const preset of missing) {
      const subjectId = makeId('sub');
      batch.set(doc(db, 'schools', schoolId, 'subjects', subjectId), {
        ownerId,
        name: preset.name,
        code: preset.code,
        formLevels: normalizeFormLevels(preset.formLevels),
        isCore: preset.isCore,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    return missing.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export interface AssessmentPayload {
  studentId: string;
  studentName: string;
  studentEmail?: string;
  formLevel: FormLevel;
  stream: string;
  term: TermName;
  academicYear: string;
  subject: string;
  ca1Raw: number;
  ca1Max: number;
  ca2Raw: number;
  ca2Max: number;
  examRaw: number;
  examMax: number;
}

export async function saveAssessment(
  schoolId: string,
  ownerId: string,
  data: AssessmentPayload,
  existingId?: string
): Promise<string> {
  const assessmentId = existingId || makeId('asm');
  const path = `schools/${schoolId}/assessments/${assessmentId}`;
  const cleanEmail = normalizeStudentEmail(data.studentEmail);

  const ca1Max = Math.min(1000, Math.max(0, Number(data.ca1Max) || 0));
  const ca1Raw = Math.min(ca1Max, Math.max(0, Number(data.ca1Raw) || 0));
  const ca1Score = calculateWeightedComponent(ca1Raw, ca1Max, 20);

  const ca2Max = Math.min(1000, Math.max(0, Number(data.ca2Max) || 0));
  const ca2Raw = Math.min(ca2Max, Math.max(0, Number(data.ca2Raw) || 0));
  const ca2Score = calculateWeightedComponent(ca2Raw, ca2Max, 20);

  const ca = Math.min(40, Math.round((ca1Score + ca2Score) * 10) / 10);

  const examMax = Math.min(1000, Math.max(0, Number(data.examMax) || 0));
  const examRaw = Math.min(examMax, Math.max(0, Number(data.examRaw) || 0));
  const exam = calculateWeightedComponent(examRaw, examMax, 60);

  const graded = calculateManebGrade(data.formLevel, ca, exam);

  try {
    if (existingId) {
      await updateDoc(doc(db, 'schools', schoolId, 'assessments', existingId), {
        studentName: clampStr(data.studentName, 120),
        studentEmail: cleanEmail,
        formLevel: Math.round(data.formLevel),
        stream: clampStr(data.stream, 20),
        term: data.term,
        academicYear: clampStr(data.academicYear, 20),
        subject: clampStr(data.subject, 60),
        ca1Raw,
        ca1Max,
        ca1Score,
        ca2Raw,
        ca2Max,
        ca2Score,
        caScore: ca,
        examRaw,
        examMax,
        examScore: exam,
        totalScore: graded.totalScore,
        grade: graded.grade,
        gradePoint: Math.round(graded.gradePoint),
        remark: graded.remark,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'schools', schoolId, 'assessments', assessmentId), {
        ownerId,
        studentId: data.studentId,
        studentName: clampStr(data.studentName, 120),
        studentEmail: cleanEmail,
        formLevel: Math.round(data.formLevel),
        stream: clampStr(data.stream, 20),
        term: data.term,
        academicYear: clampStr(data.academicYear, 20),
        subject: clampStr(data.subject, 60),
        ca1Raw,
        ca1Max,
        ca1Score,
        ca2Raw,
        ca2Max,
        ca2Score,
        caScore: ca,
        examRaw,
        examMax,
        examScore: exam,
        totalScore: graded.totalScore,
        grade: graded.grade,
        gradePoint: Math.round(graded.gradePoint),
        remark: graded.remark,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    // Mirror mark into student's registration-code portal if a code is issued
    const stuSnap = await getDoc(doc(db, 'schools', schoolId, 'students', data.studentId));
    if (stuSnap.exists()) {
      const regCode = normalizeRegistrationCode(
        (stuSnap.data() as { registrationCode?: string }).registrationCode
      );
      if (regCode.length >= 6) {
        const resRef = doc(db, 'studentPortals', regCode, 'results', assessmentId);
        const resSnap = await getDoc(resRef);
        const resultPayload = {
          studentName: clampStr(data.studentName, 120),
          formLevel: Math.round(data.formLevel),
          stream: clampStr(data.stream, 20),
          term: data.term,
          academicYear: clampStr(data.academicYear, 20),
          subject: clampStr(data.subject, 60),
          ca1Raw,
          ca1Max,
          ca1Score,
          ca2Raw,
          ca2Max,
          ca2Score,
          caScore: ca,
          examRaw,
          examMax,
          examScore: exam,
          totalScore: graded.totalScore,
          grade: graded.grade,
          gradePoint: Math.round(graded.gradePoint),
          remark: graded.remark,
          updatedAt: serverTimestamp(),
        };
        if (resSnap.exists()) {
          await updateDoc(resRef, resultPayload);
        } else {
          await setDoc(resRef, {
            ownerId,
            schoolId,
            registrationCode: regCode,
            studentId: data.studentId,
            ...resultPayload,
            createdAt: serverTimestamp(),
          });
        }
      }
    }

    return assessmentId;
  } catch (error) {
    handleFirestoreError(error, existingId ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function removeAssessment(schoolId: string, assessmentId: string) {
  const path = `schools/${schoolId}/assessments/${assessmentId}`;
  try {
    const asmRef = doc(db, 'schools', schoolId, 'assessments', assessmentId);
    const asmSnap = await getDoc(asmRef);
    if (asmSnap.exists()) {
      const studentId = (asmSnap.data() as { studentId?: string }).studentId;
      if (studentId) {
        const stuSnap = await getDoc(doc(db, 'schools', schoolId, 'students', studentId));
        if (stuSnap.exists()) {
          const regCode = normalizeRegistrationCode(
            (stuSnap.data() as { registrationCode?: string }).registrationCode
          );
          if (regCode.length >= 6) {
            const resRef = doc(db, 'studentPortals', regCode, 'results', assessmentId);
            const resSnap = await getDoc(resRef);
            if (resSnap.exists()) {
              await deleteDoc(resRef);
            }
          }
        }
      }
    }
    await deleteDoc(asmRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

async function resolveStudentRegCode(
  schoolId: string,
  studentId: string,
  explicitRegCode?: string
): Promise<string> {
  const cleanExplicit = normalizeRegistrationCode(explicitRegCode || '');
  if (cleanExplicit.length >= 6) return cleanExplicit;
  try {
    const stuSnap = await getDoc(doc(db, 'schools', schoolId, 'students', studentId));
    if (stuSnap.exists()) {
      return normalizeRegistrationCode((stuSnap.data() as { registrationCode?: string }).registrationCode);
    }
  } catch {
    // Student lookup optional if code unavailable
  }
  return '';
}

export async function createFeeInvoice(
  schoolId: string,
  ownerId: string,
  params: {
    studentId: string;
    studentName: string;
    formLevel: FormLevel;
    stream: string;
    term: TermName;
    academicYear: string;
    tuitionFee: number;
    gpfFee: number;
    examFee: number;
    otherFee: number;
    schoolType?: SchoolType;
    registrationCode?: string;
  }
) {
  const invoiceId = makeId('inv');
  const path = `schools/${schoolId}/feeInvoices/${invoiceId}`;
  const govTuitionOnly = params.schoolType ? isGovernmentSchool(params.schoolType) : false;
  const tuition = Math.max(0, Number(params.tuitionFee) || 0);
  const gpf = govTuitionOnly ? 0 : Math.max(0, Number(params.gpfFee) || 0);
  const exam = govTuitionOnly ? 0 : Math.max(0, Number(params.examFee) || 0);
  const other = govTuitionOnly ? 0 : Math.max(0, Number(params.otherFee) || 0);
  const totalBilled = tuition + gpf + exam + other;
  const status: InvoiceStatus = totalBilled === 0 ? 'Paid' : 'Unpaid';

  try {
    const cleanRegCode = await resolveStudentRegCode(
      schoolId,
      params.studentId,
      params.registrationCode
    );
    const batch = writeBatch(db);
    batch.set(doc(db, 'schools', schoolId, 'feeInvoices', invoiceId), {
      ownerId,
      studentId: params.studentId,
      studentName: clampStr(params.studentName, 120),
      formLevel: Math.round(params.formLevel),
      stream: clampStr(params.stream, 20),
      term: params.term,
      academicYear: clampStr(params.academicYear, 20),
      tuitionFee: tuition,
      gpfFee: gpf,
      examFee: exam,
      otherFee: other,
      totalBilled,
      totalPaid: 0,
      status,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (cleanRegCode.length >= 6) {
      batch.set(doc(db, 'studentPortals', cleanRegCode, 'feeInvoices', invoiceId), {
        ...buildPortalFeeInvoiceFields(ownerId, schoolId, cleanRegCode, {
          studentId: params.studentId,
          studentName: params.studentName,
          formLevel: params.formLevel,
          stream: params.stream,
          term: params.term,
          academicYear: params.academicYear,
          tuitionFee: tuition,
          gpfFee: gpf,
          examFee: exam,
          otherFee: other,
          totalBilled,
          totalPaid: 0,
          status,
        }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    return invoiceId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function recordAtomicFeePayment(
  schoolId: string,
  ownerId: string,
  params: {
    invoiceId: string;
    studentId: string;
    studentName: string;
    currentTotalPaid: number;
    totalBilled: number;
    amount: number;
    method: PaymentMethod;
    reference: string;
    receiptNo: string;
    term: TermName;
    registrationCode?: string;
  }
) {
  const paymentId = makeId('pay');
  const path = `schools/${schoolId}/feePayments/${paymentId}`;
  const payAmount = Math.max(1, Number(params.amount) || 0);
  const nextPaid = params.currentTotalPaid + payAmount;
  const nextStatus: InvoiceStatus =
    nextPaid >= params.totalBilled ? 'Paid' : nextPaid > 0 ? 'Partial' : 'Unpaid';

  try {
    const cleanRegCode = await resolveStudentRegCode(
      schoolId,
      params.studentId,
      params.registrationCode
    );
    const batch = writeBatch(db);
    batch.set(doc(db, 'schools', schoolId, 'feePayments', paymentId), {
      ownerId,
      invoiceId: params.invoiceId,
      studentId: params.studentId,
      studentName: clampStr(params.studentName, 120),
      receiptNo: clampStr(params.receiptNo, 40),
      amount: payAmount,
      method: params.method,
      reference: clampStr(params.reference, 80),
      term: params.term,
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, 'schools', schoolId, 'feeInvoices', params.invoiceId), {
      totalPaid: nextPaid,
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
    if (cleanRegCode.length >= 6) {
      const portalInvRef = doc(db, 'studentPortals', cleanRegCode, 'feeInvoices', params.invoiceId);
      const portalInvSnap = await getDoc(portalInvRef);
      if (portalInvSnap.exists()) {
        batch.update(portalInvRef, {
          totalPaid: nextPaid,
          status: nextStatus,
          updatedAt: serverTimestamp(),
        });
      } else {
        const masterInvSnap = await getDoc(doc(db, 'schools', schoolId, 'feeInvoices', params.invoiceId));
        if (masterInvSnap.exists()) {
          const raw = masterInvSnap.data() as Omit<FeeInvoice, 'id'>;
          batch.set(portalInvRef, {
            ...buildPortalFeeInvoiceFields(ownerId, schoolId, cleanRegCode, {
              ...raw,
              totalPaid: nextPaid,
              status: nextStatus,
            }),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
    }
    await batch.commit();
    return paymentId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function removeFeeInvoice(
  schoolId: string,
  invoiceId: string,
  registrationCode?: string
) {
  const path = `schools/${schoolId}/feeInvoices/${invoiceId}`;
  try {
    let cleanRegCode = normalizeRegistrationCode(registrationCode || '');
    if (cleanRegCode.length < 6) {
      const invSnap = await getDoc(doc(db, 'schools', schoolId, 'feeInvoices', invoiceId));
      if (invSnap.exists()) {
        const studentId = (invSnap.data() as { studentId?: string }).studentId;
        if (studentId) {
          cleanRegCode = await resolveStudentRegCode(schoolId, studentId);
        }
      }
    }
    const batch = writeBatch(db);
    batch.delete(doc(db, 'schools', schoolId, 'feeInvoices', invoiceId));
    if (cleanRegCode.length >= 6) {
      const portalInvRef = doc(db, 'studentPortals', cleanRegCode, 'feeInvoices', invoiceId);
      const portalInvSnap = await getDoc(portalInvRef);
      if (portalInvSnap.exists()) {
        batch.delete(portalInvRef);
      }
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function syncMissingPortalFeeInvoices(
  schoolId: string,
  ownerId: string,
  students: Student[],
  invoices: FeeInvoice[]
): Promise<void> {
  if (students.length === 0 || invoices.length === 0) return;
  const studentById = new Map<string, Student>();
  for (const s of students) {
    studentById.set(s.id, s);
  }
  const toCheck = invoices
    .map((inv) => {
      const stu = studentById.get(inv.studentId);
      const regCode = normalizeRegistrationCode(stu?.registrationCode || '');
      return { inv, regCode };
    })
    .filter((item) => item.regCode.length >= 6);

  if (toCheck.length === 0) return;

  const missingOrStale: { inv: FeeInvoice; regCode: string; exists: boolean }[] = [];
  await Promise.all(
    toCheck.map(async ({ inv, regCode }) => {
      try {
        const snap = await getDoc(doc(db, 'studentPortals', regCode, 'feeInvoices', inv.id));
        if (!snap.exists()) {
          missingOrStale.push({ inv, regCode, exists: false });
        } else {
          const data = snap.data() as Partial<FeeInvoice>;
          if (data.totalPaid !== inv.totalPaid || data.totalBilled !== inv.totalBilled || data.status !== inv.status) {
            missingOrStale.push({ inv, regCode, exists: true });
          }
        }
      } catch {
        // Ignore single portal sync failures
      }
    })
  );

  if (missingOrStale.length === 0) return;

  for (let i = 0; i < missingOrStale.length; i += 150) {
    const batch = writeBatch(db);
    for (const item of missingOrStale.slice(i, i + 150)) {
      const ref = doc(db, 'studentPortals', item.regCode, 'feeInvoices', item.inv.id);
      if (item.exists) {
        batch.update(ref, {
          totalBilled: item.inv.totalBilled,
          totalPaid: item.inv.totalPaid,
          status: item.inv.status,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(ref, {
          ...buildPortalFeeInvoiceFields(ownerId, schoolId, item.regCode, item.inv),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
    await batch.commit();
  }
}

export interface SubmitStudentFeeProofPayload {
  ownerId: string;
  schoolId: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  formLevel: FormLevel;
  stream: string;
  registrationCode: string;
  invoiceId: string;
  term: TermName;
  academicYear: string;
  amount: number;
  method: PaymentMethod;
  reference: string;
  notes: string;
  fileName: string;
  mimeType: string;
  fileFormat: FeeSubmissionFileFormat;
  fileSizeBytes: number;
  fileBytes: Uint8Array;
}

export async function submitStudentFeePaymentReference(
  data: SubmitStudentFeeProofPayload,
  onUploadProgress?: (completedChunks: number, totalChunks: number) => void
): Promise<string> {
  const cleanRegCode = normalizeRegistrationCode(data.registrationCode);
  if (cleanRegCode.length < 6) {
    throw new Error('Valid student registration code is required.');
  }
  if (!data.fileBytes || data.fileBytes.length === 0) {
    throw new Error('Select a PDF or image payment proof file.');
  }
  if (data.fileBytes.length > 8 * 1024 * 1024) {
    throw new Error('Payment proof file must be 8 MB or smaller.');
  }
  const cleanAmount = Math.round(Number(data.amount) || 0);
  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0 || cleanAmount > 100000000) {
    throw new Error('Enter a valid payment amount in MWK.');
  }

  const submissionId = makeId('fsub');
  const path = `studentPortals/${cleanRegCode}/feeSubmissions/${submissionId}`;
  const todayIso = new Date().toISOString().slice(0, 10);
  const totalChunks = Math.ceil(data.fileBytes.length / DIGITAL_CHUNK_RAW_BYTES);
  if (totalChunks < 1 || totalChunks > 20) {
    throw new Error('Payment proof file exceeds maximum supported chunk count.');
  }

  try {
    for (let startChunk = 0; startChunk < totalChunks; startChunk += CHUNK_BATCH_SIZE) {
      const chunkBatch = writeBatch(db);
      const endChunk = Math.min(totalChunks, startChunk + CHUNK_BATCH_SIZE);
      for (let idx = startChunk; idx < endChunk; idx += 1) {
        const sliceStart = idx * DIGITAL_CHUNK_RAW_BYTES;
        const sliceEnd = Math.min(data.fileBytes.length, sliceStart + DIGITAL_CHUNK_RAW_BYTES);
        const sliceBytes = data.fileBytes.subarray(sliceStart, sliceEnd);
        const chunkRef = doc(
          db,
          'studentPortals',
          cleanRegCode,
          'feeSubmissions',
          submissionId,
          'chunks',
          `chunk_${idx}`
        );
        chunkBatch.set(chunkRef, {
          ownerId: data.ownerId,
          schoolId: data.schoolId,
          registrationCode: cleanRegCode,
          submissionId,
          chunkIndex: idx,
          dataBase64: uint8ArrayToBase64(sliceBytes),
          createdAt: serverTimestamp(),
        });
      }
      await chunkBatch.commit();
      onUploadProgress?.(endChunk, totalChunks);
    }

    const payload = {
      ownerId: data.ownerId,
      schoolId: data.schoolId,
      studentId: data.studentId,
      studentName: clampStr(data.studentName, 120),
      admissionNo: clampStr(data.admissionNo || 'N/A', 40) || 'N/A',
      formLevel: Math.min(4, Math.max(1, Math.round(Number(data.formLevel) || 1))),
      stream: clampStr(data.stream || 'A', 20) || 'A',
      registrationCode: cleanRegCode,
      invoiceId: String(data.invoiceId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128),
      term: data.term,
      academicYear: clampStr(data.academicYear, 20),
      amount: cleanAmount,
      method: data.method,
      reference: clampStr(data.reference || '', 80),
      notes: clampStr(data.notes || '', 240),
      fileName: clampStr(data.fileName, 160) || 'payment-proof',
      mimeType: clampStr(data.mimeType, 100) || 'application/octet-stream',
      fileFormat: data.fileFormat,
      fileSizeBytes: Math.max(1, Math.round(data.fileSizeBytes)),
      chunkCount: totalChunks,
      status: 'Pending' as const,
      reviewNote: '',
      receiptNo: '',
      submittedDate: todayIso,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const batch = writeBatch(db);
    batch.set(doc(db, 'studentPortals', cleanRegCode, 'feeSubmissions', submissionId), payload);
    batch.set(doc(db, 'schools', data.schoolId, 'feeSubmissions', submissionId), payload);
    await batch.commit();

    return submissionId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function fetchFeeSubmissionBytes(
  registrationCode: string,
  submissionId: string
): Promise<Uint8Array | null> {
  const cleanRegCode = normalizeRegistrationCode(registrationCode);
  const path = `studentPortals/${cleanRegCode}/feeSubmissions/${submissionId}/chunks`;
  try {
    const chunksSnap = await getDocs(
      query(
        collection(db, 'studentPortals', cleanRegCode, 'feeSubmissions', submissionId, 'chunks'),
        where('registrationCode', '==', cleanRegCode),
        where('submissionId', '==', submissionId)
      )
    );
    if (chunksSnap.docs.length === 0) return null;

    const sorted = chunksSnap.docs
      .map((d) => d.data() as { chunkIndex?: number; dataBase64?: string })
      .sort((a, b) => Number(a.chunkIndex || 0) - Number(b.chunkIndex || 0));

    const parts = sorted.map((c) => base64ToUint8Array(String(c.dataBase64 || '')));
    const totalLength = parts.reduce((sum, arr) => sum + arr.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      merged.set(part, offset);
      offset += part.length;
    }
    return merged;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function approveStudentFeeSubmission(params: {
  schoolId: string;
  ownerId: string;
  submission: StudentFeeSubmission;
  invoice: FeeInvoice;
  amount: number;
  method: PaymentMethod;
  reference: string;
  receiptNo: string;
  reviewNote: string;
}): Promise<string> {
  const paymentId = makeId('pay');
  const path = `schools/${params.schoolId}/feeSubmissions/${params.submission.id}`;
  const payAmount = Math.max(1, Math.round(Number(params.amount) || 0));
  const nextPaid = params.invoice.totalPaid + payAmount;
  const nextStatus: InvoiceStatus =
    nextPaid >= params.invoice.totalBilled ? 'Paid' : nextPaid > 0 ? 'Partial' : 'Unpaid';
  const cleanRegCode = normalizeRegistrationCode(params.submission.registrationCode);
  const cleanReceipt = clampStr(params.receiptNo, 40);
  const cleanReviewNote = clampStr(params.reviewNote, 240);

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'schools', params.schoolId, 'feePayments', paymentId), {
      ownerId: params.ownerId,
      invoiceId: params.invoice.id,
      studentId: params.invoice.studentId,
      studentName: clampStr(params.invoice.studentName, 120),
      receiptNo: cleanReceipt,
      amount: payAmount,
      method: params.method,
      reference: clampStr(params.reference || 'Student Proof Upload', 80),
      term: params.invoice.term,
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, 'schools', params.schoolId, 'feeInvoices', params.invoice.id), {
      totalPaid: nextPaid,
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });

    if (cleanRegCode.length >= 6) {
      const portalInvRef = doc(db, 'studentPortals', cleanRegCode, 'feeInvoices', params.invoice.id);
      const portalInvSnap = await getDoc(portalInvRef);
      if (portalInvSnap.exists()) {
        batch.update(portalInvRef, {
          totalPaid: nextPaid,
          status: nextStatus,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(portalInvRef, {
          ...buildPortalFeeInvoiceFields(params.ownerId, params.schoolId, cleanRegCode, {
            ...params.invoice,
            totalPaid: nextPaid,
            status: nextStatus,
          }),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      const portalSubRef = doc(
        db,
        'studentPortals',
        cleanRegCode,
        'feeSubmissions',
        params.submission.id
      );
      const portalSubSnap = await getDoc(portalSubRef);
      if (portalSubSnap.exists()) {
        batch.update(portalSubRef, {
          status: 'Approved',
          reviewNote: cleanReviewNote,
          receiptNo: cleanReceipt,
          invoiceId: params.invoice.id,
          updatedAt: serverTimestamp(),
        });
      }
    }

    batch.update(doc(db, 'schools', params.schoolId, 'feeSubmissions', params.submission.id), {
      status: 'Approved',
      reviewNote: cleanReviewNote,
      receiptNo: cleanReceipt,
      invoiceId: params.invoice.id,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    return paymentId;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function rejectStudentFeeSubmission(params: {
  schoolId: string;
  submission: StudentFeeSubmission;
  reviewNote: string;
}): Promise<void> {
  const path = `schools/${params.schoolId}/feeSubmissions/${params.submission.id}`;
  const cleanRegCode = normalizeRegistrationCode(params.submission.registrationCode);
  const cleanReviewNote = clampStr(params.reviewNote || 'Payment reference could not be verified.', 240);

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'schools', params.schoolId, 'feeSubmissions', params.submission.id), {
      status: 'Rejected',
      reviewNote: cleanReviewNote,
      updatedAt: serverTimestamp(),
    });
    if (cleanRegCode.length >= 6) {
      const portalSubRef = doc(
        db,
        'studentPortals',
        cleanRegCode,
        'feeSubmissions',
        params.submission.id
      );
      const portalSubSnap = await getDoc(portalSubRef);
      if (portalSubSnap.exists()) {
        batch.update(portalSubRef, {
          status: 'Rejected',
          reviewNote: cleanReviewNote,
          updatedAt: serverTimestamp(),
        });
      }
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function saveAttendanceEntry(
  schoolId: string,
  ownerId: string,
  params: {
    date: string;
    formLevel: FormLevel;
    stream: string;
    studentId: string;
    studentName: string;
    status: AttendanceStatus;
    note: string;
    existingId?: string;
  }
) {
  const attendanceId = params.existingId || `${params.date}_${params.studentId}`;
  const path = `schools/${schoolId}/attendance/${attendanceId}`;
  try {
    if (params.existingId) {
      await updateDoc(doc(db, 'schools', schoolId, 'attendance', attendanceId), {
        status: params.status,
        note: clampStr(params.note, 140),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'schools', schoolId, 'attendance', attendanceId), {
        ownerId,
        date: params.date,
        formLevel: Math.round(params.formLevel),
        stream: clampStr(params.stream, 20),
        studentId: params.studentId,
        studentName: clampStr(params.studentName, 120),
        status: params.status,
        note: clampStr(params.note, 140),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return attendanceId;
  } catch (error) {
    handleFirestoreError(error, params.existingId ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function saveStaffAttendanceEntry(
  schoolId: string,
  ownerId: string,
  params: {
    date: string;
    teacherId: string;
    staffCode: string;
    staffName: string;
    roleTitle: TeacherRole;
    status: StaffAttendanceStatus;
    note: string;
    recordedBy: string;
    existingId?: string;
  }
): Promise<string> {
  const recordId = params.existingId || `${params.date}_${params.teacherId}`;
  const path = `schools/${schoolId}/staffAttendance/${recordId}`;
  try {
    if (params.existingId) {
      await updateDoc(doc(db, 'schools', schoolId, 'staffAttendance', recordId), {
        status: params.status,
        note: clampStr(params.note, 200),
        recordedBy: clampStr(params.recordedBy || 'School Admin', 120) || 'School Admin',
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'schools', schoolId, 'staffAttendance', recordId), {
        ownerId,
        schoolId,
        date: params.date,
        teacherId: params.teacherId,
        staffCode: clampStr(params.staffCode || 'STF', 40) || 'STF',
        staffName: clampStr(params.staffName, 120),
        roleTitle: params.roleTitle,
        status: params.status,
        note: clampStr(params.note, 200),
        recordedBy: clampStr(params.recordedBy || 'School Admin', 120) || 'School Admin',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return recordId;
  } catch (error) {
    handleFirestoreError(error, params.existingId ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export interface StudentCasePayload {
  studentId: string;
  studentName: string;
  admissionNo: string;
  formLevel: FormLevel;
  stream: string;
  caseType: StudentCaseType;
  severity: StudentCaseSeverity;
  status: StudentCaseStatus;
  title: string;
  description: string;
  actionTaken: string;
  incidentDate: string;
  suspensionEndDate: string;
  guardianNotified: boolean;
  recordedBy: string;
  syncStudentStatus?: StudentStatus | '';
}

export async function saveStudentCase(
  schoolId: string,
  ownerId: string,
  data: StudentCasePayload,
  existingId?: string
): Promise<string> {
  const caseId = existingId || makeId('case');
  const path = `schools/${schoolId}/studentCases/${caseId}`;
  const cleanTitle = clampStr(data.title, 140);
  const cleanDescription = clampStr(data.description, 1200);
  if (cleanTitle.length < 2) {
    throw new Error('Case title must be at least 2 characters.');
  }
  if (cleanDescription.length < 2) {
    throw new Error('Please enter details describing the incident or case.');
  }

  const cleanIncidentDate = /^\d{4}-\d{2}-\d{2}$/.test(data.incidentDate)
    ? data.incidentDate
    : new Date().toISOString().slice(0, 10);
  const cleanSuspensionEndDate = /^\d{4}-\d{2}-\d{2}$/.test(data.suspensionEndDate)
    ? data.suspensionEndDate
    : '';

  try {
    const batch = writeBatch(db);
    const caseRef = doc(db, 'schools', schoolId, 'studentCases', caseId);
    const fields = {
      studentName: clampStr(data.studentName, 120),
      admissionNo: clampStr(data.admissionNo || 'N/A', 40) || 'N/A',
      formLevel: Math.min(4, Math.max(1, Math.round(Number(data.formLevel) || 1))),
      stream: clampStr(data.stream || 'A', 20) || 'A',
      caseType: data.caseType,
      severity: data.severity,
      status: data.status,
      title: cleanTitle,
      description: cleanDescription,
      actionTaken: clampStr(data.actionTaken || '', 400),
      incidentDate: cleanIncidentDate,
      suspensionEndDate: cleanSuspensionEndDate,
      guardianNotified: Boolean(data.guardianNotified),
      recordedBy: clampStr(data.recordedBy || 'School Admin', 120) || 'School Admin',
      updatedAt: serverTimestamp(),
    };

    if (existingId) {
      batch.update(caseRef, fields);
    } else {
      batch.set(caseRef, {
        ownerId,
        schoolId,
        studentId: data.studentId,
        ...fields,
        createdAt: serverTimestamp(),
      });
    }

    if (data.syncStudentStatus) {
      const studentRef = doc(db, 'schools', schoolId, 'students', data.studentId);
      const studentSnap = await getDoc(studentRef);
      if (studentSnap.exists()) {
        batch.update(studentRef, {
          status: data.syncStudentStatus,
          updatedAt: serverTimestamp(),
        });
        const regCode = normalizeRegistrationCode(
          (studentSnap.data() as { registrationCode?: string }).registrationCode
        );
        if (regCode.length >= 6) {
          const portalRef = doc(db, 'studentPortals', regCode);
          const portalSnap = await getDoc(portalRef);
          if (portalSnap.exists()) {
            batch.update(portalRef, {
              status: data.syncStudentStatus,
              updatedAt: serverTimestamp(),
            });
          }
        }
      }
    }

    await batch.commit();
    return caseId;
  } catch (error) {
    handleFirestoreError(error, existingId ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function removeStudentCase(schoolId: string, caseId: string): Promise<void> {
  const path = `schools/${schoolId}/studentCases/${caseId}`;
  try {
    await deleteDoc(doc(db, 'schools', schoolId, 'studentCases', caseId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export interface LibraryLoanPayload {
  studentId: string;
  studentName: string;
  admissionNo: string;
  formLevel: FormLevel;
  stream: string;
  bookTitle: string;
  materialType: LibraryMaterialCategory;
  subject: string;
  bookCode: string;
  quantity: number;
  checkoutDate: string;
  dueDate: string;
  returnedDate?: string;
  status?: LibraryLoanStatus;
  conditionOnReturn?: LibraryItemCondition;
  notes?: string;
}

async function syncLibraryLoanToPortal(
  schoolId: string,
  ownerId: string,
  loanId: string,
  loan: {
    studentId: string;
    studentName: string;
    formLevel: FormLevel;
    stream: string;
    bookTitle: string;
    materialType: LibraryMaterialCategory;
    subject: string;
    bookCode: string;
    quantity: number;
    checkoutDate: string;
    dueDate: string;
    returnedDate: string;
    status: LibraryLoanStatus;
    conditionOnReturn: LibraryItemCondition;
    notes: string;
  }
) {
  const stuSnap = await getDoc(doc(db, 'schools', schoolId, 'students', loan.studentId));
  if (!stuSnap.exists()) return;
  const regCode = normalizeRegistrationCode(
    (stuSnap.data() as { registrationCode?: string }).registrationCode
  );
  if (regCode.length < 6) return;

  const portalLoanRef = doc(db, 'studentPortals', regCode, 'libraryLoans', loanId);
  const portalLoanSnap = await getDoc(portalLoanRef);
  const commonFields = {
    studentName: clampStr(loan.studentName, 120),
    formLevel: Math.min(4, Math.max(1, Math.round(loan.formLevel))) as FormLevel,
    stream: clampStr(loan.stream || 'A', 20) || 'A',
    bookTitle: clampStr(loan.bookTitle, 140),
    materialType: loan.materialType,
    subject: clampStr(loan.subject || 'General', 60),
    bookCode: clampStr(loan.bookCode, 40),
    quantity: Math.min(20, Math.max(1, Math.round(Number(loan.quantity) || 1))),
    checkoutDate: loan.checkoutDate,
    dueDate: loan.dueDate,
    returnedDate: loan.returnedDate || '',
    status: loan.status === 'Returned' ? 'Returned' : 'Checked Out',
    conditionOnReturn: loan.conditionOnReturn || 'Good',
    notes: clampStr(loan.notes || '', 240),
    updatedAt: serverTimestamp(),
  };

  if (portalLoanSnap.exists()) {
    await updateDoc(portalLoanRef, commonFields);
  } else {
    await setDoc(portalLoanRef, {
      ownerId,
      schoolId,
      registrationCode: regCode,
      studentId: loan.studentId,
      ...commonFields,
      createdAt: serverTimestamp(),
    });
  }
}

function buildLibraryTransactionDocData(params: {
  ownerId: string;
  loanId: string;
  action: LibraryTransactionAction;
  studentId: string;
  studentName: string;
  admissionNo: string;
  formLevel: FormLevel;
  stream: string;
  bookTitle: string;
  bookCode: string;
  subject: string;
  quantity: number;
  eventDate: string;
  dueDate: string;
  condition: LibraryItemCondition;
  notes: string;
  actorUidOverride?: string;
  actorNameOverride?: string;
}) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const cleanEventDate = /^\d{4}-\d{2}-\d{2}$/.test(params.eventDate) ? params.eventDate : todayIso;
  const cleanDueDate = /^\d{4}-\d{2}-\d{2}$/.test(params.dueDate) ? params.dueDate : todayIso;
  const rawName = clampStr(params.studentName, 120);
  const cleanStudentName = rawName.length >= 2 ? rawName : 'Student';
  const rawTitle = clampStr(params.bookTitle, 140);
  const cleanBookTitle = rawTitle.length >= 2 ? rawTitle : 'Library Book';
  const actorUid = params.actorUidOverride || auth.currentUser?.uid || params.ownerId;
  const actorName =
    clampStr(
      params.actorNameOverride ||
        auth.currentUser?.displayName ||
        auth.currentUser?.email ||
        'Library Staff',
      120
    ) || 'Library Staff';

  return {
    ownerId: params.ownerId,
    loanId: params.loanId,
    action: params.action,
    studentId: params.studentId,
    studentName: cleanStudentName,
    admissionNo: clampStr(params.admissionNo || 'N/A', 40) || 'N/A',
    formLevel: Math.min(4, Math.max(1, Math.round(Number(params.formLevel) || 1))),
    stream: clampStr(params.stream || 'A', 20) || 'A',
    bookTitle: cleanBookTitle,
    bookCode: clampStr(params.bookCode || 'LIB', 40) || 'LIB',
    subject: clampStr(params.subject || 'General', 60),
    quantity: Math.min(20, Math.max(1, Math.round(Number(params.quantity) || 1))),
    eventDate: cleanEventDate,
    dueDate: cleanDueDate,
    condition: params.condition || 'Good',
    actorUid,
    actorName,
    notes: clampStr(params.notes || '', 240),
    createdAt: serverTimestamp(),
  };
}

async function recordLibraryTransaction(
  schoolId: string,
  params: Parameters<typeof buildLibraryTransactionDocData>[0]
) {
  const txId = makeId('ltx');
  const txRef = doc(db, 'schools', schoolId, 'libraryTransactions', txId);
  await setDoc(txRef, buildLibraryTransactionDocData(params));
}

export async function saveLibraryLoan(
  schoolId: string,
  ownerId: string,
  data: LibraryLoanPayload,
  existingId?: string
): Promise<string> {
  const loanId = existingId || makeId('lib');
  const path = `schools/${schoolId}/libraryLoans/${loanId}`;
  const todayIso = new Date().toISOString().slice(0, 10);
  const status: LibraryLoanStatus = data.status === 'Returned' ? 'Returned' : 'Checked Out';
  const cleanCheckout = /^\d{4}-\d{2}-\d{2}$/.test(data.checkoutDate)
    ? data.checkoutDate
    : todayIso;
  const cleanDue = /^\d{4}-\d{2}-\d{2}$/.test(data.dueDate)
    ? data.dueDate
    : addDaysToIsoDate(cleanCheckout, 14);
  const cleanReturned =
    status === 'Returned'
      ? data.returnedDate && /^\d{4}-\d{2}-\d{2}$/.test(data.returnedDate)
        ? data.returnedDate
        : todayIso
      : '';
  const conditionOnReturn: LibraryItemCondition = data.conditionOnReturn || 'Good';
  const cleanFormLevel = Math.min(4, Math.max(1, Math.round(data.formLevel))) as FormLevel;
  const cleanQty = Math.min(20, Math.max(1, Math.round(Number(data.quantity) || 1)));
  const cleanStream = clampStr(data.stream || 'A', 20) || 'A';
  const cleanStudentName = clampStr(data.studentName, 120);
  const cleanAdmissionNo = clampStr(data.admissionNo || 'N/A', 40) || 'N/A';
  const cleanBookTitle = clampStr(data.bookTitle, 140);
  const cleanSubject = clampStr(data.subject || 'General', 60);
  const cleanBookCode = clampStr(data.bookCode, 40);
  const cleanNotes = clampStr(data.notes || '', 240);

  try {
    let txAction: LibraryTransactionAction = status === 'Returned' ? 'Returned' : 'Checked Out';
    let txEventDate = status === 'Returned' ? cleanReturned : cleanCheckout;

    if (existingId) {
      const prevSnap = await getDoc(doc(db, 'schools', schoolId, 'libraryLoans', existingId));
      const prevStatus = prevSnap.exists()
        ? (prevSnap.data() as { status?: LibraryLoanStatus }).status
        : undefined;
      if (prevStatus !== 'Returned' && status === 'Returned') {
        txAction = 'Returned';
        txEventDate = cleanReturned;
      } else if (prevStatus === 'Returned' && status === 'Checked Out') {
        txAction = 'Reopened';
        txEventDate = todayIso;
      } else {
        txAction = 'Edited';
        txEventDate = todayIso;
      }

      await updateDoc(doc(db, 'schools', schoolId, 'libraryLoans', existingId), {
        studentName: cleanStudentName,
        admissionNo: cleanAdmissionNo,
        formLevel: cleanFormLevel,
        stream: cleanStream,
        bookTitle: cleanBookTitle,
        materialType: data.materialType,
        subject: cleanSubject,
        bookCode: cleanBookCode,
        quantity: cleanQty,
        checkoutDate: cleanCheckout,
        dueDate: cleanDue,
        returnedDate: cleanReturned,
        status,
        conditionOnReturn,
        notes: cleanNotes,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'schools', schoolId, 'libraryLoans', loanId), {
        ownerId,
        studentId: data.studentId,
        studentName: cleanStudentName,
        admissionNo: cleanAdmissionNo,
        formLevel: cleanFormLevel,
        stream: cleanStream,
        bookTitle: cleanBookTitle,
        materialType: data.materialType,
        subject: cleanSubject,
        bookCode: cleanBookCode,
        quantity: cleanQty,
        checkoutDate: cleanCheckout,
        dueDate: cleanDue,
        returnedDate: cleanReturned,
        status,
        conditionOnReturn,
        notes: cleanNotes,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await recordLibraryTransaction(schoolId, {
      ownerId,
      loanId,
      action: txAction,
      studentId: data.studentId,
      studentName: cleanStudentName,
      admissionNo: cleanAdmissionNo,
      formLevel: cleanFormLevel,
      stream: cleanStream,
      bookTitle: cleanBookTitle,
      bookCode: cleanBookCode,
      subject: cleanSubject,
      quantity: cleanQty,
      eventDate: txEventDate,
      dueDate: cleanDue,
      condition: conditionOnReturn,
      notes: cleanNotes,
    });

    await syncLibraryLoanToPortal(schoolId, ownerId, loanId, {
      studentId: data.studentId,
      studentName: cleanStudentName,
      formLevel: cleanFormLevel,
      stream: cleanStream,
      bookTitle: cleanBookTitle,
      materialType: data.materialType,
      subject: cleanSubject,
      bookCode: cleanBookCode,
      quantity: cleanQty,
      checkoutDate: cleanCheckout,
      dueDate: cleanDue,
      returnedDate: cleanReturned,
      status,
      conditionOnReturn,
      notes: cleanNotes,
    });

    await syncStudentCatalogMirror(schoolId, ownerId);

    return loanId;
  } catch (error) {
    handleFirestoreError(error, existingId ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function markLibraryLoanReturned(
  schoolId: string,
  loanId: string,
  params: {
    returnedDate: string;
    conditionOnReturn: LibraryItemCondition;
    notes?: string;
  }
) {
  const path = `schools/${schoolId}/libraryLoans/${loanId}`;
  const todayIso = new Date().toISOString().slice(0, 10);
  const cleanReturned = /^\d{4}-\d{2}-\d{2}$/.test(params.returnedDate)
    ? params.returnedDate
    : todayIso;

  try {
    const loanRef = doc(db, 'schools', schoolId, 'libraryLoans', loanId);
    const loanSnap = await getDoc(loanRef);

    const payload: Record<string, unknown> = {
      status: 'Returned',
      returnedDate: cleanReturned,
      conditionOnReturn: params.conditionOnReturn,
      updatedAt: serverTimestamp(),
    };
    if (params.notes !== undefined) {
      payload.notes = clampStr(params.notes, 240);
    }
    await updateDoc(loanRef, payload);

    if (loanSnap.exists()) {
      const existing = loanSnap.data() as Omit<LibraryLoan, 'id'>;
      const finalNotes =
        params.notes !== undefined ? clampStr(params.notes, 240) : existing.notes || '';
      await recordLibraryTransaction(schoolId, {
        ownerId: existing.ownerId,
        loanId,
        action: 'Returned',
        studentId: existing.studentId,
        studentName: existing.studentName,
        admissionNo: existing.admissionNo || 'N/A',
        formLevel: existing.formLevel,
        stream: existing.stream,
        bookTitle: existing.bookTitle,
        bookCode: existing.bookCode,
        subject: existing.subject || 'General',
        quantity: existing.quantity,
        eventDate: cleanReturned,
        dueDate: existing.dueDate,
        condition: params.conditionOnReturn,
        notes: finalNotes,
      });

      await syncLibraryLoanToPortal(schoolId, existing.ownerId, loanId, {
        ...existing,
        returnedDate: cleanReturned,
        status: 'Returned',
        conditionOnReturn: params.conditionOnReturn,
        notes: finalNotes,
      });

      await syncStudentCatalogMirror(schoolId, existing.ownerId);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function reopenLibraryLoan(schoolId: string, loanId: string) {
  const path = `schools/${schoolId}/libraryLoans/${loanId}`;
  const todayIso = new Date().toISOString().slice(0, 10);
  try {
    const loanRef = doc(db, 'schools', schoolId, 'libraryLoans', loanId);
    const loanSnap = await getDoc(loanRef);

    await updateDoc(loanRef, {
      status: 'Checked Out',
      returnedDate: '',
      conditionOnReturn: 'Good',
      updatedAt: serverTimestamp(),
    });

    if (loanSnap.exists()) {
      const existing = loanSnap.data() as Omit<LibraryLoan, 'id'>;
      await recordLibraryTransaction(schoolId, {
        ownerId: existing.ownerId,
        loanId,
        action: 'Reopened',
        studentId: existing.studentId,
        studentName: existing.studentName,
        admissionNo: existing.admissionNo || 'N/A',
        formLevel: existing.formLevel,
        stream: existing.stream,
        bookTitle: existing.bookTitle,
        bookCode: existing.bookCode,
        subject: existing.subject || 'General',
        quantity: existing.quantity,
        eventDate: todayIso,
        dueDate: existing.dueDate,
        condition: 'Good',
        notes: existing.notes || '',
      });

      await syncLibraryLoanToPortal(schoolId, existing.ownerId, loanId, {
        ...existing,
        returnedDate: '',
        status: 'Checked Out',
        conditionOnReturn: 'Good',
        notes: existing.notes || '',
      });

      await syncStudentCatalogMirror(schoolId, existing.ownerId);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function removeLibraryLoan(schoolId: string, loanId: string) {
  const path = `schools/${schoolId}/libraryLoans/${loanId}`;
  const todayIso = new Date().toISOString().slice(0, 10);
  try {
    const loanRef = doc(db, 'schools', schoolId, 'libraryLoans', loanId);
    const loanSnap = await getDoc(loanRef);
    let ownerIdForMirror = '';
    if (loanSnap.exists()) {
      const existing = loanSnap.data() as Omit<LibraryLoan, 'id'>;
      ownerIdForMirror = existing.ownerId;
      await recordLibraryTransaction(schoolId, {
        ownerId: existing.ownerId,
        loanId,
        action: 'Deleted',
        studentId: existing.studentId,
        studentName: existing.studentName,
        admissionNo: existing.admissionNo || 'N/A',
        formLevel: existing.formLevel,
        stream: existing.stream,
        bookTitle: existing.bookTitle,
        bookCode: existing.bookCode,
        subject: existing.subject || 'General',
        quantity: existing.quantity,
        eventDate: todayIso,
        dueDate: existing.dueDate,
        condition: existing.conditionOnReturn || 'Good',
        notes: existing.notes || 'Loan record removed from active register.',
      });

      const studentId = existing.studentId;
      if (studentId) {
        const stuSnap = await getDoc(doc(db, 'schools', schoolId, 'students', studentId));
        if (stuSnap.exists()) {
          const regCode = normalizeRegistrationCode(
            (stuSnap.data() as { registrationCode?: string }).registrationCode
          );
          if (regCode.length >= 6) {
            const portalLoanRef = doc(db, 'studentPortals', regCode, 'libraryLoans', loanId);
            const portalLoanSnap = await getDoc(portalLoanRef);
            if (portalLoanSnap.exists()) {
              await deleteDoc(portalLoanRef);
            }
          }
        }
      }
    }
    await deleteDoc(loanRef);
    if (ownerIdForMirror) {
      await syncStudentCatalogMirror(schoolId, ownerIdForMirror);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export interface LibraryBookPayload {
  isbn: string;
  title: string;
  author: string;
  subject: string;
  materialType: LibraryMaterialCategory;
  shelfCode: string;
  totalCopies: number;
  notes?: string;
}

export async function saveLibraryBook(
  schoolId: string,
  ownerId: string,
  data: LibraryBookPayload,
  existingId?: string
): Promise<string> {
  const bookId = existingId || makeId('bk');
  const path = `schools/${schoolId}/libraryBooks/${bookId}`;
  const cleanIsbn = clampStr(data.isbn, 32);
  const cleanTitle = clampStr(data.title, 140);
  const cleanAuthor = clampStr(data.author, 120);
  const cleanSubject = clampStr(data.subject || 'General', 60) || 'General';
  const cleanShelfCode = clampStr(data.shelfCode || '', 40).toUpperCase();
  const cleanTotalCopies = Math.min(500, Math.max(1, Math.round(Number(data.totalCopies) || 1)));
  const cleanNotes = clampStr(data.notes || '', 240);

  try {
    if (existingId) {
      await updateDoc(doc(db, 'schools', schoolId, 'libraryBooks', existingId), {
        isbn: cleanIsbn,
        title: cleanTitle,
        author: cleanAuthor,
        subject: cleanSubject,
        materialType: data.materialType,
        shelfCode: cleanShelfCode,
        totalCopies: cleanTotalCopies,
        notes: cleanNotes,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'schools', schoolId, 'libraryBooks', bookId), {
        ownerId,
        isbn: cleanIsbn,
        title: cleanTitle,
        author: cleanAuthor,
        subject: cleanSubject,
        materialType: data.materialType,
        shelfCode: cleanShelfCode,
        totalCopies: cleanTotalCopies,
        notes: cleanNotes,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await syncStudentCatalogMirror(schoolId, ownerId);
    return bookId;
  } catch (error) {
    handleFirestoreError(error, existingId ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function removeLibraryBook(schoolId: string, bookId: string) {
  const path = `schools/${schoolId}/libraryBooks/${bookId}`;
  try {
    await deleteDoc(doc(db, 'schools', schoolId, 'libraryBooks', bookId));
    const mirrorRef = doc(db, 'studentLibraries', schoolId, 'books', bookId);
    const mirrorSnap = await getDoc(mirrorRef);
    if (mirrorSnap.exists()) {
      await deleteDoc(mirrorRef);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function seedDefaultLibraryBooks(
  schoolId: string,
  ownerId: string,
  existingBooks: LibraryBook[]
): Promise<number> {
  const existingTitles = new Set(existingBooks.map((b) => b.title.trim().toLowerCase()));
  const missing = DEFAULT_LIBRARY_BOOKS_PRESETS.filter(
    (preset) => !existingTitles.has(preset.title.trim().toLowerCase())
  );
  if (missing.length === 0) return 0;

  const path = `schools/${schoolId}/libraryBooks`;
  try {
    const batch = writeBatch(db);
    for (const preset of missing) {
      const bookId = makeId('bk');
      batch.set(doc(db, 'schools', schoolId, 'libraryBooks', bookId), {
        ownerId,
        isbn: preset.isbn,
        title: preset.title,
        author: preset.author,
        subject: preset.subject,
        materialType: preset.materialType,
        shelfCode: preset.shelfCode,
        totalCopies: preset.totalCopies,
        notes: preset.notes,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    await syncStudentCatalogMirror(schoolId, ownerId);
    return missing.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncStudentCatalogMirror(schoolId: string, ownerId: string): Promise<void> {
  try {
    const [booksSnap, loansSnap, mirrorsSnap] = await Promise.all([
      getDocs(query(collection(db, 'schools', schoolId, 'libraryBooks'), where('ownerId', '==', ownerId))),
      getDocs(query(collection(db, 'schools', schoolId, 'libraryLoans'), where('ownerId', '==', ownerId))),
      getDocs(query(collection(db, 'studentLibraries', schoolId, 'books'), where('schoolId', '==', schoolId))),
    ]);

    const activeLoanCountByTitle = new Map<string, number>();
    for (const d of loansSnap.docs) {
      const loan = d.data() as { status?: string; bookTitle?: string; quantity?: number };
      if (loan.status !== 'Checked Out') continue;
      const key = String(loan.bookTitle ?? '').trim().toLowerCase();
      if (!key) continue;
      const qty = Math.max(1, Math.round(Number(loan.quantity) || 1));
      activeLoanCountByTitle.set(key, (activeLoanCountByTitle.get(key) || 0) + qty);
    }

    const existingMirrorIds = new Set(mirrorsSnap.docs.map((d) => d.id));
    const currentBookIds = new Set(booksSnap.docs.map((d) => d.id));

    const ops: Array<
      | { kind: 'set'; id: string; data: Record<string, unknown> }
      | { kind: 'update'; id: string; data: Record<string, unknown> }
      | { kind: 'delete'; id: string }
    > = [];

    for (const bookDoc of booksSnap.docs) {
      const book = bookDoc.data() as Omit<LibraryBook, 'id'>;
      const cleanIsbn = clampStr(book.isbn || '', 32);
      const cleanTitle = clampStr(book.title || '', 140);
      const cleanAuthor = clampStr(book.author || '', 120);
      if (cleanIsbn.length < 3 || cleanTitle.length < 2 || cleanAuthor.length < 2) continue;

      const totalCopies = Math.min(500, Math.max(1, Math.round(Number(book.totalCopies) || 1)));
      const checkedOutRaw = activeLoanCountByTitle.get(cleanTitle.toLowerCase()) || 0;
      const checkedOutCopies = Math.min(500, Math.max(0, checkedOutRaw));
      const availableCopies = Math.min(500, Math.max(0, totalCopies - checkedOutCopies));

      const sharedFields = {
        isbn: cleanIsbn,
        title: cleanTitle,
        author: cleanAuthor,
        subject: clampStr(book.subject || 'General', 60),
        materialType: book.materialType,
        shelfCode: clampStr(book.shelfCode || '', 40).toUpperCase(),
        totalCopies,
        checkedOutCopies,
        availableCopies,
        notes: clampStr(book.notes || '', 240),
        updatedAt: serverTimestamp(),
      };

      if (existingMirrorIds.has(bookDoc.id)) {
        ops.push({ kind: 'update', id: bookDoc.id, data: sharedFields });
      } else {
        ops.push({
          kind: 'set',
          id: bookDoc.id,
          data: {
            ownerId,
            schoolId,
            ...sharedFields,
            createdAt: serverTimestamp(),
          },
        });
      }
    }

    for (const mirrorId of existingMirrorIds) {
      if (!currentBookIds.has(mirrorId)) {
        ops.push({ kind: 'delete', id: mirrorId });
      }
    }

    const CHUNK_SIZE = 400;
    for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
      const batch = writeBatch(db);
      for (const op of ops.slice(i, i + CHUNK_SIZE)) {
        const ref = doc(db, 'studentLibraries', schoolId, 'books', op.id);
        if (op.kind === 'set') batch.set(ref, op.data);
        else if (op.kind === 'update') batch.update(ref, op.data);
        else batch.delete(ref);
      }
      await batch.commit();
    }
  } catch {
    // Non-blocking mirror sync; callers already saved primary library record
  }
}

export interface LibraryReservationPayload {
  schoolId: string;
  ownerId: string;
  bookId: string;
  isbn: string;
  bookTitle: string;
  subject: string;
  materialType: LibraryMaterialCategory;
  studentId: string;
  studentName: string;
  admissionNo: string;
  formLevel: FormLevel;
  stream: string;
  registrationCode?: string;
  requestedDate?: string;
  notes?: string;
}

export async function createLibraryReservation(
  data: LibraryReservationPayload
): Promise<string> {
  const reservationId = makeId('res');
  const path = `schools/${data.schoolId}/libraryReservations/${reservationId}`;
  const todayIso = new Date().toISOString().slice(0, 10);
  const requestedDate =
    data.requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(data.requestedDate)
      ? data.requestedDate
      : todayIso;

  let cleanRegCode = normalizeRegistrationCode(data.registrationCode || '');
  if (!cleanRegCode && auth.currentUser) {
    try {
      const stuSnap = await getDoc(doc(db, 'schools', data.schoolId, 'students', data.studentId));
      if (stuSnap.exists()) {
        cleanRegCode = normalizeRegistrationCode(
          (stuSnap.data() as { registrationCode?: string }).registrationCode
        );
      }
    } catch {
      // Optional lookup for staff-initiated requests
    }
  }

  const cleanBookId =
    String(data.bookId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128) || 'catalog_book';
  const docPayload = {
    ownerId: data.ownerId,
    schoolId: data.schoolId,
    bookId: cleanBookId,
    isbn: clampStr(data.isbn || '', 32),
    bookTitle: clampStr(data.bookTitle, 140),
    subject: clampStr(data.subject || 'General', 60),
    materialType: data.materialType,
    studentId: data.studentId,
    studentName: clampStr(data.studentName, 120),
    admissionNo: clampStr(data.admissionNo || 'N/A', 40) || 'N/A',
    formLevel: Math.min(4, Math.max(1, Math.round(Number(data.formLevel) || 1))),
    stream: clampStr(data.stream || 'A', 20) || 'A',
    registrationCode: cleanRegCode,
    status: 'Pending' as LibraryReservationStatus,
    requestedDate,
    notes: clampStr(data.notes || '', 240),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'schools', data.schoolId, 'libraryReservations', reservationId), docPayload);

    if (cleanRegCode.length >= 6) {
      let writePortalMirror = !auth.currentUser;
      if (auth.currentUser) {
        const portalSnap = await getDoc(doc(db, 'studentPortals', cleanRegCode));
        if (portalSnap.exists()) {
          const p = portalSnap.data() as { schoolId?: string; studentId?: string };
          writePortalMirror = p.schoolId === data.schoolId && p.studentId === data.studentId;
        }
      }
      if (writePortalMirror) {
        batch.set(
          doc(db, 'studentPortals', cleanRegCode, 'reservations', reservationId),
          docPayload
        );
      }
    }

    await batch.commit();
    return reservationId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateLibraryReservationStatus(
  schoolId: string,
  reservationId: string,
  status: LibraryReservationStatus,
  registrationCode?: string,
  notes?: string
): Promise<void> {
  const path = `schools/${schoolId}/libraryReservations/${reservationId}`;
  const cleanRegCode = normalizeRegistrationCode(registrationCode || '');
  try {
    const batch = writeBatch(db);
    const schoolResRef = doc(db, 'schools', schoolId, 'libraryReservations', reservationId);
    const updateFields: Record<string, unknown> = {
      status,
      updatedAt: serverTimestamp(),
    };
    if (notes !== undefined) {
      updateFields.notes = clampStr(notes, 240);
    }
    batch.update(schoolResRef, updateFields);

    if (cleanRegCode.length >= 6) {
      const portalResRef = doc(db, 'studentPortals', cleanRegCode, 'reservations', reservationId);
      const portalResSnap = await getDoc(portalResRef);
      if (portalResSnap.exists()) {
        batch.update(portalResRef, updateFields);
      }
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function removeLibraryReservation(
  schoolId: string,
  reservationId: string,
  registrationCode?: string
): Promise<void> {
  const path = `schools/${schoolId}/libraryReservations/${reservationId}`;
  const cleanRegCode = normalizeRegistrationCode(registrationCode || '');
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'schools', schoolId, 'libraryReservations', reservationId));
    if (cleanRegCode.length >= 6) {
      const portalResRef = doc(db, 'studentPortals', cleanRegCode, 'reservations', reservationId);
      const portalResSnap = await getDoc(portalResRef);
      if (portalResSnap.exists()) {
        batch.delete(portalResRef);
      }
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

const DIGITAL_CHUNK_RAW_BYTES = 450000;
const CHUNK_BATCH_SIZE = 8;

export interface DigitalLibraryResourcePayload {
  title: string;
  author: string;
  subject: string;
  formLevel: DigitalResourceFormLevel;
  category: DigitalResourceCategory;
  examYear?: string;
  summary?: string;
  content: string;
  storageFormat?: DigitalStorageFormat;
  fileName?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  chunkCount?: number;
  allowOffline: boolean;
}

async function deleteDigitalResourceChunks(schoolId: string, resourceId: string): Promise<void> {
  const chunksSnap = await getDocs(
    query(
      collection(db, 'studentLibraries', schoolId, 'digitalResources', resourceId, 'chunks'),
      where('schoolId', '==', schoolId),
      where('resourceId', '==', resourceId)
    )
  );
  if (chunksSnap.docs.length === 0) return;

  for (let i = 0; i < chunksSnap.docs.length; i += 20) {
    const batch = writeBatch(db);
    for (const chunkDoc of chunksSnap.docs.slice(i, i + 20)) {
      batch.delete(chunkDoc.ref);
    }
    await batch.commit();
  }
}

export async function fetchDigitalResourceBytes(
  schoolId: string,
  resourceId: string
): Promise<Uint8Array | null> {
  const path = `studentLibraries/${schoolId}/digitalResources/${resourceId}/chunks`;
  try {
    const chunksSnap = await getDocs(
      query(
        collection(db, 'studentLibraries', schoolId, 'digitalResources', resourceId, 'chunks'),
        where('schoolId', '==', schoolId),
        where('resourceId', '==', resourceId)
      )
    );
    if (chunksSnap.docs.length === 0) return null;

    const sorted = chunksSnap.docs
      .map((d) => d.data() as { chunkIndex?: number; dataBase64?: string })
      .sort((a, b) => Number(a.chunkIndex || 0) - Number(b.chunkIndex || 0));

    const parts = sorted.map((c) => base64ToUint8Array(String(c.dataBase64 || '')));
    const totalLength = parts.reduce((sum, arr) => sum + arr.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      merged.set(part, offset);
      offset += part.length;
    }
    return merged;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveDigitalResource(
  schoolId: string,
  ownerId: string,
  data: DigitalLibraryResourcePayload,
  existingId?: string,
  fileBytes?: Uint8Array | null,
  onUploadProgress?: (completedChunks: number, totalChunks: number) => void
): Promise<string> {
  const resourceId = existingId || makeId('dig');
  const path = `schools/${schoolId}/digitalLibrary/${resourceId}`;
  const cleanTitle = clampStr(data.title, 140);
  const cleanAuthor = clampStr(data.author, 120);
  const cleanSubject = clampStr(data.subject || 'General', 60) || 'General';
  const cleanExamYear = clampStr(data.examYear || '', 16);
  const cleanSummary = clampStr(data.summary || '', 280);
  const cleanContent = String(data.content ?? '').trim().slice(0, 30000);
  const allowOffline = Boolean(data.allowOffline);

  try {
    let resolvedChunkCount = Number(data.chunkCount || 0);
    const hasNewFilePayload = fileBytes !== undefined;

    if (hasNewFilePayload) {
      if (existingId) {
        await deleteDigitalResourceChunks(schoolId, resourceId);
      }
      if (fileBytes && fileBytes.length > 0) {
        const totalChunks = Math.ceil(fileBytes.length / DIGITAL_CHUNK_RAW_BYTES);
        resolvedChunkCount = totalChunks;
        let uploaded = 0;
        for (let startChunk = 0; startChunk < totalChunks; startChunk += CHUNK_BATCH_SIZE) {
          const batch = writeBatch(db);
          const endChunk = Math.min(totalChunks, startChunk + CHUNK_BATCH_SIZE);
          for (let idx = startChunk; idx < endChunk; idx += 1) {
            const sliceStart = idx * DIGITAL_CHUNK_RAW_BYTES;
            const sliceEnd = Math.min(fileBytes.length, sliceStart + DIGITAL_CHUNK_RAW_BYTES);
            const sliceBytes = fileBytes.subarray(sliceStart, sliceEnd);
            const chunkRef = doc(
              db,
              'studentLibraries',
              schoolId,
              'digitalResources',
              resourceId,
              'chunks',
              `chunk_${idx}`
            );
            batch.set(chunkRef, {
              ownerId,
              schoolId,
              resourceId,
              chunkIndex: idx,
              dataBase64: uint8ArrayToBase64(sliceBytes),
              createdAt: serverTimestamp(),
            });
          }
          await batch.commit();
          uploaded = endChunk;
          onUploadProgress?.(uploaded, totalChunks);
        }
      } else {
        resolvedChunkCount = 0;
      }
    }

    const schoolRef = doc(db, 'schools', schoolId, 'digitalLibrary', resourceId);
    const mirrorRef = doc(db, 'studentLibraries', schoolId, 'digitalResources', resourceId);
    const sharedUpdate: Record<string, unknown> = {
      title: cleanTitle,
      author: cleanAuthor,
      subject: cleanSubject,
      formLevel: data.formLevel,
      category: data.category,
      examYear: cleanExamYear,
      summary: cleanSummary,
      content: cleanContent,
      storageFormat: data.storageFormat || 'text',
      fileName: clampStr(data.fileName || '', 160),
      mimeType: clampStr(data.mimeType || '', 100),
      fileSizeBytes: Math.max(0, Math.round(Number(data.fileSizeBytes || 0))),
      chunkCount: Math.max(0, Math.round(resolvedChunkCount)),
      allowOffline,
      updatedAt: serverTimestamp(),
    };

    const teacherOnly = isTeacherOnlyDigitalCategory(data.category);
    const batch = writeBatch(db);
    if (existingId) {
      const mirrorSnap = await getDoc(mirrorRef);
      batch.update(schoolRef, sharedUpdate);
      if (teacherOnly) {
        if (mirrorSnap.exists()) {
          batch.delete(mirrorRef);
        }
      } else if (mirrorSnap.exists()) {
        batch.update(mirrorRef, sharedUpdate);
      } else {
        batch.set(mirrorRef, {
          ownerId,
          schoolId,
          ...sharedUpdate,
          createdAt: serverTimestamp(),
        });
      }
    } else {
      const fullCreate = {
        ownerId,
        schoolId,
        ...sharedUpdate,
        createdAt: serverTimestamp(),
      };
      batch.set(schoolRef, fullCreate);
      if (!teacherOnly) {
        batch.set(mirrorRef, fullCreate);
      }
    }

    await batch.commit();
    return resourceId;
  } catch (error) {
    handleFirestoreError(error, existingId ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function removeDigitalResource(schoolId: string, resourceId: string): Promise<void> {
  const path = `schools/${schoolId}/digitalLibrary/${resourceId}`;
  try {
    await deleteDigitalResourceChunks(schoolId, resourceId);
    const batch = writeBatch(db);
    batch.delete(doc(db, 'schools', schoolId, 'digitalLibrary', resourceId));
    const mirrorRef = doc(db, 'studentLibraries', schoolId, 'digitalResources', resourceId);
    const mirrorSnap = await getDoc(mirrorRef);
    if (mirrorSnap.exists()) {
      batch.delete(mirrorRef);
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function purgeLegacyRawTextDigitalResources(schoolId: string): Promise<number> {
  if (!schoolId) return 0;
  try {
    const [staffSnap, studentSnap] = await Promise.all([
      getDocs(collection(db, 'schools', schoolId, 'digitalLibrary')),
      getDocs(
        query(
          collection(db, 'studentLibraries', schoolId, 'digitalResources'),
          where('schoolId', '==', schoolId)
        )
      ),
    ]);

    const legacyIds = new Set<string>();
    const isLegacyRawText = (data: Record<string, unknown>) => {
      const hasFileName = typeof data.fileName === 'string' && data.fileName.trim().length > 0;
      const chunkCount = typeof data.chunkCount === 'number' ? data.chunkCount : 0;
      return !hasFileName && chunkCount === 0;
    };

    staffSnap.docs.forEach((d) => {
      if (isLegacyRawText(d.data())) legacyIds.add(d.id);
    });
    studentSnap.docs.forEach((d) => {
      if (isLegacyRawText(d.data())) legacyIds.add(d.id);
    });

    if (legacyIds.size === 0) return 0;

    const batch = writeBatch(db);
    const staffIdSet = new Set(staffSnap.docs.map((d) => d.id));
    const studentIdSet = new Set(studentSnap.docs.map((d) => d.id));

    legacyIds.forEach((resourceId) => {
      if (staffIdSet.has(resourceId)) {
        batch.delete(doc(db, 'schools', schoolId, 'digitalLibrary', resourceId));
      }
      if (studentIdSet.has(resourceId)) {
        batch.delete(doc(db, 'studentLibraries', schoolId, 'digitalResources', resourceId));
      }
    });

    await batch.commit();
    return legacyIds.size;
  } catch {
    return 0;
  }
}

export type LibraryBookImportStrategy = 'skip' | 'update' | 'add_copies';

export interface LibraryBookImportResult {
  created: number;
  updated: number;
  skipped: number;
}

function normalizeBookIsbnKey(isbn?: string): string {
  return String(isbn ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '');
}

export async function bulkImportLibraryBooks(
  schoolId: string,
  ownerId: string,
  rows: LibraryBookPayload[],
  existingBooks: LibraryBook[],
  duplicateStrategy: LibraryBookImportStrategy = 'skip'
): Promise<LibraryBookImportResult> {
  if (rows.length === 0) {
    return { created: 0, updated: 0, skipped: 0 };
  }

  const path = `schools/${schoolId}/libraryBooks`;
  const byIsbn = new Map<string, LibraryBook>();
  const byTitle = new Map<string, LibraryBook>();

  for (const book of existingBooks) {
    const isbnKey = normalizeBookIsbnKey(book.isbn);
    if (isbnKey.length >= 3) byIsbn.set(isbnKey, book);
    const titleKey = book.title.trim().toLowerCase();
    if (titleKey) byTitle.set(titleKey, book);
  }

  type BatchOp =
    | { kind: 'create'; id: string; data: Record<string, unknown> }
    | { kind: 'update'; id: string; data: Record<string, unknown> };

  const ops: BatchOp[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const cleanIsbn = clampStr(row.isbn, 32);
    const cleanTitle = clampStr(row.title, 140);
    const cleanAuthor = clampStr(row.author, 120);
    const cleanSubject = clampStr(row.subject || 'General', 60) || 'General';
    const cleanShelfCode = clampStr(row.shelfCode || '', 40).toUpperCase();
    const cleanTotalCopies = Math.min(500, Math.max(1, Math.round(Number(row.totalCopies) || 1)));
    const cleanNotes = clampStr(row.notes || '', 240);

    if (cleanIsbn.length < 3 || cleanTitle.length < 2 || cleanAuthor.length < 2) {
      skipped += 1;
      continue;
    }

    const isbnKey = normalizeBookIsbnKey(cleanIsbn);
    const titleKey = cleanTitle.toLowerCase();
    const matched = byIsbn.get(isbnKey) || byTitle.get(titleKey);

    if (matched) {
      if (duplicateStrategy === 'skip') {
        skipped += 1;
        continue;
      }

      const nextCopies =
        duplicateStrategy === 'add_copies'
          ? Math.min(500, Math.max(1, (matched.totalCopies || 0) + cleanTotalCopies))
          : cleanTotalCopies;

      const updateFields: Record<string, unknown> =
        duplicateStrategy === 'add_copies'
          ? {
              isbn: matched.isbn,
              title: matched.title,
              author: matched.author,
              subject: matched.subject || cleanSubject,
              materialType: matched.materialType,
              shelfCode: matched.shelfCode || cleanShelfCode,
              totalCopies: nextCopies,
              notes: matched.notes || cleanNotes,
              updatedAt: serverTimestamp(),
            }
          : {
              isbn: cleanIsbn,
              title: cleanTitle,
              author: cleanAuthor,
              subject: cleanSubject,
              materialType: row.materialType,
              shelfCode: cleanShelfCode,
              totalCopies: nextCopies,
              notes: cleanNotes,
              updatedAt: serverTimestamp(),
            };

      ops.push({ kind: 'update', id: matched.id, data: updateFields });
      const updatedRecord: LibraryBook = {
        ...matched,
        ...(duplicateStrategy === 'add_copies'
          ? { totalCopies: nextCopies }
          : {
              isbn: cleanIsbn,
              title: cleanTitle,
              author: cleanAuthor,
              subject: cleanSubject,
              materialType: row.materialType,
              shelfCode: cleanShelfCode,
              totalCopies: nextCopies,
              notes: cleanNotes,
            }),
      };
      if (isbnKey.length >= 3) byIsbn.set(isbnKey, updatedRecord);
      byTitle.set(updatedRecord.title.trim().toLowerCase(), updatedRecord);
      updated += 1;
    } else {
      const bookId = makeId('bk');
      ops.push({
        kind: 'create',
        id: bookId,
        data: {
          ownerId,
          isbn: cleanIsbn,
          title: cleanTitle,
          author: cleanAuthor,
          subject: cleanSubject,
          materialType: row.materialType,
          shelfCode: cleanShelfCode,
          totalCopies: cleanTotalCopies,
          notes: cleanNotes,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
      const newRecord: LibraryBook = {
        id: bookId,
        ownerId,
        isbn: cleanIsbn,
        title: cleanTitle,
        author: cleanAuthor,
        subject: cleanSubject,
        materialType: row.materialType,
        shelfCode: cleanShelfCode,
        totalCopies: cleanTotalCopies,
        notes: cleanNotes,
      };
      if (isbnKey.length >= 3) byIsbn.set(isbnKey, newRecord);
      byTitle.set(titleKey, newRecord);
      created += 1;
    }
  }

  try {
    const CHUNK_SIZE = 400;
    for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
      const slice = ops.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const op of slice) {
        const ref = doc(db, 'schools', schoolId, 'libraryBooks', op.id);
        if (op.kind === 'create') {
          batch.set(ref, op.data);
        } else {
          batch.update(ref, op.data);
        }
      }
      await batch.commit();
    }
    await syncStudentCatalogMirror(schoolId, ownerId);
    return { created, updated, skipped };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function seedDemoMalawiSchool(ownerId: string): Promise<string> {
  const schoolId = await createSchoolWorkspace({
    ownerId,
    ownerDisplayName: 'Head Teacher',
    ownerEmail: '',
    name: 'Chilambula Secondary School',
    district: 'Lilongwe',
    schoolType: 'Grant-Aided',
    motto: 'Discipline, Knowledge, Service',
    academicYear: '2026/2027',
    currentTerm: 'Term 2',
    defaultTuitionMWK: 95000,
    defaultGpfMWK: 15000,
    defaultExamFeeMWK: 12000,
  });

  const demoStudents: { id: string; data: StudentPayload }[] = [
    {
      id: 'stu_01',
      data: {
        admissionNo: 'CSS/2026/001',
        fullName: 'Chikondi Banda',
        gender: 'Female',
        formLevel: 4,
        stream: 'A',
        boardingStatus: 'Boarder',
        guardianName: 'Grace Banda',
        guardianPhone: '+265 999 412 108',
        guardianSecondaryPhone: '+265 888 412 109',
        guardianRelationship: 'Mother',
        emergencyContactName: 'Dr. Kelvin Banda (Uncle)',
        emergencyContactPhone: '+265 995 110 224',
        emergencyNotes: 'Mild penicillin allergy; prefers Kamuzu Central Clinic.',
        status: 'Active',
      },
    },
    {
      id: 'stu_02',
      data: {
        admissionNo: 'CSS/2026/002',
        fullName: 'Kondwani Mwale',
        gender: 'Male',
        formLevel: 4,
        stream: 'A',
        boardingStatus: 'Boarder',
        guardianName: 'Joseph Mwale',
        guardianPhone: '+265 888 231 540',
        guardianSecondaryPhone: '+265 999 231 541',
        guardianRelationship: 'Father',
        emergencyContactName: 'Evelyn Mwale',
        emergencyContactPhone: '+265 881 774 302',
        emergencyNotes: 'No known allergies.',
        status: 'Active',
      },
    },
    {
      id: 'stu_03',
      data: {
        admissionNo: 'CSS/2026/003',
        fullName: 'Thandiwe Phiri',
        gender: 'Female',
        formLevel: 4,
        stream: 'B',
        boardingStatus: 'Day Scholar',
        guardianName: 'Martha Phiri',
        guardianPhone: '+265 995 702 319',
        guardianSecondaryPhone: '',
        guardianRelationship: 'Mother',
        emergencyContactName: 'Martha Phiri',
        emergencyContactPhone: '+265 995 702 319',
        emergencyNotes: 'Carries asthma inhaler in school bag.',
        status: 'Active',
      },
    },
    {
      id: 'stu_04',
      data: {
        admissionNo: 'CSS/2026/004',
        fullName: 'Dalitso Chirwa',
        gender: 'Male',
        formLevel: 3,
        stream: 'A',
        boardingStatus: 'Boarder',
        guardianName: 'Patrick Chirwa',
        guardianPhone: '+265 884 119 882',
        guardianSecondaryPhone: '',
        guardianRelationship: 'Father',
        emergencyContactName: 'Agnes Chirwa',
        emergencyContactPhone: '+265 999 618 400',
        emergencyNotes: '',
        status: 'Active',
      },
    },
    {
      id: 'stu_05',
      data: {
        admissionNo: 'CSS/2026/005',
        fullName: 'Chisomo Gondwe',
        gender: 'Female',
        formLevel: 3,
        stream: 'A',
        boardingStatus: 'Day Scholar',
        guardianName: 'Lydia Gondwe',
        guardianPhone: '+265 991 345 612',
        guardianSecondaryPhone: '',
        guardianRelationship: 'Aunt',
        emergencyContactName: 'Lydia Gondwe',
        emergencyContactPhone: '+265 991 345 612',
        emergencyNotes: '',
        status: 'Active',
      },
    },
    {
      id: 'stu_06',
      data: {
        admissionNo: 'CSS/2026/006',
        fullName: 'Yamikani Kumwenda',
        gender: 'Male',
        formLevel: 2,
        stream: 'A',
        boardingStatus: 'Day Scholar',
        guardianName: 'Samuel Kumwenda',
        guardianPhone: '+265 881 904 221',
        guardianSecondaryPhone: '',
        guardianRelationship: 'Father',
        emergencyContactName: 'Ruth Kumwenda',
        emergencyContactPhone: '+265 993 520 118',
        emergencyNotes: '',
        status: 'Active',
      },
    },
    {
      id: 'stu_07',
      data: {
        admissionNo: 'CSS/2026/007',
        fullName: 'Mphatso Kamanga',
        gender: 'Female',
        formLevel: 2,
        stream: 'B',
        boardingStatus: 'Boarder',
        guardianName: 'Beatrice Kamanga',
        guardianPhone: '+265 999 815 004',
        guardianSecondaryPhone: '',
        guardianRelationship: 'Mother',
        emergencyContactName: 'Beatrice Kamanga',
        emergencyContactPhone: '+265 999 815 004',
        emergencyNotes: '',
        status: 'Active',
      },
    },
    {
      id: 'stu_08',
      data: {
        admissionNo: 'CSS/2026/008',
        fullName: 'Takondwa Nyirenda',
        gender: 'Male',
        formLevel: 1,
        stream: 'A',
        boardingStatus: 'Day Scholar',
        guardianName: 'Francis Nyirenda',
        guardianPhone: '+265 888 640 773',
        guardianSecondaryPhone: '',
        guardianRelationship: 'Father',
        emergencyContactName: 'Francis Nyirenda',
        emergencyContactPhone: '+265 888 640 773',
        emergencyNotes: '',
        status: 'Active',
      },
    },
  ];

  const demoTeachers: { id: string; data: TeacherPayload }[] = [
    {
      id: 'tch_01',
      data: {
        staffCode: 'TSC-44102',
        fullName: 'Mr. Hastings Kachale',
        roleTitle: 'Head Teacher',
        subjects: ['History', 'Social & Life Skills'],
        assignedForm: 'Administration',
        phone: '+265 999 112 200',
        status: 'Active',
      },
    },
    {
      id: 'tch_02',
      data: {
        staffCode: 'TSC-48219',
        fullName: 'Mrs. Chimwemwe Nkhoma',
        roleTitle: 'Form Teacher',
        subjects: ['English', 'Chichewa'],
        assignedForm: 'Form 4A',
        phone: '+265 888 510 394',
        status: 'Active',
      },
    },
    {
      id: 'tch_03',
      data: {
        staffCode: 'TSC-51008',
        fullName: 'Mr. Gift Mhone',
        roleTitle: 'Head of Department',
        subjects: ['Mathematics', 'Physical Science'],
        assignedForm: 'Form 3A',
        phone: '+265 995 301 870',
        status: 'Active',
      },
    },
    {
      id: 'tch_04',
      data: {
        staffCode: 'TSC-52940',
        fullName: 'Ms. Alinafe Tembo',
        roleTitle: 'Subject Teacher',
        subjects: ['Biology', 'Agriculture'],
        assignedForm: 'Form 2A',
        phone: '+265 884 772 190',
        status: 'Active',
      },
    },
    {
      id: 'tch_05',
      data: {
        staffCode: 'STF-1042',
        fullName: 'Mr. Bright Zimba',
        roleTitle: 'School Bursar',
        subjects: ['Business Studies'],
        assignedForm: 'Accounts Office',
        phone: '+265 999 450 611',
        status: 'Active',
      },
    },
    {
      id: 'tch_06',
      data: {
        staffCode: 'LIB-1009',
        fullName: 'Mr. Chisomo Kalua',
        roleTitle: 'School Librarian',
        subjects: ['General'],
        assignedForm: 'Main Library',
        phone: '+265 991 804 330',
        status: 'Active',
      },
    },
  ];

  const demoRegCodes = new Map<string, string>();
  const demoEntryYears = new Map<string, number>();
  const usedDemoCodes = new Set<string>();
  for (const s of demoStudents) {
    const entryYear = getDefaultEntryYear(s.data.formLevel, '2026/2027');
    demoEntryYears.set(s.id, entryYear);
    const code = await resolveAvailablePortalCode({
      schoolId,
      studentId: s.id,
      formLevel: s.data.formLevel,
      stream: s.data.stream,
      entryYear,
      usedCodes: usedDemoCodes,
    });
    usedDemoCodes.add(code);
    demoRegCodes.set(s.id, code);
  }

  // Batch 1: Students, Student Registration Portals, Teachers, and Subjects (school doc already exists)
  try {
    const batch1 = writeBatch(db);
    for (const s of demoStudents) {
      const regCode = demoRegCodes.get(s.id) || '';
      const entryYear = demoEntryYears.get(s.id) ?? getDefaultEntryYear(s.data.formLevel, '2026/2027');
      batch1.set(doc(db, 'schools', schoolId, 'students', s.id), {
        ownerId,
        ...s.data,
        entryYear,
        guardianSecondaryPhone: s.data.guardianSecondaryPhone || '',
        guardianRelationship: s.data.guardianRelationship || '',
        emergencyContactName: s.data.emergencyContactName || '',
        emergencyContactPhone: s.data.emergencyContactPhone || '',
        emergencyNotes: s.data.emergencyNotes || '',
        studentEmail: '',
        registrationCode: regCode,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (regCode.length >= 6) {
        batch1.set(doc(db, 'studentPortals', regCode), {
          ownerId,
          schoolId,
          schoolName: 'Chilambula Secondary School',
          schoolDistrict: 'Lilongwe',
          schoolType: 'Grant-Aided',
          motto: 'Discipline, Knowledge, Service',
          academicYear: '2026/2027',
          currentTerm: 'Term 2',
          studentId: s.id,
          studentName: s.data.fullName,
          admissionNo: s.data.admissionNo,
          formLevel: s.data.formLevel,
          stream: s.data.stream,
          boardingStatus: s.data.boardingStatus,
          registrationCode: regCode,
          status: s.data.status,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
    for (const t of demoTeachers) {
      batch1.set(doc(db, 'schools', schoolId, 'teachers', t.id), {
        ownerId,
        ...t.data,
        staffEmail: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    DEFAULT_MALAWI_SUBJECT_PRESETS.forEach((preset, idx) => {
      const subId = `sub_${String(idx + 1).padStart(2, '0')}`;
      batch1.set(doc(db, 'schools', schoolId, 'subjects', subId), {
        ownerId,
        name: preset.name,
        code: preset.code,
        formLevels: preset.formLevels,
        isCore: preset.isCore,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    DEFAULT_LIBRARY_BOOKS_PRESETS.forEach((preset, idx) => {
      const bookId = `bk_${String(idx + 1).padStart(2, '0')}`;
      const checkedOutCount =
        preset.title === 'MSCE Biology Form 4 Revision Guide' ||
        preset.title === 'The Pearl (John Steinbeck)' ||
        preset.title === 'Excel & Succeed Physical Science Form 3'
          ? 1
          : 0;
      batch1.set(doc(db, 'schools', schoolId, 'libraryBooks', bookId), {
        ownerId,
        isbn: preset.isbn,
        title: preset.title,
        author: preset.author,
        subject: preset.subject,
        materialType: preset.materialType,
        shelfCode: preset.shelfCode,
        totalCopies: preset.totalCopies,
        notes: preset.notes,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch1.set(doc(db, 'studentLibraries', schoolId, 'books', bookId), {
        ownerId,
        schoolId,
        isbn: preset.isbn,
        title: preset.title,
        author: preset.author,
        subject: preset.subject,
        materialType: preset.materialType,
        shelfCode: preset.shelfCode,
        totalCopies: preset.totalCopies,
        checkedOutCopies: checkedOutCount,
        availableCopies: Math.max(0, preset.totalCopies - checkedOutCount),
        notes: preset.notes,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    await batch1.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `schools/${schoolId}/students`);
  }

  // Batch 2: Assessments (MANEB scores + portal results), Fee Invoices, and Today's Attendance
  const todayIso = new Date().toISOString().slice(0, 10);
  const sampleMarks: {
    id: string;
    studentId: string;
    studentName: string;
    formLevel: FormLevel;
    stream: string;
    subject: string;
    ca1Raw: number;
    ca1Max: number;
    ca2Raw: number;
    ca2Max: number;
    examRaw: number;
    examMax: number;
  }[] = [
    { id: 'asm_01', studentId: 'stu_01', studentName: 'Chikondi Banda', formLevel: 4, stream: 'A', subject: 'English', ca1Raw: 24, ca1Max: 30, ca2Raw: 32, ca2Max: 40, examRaw: 80, examMax: 100 },
    { id: 'asm_02', studentId: 'stu_01', studentName: 'Chikondi Banda', formLevel: 4, stream: 'A', subject: 'Mathematics', ca1Raw: 18, ca1Max: 20, ca2Raw: 42, ca2Max: 50, examRaw: 84, examMax: 100 },
    { id: 'asm_03', studentId: 'stu_01', studentName: 'Chikondi Banda', formLevel: 4, stream: 'A', subject: 'Biology', ca1Raw: 23, ca1Max: 30, ca2Raw: 24, ca2Max: 30, examRaw: 75, examMax: 100 },
    { id: 'asm_04', studentId: 'stu_01', studentName: 'Chikondi Banda', formLevel: 4, stream: 'A', subject: 'Physical Science', ca1Raw: 21, ca1Max: 30, ca2Raw: 30, ca2Max: 40, examRaw: 73, examMax: 100 },
    { id: 'asm_05', studentId: 'stu_01', studentName: 'Chikondi Banda', formLevel: 4, stream: 'A', subject: 'Chichewa', ca1Raw: 17, ca1Max: 20, ca2Raw: 25, ca2Max: 30, examRaw: 78, examMax: 100 },
    { id: 'asm_06', studentId: 'stu_01', studentName: 'Chikondi Banda', formLevel: 4, stream: 'A', subject: 'Geography', ca1Raw: 30, ca1Max: 40, ca2Raw: 30, ca2Max: 40, examRaw: 72, examMax: 100 },
    { id: 'asm_07', studentId: 'stu_02', studentName: 'Kondwani Mwale', formLevel: 4, stream: 'A', subject: 'English', ca1Raw: 19, ca1Max: 30, ca2Raw: 27, ca2Max: 40, examRaw: 65, examMax: 100 },
    { id: 'asm_08', studentId: 'stu_02', studentName: 'Kondwani Mwale', formLevel: 4, stream: 'A', subject: 'Mathematics', ca1Raw: 15, ca1Max: 20, ca2Raw: 38, ca2Max: 50, examRaw: 70, examMax: 100 },
    { id: 'asm_09', studentId: 'stu_02', studentName: 'Kondwani Mwale', formLevel: 4, stream: 'A', subject: 'Agriculture', ca1Raw: 21, ca1Max: 30, ca2Raw: 21, ca2Max: 30, examRaw: 67, examMax: 100 },
    { id: 'asm_10', studentId: 'stu_06', studentName: 'Yamikani Kumwenda', formLevel: 2, stream: 'A', subject: 'English', ca1Raw: 22, ca1Max: 30, ca2Raw: 31, ca2Max: 40, examRaw: 73, examMax: 100 },
    { id: 'asm_11', studentId: 'stu_06', studentName: 'Yamikani Kumwenda', formLevel: 2, stream: 'A', subject: 'Mathematics', ca1Raw: 16, ca1Max: 20, ca2Raw: 43, ca2Max: 50, examRaw: 82, examMax: 100 },
    { id: 'asm_12', studentId: 'stu_06', studentName: 'Yamikani Kumwenda', formLevel: 2, stream: 'A', subject: 'Chichewa', ca1Raw: 14, ca1Max: 20, ca2Raw: 21, ca2Max: 30, examRaw: 67, examMax: 100 },
  ];

  const sampleInvoices = [
    { id: 'inv_01', studentId: 'stu_01', studentName: 'Chikondi Banda', formLevel: 4, stream: 'A', tuition: 95000, gpf: 15000, exam: 12000 },
    { id: 'inv_02', studentId: 'stu_02', studentName: 'Kondwani Mwale', formLevel: 4, stream: 'A', tuition: 95000, gpf: 15000, exam: 12000 },
    { id: 'inv_03', studentId: 'stu_03', studentName: 'Thandiwe Phiri', formLevel: 4, stream: 'B', tuition: 95000, gpf: 15000, exam: 12000 },
    { id: 'inv_04', studentId: 'stu_04', studentName: 'Dalitso Chirwa', formLevel: 3, stream: 'A', tuition: 95000, gpf: 15000, exam: 0 },
    { id: 'inv_05', studentId: 'stu_06', studentName: 'Yamikani Kumwenda', formLevel: 2, stream: 'A', tuition: 95000, gpf: 15000, exam: 8500 },
  ];

  try {
    const batch2 = writeBatch(db);
    for (const m of sampleMarks) {
      const ca1Score = calculateWeightedComponent(m.ca1Raw, m.ca1Max, 20);
      const ca2Score = calculateWeightedComponent(m.ca2Raw, m.ca2Max, 20);
      const caScore = Math.round((ca1Score + ca2Score) * 10) / 10;
      const examScore = calculateWeightedComponent(m.examRaw, m.examMax, 60);
      const graded = calculateManebGrade(m.formLevel, caScore, examScore);
      batch2.set(doc(db, 'schools', schoolId, 'assessments', m.id), {
        ownerId,
        studentId: m.studentId,
        studentName: m.studentName,
        studentEmail: '',
        formLevel: m.formLevel,
        stream: m.stream,
        term: 'Term 2',
        academicYear: '2026/2027',
        subject: m.subject,
        ca1Raw: m.ca1Raw,
        ca1Max: m.ca1Max,
        ca1Score,
        ca2Raw: m.ca2Raw,
        ca2Max: m.ca2Max,
        ca2Score,
        caScore,
        examRaw: m.examRaw,
        examMax: m.examMax,
        examScore,
        totalScore: graded.totalScore,
        grade: graded.grade,
        gradePoint: graded.gradePoint,
        remark: graded.remark,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const regCode = demoRegCodes.get(m.studentId);
      if (regCode && regCode.length >= 6) {
        batch2.set(doc(db, 'studentPortals', regCode, 'results', m.id), {
          ownerId,
          schoolId,
          registrationCode: regCode,
          studentId: m.studentId,
          studentName: m.studentName,
          formLevel: m.formLevel,
          stream: m.stream,
          term: 'Term 2',
          academicYear: '2026/2027',
          subject: m.subject,
          ca1Raw: m.ca1Raw,
          ca1Max: m.ca1Max,
          ca1Score,
          ca2Raw: m.ca2Raw,
          ca2Max: m.ca2Max,
          ca2Score,
          caScore,
          examRaw: m.examRaw,
          examMax: m.examMax,
          examScore,
          totalScore: graded.totalScore,
          grade: graded.grade,
          gradePoint: graded.gradePoint,
          remark: graded.remark,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    for (const inv of sampleInvoices) {
      const totalBilled = inv.tuition + inv.gpf + inv.exam;
      batch2.set(doc(db, 'schools', schoolId, 'feeInvoices', inv.id), {
        ownerId,
        studentId: inv.studentId,
        studentName: inv.studentName,
        formLevel: inv.formLevel,
        stream: inv.stream,
        term: 'Term 2',
        academicYear: '2026/2027',
        tuitionFee: inv.tuition,
        gpfFee: inv.gpf,
        examFee: inv.exam,
        otherFee: 0,
        totalBilled,
        totalPaid: 0,
        status: 'Unpaid',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const regCode = demoRegCodes.get(inv.studentId);
      if (regCode && regCode.length >= 6) {
        batch2.set(doc(db, 'studentPortals', regCode, 'feeInvoices', inv.id), {
          ...buildPortalFeeInvoiceFields(ownerId, schoolId, regCode, {
            studentId: inv.studentId,
            studentName: inv.studentName,
            formLevel: inv.formLevel,
            stream: inv.stream,
            term: 'Term 2',
            academicYear: '2026/2027',
            tuitionFee: inv.tuition,
            gpfFee: inv.gpf,
            examFee: inv.exam,
            otherFee: 0,
            totalBilled,
            totalPaid: 0,
            status: 'Unpaid',
          }),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    const attendanceSamples: { studentId: string; studentName: string; formLevel: FormLevel; stream: string; status: AttendanceStatus }[] = [
      { studentId: 'stu_01', studentName: 'Chikondi Banda', formLevel: 4, stream: 'A', status: 'Present' },
      { studentId: 'stu_02', studentName: 'Kondwani Mwale', formLevel: 4, stream: 'A', status: 'Present' },
      { studentId: 'stu_03', studentName: 'Thandiwe Phiri', formLevel: 4, stream: 'B', status: 'Late' },
    ];
    for (const att of attendanceSamples) {
      batch2.set(doc(db, 'schools', schoolId, 'attendance', `${todayIso}_${att.studentId}`), {
        ownerId,
        date: todayIso,
        formLevel: att.formLevel,
        stream: att.stream,
        studentId: att.studentId,
        studentName: att.studentName,
        status: att.status,
        note: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const sampleLibraryLoans: {
      id: string;
      studentId: string;
      studentName: string;
      admissionNo: string;
      formLevel: FormLevel;
      stream: string;
      bookTitle: string;
      materialType: LibraryMaterialCategory;
      subject: string;
      bookCode: string;
      quantity: number;
      checkoutDate: string;
      dueDate: string;
      returnedDate: string;
      status: LibraryLoanStatus;
      conditionOnReturn: LibraryItemCondition;
      notes: string;
    }[] = [
      {
        id: 'lib_01',
        studentId: 'stu_01',
        studentName: 'Chikondi Banda',
        admissionNo: 'CSS/2026/001',
        formLevel: 4,
        stream: 'A',
        bookTitle: 'MSCE Biology Form 4 Revision Guide',
        materialType: 'Textbook',
        subject: 'Biology',
        bookCode: 'LIB-BIO-014',
        quantity: 1,
        checkoutDate: addDaysToIsoDate(todayIso, -10),
        dueDate: addDaysToIsoDate(todayIso, 11),
        returnedDate: '',
        status: 'Checked Out',
        conditionOnReturn: 'Good',
        notes: 'Issued for MSCE mock practicals.',
      },
      {
        id: 'lib_02',
        studentId: 'stu_02',
        studentName: 'Kondwani Mwale',
        admissionNo: 'CSS/2026/002',
        formLevel: 4,
        stream: 'A',
        bookTitle: 'The Pearl (John Steinbeck)',
        materialType: 'Set Book',
        subject: 'English',
        bookCode: 'LIB-ENG-008',
        quantity: 1,
        checkoutDate: addDaysToIsoDate(todayIso, -21),
        dueDate: addDaysToIsoDate(todayIso, -4),
        returnedDate: '',
        status: 'Checked Out',
        conditionOnReturn: 'Good',
        notes: 'Literature Paper II set book.',
      },
      {
        id: 'lib_03',
        studentId: 'stu_04',
        studentName: 'Dalitso Chirwa',
        admissionNo: 'CSS/2026/004',
        formLevel: 3,
        stream: 'A',
        bookTitle: 'Excel & Succeed Physical Science Form 3',
        materialType: 'Textbook',
        subject: 'Physical Science',
        bookCode: 'LIB-PSC-022',
        quantity: 1,
        checkoutDate: addDaysToIsoDate(todayIso, -5),
        dueDate: addDaysToIsoDate(todayIso, 25),
        returnedDate: '',
        status: 'Checked Out',
        conditionOnReturn: 'Good',
        notes: '',
      },
      {
        id: 'lib_04',
        studentId: 'stu_06',
        studentName: 'Yamikani Kumwenda',
        admissionNo: 'CSS/2026/006',
        formLevel: 2,
        stream: 'A',
        bookTitle: 'JCE Mathematics Worked Past Papers',
        materialType: 'Past Papers',
        subject: 'Mathematics',
        bookCode: 'LIB-MAT-031',
        quantity: 1,
        checkoutDate: addDaysToIsoDate(todayIso, -18),
        dueDate: addDaysToIsoDate(todayIso, -3),
        returnedDate: addDaysToIsoDate(todayIso, -4),
        status: 'Returned',
        conditionOnReturn: 'Good',
        notes: 'Returned intact before due date.',
      },
    ];

    for (const loan of sampleLibraryLoans) {
      batch2.set(doc(db, 'schools', schoolId, 'libraryLoans', loan.id), {
        ownerId,
        studentId: loan.studentId,
        studentName: loan.studentName,
        admissionNo: loan.admissionNo,
        formLevel: loan.formLevel,
        stream: loan.stream,
        bookTitle: loan.bookTitle,
        materialType: loan.materialType,
        subject: loan.subject,
        bookCode: loan.bookCode,
        quantity: loan.quantity,
        checkoutDate: loan.checkoutDate,
        dueDate: loan.dueDate,
        returnedDate: loan.returnedDate,
        status: loan.status,
        conditionOnReturn: loan.conditionOnReturn,
        notes: loan.notes,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const regCode = demoRegCodes.get(loan.studentId);
      if (regCode && regCode.length >= 6) {
        batch2.set(doc(db, 'studentPortals', regCode, 'libraryLoans', loan.id), {
          ownerId,
          schoolId,
          registrationCode: regCode,
          studentId: loan.studentId,
          studentName: loan.studentName,
          formLevel: loan.formLevel,
          stream: loan.stream,
          bookTitle: loan.bookTitle,
          materialType: loan.materialType,
          subject: loan.subject,
          bookCode: loan.bookCode,
          quantity: loan.quantity,
          checkoutDate: loan.checkoutDate,
          dueDate: loan.dueDate,
          returnedDate: loan.returnedDate,
          status: loan.status,
          conditionOnReturn: loan.conditionOnReturn,
          notes: loan.notes,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      batch2.set(
        doc(db, 'schools', schoolId, 'libraryTransactions', `ltx_${loan.id}_out`),
        buildLibraryTransactionDocData({
          ownerId,
          loanId: loan.id,
          action: 'Checked Out',
          studentId: loan.studentId,
          studentName: loan.studentName,
          admissionNo: loan.admissionNo,
          formLevel: loan.formLevel,
          stream: loan.stream,
          bookTitle: loan.bookTitle,
          bookCode: loan.bookCode,
          subject: loan.subject,
          quantity: loan.quantity,
          eventDate: loan.checkoutDate,
          dueDate: loan.dueDate,
          condition: 'Good',
          notes: loan.notes,
          actorUidOverride: ownerId,
          actorNameOverride:
            auth.currentUser?.displayName || auth.currentUser?.email || 'School Librarian',
        })
      );

      if (loan.status === 'Returned') {
        batch2.set(
          doc(db, 'schools', schoolId, 'libraryTransactions', `ltx_${loan.id}_ret`),
          buildLibraryTransactionDocData({
            ownerId,
            loanId: loan.id,
            action: 'Returned',
            studentId: loan.studentId,
            studentName: loan.studentName,
            admissionNo: loan.admissionNo,
            formLevel: loan.formLevel,
            stream: loan.stream,
            bookTitle: loan.bookTitle,
            bookCode: loan.bookCode,
            subject: loan.subject,
            quantity: loan.quantity,
            eventDate: loan.returnedDate || todayIso,
            dueDate: loan.dueDate,
            condition: loan.conditionOnReturn,
            notes: loan.notes,
            actorUidOverride: ownerId,
            actorNameOverride:
              auth.currentUser?.displayName || auth.currentUser?.email || 'School Librarian',
          })
        );
      }
    }

    await batch2.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `schools/${schoolId}/assessments`);
  }

  // Batch 3: Atomic Fee Payments synced with invoices
  try {
    const batch3 = writeBatch(db);
    // Payment 1: Full payment via Bank Deposit for stu_01 (122,000)
    batch3.set(doc(db, 'schools', schoolId, 'feePayments', 'pay_01'), {
      ownerId,
      invoiceId: 'inv_01',
      studentId: 'stu_01',
      studentName: 'Chikondi Banda',
      receiptNo: 'RCT-2026-0101',
      amount: 122000,
      method: 'Bank Deposit',
      reference: 'NBM-LLW-88412',
      term: 'Term 2',
      createdAt: serverTimestamp(),
    });
    batch3.update(doc(db, 'schools', schoolId, 'feeInvoices', 'inv_01'), {
      totalPaid: 122000,
      status: 'Paid',
      updatedAt: serverTimestamp(),
    });
    const rc1 = demoRegCodes.get('stu_01');
    if (rc1 && rc1.length >= 6) {
      batch3.update(doc(db, 'studentPortals', rc1, 'feeInvoices', 'inv_01'), {
        totalPaid: 122000,
        status: 'Paid',
        updatedAt: serverTimestamp(),
      });
    }

    // Payment 2: Partial payment via Airtel Money for stu_02 (75,000 of 122,000)
    batch3.set(doc(db, 'schools', schoolId, 'feePayments', 'pay_02'), {
      ownerId,
      invoiceId: 'inv_02',
      studentId: 'stu_02',
      studentName: 'Kondwani Mwale',
      receiptNo: 'RCT-2026-0102',
      amount: 75000,
      method: 'Airtel Money',
      reference: 'AM-2611-94021',
      term: 'Term 2',
      createdAt: serverTimestamp(),
    });
    batch3.update(doc(db, 'schools', schoolId, 'feeInvoices', 'inv_02'), {
      totalPaid: 75000,
      status: 'Partial',
      updatedAt: serverTimestamp(),
    });
    const rc2 = demoRegCodes.get('stu_02');
    if (rc2 && rc2.length >= 6) {
      batch3.update(doc(db, 'studentPortals', rc2, 'feeInvoices', 'inv_02'), {
        totalPaid: 75000,
        status: 'Partial',
        updatedAt: serverTimestamp(),
      });
    }

    // Payment 3: Partial payment via TNM Mpamba for stu_04 (60,000 of 110,000)
    batch3.set(doc(db, 'schools', schoolId, 'feePayments', 'pay_03'), {
      ownerId,
      invoiceId: 'inv_04',
      studentId: 'stu_04',
      studentName: 'Dalitso Chirwa',
      receiptNo: 'RCT-2026-0103',
      amount: 60000,
      method: 'TNM Mpamba',
      reference: 'MP-7710-3328',
      term: 'Term 2',
      createdAt: serverTimestamp(),
    });
    batch3.update(doc(db, 'schools', schoolId, 'feeInvoices', 'inv_04'), {
      totalPaid: 60000,
      status: 'Partial',
      updatedAt: serverTimestamp(),
    });
    const rc4 = demoRegCodes.get('stu_04');
    if (rc4 && rc4.length >= 6) {
      batch3.update(doc(db, 'studentPortals', rc4, 'feeInvoices', 'inv_04'), {
        totalPaid: 60000,
        status: 'Partial',
        updatedAt: serverTimestamp(),
      });
    }

    await batch3.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `schools/${schoolId}/feePayments`);
  }

  return schoolId;
}

export async function billEntireFormBatch(
  schoolId: string,
  ownerId: string,
  params: {
    students: {
      id: string;
      fullName: string;
      formLevel: FormLevel;
      stream: string;
      registrationCode?: string;
    }[];
    term: TermName;
    academicYear: string;
    tuitionFee: number;
    gpfFee: number;
    examFee: number;
    schoolType?: SchoolType;
  }
) {
  if (params.students.length === 0) return 0;
  const govTuitionOnly = params.schoolType ? isGovernmentSchool(params.schoolType) : false;
  const tuition = Math.max(0, Number(params.tuitionFee) || 0);
  const gpf = govTuitionOnly ? 0 : Math.max(0, Number(params.gpfFee) || 0);
  const exam = govTuitionOnly ? 0 : Math.max(0, Number(params.examFee) || 0);
  const totalBilled = tuition + gpf + exam;
  const status: InvoiceStatus = totalBilled === 0 ? 'Paid' : 'Unpaid';
  try {
    for (let i = 0; i < params.students.length; i += 150) {
      const batch = writeBatch(db);
      for (const s of params.students.slice(i, i + 150)) {
        const invoiceId = makeId('inv');
        batch.set(doc(db, 'schools', schoolId, 'feeInvoices', invoiceId), {
          ownerId,
          studentId: s.id,
          studentName: clampStr(s.fullName, 120),
          formLevel: Math.round(s.formLevel),
          stream: clampStr(s.stream, 20),
          term: params.term,
          academicYear: clampStr(params.academicYear, 20),
          tuitionFee: tuition,
          gpfFee: gpf,
          examFee: exam,
          otherFee: 0,
          totalBilled,
          totalPaid: 0,
          status,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        const cleanRegCode = normalizeRegistrationCode(s.registrationCode || '');
        if (cleanRegCode.length >= 6) {
          batch.set(doc(db, 'studentPortals', cleanRegCode, 'feeInvoices', invoiceId), {
            ...buildPortalFeeInvoiceFields(ownerId, schoolId, cleanRegCode, {
              studentId: s.id,
              studentName: s.fullName,
              formLevel: s.formLevel,
              stream: s.stream,
              term: params.term,
              academicYear: params.academicYear,
              tuitionFee: tuition,
              gpfFee: gpf,
              examFee: exam,
              otherFee: 0,
              totalBilled,
              totalPaid: 0,
              status,
            }),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
      await batch.commit();
    }
    return params.students.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `schools/${schoolId}/feeInvoices`);
  }
}

export function getFeeInvoiceCollectionRef(schoolId: string) {
  return collection(db, 'schools', schoolId, 'feeInvoices');
}

export interface SchoolAnnouncementPayload {
  title: string;
  message: string;
  targetAudiences: AnnouncementAudience[];
  publishedDate: string;
  authorName: string;
}

const VALID_AUDIENCES: AnnouncementAudience[] = ['Teachers', 'Librarian', 'Bursar', 'Students'];

export async function saveSchoolAnnouncement(
  schoolId: string,
  ownerId: string,
  data: SchoolAnnouncementPayload,
  existingId?: string
): Promise<string> {
  const announcementId = existingId || makeId('ann');
  const path = `schools/${schoolId}/announcements/${announcementId}`;
  const cleanAudiences = Array.from(
    new Set(data.targetAudiences.filter((a) => VALID_AUDIENCES.includes(a)))
  ).slice(0, 4);
  if (cleanAudiences.length === 0) {
    throw new Error('Select at least one audience group for this announcement.');
  }

  const cleanDate = /^\d{4}-\d{2}-\d{2}$/.test(data.publishedDate)
    ? data.publishedDate
    : new Date().toISOString().slice(0, 10);
  const cleanTitle = clampStr(data.title, 120);
  const cleanMessage = clampStr(data.message, 1000);
  const cleanAuthor = clampStr(data.authorName || 'School Admin', 120) || 'School Admin';

  try {
    const batch = writeBatch(db);
    const schoolAnnRef = doc(db, 'schools', schoolId, 'announcements', announcementId);
    const studentMirrorRef = doc(db, 'studentLibraries', schoolId, 'announcements', announcementId);
    const includesStudents = cleanAudiences.includes('Students');

    if (existingId) {
      const updateFields = {
        title: cleanTitle,
        message: cleanMessage,
        targetAudiences: cleanAudiences,
        publishedDate: cleanDate,
        authorName: cleanAuthor,
        updatedAt: serverTimestamp(),
      };
      batch.update(schoolAnnRef, updateFields);

      if (includesStudents) {
        const mirrorSnap = await getDoc(studentMirrorRef);
        if (mirrorSnap.exists()) {
          batch.update(studentMirrorRef, updateFields);
        } else {
          batch.set(studentMirrorRef, {
            ownerId,
            schoolId,
            ...updateFields,
            createdAt: serverTimestamp(),
          });
        }
      } else {
        const mirrorSnap = await getDoc(studentMirrorRef);
        if (mirrorSnap.exists()) {
          batch.delete(studentMirrorRef);
        }
      }
    } else {
      const createFields = {
        ownerId,
        schoolId,
        title: cleanTitle,
        message: cleanMessage,
        targetAudiences: cleanAudiences,
        publishedDate: cleanDate,
        authorName: cleanAuthor,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      batch.set(schoolAnnRef, createFields);
      if (includesStudents) {
        batch.set(studentMirrorRef, createFields);
      }
    }

    await batch.commit();
    return announcementId;
  } catch (error) {
    handleFirestoreError(error, existingId ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function removeSchoolAnnouncement(
  schoolId: string,
  announcementId: string
): Promise<void> {
  const path = `schools/${schoolId}/announcements/${announcementId}`;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'schools', schoolId, 'announcements', announcementId));
    const mirrorRef = doc(db, 'studentLibraries', schoolId, 'announcements', announcementId);
    const mirrorSnap = await getDoc(mirrorRef);
    if (mirrorSnap.exists()) {
      batch.delete(mirrorRef);
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export interface UpsertLibraryReadingSessionParams {
  schoolId: string;
  ownerId: string;
  resourceId: string;
  readerKey: string;
  registrationCode?: string;
  mode: LibraryReadingMode;
  isReading: boolean;
  isRead: boolean;
  lastReadPage: number;
  lastReadAtMs: number;
  ttlMs?: number;
}

export async function upsertLibraryReadingSession(
  params: UpsertLibraryReadingSessionParams
): Promise<void> {
  if (!params.schoolId || !params.ownerId || !params.resourceId || !params.readerKey) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  const sessionId = buildReadingSessionId(params.resourceId, params.readerKey);
  const ref = doc(db, 'studentLibraries', params.schoolId, 'readingSessions', sessionId);
  const nowMs = Date.now();
  const cleanPage = Math.max(0, Math.min(5000, Math.round(params.lastReadPage || 0)));
  const cleanLastReadMs = Math.max(0, Math.round(params.lastReadAtMs || nowMs));
  const ttl = params.ttlMs ?? READING_SESSION_TTL_MS;
  const expiresAtMs = params.isReading ? nowMs + ttl : nowMs;
  const regCode = params.registrationCode ? normalizeRegistrationCode(params.registrationCode) : '';

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, {
        mode: params.mode,
        isReading: params.isReading,
        isRead: params.isRead,
        lastReadPage: cleanPage,
        lastReadAtMs: cleanLastReadMs,
        expiresAtMs,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ownerId: params.ownerId,
        schoolId: params.schoolId,
        resourceId: params.resourceId,
        readerKey: params.readerKey,
        registrationCode: regCode,
        mode: params.mode,
        isReading: params.isReading,
        isRead: params.isRead,
        lastReadPage: cleanPage,
        lastReadAtMs: cleanLastReadMs,
        expiresAtMs,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // Reading session telemetry fails silently so reading never breaks if offline/restricted
  }
}

export async function closeLibraryReadingSession(params: {
  schoolId: string;
  ownerId: string;
  resourceId: string;
  readerKey: string;
  registrationCode?: string;
  mode: LibraryReadingMode;
  isRead: boolean;
  lastReadPage: number;
  lastReadAtMs: number;
}): Promise<void> {
  if (!params.schoolId || !params.resourceId || !params.readerKey) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  const sessionId = buildReadingSessionId(params.resourceId, params.readerKey);
  const ref = doc(db, 'studentLibraries', params.schoolId, 'readingSessions', sessionId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const nowMs = Date.now();
    await updateDoc(ref, {
      mode: params.mode,
      isReading: false,
      isRead: params.isRead,
      lastReadPage: Math.max(0, Math.min(5000, Math.round(params.lastReadPage || 0))),
      lastReadAtMs: Math.max(0, Math.round(params.lastReadAtMs || nowMs)),
      expiresAtMs: nowMs,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Ignore close errors
  }
}

export async function flushPendingOfflineReadingSyncs(schoolId?: string): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const pending = getPendingOfflineReadingSyncs(schoolId);
  if (pending.length === 0) return;

  for (const item of pending) {
    try {
      await upsertLibraryReadingSession({
        schoolId: item.schoolId,
        ownerId: item.ownerId,
        resourceId: item.resourceId,
        readerKey: item.readerKey,
        registrationCode: item.registrationCode,
        mode: 'offline',
        isReading: false,
        isRead: item.isRead,
        lastReadPage: item.lastReadPage,
        lastReadAtMs: item.lastReadAtMs,
        ttlMs: 0,
      });
      removeQueuedOfflineReadingSync(item.sessionId);
    } catch {
      // Leave queued until next reconnect
    }
  }
}

export function subscribeLibraryReadingSessions(
  schoolId: string,
  onData: (sessions: LibraryReadingSession[]) => void,
  onError?: (err: unknown) => void
): () => void {
  if (!schoolId) {
    onData([]);
    return () => {};
  }
  const q = query(
    collection(db, 'studentLibraries', schoolId, 'readingSessions'),
    where('schoolId', '==', schoolId)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: LibraryReadingSession[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<LibraryReadingSession, 'id'>),
      }));
      onData(items);
    },
    (error) => {
      onError?.(error);
    }
  );
}

// ============================================================================
// SMART GPS-BASED STAFF TIMEBOOK & ATTENDANCE MODULE
// ============================================================================

export async function saveTimebookSettings(params: {
  schoolId: string;
  ownerId: string;
  settings: Omit<TimebookSettings, 'id' | 'ownerId' | 'schoolId' | 'createdAt' | 'updatedAt'>;
}): Promise<void> {
  const ref = doc(db, 'schools', params.schoolId, 'timebookSettings', 'default');
  const path = `schools/${params.schoolId}/timebookSettings/default`;

  const safeLat = isValidLatitude(params.settings.schoolLatitude)
    ? Number(params.settings.schoolLatitude.toFixed(6))
    : -15.7861;
  const safeLng = isValidLongitude(params.settings.schoolLongitude)
    ? Number(params.settings.schoolLongitude.toFixed(6))
    : 35.0058;
  const safeRadius = Math.min(5000, Math.max(20, Math.round(params.settings.radiusMeters || DEFAULT_TIMEBOOK_RADIUS_METERS)));
  const safeAccuracy = Math.min(1000, Math.max(10, Math.round(params.settings.maxAccuracyMeters || DEFAULT_TIMEBOOK_MAX_ACCURACY_METERS)));
  const safeTz = isValidTimeZone(params.settings.timezone)
    ? params.settings.timezone
    : DEFAULT_TIMEBOOK_TIMEZONE;
  const safeWindowStart = isValidHHMM(params.settings.windowStartHHMM)
    ? params.settings.windowStartHHMM.trim()
    : DEFAULT_TIMEBOOK_WINDOW_START;
  const safeDeadline = isValidHHMM(params.settings.defaultDeadlineHHMM)
    ? params.settings.defaultDeadlineHHMM.trim()
    : DEFAULT_TIMEBOOK_DEADLINE;

  const cleanCategoryDeadlines: Record<string, string> = {};
  for (const [k, v] of Object.entries(params.settings.categoryDeadlines || {})) {
    const cleanKey = clampStr(k, 40);
    if (cleanKey && isValidHHMM(v)) {
      cleanCategoryDeadlines[cleanKey] = v.trim();
    }
  }

  const cleanWorkdays = Array.isArray(params.settings.workdays) && params.settings.workdays.length > 0
    ? Array.from(new Set(params.settings.workdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))).sort((a, b) => a - b)
    : [...DEFAULT_TIMEBOOK_WORKDAYS];

  const cleanHolidays = (Array.isArray(params.settings.holidays) ? params.settings.holidays : [])
    .filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h?.date || '') && clampStr(h?.name || '', 80))
    .slice(0, 60)
    .map((h) => ({ date: h.date.trim(), name: clampStr(h.name, 80) }));

  const cleanReminders = Array.isArray(params.settings.reminderSlots)
    ? Array.from(new Set(params.settings.reminderSlots.map((s) => s.trim()).filter((s) => isValidHHMM(s)))).sort().slice(0, 8)
    : [...DEFAULT_TIMEBOOK_REMINDER_SLOTS];

  const payload = {
    ownerId: params.ownerId,
    schoolId: params.schoolId,
    enabled: Boolean(params.settings.enabled),
    locationConfigured: Boolean(params.settings.locationConfigured),
    locationLabel: clampStr(params.settings.locationLabel || 'School Main Campus', 120) || 'School Main Campus',
    schoolLatitude: safeLat,
    schoolLongitude: safeLng,
    radiusMeters: safeRadius,
    maxAccuracyMeters: safeAccuracy,
    timezone: safeTz,
    windowStartHHMM: safeWindowStart,
    defaultDeadlineHHMM: safeDeadline,
    categoryDeadlines: cleanCategoryDeadlines,
    workdays: cleanWorkdays,
    holidays: cleanHolidays,
    reminderSlots: cleanReminders,
    remindersEnabled: Boolean(params.settings.remindersEnabled),
    updatedBy: clampStr(params.settings.updatedBy || 'School Admin', 120) || 'School Admin',
    updatedAt: serverTimestamp(),
  };

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, payload);
    } else {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveVerifiedTimebookEntry(params: {
  ownerId: string;
  verifiedEntry: VerifyCheckInResponse['entry'];
}): Promise<void> {
  const e = params.verifiedEntry;
  const entryId = `${e.date}_${e.teacherId}`;
  const ref = doc(db, 'schools', e.schoolId, 'timebookEntries', entryId);

  try {
    await setDoc(ref, {
      ownerId: params.ownerId,
      schoolId: e.schoolId,
      date: e.date,
      teacherId: e.teacherId,
      staffUid: e.staffUid,
      staffCode: clampStr(e.staffCode, 30),
      staffName: clampStr(e.staffName, 120),
      roleTitle: e.roleTitle,
      status: 'Present',
      recordingMethod: 'GPS Auto',
      timeInServer: serverTimestamp(),
      timeInDisplay: clampStr(e.timeInDisplay, 20),
      gpsVerificationStatus: 'Verified',
      latitude: Number(e.latitude),
      longitude: Number(e.longitude),
      distanceMeters: Number(e.distanceMeters),
      accuracyMeters: Number(e.accuracyMeters),
      deadlineHHMM: e.deadlineHHMM,
      isSuspicious: Boolean(e.isSuspicious),
      spoofingFlags: Array.isArray(e.spoofingFlags) ? e.spoofingFlags.slice(0, 10) : [],
      correctionStatus: 'None',
      correctionReason: '',
      authorizedByUid: '',
      authorizedByName: '',
      serverReceiptSignature: clampStr(e.serverReceiptSignature, 128),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `schools/${e.schoolId}/timebookEntries/${entryId}`);
    throw err;
  }
}

export async function logTimebookSuspiciousAttempt(params: {
  schoolId: string;
  ownerId: string;
  date: string;
  teacherId: string;
  staffUid: string;
  staffName: string;
  roleTitle: TeacherRole;
  reasonCode: string;
  detail: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  accuracyMeters: number;
  clientTimestampIso: string;
  serverTimeIso: string;
}): Promise<void> {
  if (!params.schoolId || !params.teacherId || !params.staffUid) return;
  const logId = makeId('susp');
  const ref = doc(db, 'schools', params.schoolId, 'timebookSuspiciousLogs', logId);
  try {
    await setDoc(ref, {
      ownerId: params.ownerId,
      schoolId: params.schoolId,
      date: params.date,
      teacherId: params.teacherId,
      staffUid: params.staffUid,
      staffName: clampStr(params.staffName, 120),
      roleTitle: params.roleTitle,
      reasonCode: clampStr(params.reasonCode, 80),
      detail: clampStr(params.detail, 600),
      latitude: isValidLatitude(params.latitude) ? params.latitude : 0,
      longitude: isValidLongitude(params.longitude) ? params.longitude : 0,
      distanceMeters: Math.max(0, Math.min(25_000_000, Number(params.distanceMeters) || 0)),
      accuracyMeters: Math.max(0, Math.min(100_000, Number(params.accuracyMeters) || 0)),
      clientTimestampIso: clampStr(params.clientTimestampIso, 40),
      serverTimeIso: clampStr(params.serverTimeIso, 40),
      createdAt: serverTimestamp(),
    });
  } catch {
    // Do not break user error reporting if suspicious telemetry write is rejected
  }
}

export async function submitTimebookCorrectionRequest(params: {
  schoolId: string;
  ownerId: string;
  date: string;
  teacherId: string;
  staffUid: string;
  staffCode: string;
  staffName: string;
  roleTitle: TeacherRole;
  currentStatus: string;
  requestedStatus: 'Present' | 'Late' | 'On Leave';
  explanation: string;
}): Promise<string> {
  const cleanExplanation = clampStr(params.explanation, 600);
  if (cleanExplanation.length < 5) {
    throw new Error('Please provide a clear explanation (at least 5 characters) for your administrator.');
  }

  const requestId = makeId('treq');
  const ref = doc(db, 'schools', params.schoolId, 'timebookCorrectionRequests', requestId);
  await setDoc(ref, {
    ownerId: params.ownerId,
    schoolId: params.schoolId,
    date: params.date,
    teacherId: params.teacherId,
    staffUid: params.staffUid,
    staffCode: clampStr(params.staffCode, 30),
    staffName: clampStr(params.staffName, 120),
    roleTitle: params.roleTitle,
    currentStatus: clampStr(params.currentStatus || 'Not Signed In', 40),
    requestedStatus: params.requestedStatus,
    explanation: cleanExplanation,
    status: 'Pending',
    adminNote: '',
    reviewedByUid: '',
    reviewedByName: '',
    reviewedAtIso: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return requestId;
}

export async function adminSaveTimebookCorrection(params: {
  schoolId: string;
  ownerId: string;
  teacher: Teacher;
  date: string;
  existingEntry?: StaffTimebookEntry | null;
  newStatus: TimebookEntryStatus;
  timeInDisplay: string;
  explanation: string;
  authorizedByName: string;
  deadlineHHMM: string;
  correctionRequestId?: string;
}): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Administrator authentication is required.');

  const cleanExplanation = clampStr(params.explanation, 600);
  if (cleanExplanation.length < 5) {
    throw new Error('Enter a justification (minimum 5 characters) before saving an attendance correction.');
  }

  const entryId = `${params.date}_${params.teacher.id}`;
  const entryRef = doc(db, 'schools', params.schoolId, 'timebookEntries', entryId);
  const auditId = makeId('taudit');
  const auditRef = doc(db, 'schools', params.schoolId, 'timebookAuditLogs', auditId);

  const originalStatus = params.existingEntry?.status || 'Not Signed In';
  const cleanTimeIn = clampStr(params.timeInDisplay || '', 20);
  const previousValuesSummary = params.existingEntry
    ? `Status: ${params.existingEntry.status}; Method: ${params.existingEntry.recordingMethod}; TimeIn: ${params.existingEntry.timeInDisplay || '—'}`
    : 'Status: Not Signed In; Method: None; TimeIn: —';
  const updatedValuesSummary = `Status: ${params.newStatus}; Method: Admin Recorded; TimeIn: ${cleanTimeIn || '—'}`;

  const batch = writeBatch(db);

  if (params.existingEntry) {
    batch.update(entryRef, {
      status: params.newStatus,
      recordingMethod: 'Admin Recorded',
      timeInServer: params.newStatus === 'Absent' || params.newStatus === 'On Leave' ? null : serverTimestamp(),
      timeInDisplay: cleanTimeIn,
      gpsVerificationStatus: 'Admin Override' as TimebookGpsVerificationStatus,
      correctionStatus: 'Approved',
      correctionReason: clampStr(cleanExplanation, 400),
      authorizedByUid: uid,
      authorizedByName: clampStr(params.authorizedByName, 120),
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.set(entryRef, {
      ownerId: params.ownerId,
      schoolId: params.schoolId,
      date: params.date,
      teacherId: params.teacher.id,
      staffUid: '',
      staffCode: clampStr(params.teacher.staffCode, 30),
      staffName: clampStr(params.teacher.fullName, 120),
      roleTitle: params.teacher.roleTitle,
      status: params.newStatus,
      recordingMethod: 'Admin Recorded',
      timeInServer: params.newStatus === 'Absent' || params.newStatus === 'On Leave' ? null : serverTimestamp(),
      timeInDisplay: cleanTimeIn,
      gpsVerificationStatus: 'Admin Override' as TimebookGpsVerificationStatus,
      latitude: 0,
      longitude: 0,
      distanceMeters: 0,
      accuracyMeters: 0,
      deadlineHHMM: isValidHHMM(params.deadlineHHMM) ? params.deadlineHHMM : DEFAULT_TIMEBOOK_DEADLINE,
      isSuspicious: false,
      spoofingFlags: [],
      correctionStatus: 'Approved',
      correctionReason: clampStr(cleanExplanation, 400),
      authorizedByUid: uid,
      authorizedByName: clampStr(params.authorizedByName, 120),
      serverReceiptSignature: `ADMIN_OVERRIDE_${Date.now().toString(36)}`,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  if (params.correctionRequestId) {
    const reqRef = doc(
      db,
      'schools',
      params.schoolId,
      'timebookCorrectionRequests',
      params.correctionRequestId
    );
    batch.update(reqRef, {
      status: 'Approved',
      adminNote: clampStr(cleanExplanation, 400),
      reviewedByUid: uid,
      reviewedByName: clampStr(params.authorizedByName, 120),
      reviewedAtIso: new Date().toISOString().slice(0, 40),
      updatedAt: serverTimestamp(),
    });
  }

  batch.set(auditRef, {
    ownerId: params.ownerId,
    schoolId: params.schoolId,
    entryId,
    teacherId: params.teacher.id,
    staffCode: clampStr(params.teacher.staffCode, 30),
    staffName: clampStr(params.teacher.fullName, 120),
    attendanceDate: params.date,
    originalStatus: clampStr(originalStatus, 40),
    correctedStatus: clampStr(params.newStatus, 40),
    previousValues: clampStr(previousValuesSummary, 600),
    updatedValues: clampStr(updatedValuesSummary, 600),
    explanation: cleanExplanation,
    authorizedByUid: uid,
    authorizedByName: clampStr(params.authorizedByName, 120),
    createdAt: serverTimestamp(),
  });

  await batch.commit();

  // Notify backend reminder scheduler immediately so reminders stop for this staff member today
  try {
    await syncAdminEntryToServer({
      schoolId: params.schoolId,
      date: params.date,
      teacherId: params.teacher.id,
      status: params.newStatus,
      timeInDisplay: cleanTimeIn,
    });
  } catch {
    // Non-blocking: Firestore correction & immutable audit record already committed
  }
}

export async function adminRejectTimebookCorrectionRequest(params: {
  schoolId: string;
  ownerId: string;
  requestId: string;
  teacherId: string;
  staffCode: string;
  staffName: string;
  attendanceDate: string;
  originalStatus: string;
  adminNote: string;
  authorizedByName: string;
}): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Administrator authentication is required.');
  const cleanNote = clampStr(params.adminNote, 400);
  if (cleanNote.length < 5) {
    throw new Error('Provide a clear reason (at least 5 characters) when rejecting a correction request.');
  }

  const reqRef = doc(db, 'schools', params.schoolId, 'timebookCorrectionRequests', params.requestId);
  const auditRef = doc(db, 'schools', params.schoolId, 'timebookAuditLogs', makeId('taudit'));
  const entryId = `${params.attendanceDate}_${params.teacherId}`;

  const batch = writeBatch(db);
  batch.update(reqRef, {
    status: 'Rejected',
    adminNote: cleanNote,
    reviewedByUid: uid,
    reviewedByName: clampStr(params.authorizedByName, 120),
    reviewedAtIso: new Date().toISOString().slice(0, 40),
    updatedAt: serverTimestamp(),
  });
  batch.set(auditRef, {
    ownerId: params.ownerId,
    schoolId: params.schoolId,
    entryId,
    teacherId: params.teacherId,
    staffCode: clampStr(params.staffCode, 30),
    staffName: clampStr(params.staffName, 120),
    attendanceDate: params.attendanceDate,
    originalStatus: clampStr(params.originalStatus || 'Not Signed In', 40),
    correctedStatus: 'Correction Rejected',
    previousValues: `Pending correction request for ${params.attendanceDate}`,
    updatedValues: `Rejected: ${cleanNote}`,
    explanation: cleanNote,
    authorizedByUid: uid,
    authorizedByName: clampStr(params.authorizedByName, 120),
    createdAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function adminBulkMarkUnmarkedTimebook(params: {
  schoolId: string;
  ownerId: string;
  teachers: Teacher[];
  date: string;
  explanation: string;
  authorizedByName: string;
  timeInDisplay: string;
  getDeadlineHHMM: (roleTitle: TeacherRole) => string;
}): Promise<number> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Administrator authentication is required.');
  if (params.teachers.length === 0) return 0;

  const cleanExplanation = clampStr(params.explanation, 600);
  if (cleanExplanation.length < 5) {
    throw new Error('Enter a justification (minimum 5 characters) for bulk attendance recording.');
  }

  const cleanTimeIn = clampStr(params.timeInDisplay || '07:55:00', 20) || '07:55:00';
  const path = `schools/${params.schoolId}/timebookEntries`;

  try {
    // 2 writes per teacher (timebookEntry + immutable auditLog) -> chunk by 150 teachers (300 writes < 500 limit)
    for (let i = 0; i < params.teachers.length; i += 150) {
      const chunk = params.teachers.slice(i, i + 150);
      const batch = writeBatch(db);

      for (const teacher of chunk) {
        const entryId = `${params.date}_${teacher.id}`;
        const entryRef = doc(db, 'schools', params.schoolId, 'timebookEntries', entryId);
        const auditId = makeId('taudit');
        const auditRef = doc(db, 'schools', params.schoolId, 'timebookAuditLogs', auditId);

        const nextStatus: TimebookEntryStatus =
          teacher.status === 'On Leave' ? 'On Leave' : 'Present';
        const effectiveTimeIn = nextStatus === 'On Leave' ? '' : cleanTimeIn;
        const rowReason =
          nextStatus === 'On Leave'
            ? `${cleanExplanation} (Scheduled staff leave)`
            : cleanExplanation;

        batch.set(entryRef, {
          ownerId: params.ownerId,
          schoolId: params.schoolId,
          date: params.date,
          teacherId: teacher.id,
          staffUid: '',
          staffCode: clampStr(teacher.staffCode, 30),
          staffName: clampStr(teacher.fullName, 120),
          roleTitle: teacher.roleTitle,
          status: nextStatus,
          recordingMethod: 'Admin Recorded',
          timeInServer: nextStatus === 'On Leave' ? null : serverTimestamp(),
          timeInDisplay: effectiveTimeIn,
          gpsVerificationStatus: 'Admin Override' as TimebookGpsVerificationStatus,
          latitude: 0,
          longitude: 0,
          distanceMeters: 0,
          accuracyMeters: 0,
          deadlineHHMM: isValidHHMM(params.getDeadlineHHMM(teacher.roleTitle))
            ? params.getDeadlineHHMM(teacher.roleTitle)
            : DEFAULT_TIMEBOOK_DEADLINE,
          isSuspicious: false,
          spoofingFlags: [],
          correctionStatus: 'Approved',
          correctionReason: clampStr(rowReason, 400),
          authorizedByUid: uid,
          authorizedByName: clampStr(params.authorizedByName, 120),
          serverReceiptSignature: `ADMIN_BULK_${Date.now().toString(36)}`,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        batch.set(auditRef, {
          ownerId: params.ownerId,
          schoolId: params.schoolId,
          entryId,
          teacherId: teacher.id,
          staffCode: clampStr(teacher.staffCode, 30),
          staffName: clampStr(teacher.fullName, 120),
          attendanceDate: params.date,
          originalStatus: 'Not Signed In',
          correctedStatus: nextStatus,
          previousValues: 'Status: Not Signed In; Method: None; TimeIn: —',
          updatedValues: `Status: ${nextStatus}; Method: Admin Recorded; TimeIn: ${effectiveTimeIn || '—'}`,
          explanation: clampStr(rowReason, 600),
          authorizedByUid: uid,
          authorizedByName: clampStr(params.authorizedByName, 120),
          createdAt: serverTimestamp(),
        });
      }

      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }

  for (const teacher of params.teachers) {
    const nextStatus: TimebookEntryStatus =
      teacher.status === 'On Leave' ? 'On Leave' : 'Present';
    try {
      await syncAdminEntryToServer({
        schoolId: params.schoolId,
        date: params.date,
        teacherId: teacher.id,
        status: nextStatus,
        timeInDisplay: nextStatus === 'On Leave' ? '' : cleanTimeIn,
      });
    } catch {
      // Non-blocking sync to backend reminder scheduler
    }
  }

  return params.teachers.length;
}




