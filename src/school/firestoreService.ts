import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  addDaysToIsoDate,
  calculateManebGrade,
  calculateWeightedComponent,
  DEFAULT_MALAWI_SUBJECT_PRESETS,
  generateStudentRegistrationCode,
  getDefaultEntryYear,
  inferStudentEntryYear,
  isGovernmentSchool,
  normalizeAssessmentComponents,
  normalizeRegistrationCode,
} from './malawi';
import {
  Assessment,
  AttendanceStatus,
  BoardingStatus,
  FormLevel,
  Gender,
  InvoiceStatus,
  LibraryItemCondition,
  LibraryLoanStatus,
  LibraryMaterialCategory,
  PaymentMethod,
  School,
  SchoolSubject,
  SchoolType,
  Student,
  StudentStatus,
  TeacherRole,
  TermName,
} from './types';

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

    // Sync school header metadata onto active studentLinks & staffLinks
    if (
      ownerId &&
      (updates.name !== undefined ||
        updates.district !== undefined ||
        updates.schoolType !== undefined ||
        updates.motto !== undefined ||
        updates.academicYear !== undefined ||
        updates.currentTerm !== undefined)
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
        updates.currentTerm !== undefined
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

  const resultsSnap = await getDocs(collection(db, 'studentPortals', cleanCode, 'results'));
  if (resultsSnap.docs.length > 0) {
    const batch = writeBatch(db);
    for (const d of resultsSnap.docs) {
      batch.delete(d.ref);
    }
    await batch.commit();
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

  try {
    await setDoc(doc(db, 'schools', schoolId, 'feeInvoices', invoiceId), {
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
      status: totalBilled === 0 ? 'Paid' : 'Unpaid',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
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
  }
) {
  const paymentId = makeId('pay');
  const path = `schools/${schoolId}/feePayments/${paymentId}`;
  const payAmount = Math.max(1, Number(params.amount) || 0);
  const nextPaid = params.currentTotalPaid + payAmount;
  const nextStatus: InvoiceStatus =
    nextPaid >= params.totalBilled ? 'Paid' : nextPaid > 0 ? 'Partial' : 'Unpaid';

  try {
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
    await batch.commit();
    return paymentId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function removeFeeInvoice(schoolId: string, invoiceId: string) {
  const path = `schools/${schoolId}/feeInvoices/${invoiceId}`;
  try {
    await deleteDoc(doc(db, 'schools', schoolId, 'feeInvoices', invoiceId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
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

  try {
    if (existingId) {
      await updateDoc(doc(db, 'schools', schoolId, 'libraryLoans', existingId), {
        studentName: clampStr(data.studentName, 120),
        admissionNo: clampStr(data.admissionNo || 'N/A', 40) || 'N/A',
        formLevel: cleanFormLevel,
        stream: clampStr(data.stream || 'A', 20) || 'A',
        bookTitle: clampStr(data.bookTitle, 140),
        materialType: data.materialType,
        subject: clampStr(data.subject || 'General', 60),
        bookCode: clampStr(data.bookCode, 40),
        quantity: cleanQty,
        checkoutDate: cleanCheckout,
        dueDate: cleanDue,
        returnedDate: cleanReturned,
        status,
        conditionOnReturn,
        notes: clampStr(data.notes || '', 240),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'schools', schoolId, 'libraryLoans', loanId), {
        ownerId,
        studentId: data.studentId,
        studentName: clampStr(data.studentName, 120),
        admissionNo: clampStr(data.admissionNo || 'N/A', 40) || 'N/A',
        formLevel: cleanFormLevel,
        stream: clampStr(data.stream || 'A', 20) || 'A',
        bookTitle: clampStr(data.bookTitle, 140),
        materialType: data.materialType,
        subject: clampStr(data.subject || 'General', 60),
        bookCode: clampStr(data.bookCode, 40),
        quantity: cleanQty,
        checkoutDate: cleanCheckout,
        dueDate: cleanDue,
        returnedDate: cleanReturned,
        status,
        conditionOnReturn,
        notes: clampStr(data.notes || '', 240),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
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
    const payload: Record<string, unknown> = {
      status: 'Returned',
      returnedDate: cleanReturned,
      conditionOnReturn: params.conditionOnReturn,
      updatedAt: serverTimestamp(),
    };
    if (params.notes !== undefined) {
      payload.notes = clampStr(params.notes, 240);
    }
    await updateDoc(doc(db, 'schools', schoolId, 'libraryLoans', loanId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function reopenLibraryLoan(schoolId: string, loanId: string) {
  const path = `schools/${schoolId}/libraryLoans/${loanId}`;
  try {
    await updateDoc(doc(db, 'schools', schoolId, 'libraryLoans', loanId), {
      status: 'Checked Out',
      returnedDate: '',
      conditionOnReturn: 'Good',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function removeLibraryLoan(schoolId: string, loanId: string) {
  const path = `schools/${schoolId}/libraryLoans/${loanId}`;
  try {
    await deleteDoc(doc(db, 'schools', schoolId, 'libraryLoans', loanId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
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
        roleTitle: 'Form Master',
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
    students: { id: string; fullName: string; formLevel: FormLevel; stream: string }[];
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
  try {
    const batch = writeBatch(db);
    for (const s of params.students) {
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
        status: totalBilled === 0 ? 'Paid' : 'Unpaid',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    return params.students.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `schools/${schoolId}/feeInvoices`);
  }
}

export function getFeeInvoiceCollectionRef(schoolId: string) {
  return collection(db, 'schools', schoolId, 'feeInvoices');
}
