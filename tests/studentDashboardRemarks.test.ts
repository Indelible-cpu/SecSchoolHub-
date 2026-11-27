import assert from 'node:assert/strict';
import test from 'node:test';
import {
  arePortalResultFieldsSynced,
  calculateTermReportSummary,
  findStudentTermRemark,
  makeReportRemarkId,
} from '../src/school/malawi';
import { buildStudentReportCardPayload } from '../src/school/reportCardTemplates';
import type { Assessment, School, Student, StudentReportRemark } from '../src/school/types';

function makeSampleAssessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: 'asm_01',
    ownerId: 'owner_01',
    studentId: 'stu_01',
    studentName: 'Thandiwe Phiri',
    formLevel: 4,
    stream: 'A',
    term: 'Term 2',
    academicYear: '2026/2027',
    subject: 'Mathematics',
    ca1Raw: 18,
    ca1Max: 20,
    ca1Score: 18,
    ca2Raw: 16,
    ca2Max: 20,
    ca2Score: 16,
    caScore: 34,
    examRaw: 85,
    examMax: 100,
    examScore: 51,
    totalScore: 85,
    grade: '1',
    gradePoint: 1,
    remark: 'Distinction',
    teacherComment: 'Strong work on trigonometry; double-check vector signs.',
    ...overrides,
  };
}

function makeSampleRemark(overrides: Partial<StudentReportRemark> = {}): StudentReportRemark {
  return {
    id: 'rmk_stu_01_Term_2_2026_2027',
    ownerId: 'owner_01',
    schoolId: 'sch_01',
    registrationCode: 'REG-2026-01',
    studentId: 'stu_01',
    studentName: 'Thandiwe Phiri',
    formLevel: 4,
    stream: 'A',
    term: 'Term 2',
    academicYear: '2026/2027',
    formTeacherRemark: 'Focused and consistent across laboratory practicals.',
    headTeacherRemark: 'Keep maintaining top-tier MSCE standards.',
    nextTermOpens: '14 September 2026',
    formTeacherName: 'Mr. K. Mwale',
    headTeacherName: 'Mrs. G. Chirwa',
    ...overrides,
  };
}

test('makeReportRemarkId creates deterministic Firestore-safe IDs under 128 chars', () => {
  const id = makeReportRemarkId('stu_abc123', 'Term 2', '2026/2027');
  assert.equal(id, 'rmk_stu_abc123_Term_2_2026_2027');
  assert.match(id, /^[a-zA-Z0-9_-]{1,128}$/);

  const longId = makeReportRemarkId('student_with_very_long_identifier_'.repeat(4), 'Term 3', '2026/2027');
  assert.ok(longId.length <= 128);
  assert.match(longId, /^[a-zA-Z0-9_-]{1,128}$/);
});

test('findStudentTermRemark prefers exact academicYear match and falls back to matching term', () => {
  const rOld = makeSampleRemark({
    id: 'rmk_old',
    academicYear: '2025/2026',
    formTeacherRemark: 'Previous year remark',
  });
  const rCurrent = makeSampleRemark({
    id: 'rmk_curr',
    academicYear: '2026/2027',
    formTeacherRemark: 'Current year remark',
  });
  const rOtherTerm = makeSampleRemark({
    id: 'rmk_t1',
    term: 'Term 1',
    academicYear: '2026/2027',
  });

  const foundExact = findStudentTermRemark(
    [rOld, rOtherTerm, rCurrent],
    'stu_01',
    'Term 2',
    '2026/2027'
  );
  assert.equal(foundExact?.id, 'rmk_curr');

  const foundFallback = findStudentTermRemark([rOld], 'stu_01', 'Term 2', '2027/2028');
  assert.equal(foundFallback?.id, 'rmk_old');

  assert.equal(findStudentTermRemark([rOtherTerm], 'stu_01', 'Term 2', '2026/2027'), null);
});

test('arePortalResultFieldsSynced detects changes in teacherComment', () => {
  const asm = makeSampleAssessment();
  const mirrored: Partial<Assessment> = {
    studentName: 'Thandiwe Phiri',
    formLevel: 4,
    stream: 'A',
    term: 'Term 2',
    academicYear: '2026/2027',
    subject: 'Mathematics',
    ca1Raw: 18,
    ca1Max: 20,
    ca1Score: 18,
    ca2Raw: 16,
    ca2Max: 20,
    ca2Score: 16,
    caScore: 34,
    examRaw: 85,
    examMax: 100,
    examScore: 51,
    totalScore: 85,
    grade: '1',
    gradePoint: 1,
    remark: 'Distinction',
    teacherComment: 'Strong work on trigonometry; double-check vector signs.',
  };

  assert.equal(arePortalResultFieldsSynced(mirrored, asm, 'Thandiwe Phiri'), true);
  assert.equal(
    arePortalResultFieldsSynced({ ...mirrored, teacherComment: '' }, asm, 'Thandiwe Phiri'),
    false
  );
  assert.equal(
    arePortalResultFieldsSynced(
      { ...mirrored, teacherComment: 'Updated note' },
      asm,
      'Thandiwe Phiri'
    ),
    false
  );
});

test('buildStudentReportCardPayload prioritizes published remarks and attribution over defaults', () => {
  const school: School = {
    id: 'sch_01',
    ownerId: 'owner_01',
    name: 'Kamuzu Secondary School',
    district: 'Lilongwe',
    schoolType: 'Government Boarding',
    motto: 'Discipline & Excellence',
    academicYear: '2026/2027',
    currentTerm: 'Term 2',
    defaultTuitionMWK: 0,
    defaultGpfMWK: 0,
    defaultExamFeeMWK: 0,
  };
  const student: Student = {
    id: 'stu_01',
    ownerId: 'owner_01',
    admissionNo: 'KSS/26/001',
    fullName: 'Thandiwe Phiri',
    gender: 'Female',
    formLevel: 4,
    stream: 'A',
    boardingStatus: 'Boarder',
    guardianName: 'Mercy Phiri',
    guardianPhone: '+265999000111',
    status: 'Active',
  };
  const summary = calculateTermReportSummary(4, [makeSampleAssessment()]);
  const payload = buildStudentReportCardPayload({
    school,
    student,
    term: 'Term 2',
    summary,
    formTeacherRemark: 'Consistently strong problem solving across science clubs.',
    headTeacherRemark: 'Approved for top-tier MSCE mock cohort.',
    formTeacherName: 'Mr. K. Mwale',
    headTeacherName: 'Mrs. G. Chirwa',
    nextTermOpens: '14 September 2026',
  });

  assert.equal(payload.formTeacherRemark, 'Consistently strong problem solving across science clubs.');
  assert.equal(payload.headTeacherRemark, 'Approved for top-tier MSCE mock cohort.');
  assert.equal(payload.formTeacherName, 'Mr. K. Mwale');
  assert.equal(payload.headTeacherName, 'Mrs. G. Chirwa');
  assert.equal(payload.nextTermOpens, '14 September 2026');
});
