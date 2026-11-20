import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Upload,
  X,
} from 'lucide-react';
import {
  LibraryBook,
  LibraryMaterialCategory,
  School,
} from '../../school/types';
import { downloadCSV, LIBRARY_MATERIAL_CATEGORIES } from '../../school/malawi';
import {
  bulkImportLibraryBooks,
  LibraryBookImportResult,
  LibraryBookImportStrategy,
  LibraryBookPayload,
} from '../../school/firestoreService';

interface LibraryCsvImportModalProps {
  open: boolean;
  school: School;
  ownerId: string;
  libraryBooks: LibraryBook[];
  onClose: () => void;
}

interface ParsedCsvBookRow {
  rowNumber: number;
  payload: LibraryBookPayload;
  errors: string[];
  existingMatch: LibraryBook | null;
}

function normalizeHeaderKey(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeIsbnToken(val: string): string {
  return val
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '');
}

function normalizeMaterialType(raw: string): LibraryMaterialCategory {
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return 'Textbook';

  const exact = LIBRARY_MATERIAL_CATEGORIES.find((c) => c.toLowerCase() === cleaned);
  if (exact) return exact;

  if (cleaned.includes('set')) return 'Set Book';
  if (cleaned.includes('ref')) return 'Reference Book';
  if (cleaned.includes('past') || cleaned.includes('paper')) return 'Past Papers';
  if (cleaned.includes('novel') || cleaned.includes('reader') || cleaned.includes('fiction')) {
    return 'Reader / Novel';
  }
  if (cleaned.includes('manual') || cleaned.includes('lab') || cleaned.includes('practical')) {
    return 'Science Manual';
  }
  return 'Textbook';
}

function deriveShelfCode(subject: string, explicitShelf: string): string {
  const cleanExplicit = explicitShelf.trim().toUpperCase().slice(0, 40);
  if (cleanExplicit) return cleanExplicit;
  const tok =
    subject
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase()
      .slice(0, 3) || 'GEN';
  return `LIB-${tok}`;
}

export function parseCsvMatrix(text: string): string[][] {
  const normalized = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    const next = normalized[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentCell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentCell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if (ch === '\r' && next === '\n') {
      currentRow.push(currentCell.trim());
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      currentRow.push(currentCell.trim());
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += ch;
    }
  }

  currentRow.push(currentCell.trim());
  if (currentRow.some((cell) => cell.length > 0)) {
    rows.push(currentRow);
  }

  return rows;
}

const SAMPLE_TEMPLATE_ROWS: (string | number)[][] = [
  [
    '978-99908-87-12-4',
    'Excel & Succeed Biology Form 4',
    'M. Chibwana & P. Phiri',
    'Biology',
    'Textbook',
    'LIB-BIO',
    35,
    'MSCE syllabus edition',
  ],
  [
    '978-0-14-017737-4',
    'The Pearl',
    'John Steinbeck',
    'English',
    'Set Book',
    'LIB-ENG',
    28,
    'Literature Paper II set book',
  ],
  [
    '978-99908-45-33-2',
    'MSCE Mathematics Past Papers & Solutions',
    'Malawi Secondary Mathematics Panel',
    'Mathematics',
    'Past Papers',
    'LIB-MAT',
    20,
    'Forms 3 and 4 revision pack',
  ],
];

