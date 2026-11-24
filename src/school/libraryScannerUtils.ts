import { LibraryBook, LibraryLoan, Student } from './types';

export type ScanCirculationMode = 'auto' | 'check_in' | 'check_out';

export type ResolvedLibraryScan =
  | {
      kind: 'loan_and_book';
      loan: LibraryLoan;
      book: LibraryBook | null;
      matchedVia: 'copy_code';
    }
  | {
      kind: 'book';
      book: LibraryBook;
      matchedVia: 'qr_json' | 'id' | 'isbn' | 'shelf_code' | 'title';
    }
  | {
      kind: 'student';
      student: Student;
      matchedVia: 'registration_code' | 'admission_no' | 'id';
    }
  | {
      kind: 'unmatched';
      raw: string;
    };

export function compactScanToken(val?: string): string {
  return String(val ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '');
}

export function buildBookQrPayload(schoolId: string, book: LibraryBook): string {
  return JSON.stringify({
    t: 'SECSCHOOLHUB_BOOK',
    s: schoolId,
    b: book.id,
    isbn: book.isbn,
  });
}

export function parseScannedQrToBook(
  rawValue: string,
  books: LibraryBook[]
): LibraryBook | null {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as {
      t?: string;
      b?: string;
      isbn?: string;
    };
    if (parsed && parsed.t === 'SECSCHOOLHUB_BOOK') {
      if (parsed.b) {
        const byId = books.find((bk) => bk.id === parsed.b);
        if (byId) return byId;
      }
      if (parsed.isbn) {
        const target = compactScanToken(parsed.isbn);
        const byIsbn = books.find((bk) => compactScanToken(bk.isbn) === target);
        if (byIsbn) return byIsbn;
      }
    }
  } catch {
    // Not JSON — fall through to plain-text ISBN / ID / shelf / title matching
  }

  const targetCompact = compactScanToken(trimmed);
  const lower = trimmed.toLowerCase();

  return (
    books.find((bk) => bk.id.toLowerCase() === lower) ||
    books.find((bk) => targetCompact.length > 0 && compactScanToken(bk.isbn) === targetCompact) ||
    books.find((bk) => bk.title.toLowerCase() === lower) ||
    books.find((bk) => bk.shelfCode && bk.shelfCode.toLowerCase() === lower) ||
    books.find(
      (bk) =>
        targetCompact.length >= 4 &&
        (compactScanToken(bk.isbn).includes(targetCompact) ||
          bk.title.toLowerCase().includes(lower))
    ) ||
    null
  );
}

export function findBookForLoan(loan: LibraryLoan, books: LibraryBook[]): LibraryBook | null {
  const titleKey = loan.bookTitle.trim().toLowerCase();
  const byTitle = books.find((b) => b.title.trim().toLowerCase() === titleKey);
  if (byTitle) return byTitle;

  const notesCompact = compactScanToken(loan.notes);
  if (notesCompact.length >= 6) {
    const byNoteIsbn = books.find((b) => {
      const isbnCompact = compactScanToken(b.isbn);
      return isbnCompact.length >= 6 && notesCompact.includes(isbnCompact);
    });
    if (byNoteIsbn) return byNoteIsbn;
  }

  const codeUpper = (loan.bookCode || '').trim().toUpperCase();
  if (codeUpper) {
    const byShelf = books.find((b) => {
      const shelf = (b.shelfCode || '').trim().toUpperCase();
      return shelf.length >= 3 && codeUpper.startsWith(shelf);
    });
    if (byShelf) return byShelf;
  }

  return null;
}

export function findActiveLoanByCopyBarcode(
  rawValue: string,
  loans: LibraryLoan[]
): LibraryLoan | null {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  const compact = compactScanToken(trimmed);

  // Check active loans first (exact bookCode match or compact code match)
  const activeLoans = loans.filter((l) => l.status === 'Checked Out');
  return (
    activeLoans.find((l) => (l.bookCode || '').trim().toUpperCase() === upper) ||
    activeLoans.find(
      (l) => compact.length >= 4 && compactScanToken(l.bookCode) === compact
    ) ||
    null
  );
}

