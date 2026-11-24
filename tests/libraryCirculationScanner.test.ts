import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBookQrPayload,
  findActiveLoanByCopyBarcode,
  findStudentByScannedCode,
  parseScannedQrToBook,
  resolveScannedBarcodeOrQr,
  suggestCopyCodeForBook,
} from '../src/school/libraryScannerUtils';
import type { LibraryBook, LibraryLoan, Student } from '../src/school/types';

const SAMPLE_BOOKS: LibraryBook[] = [
  {
    id: 'book-bio-1',
    ownerId: 'owner-1',
    title: 'Senior Secondary Biology Form 3',
    isbn: '978-0-19-839011-4',
    author: 'E. Banda',
    materialType: 'Textbook',
    subject: 'Biology',
    shelfCode: 'LIB-BIO',
    totalCopies: 15,
    notes: '',
  },
  {
    id: 'book-eng-1',
    ownerId: 'owner-1',
    title: 'The Pearl',
    isbn: '9780140177374',
    author: 'John Steinbeck',
    materialType: 'Set Book',
    subject: 'English',
    shelfCode: 'LIB-ENG',
    totalCopies: 20,
    notes: '',
  },
];

const SAMPLE_STUDENTS: Student[] = [
  {
    id: 'stu-101',
    ownerId: 'owner-1',
    fullName: 'Chisomo Phiri',
    admissionNo: 'ADM-2025-014',
    registrationCode: 'REG-F3A-014',
    formLevel: 3,
    stream: 'A',
    gender: 'Female',
    boardingStatus: 'Day Scholar',
    guardianName: 'Grace Phiri',
    guardianPhone: '+265999111222',
    status: 'Active',
  },
  {
    id: 'stu-102',
    ownerId: 'owner-1',
    fullName: 'Kondwani Mwale',
    admissionNo: 'ADM-2025-088',
    registrationCode: 'REG-F4B-088',
    formLevel: 4,
    stream: 'B',
    gender: 'Male',
    boardingStatus: 'Boarder',
    guardianName: 'Peter Mwale',
    guardianPhone: '+265888333444',
    status: 'Active',
  },
];

const SAMPLE_LOANS: LibraryLoan[] = [
  {
    id: 'loan-returned-1',
    ownerId: 'owner-1',
    studentId: 'stu-102',
    studentName: 'Kondwani Mwale',
    admissionNo: 'ADM-2025-088',
    formLevel: 4,
    stream: 'B',
    bookTitle: 'Senior Secondary Biology Form 3',
    materialType: 'Textbook',
    subject: 'Biology',
    bookCode: 'LIB-BIO-001',
    quantity: 1,
    checkoutDate: '2026-02-01',
    dueDate: '2026-02-15',
    returnedDate: '2026-02-14',
    status: 'Returned',
    conditionOnReturn: 'Good',
    notes: '',
  },
  {
    id: 'loan-active-2',
    ownerId: 'owner-1',
    studentId: 'stu-101',
    studentName: 'Chisomo Phiri',
    admissionNo: 'ADM-2025-014',
    formLevel: 3,
    stream: 'A',
    bookTitle: 'Senior Secondary Biology Form 3',
    materialType: 'Textbook',
    subject: 'Biology',
    bookCode: 'LIB-BIO-002',
    quantity: 1,
    checkoutDate: '2026-03-01',
    dueDate: '2026-03-15',
    returnedDate: '',
    status: 'Checked Out',
    conditionOnReturn: 'Good',
    notes: '',
  },
];

test('parseScannedQrToBook resolves SecSchoolHub JSON QR payloads and ISBN barcodes', () => {
  const payload = buildBookQrPayload('school-1', SAMPLE_BOOKS[0]);
  const fromJson = parseScannedQrToBook(payload, SAMPLE_BOOKS);
  assert.equal(fromJson?.id, 'book-bio-1');

  // Compact ISBN barcode without hyphens should still match hyphenated catalog ISBN
  const fromIsbn = parseScannedQrToBook('9780198390114', SAMPLE_BOOKS);
  assert.equal(fromIsbn?.id, 'book-bio-1');

  // Shelf code lookup
  const fromShelf = parseScannedQrToBook('lib-eng', SAMPLE_BOOKS);
  assert.equal(fromShelf?.id, 'book-eng-1');

  // Unknown string returns null
  assert.equal(parseScannedQrToBook('NON-EXISTENT-CODE', SAMPLE_BOOKS), null);
});

