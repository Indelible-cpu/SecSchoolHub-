import assert from 'node:assert/strict';
import test from 'node:test';
import {
  arePortalResultFieldsSynced,
  countStudentAssessmentsByTerm,
  resolveStudentPortalTerm,
} from '../src/school/malawi';
import type { Assessment } from '../src/school/types';

function makeSampleAssessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: 'asm_01',
    ownerId: 'owner_01',
    studentId: 'stu_01',
    studentName: 'Chikondi Banda',
    formLevel: 4,
    stream: 'A',
    term: 'Term 2',
    academicYear: '2026/2027',
    subject: 'English',
    ca1Raw: 24,
    ca1Max: 30,
    ca1Score: 16,
    ca2Raw: 32,
    ca2Max: 40,
    ca2Score: 16,
    caScore: 32,
    examRaw: 80,
    examMax: 100,
    examScore: 48,
    totalScore: 80,
    grade: '1',
    gradePoint: 1,
    remark: 'Distinction',
    ...overrides,
  };
}

test('countStudentAssessmentsByTerm counts published subjects per term accurately', () => {
  const counts = countStudentAssessmentsByTerm([
    { term: 'Term 1' },
    { term: 'Term 2' },
    { term: 'Term 2' },
    { term: 'Term 2' },
  ]);

  assert.deepEqual(counts, {
    'Term 1': 1,
    'Term 2': 3,
    'Term 3': 0,
  });
});

test('resolveStudentPortalTerm keeps preferredTerm when marks exist, otherwise selects latest term with marks', () => {
  assert.equal(
    resolveStudentPortalTerm('Term 1', [{ term: 'Term 1' }, { term: 'Term 2' }]),
    'Term 1'
  );

  // School switched to Term 3, but student marks are only in Term 2 -> auto-select Term 2
  assert.equal(
    resolveStudentPortalTerm('Term 3', [{ term: 'Term 1' }, { term: 'Term 2' }]),
    'Term 2'
  );

  // School is on Term 1, student has Term 3 marks -> auto-select Term 3
  assert.equal(
    resolveStudentPortalTerm('Term 1', [{ term: 'Term 3' }]),
    'Term 3'
  );

  // No marks anywhere -> keep preferredTerm
  assert.equal(resolveStudentPortalTerm('Term 2', []), 'Term 2');
});

test('arePortalResultFieldsSynced detects matching and stale CA/exam/student fields', () => {
  const asm = makeSampleAssessment();
  const mirrored: Partial<Assessment> = {
    studentName: 'Chikondi Banda',
    formLevel: 4,
    stream: 'A',
    term: 'Term 2',
    academicYear: '2026/2027',
    subject: 'English',
    ca1Raw: 24,
    ca1Max: 30,
    ca1Score: 16,
    ca2Raw: 32,
    ca2Max: 40,
    ca2Score: 16,
    caScore: 32,
    examRaw: 80,
    examMax: 100,
    examScore: 48,
    totalScore: 80,
    grade: '1',
    gradePoint: 1,
    remark: 'Distinction',
  };

  assert.equal(arePortalResultFieldsSynced(mirrored, asm, 'Chikondi Banda'), true);
  assert.equal(arePortalResultFieldsSynced({ ...mirrored, ca1Score: 14 }, asm, 'Chikondi Banda'), false);
  assert.equal(arePortalResultFieldsSynced({ ...mirrored, ca2Raw: 20 }, asm, 'Chikondi Banda'), false);
  assert.equal(arePortalResultFieldsSynced(mirrored, asm, 'Chikondi M. Banda'), false);
});