export const LibraryCsvImportModal: React.FC<LibraryCsvImportModalProps> = ({
  open,
  school,
  ownerId,
  libraryBooks,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [duplicateStrategy, setDuplicateStrategy] =
    useState<LibraryBookImportStrategy>('skip');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importResult, setImportResult] = useState<LibraryBookImportResult | null>(null);

  const existingMaps = useMemo(() => {
    const byIsbn = new Map<string, LibraryBook>();
    const byTitle = new Map<string, LibraryBook>();
    for (const book of libraryBooks) {
      const isbnKey = normalizeIsbnToken(book.isbn);
      if (isbnKey.length >= 3) byIsbn.set(isbnKey, book);
      const titleKey = book.title.trim().toLowerCase();
      if (titleKey) byTitle.set(titleKey, book);
    }
    return { byIsbn, byTitle };
  }, [libraryBooks]);

  const parsedPreview = useMemo(() => {
    if (!csvText.trim()) {
      return { rows: [] as ParsedCsvBookRow[], headerError: '' };
    }

    const matrix = parseCsvMatrix(csvText);
    if (matrix.length < 2) {
      return {
        rows: [] as ParsedCsvBookRow[],
        headerError:
          'CSV must contain a header row and at least one book row.',
      };
    }

    const headerCells = matrix[0].map(normalizeHeaderKey);
    const findCol = (aliases: string[]) =>
      headerCells.findIndex((h) => aliases.includes(h));

    const isbnIdx = findCol(['isbn', 'isbn13', 'isbn10', 'bookisbn']);
    const titleIdx = findCol(['title', 'booktitle', 'bookname', 'name', 'materialtitle']);
    const authorIdx = findCol(['author', 'authors', 'writer', 'authorname']);
    const subjectIdx = findCol(['subject', 'department', 'course']);
    const typeIdx = findCol(['materialtype', 'type', 'category', 'format']);
    const shelfIdx = findCol(['shelfcode', 'shelf', 'copyprefix', 'callnumber', 'code']);
    const copiesIdx = findCol(['totalcopies', 'copies', 'quantity', 'qty', 'stock']);
    const notesIdx = findCol(['notes', 'remarks', 'description', 'edition']);

    if (isbnIdx === -1 || titleIdx === -1 || authorIdx === -1) {
      return {
        rows: [] as ParsedCsvBookRow[],
        headerError:
          'Missing required CSV headers. Ensure the first row includes ISBN, Title, and Author columns.',
      };
    }

    const parsedRows: ParsedCsvBookRow[] = [];
    for (let i = 1; i < matrix.length; i += 1) {
      const rawRow = matrix[i];
      const getVal = (idx: number) => (idx >= 0 ? (rawRow[idx] || '').trim() : '');

      const rawIsbn = getVal(isbnIdx);
      const rawTitle = getVal(titleIdx);
      const rawAuthor = getVal(authorIdx);
      const rawSubject = getVal(subjectIdx) || 'General';
      const rawType = getVal(typeIdx);
      const rawShelf = getVal(shelfIdx);
      const rawCopies = getVal(copiesIdx);
      const rawNotes = getVal(notesIdx);

      const errors: string[] = [];
      if (rawIsbn.length < 3) errors.push('ISBN min 3 chars');
      if (rawIsbn.length > 32) errors.push('ISBN max 32 chars');
      if (rawTitle.length < 2) errors.push('Title min 2 chars');
      if (rawAuthor.length < 2) errors.push('Author min 2 chars');

      let parsedCopies = 1;
      if (rawCopies) {
        const n = Number(rawCopies);
        if (!Number.isFinite(n) || n < 1) {
          errors.push('Copies must be >= 1');
        } else {
          parsedCopies = Math.min(500, Math.max(1, Math.round(n)));
        }
      }

      const cleanSubject = rawSubject.slice(0, 60) || 'General';
      const payload: LibraryBookPayload = {
        isbn: rawIsbn.slice(0, 32),
        title: rawTitle.slice(0, 140),
        author: rawAuthor.slice(0, 120),
        subject: cleanSubject,
        materialType: normalizeMaterialType(rawType),
        shelfCode: deriveShelfCode(cleanSubject, rawShelf),
        totalCopies: parsedCopies,
        notes: rawNotes.slice(0, 240),
      };

      const isbnKey = normalizeIsbnToken(payload.isbn);
      const titleKey = payload.title.trim().toLowerCase();
      const existingMatch =
        (isbnKey.length >= 3 ? existingMaps.byIsbn.get(isbnKey) : undefined) ||
        existingMaps.byTitle.get(titleKey) ||
        null;

      parsedRows.push({
        rowNumber: i + 1,
        payload,
        errors,
        existingMatch,
      });
    }

    return { rows: parsedRows, headerError: '' };
  }, [csvText, existingMaps]);

  const summary = useMemo(() => {
    let validNew = 0;
    let validExisting = 0;
    let invalid = 0;
    const validPayloads: LibraryBookPayload[] = [];

    for (const r of parsedPreview.rows) {
      if (r.errors.length > 0) {
        invalid += 1;
      } else {
        validPayloads.push(r.payload);
        if (r.existingMatch) {
          validExisting += 1;
        } else {
          validNew += 1;
        }
      }
    }

    const actionableCount =
      duplicateStrategy === 'skip' ? validNew : validNew + validExisting;

    return {
      total: parsedPreview.rows.length,
      validNew,
      validExisting,
      invalid,
      actionableCount,
      validPayloads,
    };
  }, [duplicateStrategy, parsedPreview.rows]);

  if (!open) return null;

  const handleDownloadTemplate = () => {
    downloadCSV(
      'SecSchoolHub_Library_Inventory_Template.csv',
      ['ISBN', 'Title', 'Author', 'Subject', 'Material Type', 'Shelf Code', 'Total Copies', 'Notes'],
      SAMPLE_TEMPLATE_ROWS
    );
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    setImportResult(null);
    setFileName(file.name);
    try {
      const content = await file.text();
      setCsvText(content);
    } catch {
      setImportError('Unable to read the selected CSV file.');
    }
    e.target.value = '';
  };

  const handleReset = () => {
    setCsvText('');
    setFileName('');
    setImportError('');
    setImportResult(null);
  };

  const handleConfirmImport = async () => {
    if (summary.actionableCount === 0 || importing) return;
    setImporting(true);
    setImportError('');
    try {
      const result = await bulkImportLibraryBooks(
        school.id,
        ownerId,
        summary.validPayloads,
        libraryBooks,
        duplicateStrategy
      );
      setImportResult(result);
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : 'Unable to import books from CSV.'
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="library-csv-import-title"
    >
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
              <FileSpreadsheet className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="library-csv-import-title"
                className="text-base font-semibold text-slate-900 dark:text-white"
              >
                Bulk Import Books from CSV
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Upload a spreadsheet of textbooks, set books, or past papers into {school.name}.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            aria-label="Close CSV import dialog"
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Upload & Template Controls */}
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/50 p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
              <div className="font-semibold text-slate-900 dark:text-white">
                {fileName ? `Loaded file: ${fileName}` : 'Select a .csv file or paste CSV rows'}
              </div>
              <p className="text-slate-500 dark:text-slate-400">
                Required columns: <span className="font-mono">ISBN, Title, Author</span> · Optional:{' '}
                <span className="font-mono">
                  Subject, Material Type, Shelf Code, Total Copies, Notes
                </span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#161B22] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Sample CSV</span>
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,.txt"
                onChange={handleFileSelected}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="inline-flex items-center gap-1.5 min-h-[36px] px-3.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
              >
                <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{csvText ? 'Choose Another File' : 'Upload CSV File'}</span>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => setShowPasteBox((v) => !v)}
              className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
            >
              {showPasteBox ? 'Hide paste CSV box' : 'Or paste CSV text directly'}
            </button>

            {csvText && (
              <button
                type="button"
                onClick={handleReset}
                className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>

          {showPasteBox && (
            <textarea
              rows={5}
              value={csvText}
              onChange={(e) => {
                setFileName('');
                setImportResult(null);
                setImportError('');
                setCsvText(e.target.value);
              }}
              placeholder={
                'ISBN,Title,Author,Subject,Material Type,Shelf Code,Total Copies,Notes\n978-0-14-017737-4,The Pearl,John Steinbeck,English,Set Book,LIB-ENG,30,Form 4 literature'
              }
              className="w-full rounded-xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-700 p-3 font-mono text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
            />
          )}
        </div>

        {/* Errors or Import Result */}
        {parsedPreview.headerError && (
          <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{parsedPreview.headerError}</span>
          </div>
        )}

        {importError && (
          <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{importError}</span>
          </div>
        )}

        {importResult && (
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 px-4 py-3 text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
            <span className="font-medium font-mono tabular-nums">
              Import complete: {importResult.created} added · {importResult.updated} updated ·{' '}
              {importResult.skipped} skipped.
            </span>
          </div>
        )}

        {/* Duplicate Policy & Parsed Preview */}
        {parsedPreview.rows.length > 0 && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                  {summary.validNew} new
                </span>{' '}
                ·{' '}
                <span className="font-semibold text-amber-700 dark:text-amber-400">
                  {summary.validExisting} existing
                </span>{' '}
                ·{' '}
                <span
                  className={
                    summary.invalid > 0
                      ? 'font-semibold text-rose-600 dark:text-rose-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }
                >
                  {summary.invalid} invalid
                </span>
              </div>

              <div className="flex items-center gap-2">
                <label
                  htmlFor="csv-dup-strategy"
                  className="text-xs font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap"
                >
                  Existing books:
                </label>
                <select
                  id="csv-dup-strategy"
                  value={duplicateStrategy}
                  onChange={(e) =>
                    setDuplicateStrategy(e.target.value as LibraryBookImportStrategy)
                  }
                  disabled={importing}
                  className="min-h-[36px] px-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100"
                >
                  <option value="skip">Skip existing titles</option>
                  <option value="add_copies">Add copies to existing stock</option>
                  <option value="update">Overwrite existing details</option>
                </select>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="py-2 px-3 font-medium">Row</th>
                    <th className="py-2 px-3 font-medium">Title &amp; Author</th>
                    <th className="py-2 px-3 font-medium">ISBN &amp; Shelf</th>
                    <th className="py-2 px-3 font-medium">Copies</th>
                    <th className="py-2 px-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {parsedPreview.rows.map((row) => {
                    const isInvalid = row.errors.length > 0;
                    const isExisting = !isInvalid && Boolean(row.existingMatch);

                    return (
                      <tr key={row.rowNumber} className="align-top">
                        <td className="py-2 px-3 font-mono tabular-nums text-slate-400">
                          #{row.rowNumber}
                        </td>
                        <td className="py-2 px-3">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {row.payload.title || '—'}
                          </div>
                          <div className="text-slate-500 dark:text-slate-400">
                            {row.payload.author || '—'} · {row.payload.subject} ({row.payload.materialType})
                          </div>
                        </td>
                        <td className="py-2 px-3 font-mono tabular-nums whitespace-nowrap">
                          <div className="text-slate-800 dark:text-slate-200">
                            {row.payload.isbn || '—'}
                          </div>
                          <div className="text-slate-500 dark:text-slate-400">
                            {row.payload.shelfCode}
                          </div>
                        </td>
                        <td className="py-2 px-3 font-mono tabular-nums text-slate-800 dark:text-slate-200">
                          {row.payload.totalCopies}
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          {isInvalid ? (
                            <span className="font-semibold text-rose-600 dark:text-rose-400">
                              Invalid: {row.errors.join(', ')}
                            </span>
                          ) : isExisting ? (
                            <span className="font-semibold text-amber-700 dark:text-amber-400">
                              {duplicateStrategy === 'skip'
                                ? 'Existing (Will Skip)'
                                : duplicateStrategy === 'add_copies'
                                ? `Existing (+${row.payload.totalCopies} copies)`
                                : 'Existing (Will Update)'}
                            </span>
                          ) : (
                            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                              Ready (New)
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Modal Footer */}
        <div className="pt-2 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            className="min-h-[40px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            {importResult ? 'Done' : 'Cancel'}
          </button>

          {!importResult && (
            <button
              type="button"
              onClick={handleConfirmImport}
              disabled={importing || summary.actionableCount === 0}
              className="min-h-[40px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-40 cursor-pointer whitespace-nowrap"
            >
              {importing
                ? 'Importing Books...'
                : `Import ${summary.actionableCount} ${
                    summary.actionableCount === 1 ? 'Book' : 'Books'
                  }`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