test('findActiveLoanByCopyBarcode matches active Checked Out loans and ignores returned loans', () => {
  // Returned copy code should not match as an active check-in target
  assert.equal(findActiveLoanByCopyBarcode('LIB-BIO-001', SAMPLE_LOANS), null);

  // Active loan matches case-insensitively and even without hyphens
  const active = findActiveLoanByCopyBarcode('lib-bio-002', SAMPLE_LOANS);
  assert.equal(active?.id, 'loan-active-2');

  const compactMatch = findActiveLoanByCopyBarcode('LIBBIO002', SAMPLE_LOANS);
  assert.equal(compactMatch?.id, 'loan-active-2');
});

test('findStudentByScannedCode matches registrationCode, admissionNo, ID, and student JSON QR', () => {
  const byReg = findStudentByScannedCode('reg-f3a-014', SAMPLE_STUDENTS);
  assert.equal(byReg?.student.id, 'stu-101');
  assert.equal(byReg?.matchedVia, 'registration_code');

  const byAdm = findStudentByScannedCode('ADM-2025-088', SAMPLE_STUDENTS);
  assert.equal(byAdm?.student.id, 'stu-102');
  assert.equal(byAdm?.matchedVia, 'admission_no');

  const byJson = findStudentByScannedCode(
    JSON.stringify({ t: 'SECSCHOOLHUB_STUDENT', registrationCode: 'REG-F4B-088' }),
    SAMPLE_STUDENTS
  );
  assert.equal(byJson?.student.id, 'stu-102');
  assert.equal(byJson?.matchedVia, 'registration_code');
});

test('resolveScannedBarcodeOrQr prioritizes QR book payloads, copy barcodes, student codes, then ISBNs', () => {
  const qrPayload = buildBookQrPayload('school-1', SAMPLE_BOOKS[1]);
  const qrResult = resolveScannedBarcodeOrQr(qrPayload, SAMPLE_BOOKS, SAMPLE_LOANS, SAMPLE_STUDENTS);
  assert.equal(qrResult.kind, 'book');
  if (qrResult.kind === 'book') {
    assert.equal(qrResult.book.id, 'book-eng-1');
    assert.equal(qrResult.matchedVia, 'qr_json');
  }

  const copyResult = resolveScannedBarcodeOrQr(
    'LIB-BIO-002',
    SAMPLE_BOOKS,
    SAMPLE_LOANS,
    SAMPLE_STUDENTS
  );
  assert.equal(copyResult.kind, 'loan_and_book');
  if (copyResult.kind === 'loan_and_book') {
    assert.equal(copyResult.loan.id, 'loan-active-2');
    assert.equal(copyResult.book?.id, 'book-bio-1');
    assert.equal(copyResult.matchedVia, 'copy_code');
  }

  const studentResult = resolveScannedBarcodeOrQr(
    'REG-F3A-014',
    SAMPLE_BOOKS,
    SAMPLE_LOANS,
    SAMPLE_STUDENTS
  );
  assert.equal(studentResult.kind, 'student');
  if (studentResult.kind === 'student') {
    assert.equal(studentResult.student.fullName, 'Chisomo Phiri');
  }

  const isbnResult = resolveScannedBarcodeOrQr(
    '9780140177374',
    SAMPLE_BOOKS,
    SAMPLE_LOANS,
    SAMPLE_STUDENTS
  );
  assert.equal(isbnResult.kind, 'book');
  if (isbnResult.kind === 'book') {
    assert.equal(isbnResult.book.id, 'book-eng-1');
    assert.equal(isbnResult.matchedVia, 'isbn');
  }

  const unmatched = resolveScannedBarcodeOrQr(
    '9789990811111',
    SAMPLE_BOOKS,
    SAMPLE_LOANS,
    SAMPLE_STUDENTS
  );
  assert.equal(unmatched.kind, 'unmatched');
});

test('suggestCopyCodeForBook increments copy numbers from existing loans', () => {
  assert.equal(suggestCopyCodeForBook(SAMPLE_BOOKS[0], SAMPLE_LOANS), 'LIB-BIO-003');
  assert.equal(suggestCopyCodeForBook(SAMPLE_BOOKS[1], SAMPLE_LOANS), 'LIB-ENG-001');
});