export function findStudentByScannedCode(
  rawValue: string,
  students: Student[]
): { student: Student; matchedVia: 'registration_code' | 'admission_no' | 'id' } | null {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  const lower = trimmed.toLowerCase();

  // Check SecSchoolHub student JSON QR format if present
  try {
    const parsed = JSON.parse(trimmed) as {
      t?: string;
      studentId?: string;
      registrationCode?: string;
      admissionNo?: string;
    };
    if (parsed && (parsed.studentId || parsed.registrationCode || parsed.admissionNo)) {
      if (parsed.studentId) {
        const byId = students.find((s) => s.id === parsed.studentId);
        if (byId) return { student: byId, matchedVia: 'id' };
      }
      if (parsed.registrationCode) {
        const rc = parsed.registrationCode.trim().toUpperCase();
        const byRc = students.find((s) => (s.registrationCode || '').trim().toUpperCase() === rc);
        if (byRc) return { student: byRc, matchedVia: 'registration_code' };
      }
      if (parsed.admissionNo) {
        const adm = parsed.admissionNo.trim().toUpperCase();
        const byAdm = students.find((s) => (s.admissionNo || '').trim().toUpperCase() === adm);
        if (byAdm) return { student: byAdm, matchedVia: 'admission_no' };
      }
    }
  } catch {
    // Plain text code
  }

  const byReg = students.find(
    (s) => s.registrationCode && s.registrationCode.trim().toUpperCase() === upper
  );
  if (byReg) return { student: byReg, matchedVia: 'registration_code' };

  const byAdm = students.find(
    (s) => s.admissionNo && s.admissionNo.trim().toUpperCase() === upper
  );
  if (byAdm) return { student: byAdm, matchedVia: 'admission_no' };

  const byId = students.find((s) => s.id.toLowerCase() === lower);
  if (byId) return { student: byId, matchedVia: 'id' };

  return null;
}

export function resolveScannedBarcodeOrQr(
  rawValue: string,
  books: LibraryBook[],
  loans: LibraryLoan[],
  students: Student[] = []
): ResolvedLibraryScan {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return { kind: 'unmatched', raw: '' };
  }

  // 1. JSON QR payload for a book takes priority
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { t?: string };
      if (parsed && parsed.t === 'SECSCHOOLHUB_BOOK') {
        const qrBook = parseScannedQrToBook(trimmed, books);
        if (qrBook) {
          return { kind: 'book', book: qrBook, matchedVia: 'qr_json' };
        }
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  // 2. Exact copy barcode on an active Checked Out loan (e.g. LIB-BIO-001)
  const matchedLoan = findActiveLoanByCopyBarcode(trimmed, loans);
  if (matchedLoan) {
    return {
      kind: 'loan_and_book',
      loan: matchedLoan,
      book: findBookForLoan(matchedLoan, books),
      matchedVia: 'copy_code',
    };
  }

  // 3. Student ID / registration code / admission no scan
  const matchedStudent = findStudentByScannedCode(trimmed, students);
  if (matchedStudent) {
    return {
      kind: 'student',
      student: matchedStudent.student,
      matchedVia: matchedStudent.matchedVia,
    };
  }

  // 4. Book catalog match (ISBN-13 / ISBN-10 / EAN-13 / Shelf / Title / ID)
  const matchedBook = parseScannedQrToBook(trimmed, books);
  if (matchedBook) {
    const targetCompact = compactScanToken(trimmed);
    const lower = trimmed.toLowerCase();
    const matchedVia =
      matchedBook.id.toLowerCase() === lower
        ? 'id'
        : targetCompact.length > 0 && compactScanToken(matchedBook.isbn).includes(targetCompact)
        ? 'isbn'
        : matchedBook.shelfCode && matchedBook.shelfCode.toLowerCase() === lower
        ? 'shelf_code'
        : 'title';

    return {
      kind: 'book',
      book: matchedBook,
      matchedVia,
    };
  }

  return { kind: 'unmatched', raw: trimmed };
}

export function suggestCopyCodeForBook(
  book: LibraryBook,
  existingLoans: LibraryLoan[]
): string {
  const cleanCustom = (book.shelfCode || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+$/, '');
  const token =
    (book.subject || 'GEN')
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase()
      .slice(0, 3) || 'GEN';
  const prefix = cleanCustom ? `${cleanCustom}-` : `LIB-${token}-`;
  let maxNum = 0;
  for (const loan of existingLoans) {
    const code = (loan.bookCode || '').toUpperCase();
    if (code.startsWith(prefix)) {
      const tail = Number(code.slice(prefix.length));
      if (Number.isFinite(tail) && tail > maxNum) {
        maxNum = tail;
      }
    }
  }
  return `${prefix}${String(maxNum + 1).padStart(3, '0')}`;
}
