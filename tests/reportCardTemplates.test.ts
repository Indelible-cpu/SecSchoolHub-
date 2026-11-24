import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateTermReportSummary } from '../src/school/malawi';
import {
  ACADEMIC_REPORT_TEMPLATES,
  buildStudentReportCardPayload,
  computeFormRankings,
  computeStudentAttendanceStats,
  computeSubjectCaDeltaPct,
  formatOrdinalPosition,
  generateDefaultTeacherRemarks,
  getReportTemplateMeta,
} from '../src/school/reportCardTemplates';
import type { Assessment, AttendanceRecord, FormLevel, School, Student } from '../src/school/types';

const TEST_SCHOOL: School = {
  id: 'sch_1',
  ownerId: 'owner_1',
  name: 'Kamuzu Day Secondary School',
  district: 'Lilongwe',
  schoolType: 'Government Day',
  motto: 'Discipline and Excellence',
  academicYear: '2026',
  currentTerm: 'Term 1',
  defaultTuitionMWK: 25000,
  defaultGpfMWK: 5000,
  defaultExamFeeMWK: 3500,
};

function makeStudent(id: string, name: string, formLevel: FormLevel, stream = 'A'): Student {
  return {
    id,
    ownerId: 'owner_1',
    admissionNo: `KDS-${id}`,
    fullName: name,
    gender: 'Female',
    formLevel,
    stream,
    boardingStatus: 'Day Scholar',
    guardianName: 'Grace Banda',
    guardianPhone: '+265991234567',
    status: 'Active',
  };
}

function makeAssessment(
  id: string,
  studentId: string,
  studentName: string,
  formLevel: FormLevel,
  subject: string,
  ca1Raw: number,
  ca2Raw: number,
  examRaw: number
): Assessment {
  const ca1Score = ca1Raw; // out of 20
  const ca2Score = ca2Raw; // out of 20
  const caScore = ca1Score + ca2Score;
  const examScore = Math.round((examRaw / 100) * 60 * 10) / 10;
  const totalScore = Math.round((caScore + examScore) * 10) / 10;
  return {
    id,
    ownerId: 'owner_1',
    studentId,
    studentName,
    formLevel,
    stream: 'A',
    term: 'Term 1',
    academicYear: '2026',
    subject,
    ca1Raw,
    ca1Max: 20,
    ca1Score,
    ca2Raw,
    ca2Max: 20,
    ca2Score,
    caScore,
    examRaw,
    examMax: 100,
    examScore,
    totalScore,
    grade: totalScore >= 80 ? '1' : totalScore >= 60 ? '5' : '9',
    gradePoint: totalScore >= 80 ? 1 : totalScore >= 60 ? 5 : 9,
    remark: totalScore >= 80 ? 'Distinction' : totalScore >= 60 ? 'Credit' : 'Fail',
  };
}

test('ACADEMIC_REPORT_TEMPLATES includes all 4 pre-defined printable templates', () => {
  assert.equal(ACADEMIC_REPORT_TEMPLATES.length, 4);
  const ids = ACADEMIC_REPORT_TEMPLATES.map((t) => t.id);
  assert.deepEqual(ids, [
    'classic-maneb',
    'modern-executive',
    'compact-parent-slip',
    'detailed-transcript',
  ]);
  assert.equal(getReportTemplateMeta('detailed-transcript').supportsCaDelta, true);
  assert.equal(getReportTemplateMeta('compact-parent-slip').supportsGuardianSlip, true);
});

test('computeFormRankings ranks per Form Level and preserves tie positions', () => {
  const s1 = makeStudent('s1', 'Alice Phiri', 3);
  const s2 = makeStudent('s2', 'Brian Mwale', 3);
  const s3 = makeStudent('s3', 'Chisomo Banda', 3);
  const s4 = makeStudent('s4', 'Doreen Nkhoma', 3);
  const s5 = makeStudent('s5', 'Kondwani Tembo', 2);
  const s6 = makeStudent('s6', 'Unmarked Student', 3);

  const assessments: Assessment[] = [
    makeAssessment('a1', 's1', s1.fullName, 3, 'English', 18, 18, 90), // 90%
    makeAssessment('a2', 's2', s2.fullName, 3, 'English', 15, 15, 70), // 72%
    makeAssessment('a3', 's3', s3.fullName, 3, 'English', 15, 15, 70), // 72% (tie)
    makeAssessment('a4', 's4', s4.fullName, 3, 'English', 10, 10, 50), // 50%
    makeAssessment('a5', 's5', s5.fullName, 2, 'English', 16, 16, 80), // Form 2 #1
  ];

  const ranks = computeFormRankings({
    students: [s1, s2, s3, s4, s5, s6],
    assessments,
    term: 'Term 1',
    academicYear: '2026',
  });

  assert.equal(ranks.get('s1')?.rank, 1);
  assert.equal(ranks.get('s1')?.totalRanked, 4);
  assert.equal(ranks.get('s2')?.rank, 2);
  assert.equal(ranks.get('s3')?.rank, 2);
  assert.equal(ranks.get('s4')?.rank, 4);
  assert.equal(ranks.get('s5')?.rank, 1);
  assert.equal(ranks.get('s5')?.totalRanked, 1);
  assert.equal(ranks.has('s6'), false);
});

