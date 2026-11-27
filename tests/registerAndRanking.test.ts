import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateManebGrade,
  compareStudentsRegisterOrder,
  getStudentGenderRegisterRank,
  rankAssessmentsByPerformance,
  sortStudentsForRegister,
} from '../src/school/malawi';
import { buildLiveCohortMeritStandings } from '../src/school/reportCardTemplates';
import type { Assessment, FormLevel, Gender, Student } from '../src/school/types';

function makeStudent(
  id: string,
  fullName: string,
  gender: Gender,
  formLevel: FormLevel = 1,
  stream = 'A'
): Student {
  return {
    id,
    ownerId: 'owner_1',
    admissionNo: `SCH-2026-${id}`,
    fullName,
    gender,
    formLevel,
    stream,
    boardingStatus: 'Day Scholar',
    guardianName: 'Guardian',
    guardianPhone: '+265991000000',
    status: 'Active',
  };
}

function makeAssessment(
  id: string,
  student: Student,
  subject: string,
  ca1: number,
  ca2: number,
  examOutOf100: number
): Assessment {
  const caScore = Math.round((ca1 + ca2) * 10) / 10;
  const examScore = Math.round((examOutOf100 / 100) * 60 * 10) / 10;
  const maneb = calculateManebGrade(student.formLevel, caScore, examScore);
  return {
    id,
    ownerId: 'owner_1',
    studentId: student.id,
    studentName: student.fullName,
    formLevel: student.formLevel,
    stream: student.stream,
    term: 'Term 1',
    academicYear: '2026',
    subject,
    ca1Raw: ca1,
    ca1Max: 20,
    ca1Score: ca1,
    ca2Raw: ca2,
    ca2Max: 20,
    ca2Score: ca2,
    caScore,
    examRaw: examOutOf100,
    examMax: 100,
    examScore,
    totalScore: maneb.totalScore,
    grade: maneb.grade,
    gradePoint: maneb.gradePoint,
    remark: maneb.remark,
  };
}

test('getStudentGenderRegisterRank places boys upwards (0) and girls downwards (1)', () => {
  assert.equal(getStudentGenderRegisterRank('Male'), 0);
  assert.equal(getStudentGenderRegisterRank('male'), 0);
  assert.equal(getStudentGenderRegisterRank('Boy'), 0);
  assert.equal(getStudentGenderRegisterRank('Female'), 1);
  assert.equal(getStudentGenderRegisterRank('female'), 1);
  assert.equal(getStudentGenderRegisterRank('Girl'), 1);
});

test('sortStudentsForRegister auto-arranges Boys upwards A-Z and Girls downwards A-Z as students are added', () => {
  // Simulate admin adding students in arbitrary order across forms
  const incremental: Student[] = [];
  incremental.push(makeStudent('1', 'Alice Banda', 'Female', 1));
  incremental.push(makeStudent('2', 'Zulu Phiri', 'Male', 2));
  incremental.push(makeStudent('3', 'aaron Gondwe', 'Male', 1));
  incremental.push(makeStudent('4', 'Zione Tembo', 'Female', 1));
  incremental.push(makeStudent('5', 'Kondwani Mwale', 'Male', 3));
  incremental.push(makeStudent('6', 'Chisomo Kaunda', 'Female', 2));

  const sorted = sortStudentsForRegister(incremental);
  assert.deepEqual(
    sorted.map((s) => `${s.fullName} (${s.gender})`),
    [
      'aaron Gondwe (Male)',
      'Kondwani Mwale (Male)',
      'Zulu Phiri (Male)',
      'Alice Banda (Female)',
      'Chisomo Kaunda (Female)',
      'Zione Tembo (Female)',
    ]
  );

  // Adding another Boy and Girl later stays cleanly sorted
  const updated = sortStudentsForRegister([
    ...sorted,
    makeStudent('7', 'Benson Nkhoma', 'Male', 1),
    makeStudent('8', 'Beatrice Chirwa', 'Female', 1),
  ]);
  assert.deepEqual(
    updated.map((s) => s.fullName),
    [
      'aaron Gondwe',
      'Benson Nkhoma',
      'Kondwani Mwale',
      'Zulu Phiri',
      'Alice Banda',
      'Beatrice Chirwa',
      'Chisomo Kaunda',
      'Zione Tembo',
    ]
  );
});

