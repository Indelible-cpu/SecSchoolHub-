import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react';
import {
  BoardingStatus,
  FormLevel,
  Gender,
  School,
  Student,
  StudentStatus,
} from '../../school/types';
import {
  downloadCSV,
  FORM_LEVELS,
  STREAMS,
  STUDENT_STATUSES,
} from '../../school/malawi';
import {
  bulkImportStudents,
  StudentImportResult,
  StudentImportRowInput,
  StudentImportStrategy,
} from '../../school/firestoreService';
import {
  autoDetectStudentFieldMapping,
  buildStudentImportPreview,
  createEmptyStudentMapping,
  parseCsvMatrix,
  STUDENT_CSV_SAMPLE_HEADERS,
  STUDENT_CSV_SAMPLE_ROWS,
  STUDENT_SCHEMA_FIELDS,
  StudentCsvImportDefaults,
  StudentFieldMapping,
  StudentSchemaFieldKey,
} from '../../school/studentCsvImport';
import {
  buildModalDraftKey,
  clearModalDraft,
  loadModalDraft,
  saveModalDraft,
} from '../../school/modalDrafts';
import { DraftRestoredNotice, ModalBackdrop } from './ModalBackdrop';

interface StudentCsvImportModalProps {
  open: boolean;
  school: School;
  ownerId: string;
  students: Student[];
  onClose: () => void;
}

const DEFAULT_IMPORT_SETTINGS: StudentCsvImportDefaults = {
  formLevel: 1,
  stream: 'A',
  gender: 'Female',
  boardingStatus: 'Day Scholar',
  status: 'Active',
  autoGenerateAdmissionNo: false,
};

const CORE_MAPPING_KEYS = new Set<StudentSchemaFieldKey>([
  'admissionNo',
  'fullName',
  'gender',
  'formLevel',
  'stream',
  'boardingStatus',
  'guardianName',
  'guardianPhone',
]);

