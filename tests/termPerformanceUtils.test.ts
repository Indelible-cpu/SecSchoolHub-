import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTermPerformanceTrends } from '../src/school/termPerformanceUtils';
import type { Assessment, FormLevel, TermName } from '../src/school/types';

function makeAssessment(
  id: string,
  studentId: string,
  formLevel: FormLevel,
  academicYear: string,
  term: TermName,
  subject: string,
  totalScore: number,
  gradePoint: number
): Assessment {
  return {
    id,
    ownerId: 'owner-1',
    studentId,
    studentName: `Student ${studentId}`,
    formLevel,
    stream: 'A',
    term,
    academicYear,
    subject,
    caScore: Math.round(totalScore * 0.4),
    examScore: Math.round(totalScore * 0.6),
    totalScore,
    grade: String(gradePoint),
    gradePoint,
    remark: gradePoint <= 7 ? 'Pass' : 'Fail',
  };
}

test('buildTermPerformanceTrends orders multi-year terms chronologically and computes per-student aggregate means', () => {
  const records: Assessment[] = [
    // 2025 Term 3: Student A (80, 70 -> avg 75), Student B (60 -> avg 60) => school mean = (75 + 60) / 2 = 67.5
    makeAssessment('a1', 's1', 3, '2025', 'Term 3', 'English', 80, 1),
    makeAssessment('a2', 's1', 3, '2025', 'Term 3', 'Mathematics', 70, 3),
    makeAssessment('a3', 's2', 1, '2025', 'Term 3', 'English', 60, 5),

    // 2026 Term 1: Student A (84), Student B (72) => school mean = 78.0 (+10.5 pts vs 2025 Term 3)
    makeAssessment('b1', 's1', 4, '2026', 'Term 1', 'English', 84, 1),
    makeAssessment('b2', 's2', 2, '2026', 'Term 1', 'English', 72, 3),

    // 2026 Term 2: Student A (88), Student B (76) => school mean = 82.0 (+4.0 pts vs 2026 Term 1)
    makeAssessment('c1', 's1', 4, '2026', 'Term 2', 'English', 88, 1),
    makeAssessment('c2', 's2', 2, '2026', 'Term 2', 'English', 76, 3),
  ];

  const summary = buildTermPerformanceTrends(records, { currentAcademicYear: '2026' });

  assert.equal(summary.activeTermsCount, 3);
  assert.deepEqual(summary.availableYears, ['2025', '2026']);
  assert.deepEqual(summary.availableSubjects, ['English', 'Mathematics']);
  assert.equal(summary.points.length, 6); // 3 terms x 2 academic years

  const t3_2025 = summary.points.find((p) => p.academicYear === '2025' && p.term === 'Term 3');
  const t1_2026 = summary.points.find((p) => p.academicYear === '2026' && p.term === 'Term 1');
  const t2_2026 = summary.points.find((p) => p.academicYear === '2026' && p.term === 'Term 2');
  const t3_2026 = summary.points.find((p) => p.academicYear === '2026' && p.term === 'Term 3');

  assert.equal(t3_2025?.aggregateMean, 67.5);
  assert.equal(t3_2025?.deltaFromPrev, null);
  assert.equal(t1_2026?.aggregateMean, 78);
  assert.equal(t1_2026?.deltaFromPrev, 10.5);
  assert.equal(t2_2026?.aggregateMean, 82);
  assert.equal(t2_2026?.deltaFromPrev, 4);
  assert.equal(t3_2026?.hasData, false);
  assert.equal(t3_2026?.aggregateMean, null);

  assert.equal(summary.latestPoint?.fullLabel, 'Term 2 (2026)');
  assert.equal(summary.previousPoint?.fullLabel, 'Term 1 (2026)');
  assert.equal(summary.bestPoint?.fullLabel, 'Term 2 (2026)');
});

test('buildTermPerformanceTrends supports Form Level and Subject filtering and respects JCE vs MSCE pass thresholds', () => {
  const records: Assessment[] = [
    // Form 2 (JCE: gradePoint <= 7 passes; 8 fails)
    makeAssessment('f2-1', 's10', 2, '2026', 'Term 1', 'Biology', 45, 8), // Fail for JCE
    makeAssessment('f2-2', 's11', 2, '2026', 'Term 1', 'Biology', 65, 5), // Pass for JCE
    // Form 4 (MSCE: gradePoint <= 8 passes)
    makeAssessment('f4-1', 's20', 4, '2026', 'Term 1', 'Biology', 44, 8), // Pass for MSCE
    makeAssessment('f4-2', 's20', 4, '2026', 'Term 1', 'English', 74, 3),
  ];

  const bioForm2 = buildTermPerformanceTrends(records, {
    currentAcademicYear: '2026',
    formFilter: 2,
    subjectFilter: 'Biology',
  });
  assert.equal(bioForm2.activeTermsCount, 1);
  assert.equal(bioForm2.latestPoint?.aggregateMean, 55);
  assert.equal(bioForm2.latestPoint?.passRatePct, 50);

  const bioForm4 = buildTermPerformanceTrends(records, {
    currentAcademicYear: '2026',
    formFilter: 4,
    subjectFilter: 'Biology',
  });
  assert.equal(bioForm4.latestPoint?.aggregateMean, 44);
  assert.equal(bioForm4.latestPoint?.passRatePct, 100);
});

test('buildTermPerformanceTrends handles empty assessments cleanly', () => {
  const empty = buildTermPerformanceTrends([], { currentAcademicYear: '2026' });
  assert.equal(empty.totalAssessments, 0);
  assert.equal(empty.activeTermsCount, 0);
  assert.equal(empty.points.length, 0);
  assert.equal(empty.latestPoint, null);
});
