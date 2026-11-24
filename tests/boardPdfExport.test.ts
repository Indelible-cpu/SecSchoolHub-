import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBoardReportSummaryData,
  sanitizeSvgMarkupForPrint,
} from '../src/school/boardPdfExport';
import type {
  Assessment,
  AttendanceRecord,
  FeeInvoice,
  School,
  Student,
  Teacher,
} from '../src/school/types';

const TEST_SCHOOL: School = {
  id: 'sch-1',
  ownerId: 'owner-1',
  name: 'Kamuzu Academy Demo',
  schoolType: 'Government Boarding',
  district: 'Kasungu',
  motto: 'Excellence and Discipline',
  academicYear: '2026',
  currentTerm: 'Term 2',
  defaultTuitionMWK: 100000,
  defaultGpfMWK: 10000,
  defaultExamFeeMWK: 5000,
};

const TEST_STUDENTS: Student[] = [
  {
    id: 'st-1',
    ownerId: 'owner-1',
    admissionNo: 'ADM-001',
    fullName: 'Chisomo Banda',
    gender: 'Female',
    formLevel: 4,
    stream: 'A',
    boardingStatus: 'Boarder',
    guardianName: 'Grace Banda',
    guardianPhone: '+265999111222',
    status: 'Active',
  },
  {
    id: 'st-2',
    ownerId: 'owner-1',
    admissionNo: 'ADM-002',
    fullName: 'Kondwani Phiri',
    gender: 'Male',
    formLevel: 2,
    stream: 'B',
    boardingStatus: 'Day Scholar',
    guardianName: 'Peter Phiri',
    guardianPhone: '+265888222333',
    status: 'Active',
  },
  {
    id: 'st-3',
    ownerId: 'owner-1',
    admissionNo: 'ADM-003',
    fullName: 'Thandiwe Mwale',
    gender: 'Female',
    formLevel: 1,
    stream: 'A',
    boardingStatus: 'Day Scholar',
    guardianName: 'Mary Mwale',
    guardianPhone: '+265991333444',
    status: 'Transferred',
  },
];

const TEST_TEACHERS: Teacher[] = [
  {
    id: 't-1',
    ownerId: 'owner-1',
    staffCode: 'STF-01',
    fullName: 'Mr. J. Chirwa',
    roleTitle: 'Head of Department',
    phone: '+265999000111',
    subjects: ['Mathematics'],
    assignedForm: 'Form 4A',
    status: 'Active',
  },
  {
    id: 't-2',
    ownerId: 'owner-1',
    staffCode: 'STF-02',
    fullName: 'Ms. L. Nkhoma',
    roleTitle: 'Form Teacher',
    phone: '+265999000222',
    subjects: ['English'],
    assignedForm: 'Form 2B',
    status: 'On Leave',
  },
];

const TEST_ASSESSMENTS: Assessment[] = [
  {
    id: 'as-1',
    ownerId: 'owner-1',
    studentId: 'st-1',
    studentName: 'Chisomo Banda',
    formLevel: 4,
    stream: 'A',
    term: 'Term 1',
    academicYear: '2026',
    subject: 'Mathematics',
    ca1Score: 14,
    ca2Score: 15,
    caScore: 29,
    examScore: 45,
    totalScore: 74,
    grade: '2',
    gradePoint: 2,
    remark: 'Distinction',
  },
  {
    id: 'as-2',
    ownerId: 'owner-1',
    studentId: 'st-1',
    studentName: 'Chisomo Banda',
    formLevel: 4,
    stream: 'A',
    term: 'Term 2',
    academicYear: '2026',
    subject: 'Mathematics',
    ca1Score: 16,
    ca2Score: 17,
    caScore: 33,
    examScore: 49,
    totalScore: 82,
    grade: '1',
    gradePoint: 1,
    remark: 'Distinction',
  },
  {
    id: 'as-3',
    ownerId: 'owner-1',
    studentId: 'st-2',
    studentName: 'Kondwani Phiri',
    formLevel: 2,
    stream: 'B',
    term: 'Term 2',
    academicYear: '2026',
    subject: 'English',
    ca1Score: 8,
    ca2Score: 7,
    caScore: 15,
    examScore: 20,
    totalScore: 35,
    grade: 'F',
    gradePoint: 9,
    remark: 'Fail',
  },
];

const TEST_ATTENDANCE: AttendanceRecord[] = [
  {
    id: 'att-1',
    ownerId: 'owner-1',
    studentId: 'st-1',
    studentName: 'Chisomo Banda',
    formLevel: 4,
    stream: 'A',
    date: '2026-06-15',
    status: 'Present',
    note: '',
  },
  {
    id: 'att-2',
    ownerId: 'owner-1',
    studentId: 'st-2',
    studentName: 'Kondwani Phiri',
    formLevel: 2,
    stream: 'B',
    date: '2026-06-15',
    status: 'Absent',
    note: '',
  },
];