test('formatOrdinalPosition formats English ordinal suffixes accurately', () => {
  assert.equal(formatOrdinalPosition(1), '1st');
  assert.equal(formatOrdinalPosition(2), '2nd');
  assert.equal(formatOrdinalPosition(3), '3rd');
  assert.equal(formatOrdinalPosition(4), '4th');
  assert.equal(formatOrdinalPosition(11), '11th');
  assert.equal(formatOrdinalPosition(12), '12th');
  assert.equal(formatOrdinalPosition(13), '13th');
  assert.equal(formatOrdinalPosition(21), '21st');
  assert.equal(formatOrdinalPosition(22), '22nd');
  assert.equal(formatOrdinalPosition(23), '23rd');
});

test('computeStudentAttendanceStats & computeSubjectCaDeltaPct compute accurate metrics', () => {
  const attendance: AttendanceRecord[] = [
    { id: '1', ownerId: 'o', date: '2026-10-01', formLevel: 3, stream: 'A', studentId: 's1', studentName: 'Alice', status: 'Present', note: '' },
    { id: '2', ownerId: 'o', date: '2026-10-02', formLevel: 3, stream: 'A', studentId: 's1', studentName: 'Alice', status: 'Late', note: '' },
    { id: '3', ownerId: 'o', date: '2026-10-03', formLevel: 3, stream: 'A', studentId: 's1', studentName: 'Alice', status: 'Absent', note: '' },
    { id: '4', ownerId: 'o', date: '2026-10-04', formLevel: 3, stream: 'A', studentId: 's1', studentName: 'Alice', status: 'Excused', note: '' },
  ];

  const stats = computeStudentAttendanceStats(attendance, 's1');
  assert.ok(stats);
  assert.equal(stats.present, 1);
  assert.equal(stats.late, 1);
  assert.equal(stats.absent, 1);
  assert.equal(stats.excused, 1);
  assert.equal(stats.totalMarked, 4);
  assert.equal(stats.ratePct, 50);

  assert.equal(computeStudentAttendanceStats(attendance, 'missing'), null);

  const student = makeStudent('s1', 'Alice Phiri', 3);
  const summary = calculateTermReportSummary(3, [
    makeAssessment('a1', 's1', student.fullName, 3, 'Mathematics', 16, 12, 70),
  ]);
  // CA1 16/20 = 80%, CA2 12/20 = 60% => delta = -20%
  assert.equal(computeSubjectCaDeltaPct(summary.rows[0]), -20);
});

test('generateDefaultTeacherRemarks and buildStudentReportCardPayload support custom overrides', () => {
  const student = makeStudent('s1', 'Alice Phiri', 3);
  const subjects = ['English', 'Mathematics', 'Biology', 'Physical Science', 'Geography', 'Chichewa'];
  const assessments = subjects.map((subj, idx) =>
    makeAssessment(`a${idx}`, 's1', student.fullName, 3, subj, 17, 18, 85)
  );
  const summary = calculateTermReportSummary(3, assessments);
  const auto = generateDefaultTeacherRemarks(summary, student, {
    rank: 1,
    totalRanked: 20,
    formLabel: 'Form 3',
  });
  assert.match(auto.formTeacherRemark, /1st out of 20/);
  assert.match(auto.headTeacherRemark, /MSCE/i);

  const built = buildStudentReportCardPayload({
    school: TEST_SCHOOL,
    student,
    term: 'Term 1',
    summary,
    formTeacherRemark: 'Consistent top performer in Science.',
    nextTermOpens: '12 January 2027',
  });
  assert.equal(built.formTeacherRemark, 'Consistent top performer in Science.');
  assert.equal(built.nextTermOpens, '12 January 2027');
});