export const StudentCsvImportModal: React.FC<StudentCsvImportModalProps> = ({
  open,
  school,
  ownerId,
  students,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draftKey = useMemo(
    () => buildModalDraftKey(school.id, 'student_csv_import', 'new'),
    [school.id]
  );

  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [mapping, setMapping] = useState<StudentFieldMapping>(() => createEmptyStudentMapping());
  const [defaults, setDefaults] = useState<StudentCsvImportDefaults>(DEFAULT_IMPORT_SETTINGS);
  const [showAllSchemaFields, setShowAllSchemaFields] = useState(false);
  const [duplicateStrategy, setDuplicateStrategy] = useState<StudentImportStrategy>('skip');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [importError, setImportError] = useState('');
  const [importResult, setImportResult] = useState<StudentImportResult | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);

  const csvMatrix = useMemo(() => {
    if (!csvText.trim()) return [] as string[][];
    return parseCsvMatrix(csvText);
  }, [csvText]);

  const csvHeaders = useMemo(() => (csvMatrix.length > 0 ? csvMatrix[0] : []), [csvMatrix]);
  const firstDataRow = useMemo(() => (csvMatrix.length > 1 ? csvMatrix[1] : []), [csvMatrix]);

  const applyCsvSource = (nextText: string, nextFileName: string) => {
    setCsvText(nextText);
    setFileName(nextFileName);
    setImportError('');
    setImportResult(null);

    const matrix = nextText.trim() ? parseCsvMatrix(nextText) : [];
    if (matrix.length > 0) {
      const detected = autoDetectStudentFieldMapping(matrix[0]);
      setMapping(detected.mapping);
      setDefaults((prev) => ({
        ...prev,
        autoGenerateAdmissionNo: detected.autoGenerateAdmissionNo,
      }));
    } else {
      setMapping(createEmptyStudentMapping());
    }
  };

  useEffect(() => {
    if (!open) return;
    const saved = loadModalDraft<{
      csvText?: string;
      fileName?: string;
      showPasteBox?: boolean;
      mapping?: StudentFieldMapping;
      defaults?: StudentCsvImportDefaults;
      duplicateStrategy?: StudentImportStrategy;
    }>(draftKey);
    if (saved && saved.csvText && !csvText) {
      setCsvText(saved.csvText);
      setFileName(saved.fileName || '');
      setShowPasteBox(Boolean(saved.showPasteBox));
      if (saved.mapping) {
        setMapping({ ...createEmptyStudentMapping(), ...saved.mapping });
      }
      if (saved.defaults) {
        setDefaults({ ...DEFAULT_IMPORT_SETTINGS, ...saved.defaults });
      }
      if (saved.duplicateStrategy) {
        setDuplicateStrategy(saved.duplicateStrategy);
      }
      setDraftRestored(true);
    }
  }, [csvText, draftKey, open]);

  useEffect(() => {
    if (!open || importResult) return;
    if (csvText.trim()) {
      saveModalDraft(draftKey, {
        csvText,
        fileName,
        showPasteBox,
        mapping,
        defaults,
        duplicateStrategy,
      });
    }
  }, [csvText, defaults, draftKey, duplicateStrategy, fileName, importResult, mapping, open, showPasteBox]);

  const discardDraft = () => {
    clearModalDraft(draftKey);
    setCsvText('');
    setFileName('');
    setMapping(createEmptyStudentMapping());
    setDefaults(DEFAULT_IMPORT_SETTINGS);
    setImportError('');
    setImportResult(null);
    setDraftRestored(false);
  };

  const parsedPreview = useMemo(() => {
    if (!csvText.trim()) {
      return { rows: [], mappingError: '' };
    }
    return buildStudentImportPreview({
      matrix: csvMatrix,
      mapping,
      defaults,
      existingStudents: students,
      school,
    });
  }, [csvMatrix, csvText, defaults, mapping, school, students]);

  const summary = useMemo(() => {
    let validNew = 0;
    let validExisting = 0;
    let invalid = 0;
    const actionableRows: StudentImportRowInput[] = [];

    for (const r of parsedPreview.rows) {
      if (r.errors.length > 0) {
        invalid += 1;
      } else {
        if (r.existingMatch) {
          validExisting += 1;
          if (duplicateStrategy === 'update') {
            actionableRows.push({
              rowNumber: r.rowNumber,
              payload: r.payload,
              mappedKeys: r.mappedKeys,
            });
          }
        } else {
          validNew += 1;
          actionableRows.push({
            rowNumber: r.rowNumber,
            payload: r.payload,
            mappedKeys: r.mappedKeys,
          });
        }
      }
    }

    return {
      total: parsedPreview.rows.length,
      validNew,
      validExisting,
      invalid,
      actionableCount: actionableRows.length,
      actionableRows,
    };
  }, [duplicateStrategy, parsedPreview.rows]);

  const visibleSchemaFields = useMemo(() => {
    if (showAllSchemaFields) return STUDENT_SCHEMA_FIELDS;
    return STUDENT_SCHEMA_FIELDS.filter(
      (field) => CORE_MAPPING_KEYS.has(field.key) || mapping[field.key] >= 0
    );
  }, [mapping, showAllSchemaFields]);

  const mappedCount = useMemo(
    () =>
      STUDENT_SCHEMA_FIELDS.filter(
        (f) => mapping[f.key] >= 0 || (f.key === 'admissionNo' && defaults.autoGenerateAdmissionNo)
      ).length,
    [defaults.autoGenerateAdmissionNo, mapping]
  );

  if (!open) return null;

  const handleDownloadTemplate = () => {
    downloadCSV(
      'SecSchoolHub_Students_Import_Template.csv',
      STUDENT_CSV_SAMPLE_HEADERS,
      STUDENT_CSV_SAMPLE_ROWS
    );
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      applyCsvSource(content, file.name);
    } catch {
      setImportError('Unable to read the selected CSV file.');
    }
    e.target.value = '';
  };

  const handleAutoDetectMapping = () => {
    if (csvHeaders.length === 0) return;
    const detected = autoDetectStudentFieldMapping(csvHeaders);
    setMapping(detected.mapping);
    setDefaults((prev) => ({
      ...prev,
      autoGenerateAdmissionNo: detected.autoGenerateAdmissionNo,
    }));
  };

  const handleMappingChange = (key: StudentSchemaFieldKey, rawValue: string) => {
    setImportResult(null);
    setImportError('');
    if (key === 'admissionNo' && rawValue === '__AUTO__') {
      setMapping((prev) => ({ ...prev, admissionNo: -1 }));
      setDefaults((prev) => ({ ...prev, autoGenerateAdmissionNo: true }));
      return;
    }

    const colIdx = Number(rawValue);
    if (key === 'admissionNo') {
      setDefaults((prev) => ({ ...prev, autoGenerateAdmissionNo: false }));
    }
    setMapping((prev) => ({
      ...prev,
      [key]: Number.isFinite(colIdx) ? colIdx : -1,
    }));
  };

  const handleConfirmImport = async () => {
    if (summary.actionableCount === 0 || importing) return;
    setImporting(true);
    setImportError('');
    setImportProgress({ done: 0, total: summary.actionableCount });
    try {
      const result = await bulkImportStudents(
        school,
        ownerId,
        summary.actionableRows,
        students,
        duplicateStrategy,
        (done, total) => setImportProgress({ done, total })
      );
      setImportResult(result);
      if (result.failed.length === 0) {
        clearModalDraft(draftKey);
        setDraftRestored(false);
      } else if (result.created === 0 && result.updated === 0) {
        setImportError(result.failed[0].reason);
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Unable to import students from CSV.');
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  return (
    <ModalBackdrop
      open={open}
      onClose={onClose}
      disabled={importing}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4"
      ariaLabelledBy="student-csv-import-title"
    >
      <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-start gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
              <FileSpreadsheet className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="student-csv-import-title"
                className="text-base font-semibold text-slate-900 dark:text-white"
              >
                Import Students from CSV
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Upload a roster CSV, map columns to the student schema, and verify records before saving.
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

        <DraftRestoredNotice visible={draftRestored && !importResult} onDiscard={discardDraft} />

        {/* Step 1: CSV File / Paste / Sample Template */}
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/50 p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
              <div className="font-semibold text-slate-900 dark:text-white">
                {fileName
                  ? `Loaded file: ${fileName}`
                  : csvHeaders.length > 0
                  ? `Loaded CSV text (${csvHeaders.length} columns · ${Math.max(0, csvMatrix.length - 1)} rows)`
                  : '1. Select a .csv file or paste CSV rows'}
              </div>
              <p className="text-slate-500 dark:text-slate-400">
                Required fields: <span className="font-mono">Admission No, Full Name, Guardian Name</span>{' '}
                · Any column order supported via field mapping below.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#161B22] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
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
                className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
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
                onClick={discardDraft}
                disabled={importing}
                className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
              >
                Clear CSV
              </button>
            )}
          </div>

          {showPasteBox && (
            <textarea
              rows={5}
              value={csvText}
              onChange={(e) => applyCsvSource(e.target.value, '')}
              placeholder={
                'Admission No,Full Name,Gender,Form,Stream,Boarding,Guardian,Primary Phone\nSCH/2026/001,Chimwemwe Banda,Female,Form 1,A,Day Scholar,Mary Banda,+265999112233'
              }
              className="w-full rounded-xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-700 p-3 font-mono text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
            />
          )}
        </div>

        {/* Step 2: Interactive Schema Field Mapping */}
        {csvHeaders.length > 0 && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#161B22] p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  2. Map CSV Columns to Student Record Schema
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
                  {mappedCount} of {STUDENT_SCHEMA_FIELDS.length} schema fields mapped ·{' '}
                  {csvHeaders.length} CSV columns detected
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleAutoDetectMapping}
                  disabled={importing}
                  className="inline-flex items-center gap-1.5 min-h-[34px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Auto-Match Columns</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowAllSchemaFields((v) => !v)}
                  className="inline-flex items-center gap-1.5 min-h-[34px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {showAllSchemaFields ? (
                    <>
                      <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Compact Fields</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>All Schema Fields ({STUDENT_SCHEMA_FIELDS.length})</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {visibleSchemaFields.map((field) => {
                const selectedValue =
                  field.key === 'admissionNo' && defaults.autoGenerateAdmissionNo
                    ? '__AUTO__'
                    : String(mapping[field.key]);

                const mappedSample =
                  mapping[field.key] >= 0 ? (firstDataRow[mapping[field.key]] || '').trim() : '';

                return (
                  <div
                    key={field.key}
                    className="flex flex-col justify-between gap-1.5 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 px-3 py-2.5"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <label
                        htmlFor={`map-${field.key}`}
                        className="text-xs font-semibold text-slate-800 dark:text-slate-200"
                      >
                        {field.label}
                        {field.required && (
                          <span className="text-rose-600 dark:text-rose-400 ml-0.5">*</span>
                        )}
                      </label>
                      <span className="text-[11px] text-slate-400 truncate max-w-[190px]">
                        {field.group}
                      </span>
                    </div>

                    <select
                      id={`map-${field.key}`}
                      value={selectedValue}
                      disabled={importing}
                      onChange={(e) => handleMappingChange(field.key, e.target.value)}
                      className="w-full min-h-[36px] px-2.5 rounded-lg bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                    >
                      {field.key === 'admissionNo' ? (
                        <>
                          <option value="-1">-- Select CSV column --</option>
                          <option value="__AUTO__">
                            -- Auto-generate Admission No (SCH/Year/###) --
                          </option>
                        </>
                      ) : field.key === 'registrationCode' ? (
                        <option value="-1">-- Auto-generate unique portal code --</option>
                      ) : (
                        <option value="-1">
                          {field.required
                            ? '-- Select CSV column (required) --'
                            : '-- Not mapped (use default) --'}
                        </option>
                      )}
                      {csvHeaders.map((header, idx) => {
                        const previewVal = (firstDataRow[idx] || '').trim();
                        const truncatedPreview =
                          previewVal.length > 24 ? `${previewVal.slice(0, 24)}…` : previewVal;
                        return (
                          <option key={`${idx}-${header}`} value={String(idx)}>
                            {header || `Column ${idx + 1}`}
                            {truncatedPreview ? ` (e.g. "${truncatedPreview}")` : ''}
                          </option>
                        );
                      })}
                    </select>

                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {mappedSample
                        ? `First row: ${mappedSample}`
                        : field.key === 'admissionNo' && defaults.autoGenerateAdmissionNo
                        ? 'Will auto-assign SCH/Year/### sequentially'
                        : field.hint}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Defaults for unmapped or blank optional columns */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
              <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Fallback values for unmapped or blank cells
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                <div>
                  <label
                    htmlFor="default-form"
                    className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1"
                  >
                    Form Level
                  </label>
                  <select
                    id="default-form"
                    value={defaults.formLevel}
                    disabled={importing}
                    onChange={(e) =>
                      setDefaults((prev) => ({
                        ...prev,
                        formLevel: Number(e.target.value) as FormLevel,
                      }))
                    }
                    className="w-full min-h-[36px] px-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                  >
                    {FORM_LEVELS.map((f) => (
                      <option key={f} value={f}>
                        Form {f}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="default-stream"
                    className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1"
                  >
                    Stream
                  </label>
                  <select
                    id="default-stream"
                    value={defaults.stream}
                    disabled={importing}
                    onChange={(e) =>
                      setDefaults((prev) => ({ ...prev, stream: e.target.value }))
                    }
                    className="w-full min-h-[36px] px-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                  >
                    {STREAMS.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="default-gender"
                    className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1"
                  >
                    Gender
                  </label>
                  <select
                    id="default-gender"
                    value={defaults.gender}
                    disabled={importing}
                    onChange={(e) =>
                      setDefaults((prev) => ({ ...prev, gender: e.target.value as Gender }))
                    }
                    className="w-full min-h-[36px] px-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                  >
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="default-boarding"
                    className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1"
                  >
                    Boarding
                  </label>
                  <select
                    id="default-boarding"
                    value={defaults.boardingStatus}
                    disabled={importing}
                    onChange={(e) =>
                      setDefaults((prev) => ({
                        ...prev,
                        boardingStatus: e.target.value as BoardingStatus,
                      }))
                    }
                    className="w-full min-h-[36px] px-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                  >
                    <option value="Day Scholar">Day Scholar</option>
                    <option value="Boarder">Boarder</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="default-status"
                    className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1"
                  >
                    Status
                  </label>
                  <select
                    id="default-status"
                    value={defaults.status}
                    disabled={importing}
                    onChange={(e) =>
                      setDefaults((prev) => ({
                        ...prev,
                        status: e.target.value as StudentStatus,
                      }))
                    }
                    className="w-full min-h-[36px] px-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                  >
                    {STUDENT_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Validation / Mapping / Import Errors */}
        {parsedPreview.mappingError && (
          <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{parsedPreview.mappingError}</span>
          </div>
        )}

        {importError && (
          <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{importError}</span>
          </div>
        )}

        {importResult && (
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 px-4 py-3 text-xs text-emerald-900 dark:text-emerald-200 space-y-1.5">
            <div className="flex items-center gap-2.5">
              <CheckCircle2
                className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0"
                aria-hidden="true"
              />
              <span className="font-medium font-mono tabular-nums">
                Import complete: {importResult.created} added · {importResult.updated} updated ·{' '}
                {importResult.skipped} skipped
                {importResult.failed.length > 0 ? ` · ${importResult.failed.length} failed` : ''}.
              </span>
            </div>
            {importResult.failed.length > 0 && (
              <ul className="pl-6 list-disc text-rose-700 dark:text-rose-300 space-y-0.5">
                {importResult.failed.slice(0, 5).map((f) => (
                  <li key={`${f.rowNumber}-${f.admissionNo}`}>
                    Row #{f.rowNumber} ({f.fullName || f.admissionNo}): {f.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Step 3: Duplicate Policy & Parsed Preview */}
        {parsedPreview.rows.length > 0 && (
          <div className="space-y-3">
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
                  htmlFor="student-csv-dup-strategy"
                  className="text-xs font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap"
                >
                  Existing admission numbers:
                </label>
                <select
                  id="student-csv-dup-strategy"
                  value={duplicateStrategy}
                  onChange={(e) => setDuplicateStrategy(e.target.value as StudentImportStrategy)}
                  disabled={importing}
                  className="min-h-[36px] px-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100"
                >
                  <option value="skip">Skip existing students</option>
                  <option value="update">Update existing student records</option>
                </select>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="py-2 px-3 font-medium">Row</th>
                    <th className="py-2 px-3 font-medium">Student &amp; Adm #</th>
                    <th className="py-2 px-3 font-medium">Class &amp; Boarding</th>
                    <th className="py-2 px-3 font-medium">Guardian &amp; Phone</th>
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
                            {row.payload.fullName || '—'}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            {row.payload.admissionNo || '—'} · {row.payload.gender}
                          </div>
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          <div className="font-medium text-slate-800 dark:text-slate-200">
                            Form {row.payload.formLevel}
                            {row.payload.stream} · {row.payload.entryYear}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {row.payload.boardingStatus} · {row.payload.status}
                          </div>
                        </td>
                        <td className="py-2 px-3">
                          <div className="text-slate-800 dark:text-slate-200">
                            {row.payload.guardianName || '—'}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            {row.payload.guardianPhone || 'No phone'}
                          </div>
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
        <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {importProgress
              ? `Saving ${importProgress.done} of ${importProgress.total} students...`
              : parsedPreview.rows.length > 0 && !importResult
              ? 'Portal registration codes are auto-issued for any rows without a code.'
              : ''}
          </div>

          <div className="flex flex-wrap items-center gap-2 ml-auto">
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
                  ? importProgress
                    ? `Importing ${importProgress.done}/${importProgress.total}...`
                    : 'Importing Students...'
                  : `Import ${summary.actionableCount} ${
                      summary.actionableCount === 1 ? 'Student' : 'Students'
                    }`}
              </button>
            )}
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
};