const TEST_INVOICES: FeeInvoice[] = [
  {
    id: 'inv-1',
    ownerId: 'owner-1',
    studentId: 'st-1',
    studentName: 'Chisomo Banda',
    formLevel: 4,
    stream: 'A',
    term: 'Term 2',
    academicYear: '2026',
    tuitionFee: 100000,
    gpfFee: 10000,
    examFee: 5000,
    otherFee: 50000,
    totalBilled: 165000,
    totalPaid: 165000,
    status: 'Paid',
  },
  {
    id: 'inv-2',
    ownerId: 'owner-1',
    studentId: 'st-2',
    studentName: 'Kondwani Phiri',
    formLevel: 2,
    stream: 'B',
    term: 'Term 2',
    academicYear: '2026',
    tuitionFee: 80000,
    gpfFee: 10000,
    examFee: 5000,
    otherFee: 0,
    totalBilled: 95000,
    totalPaid: 35000,
    status: 'Partial',
  },
];

test('sanitizeSvgMarkupForPrint injects xmlns, explicit dimensions, and light print-safe colors', () => {
  const darkSvg =
    '<svg viewBox="0 0 600 240"><rect fill="#1e293b" stroke="#334155" /><rect fill="#0f172a" stroke="#f8fafc" /><text fill="currentColor" style="font-family: var(--font-mono);">88%</text></svg>';

  const sanitized = sanitizeSvgMarkupForPrint(darkSvg, { width: 600, height: 240 });

  assert.match(sanitized, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(sanitized, /width="600"/);
  assert.match(sanitized, /height="240"/);
  assert.doesNotMatch(sanitized, /var\(--font-mono\)/);
  assert.doesNotMatch(sanitized, /currentColor/);
  assert.match(sanitized, /fill="#f1f5f9"/);
  assert.match(sanitized, /fill="#f8fafc"/);
  assert.match(sanitized, /stroke="#cbd5e1"/);
  assert.match(sanitized, /stroke="#0f172a"/);
  assert.match(sanitized, /fill="#475569"/);
});

test('buildBoardReportSummaryData computes academic/attendance metrics and enforces RBAC financial exclusion', () => {
  const withoutFees = buildBoardReportSummaryData({
    school: TEST_SCHOOL,
    students: TEST_STUDENTS,
    teachers: TEST_TEACHERS,
    assessments: TEST_ASSESSMENTS,
    attendance: TEST_ATTENDANCE,
    invoices: TEST_INVOICES,
    todayIso: '2026-06-15',
    includeFinancialSummary: false,
  });

  assert.equal(withoutFees.activeStudentsCount, 2);
  assert.equal(withoutFees.activeStaffCount, 1);
  assert.equal(withoutFees.totalStaffCount, 2);
  assert.equal(withoutFees.termAssessmentsCount, 2);
  assert.equal(withoutFees.gradeDistribution.distinction, 1);
  assert.equal(withoutFees.gradeDistribution.fail, 1);
  assert.equal(withoutFees.gradeDistribution.passRate, 50);
  assert.equal(withoutFees.subjectRows.length, 2);
  assert.equal(withoutFees.subjectRows[0]?.subject, 'Mathematics');
  assert.equal(withoutFees.attendanceOverview.todayMarked, 2);
  assert.equal(withoutFees.attendanceOverview.todayPresent, 1);
  assert.equal(withoutFees.attendanceOverview.todayRate, 50);
  assert.equal(withoutFees.msceTopRows.length, 1);
  assert.equal(withoutFees.msceTopRows[0]?.studentName, 'Chisomo Banda');
  assert.equal(withoutFees.feeSummary, null);

  const withFees = buildBoardReportSummaryData({
    school: TEST_SCHOOL,
    students: TEST_STUDENTS,
    teachers: TEST_TEACHERS,
    assessments: TEST_ASSESSMENTS,
    attendance: TEST_ATTENDANCE,
    invoices: TEST_INVOICES,
    todayIso: '2026-06-15',
    includeFinancialSummary: true,
  });

  assert.ok(withFees.feeSummary);
  assert.equal(withFees.feeSummary.totalBilled, 260000);
  assert.equal(withFees.feeSummary.totalPaid, 200000);
  assert.equal(withFees.feeSummary.balance, 60000);
  assert.equal(withFees.feeSummary.collectionRate, 77);
  assert.equal(withFees.feeSummary.paidCount, 1);
  assert.equal(withFees.feeSummary.partialCount, 1);
  assert.equal(withFees.feeSummary.unpaidCount, 0);
});
