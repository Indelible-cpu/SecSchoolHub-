import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inferMaterialType,
  isValidIsbn,
  matchCurriculumSubject,
  normalizeIsbn,
} from '../server/libraryScanner';

const MALAWI_SUBJECTS = [
  'English',
  'Chichewa',
  'Mathematics',
  'Biology',
  'Physical Science',
  'Geography',
  'History',
  'Agriculture',
  'Bible Knowledge',
  'Social & Life Skills',
  'Business Studies',
  'Computer Studies',
];

test('normalizeIsbn handles hyphens, spaces, ISBN-10 X check digit, and SecSchoolHub JSON QR payloads', () => {
  assert.equal(normalizeIsbn('978-0-19-839011-4'), '9780198390114');
  assert.equal(normalizeIsbn('0-14-044913-x'), '014044913X');
  assert.equal(
    normalizeIsbn(JSON.stringify({ type: 'SECSCHOOLHUB_BOOK', isbn: '978-99908-1-234-5', copy: 1 })),
    '9789990812345'
  );
  assert.equal(normalizeIsbn('ISBN: 978 0 521 89801 0'), '9780521898010');
});

test('isValidIsbn accepts valid ISBN-13 and ISBN-10 and rejects invalid strings', () => {
  assert.equal(isValidIsbn('9780198390114'), true);
  assert.equal(isValidIsbn('014044913X'), true);
  assert.equal(isValidIsbn('978-99908-1-234-5'), true);
  assert.equal(isValidIsbn('12345'), false);
  assert.equal(isValidIsbn(''), false);
  assert.equal(isValidIsbn('ABCDEFGHIJ'), false);
});

test('matchCurriculumSubject maps raw subjects and titles onto Malawi secondary subjects', () => {
  assert.equal(
    matchCurriculumSubject(['Chemistry', 'Secondary Education'], 'Senior Physics & Chemistry', MALAWI_SUBJECTS),
    'Physical Science'
  );
  assert.equal(
    matchCurriculumSubject(['Life sciences'], 'Botany and Zoology Form 3', MALAWI_SUBJECTS),
    'Biology'
  );
  assert.equal(
    matchCurriculumSubject(['Agronomy'], 'Malawi Secondary Agriculture Book 2', MALAWI_SUBJECTS),
    'Agriculture'
  );
  assert.equal(
    matchCurriculumSubject(['Shakespearean Tragedy'], 'Macbeth Set Book Edition', MALAWI_SUBJECTS),
    'English'
  );
  assert.equal(
    matchCurriculumSubject(['Unknown Topic'], 'Unclassified Booklet', MALAWI_SUBJECTS),
    'English'
  );
  assert.equal(matchCurriculumSubject(['Unknown'], 'Untitled', []), 'General');
});

test('inferMaterialType classifies textbooks, set books, manuals, past papers, references, and novels', () => {
  assert.equal(inferMaterialType([], 'MSCE Past Papers Biology 2018-2024', ''), 'Past Papers');
  assert.equal(inferMaterialType(['Science'], 'Chemistry Laboratory Manual Form 4', ''), 'Science Manual');
  assert.equal(inferMaterialType([], 'Oxford Secondary School Dictionary', ''), 'Reference Book');
  assert.equal(inferMaterialType(['Literature'], 'The Pearl Set Book', ''), 'Set Book');
  assert.equal(inferMaterialType(['Fiction'], 'Things Fall Apart', 'African Writers Series novel'), 'Reader / Novel');
  assert.equal(inferMaterialType(['Mathematics'], 'Senior Secondary Mathematics Form 1', ''), 'Textbook');
});