test('sortStudentsForRegister with groupByForm keeps Boys upwards A-Z and Girls downwards A-Z within each Form', () => {
  const roster = [
    makeStudent('1', 'Thandiwe Banda', 'Female', 2),
    makeStudent('2', 'Yamikani Phiri', 'Male', 2),
    makeStudent('3', 'Alice Mwale', 'Female', 1),
    makeStudent('4', 'Zack Gondwe', 'Male', 1),
    makeStudent('5', 'Brian Kaunda', 'Male', 1),
  ];

  const byForm = sortStudentsForRegister(roster, { groupByForm: true });
  assert.deepEqual(
    byForm.map((s) => `F${s.formLevel}:${s.fullName}:${s.gender}`),
    [
      'F1:Brian Kaunda:Male',
      'F1:Zack Gondwe:Male',
      'F1:Alice Mwale:Female',
      'F2:Yamikani Phiri:Male',
      'F2:Thandiwe Banda:Female',
    ]
  );

  assert.ok(
    compareStudentsRegisterOrder(
      makeStudent('a', 'Zack', 'Male', 1),
      makeStudent('b', 'Alice', 'Female', 1)
    ) < 0
  );
});

test('rankAssessmentsByPerformance auto-ranks scores highest-first with tie handling and updates when new scores arrive', () => {
  const b1 = makeStudent('1', 'Chisomo Banda', 'Male', 4);
  const g1 = makeStudent('2', 'Thandiwe Phiri', 'Female', 4);
  const b2 = makeStudent('3', 'Kondwani Mwale', 'Male', 4);
  const g2 = makeStudent('4', 'Zione Tembo', 'Female', 4);

  const initialMarks = [
    makeAssessment('m1', b1, 'Mathematics', 12, 14, 60), // 12 + 14 + 36 = 62%
    makeAssessment('m2', g1, 'Mathematics', 18, 18, 80), // 18 + 18 + 48 = 84%
    makeAssessment('m3', b2, 'Mathematics', 18, 18, 80), // 84% (tied 1st!)
  ];

  const ranked1 = rankAssessmentsByPerformance(initialMarks);
  assert.deepEqual(
    ranked1.map((r) => ({
      name: r.assessment.studentName,
      score: r.assessment.totalScore,
      rank: r.rank,
      ordinal: r.ordinal,
      isTied: r.isTied,
    })),
    [
      { name: 'Kondwani Mwale', score: 84, rank: 1, ordinal: '1st', isTied: true },
      { name: 'Thandiwe Phiri', score: 84, rank: 1, ordinal: '1st', isTied: true },
      { name: 'Chisomo Banda', score: 62, rank: 3, ordinal: '3rd', isTied: false },
    ]
  );

  // Now teacher enters a higher score for Zione (92%) -> auto-ranks to 1st, others shift to 2nd= and 4th
  const ranked2 = rankAssessmentsByPerformance([
    ...initialMarks,
    makeAssessment('m4', g2, 'Mathematics', 20, 18, 90), // 20 + 18 + 54 = 92%
  ]);
  assert.deepEqual(
    ranked2.map((r) => ({
      name: r.assessment.studentName,
      score: r.assessment.totalScore,
      rank: r.rank,
      ordinal: r.ordinal,
      isTied: r.isTied,
    })),
    [
      { name: 'Zione Tembo', score: 92, rank: 1, ordinal: '1st', isTied: false },
      { name: 'Kondwani Mwale', score: 84, rank: 2, ordinal: '2nd', isTied: true },
      { name: 'Thandiwe Phiri', score: 84, rank: 2, ordinal: '2nd', isTied: true },
      { name: 'Chisomo Banda', score: 62, rank: 4, ordinal: '4th', isTied: false },
    ]
  );
});

test('buildLiveCohortMeritStandings dynamically ranks students across subjects as grades are entered', () => {
  const s1 = makeStudent('1', 'Chisomo Banda', 'Male', 4);
  const s2 = makeStudent('2', 'Grace Phiri', 'Female', 4);
  const s3 = makeStudent('3', 'Kondwani Mwale', 'Male', 4);

  const assessments = [
    makeAssessment('a1', s1, 'English', 16, 16, 70), // 74%
    makeAssessment('a2', s1, 'Mathematics', 14, 16, 70), // 72% -> avg 73%
    makeAssessment('a3', s2, 'English', 18, 18, 85), // 87%
    makeAssessment('a4', s2, 'Mathematics', 17, 18, 80), // 83% -> avg 85%
    makeAssessment('a5', s3, 'English', 10, 12, 50), // 52%
  ];

  const standings = buildLiveCohortMeritStandings({
    students: [s1, s2, s3],
    assessments,
    term: 'Term 1',
    academicYear: '2026',
    formFilter: 4,
  });

  assert.deepEqual(
    standings.map((r) => ({
      pos: r.formRank.rank,
      name: r.student.fullName,
      avg: r.summary.weightedAverage,
    })),
    [
      { pos: 1, name: 'Grace Phiri', avg: 85 },
      { pos: 2, name: 'Chisomo Banda', avg: 73 },
      { pos: 3, name: 'Kondwani Mwale', avg: 52 },
    ]
  );
});
