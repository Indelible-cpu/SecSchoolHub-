import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  FileDown,
  Layers,
  Printer,
  RotateCcw,
  Search,
  User,
  X,
} from 'lucide-react';
import {
  Assessment,
  AttendanceRecord,
  FormLevel,
  School,
  Student,
  StudentReportRemark,
  TermName,
} from '../../school/types';
import {
  calculateTermReportSummary,
  findStudentTermRemark,
  FORM_LEVELS,
  formatSchoolTypeLabel,
  matchesStudentSearchQuery,
  sortStudentsForRegister,
  TERMS,
} from '../../school/malawi';
import { saveStudentReportRemark } from '../../school/firestoreService';
import {
  ACADEMIC_REPORT_TEMPLATES,
  buildStudentReportCardPayload,
  computeFormRankings,
  computeStudentAttendanceStats,
  computeSubjectCaDeltaPct,
  formatOrdinalPosition,
  generateDefaultTeacherRemarks,
  getReportTemplateMeta,
  ReportCardExportOptions,
  ReportCardTemplateId,
} from '../../school/reportCardTemplates';
import {
  downloadBatchStudentReportCardsPdf,
  downloadStudentTermReportCardPdf,
} from '../../school/pdfReports';
import { ModalBackdrop } from './ModalBackdrop';

interface ReportCardExportModalProps {
  open: boolean;
  onClose: () => void;
  school: School;
  students: Student[];
  assessments: Assessment[];
  reportRemarks?: StudentReportRemark[];
  attendance?: AttendanceRecord[];
  initialStudentId?: string;
  initialTerm: TermName;
  currentStaffName?: string;
  currentStaffRole?: string;
}

type ExportScopeMode = 'single' | 'batch';

export const ReportCardExportModal: React.FC<ReportCardExportModalProps> = ({
  open,
  onClose,
  school,
  students,
  assessments,
  reportRemarks = [],
  attendance = [],
  initialStudentId,
  initialTerm,
  currentStaffName,
  currentStaffRole,
}) => {
  const [scopeMode, setScopeMode] = useState<ExportScopeMode>('single');
  const [templateId, setTemplateId] = useState<ReportCardTemplateId>('classic-maneb');
  const [options, setOptions] = useState<ReportCardExportOptions>(
    () => getReportTemplateMeta('classic-maneb').defaultOptions
  );

  const [reportTerm, setReportTerm] = useState<TermName>(initialTerm);
  const [studentQuery, setStudentQuery] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState('');

  // Batch controls
  const [batchForm, setBatchForm] = useState<'all' | FormLevel>('all');
  const [batchStream, setBatchStream] = useState<string>('all');
  const [onlyWithMarks, setOnlyWithMarks] = useState(true);

  // Editable remarks & next-term date
  const [customFormRemark, setCustomFormRemark] = useState('');
  const [customHeadRemark, setCustomHeadRemark] = useState('');
  const [remarksDirty, setRemarksDirty] = useState(false);
  const [nextTermOpens, setNextTermOpens] = useState('');
  const [savingRemarks, setSavingRemarks] = useState(false);
  const [remarkSaveFeedback, setRemarkSaveFeedback] = useState<{ ok: boolean; msg: string } | null>(
    null
  );

  const [exportStatus, setExportStatus] = useState('');

  const sortedStudents = useMemo(
    () => sortStudentsForRegister(students, { groupByForm: true }),
    [students]
  );

  useEffect(() => {
    if (!open) return;
    setReportTerm(initialTerm);
    if (initialStudentId && sortedStudents.some((s) => s.id === initialStudentId)) {
      setSelectedStudentId(initialStudentId);
      setScopeMode('single');
    } else if (!selectedStudentId && sortedStudents.length > 0) {
      const activeFirst = sortedStudents.find((s) => s.status === 'Active') || sortedStudents[0];
      setSelectedStudentId(activeFirst.id);
    }
    setExportStatus('');
  }, [initialStudentId, initialTerm, open, selectedStudentId, sortedStudents]);

  const handleTemplateSelect = (nextId: ReportCardTemplateId) => {
    setTemplateId(nextId);
    setOptions({ ...getReportTemplateMeta(nextId).defaultOptions });
    setExportStatus('');
  };

  const rankings = useMemo(
    () =>
      computeFormRankings({
        students: sortedStudents,
        assessments,
        term: reportTerm,
        academicYear: school.academicYear,
      }),
    [assessments, reportTerm, school.academicYear, sortedStudents]
  );

  const getStudentTermAssessments = useMemo(() => {
    return (stuId: string) => {
      const exactYear = assessments.filter(
        (a) =>
          a.studentId === stuId &&
          a.term === reportTerm &&
          (!a.academicYear || a.academicYear === school.academicYear)
      );
      if (exactYear.length > 0) return exactYear;
      return assessments.filter((a) => a.studentId === stuId && a.term === reportTerm);
    };
  }, [assessments, reportTerm, school.academicYear]);

  const filteredSingleStudents = useMemo(() => {
    return sortedStudents.filter((s) =>
      matchesStudentSearchQuery(s, studentQuery, { includeFormClass: true })
    );
  }, [sortedStudents, studentQuery]);

  const singleStudent = useMemo(
    () =>
      sortedStudents.find((s) => s.id === selectedStudentId) ||
      filteredSingleStudents[0] ||
      sortedStudents[0] ||
      null,
    [filteredSingleStudents, selectedStudentId, sortedStudents]
  );

  // Batch candidates
  const availableStreams = useMemo(() => {
    const base =
      batchForm === 'all'
        ? sortedStudents
        : sortedStudents.filter((s) => s.formLevel === batchForm);
    return Array.from(new Set(base.map((s) => s.stream).filter(Boolean))).sort();
  }, [batchForm, sortedStudents]);

  const batchCards = useMemo(() => {
    const cohort = sortedStudents.filter((s) => {
      if (s.status !== 'Active') return false;
      if (batchForm !== 'all' && s.formLevel !== batchForm) return false;
      if (batchStream !== 'all' && s.stream !== batchStream) return false;
      return true;
    });

    return cohort
      .map((stu) => {
        const stuAssessments = getStudentTermAssessments(stu.id);
        if (onlyWithMarks && stuAssessments.length === 0) return null;
        const summary = calculateTermReportSummary(stu.formLevel, stuAssessments);
        const classRank = rankings.get(stu.id) || null;
        const attendanceStats = computeStudentAttendanceStats(attendance, stu.id);
        const savedRemark = findStudentTermRemark(
          reportRemarks,
          stu.id,
          reportTerm,
          school.academicYear
        );
        return buildStudentReportCardPayload({
          school,
          student: stu,
          term: reportTerm,
          summary,
          classRank,
          attendanceStats,
          formTeacherRemark: savedRemark?.formTeacherRemark || undefined,
          headTeacherRemark: savedRemark?.headTeacherRemark || undefined,
          nextTermOpens: nextTermOpens.trim() || savedRemark?.nextTermOpens || '',
        });
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [
    attendance,
    batchForm,
    batchStream,
    getStudentTermAssessments,
    nextTermOpens,
    onlyWithMarks,
    rankings,
    reportRemarks,
    reportTerm,
    school,
    sortedStudents,
  ]);

  // Active preview payload (single student or first student in batch)
  const singleSummary = useMemo(() => {
    if (!singleStudent) return null;
    return calculateTermReportSummary(
      singleStudent.formLevel,
      getStudentTermAssessments(singleStudent.id)
    );
  }, [getStudentTermAssessments, singleStudent]);

  const singleRank = singleStudent ? rankings.get(singleStudent.id) || null : null;
  const singleAttendance = singleStudent
    ? computeStudentAttendanceStats(attendance, singleStudent.id)
    : null;
  const singlePublishedRemark = useMemo(() => {
    if (!singleStudent) return null;
    return findStudentTermRemark(
      reportRemarks,
      singleStudent.id,
      reportTerm,
      school.academicYear
    );
  }, [reportRemarks, reportTerm, school.academicYear, singleStudent]);

  useEffect(() => {
    if (!singleStudent || !singleSummary) return;
    const autoRemarks = generateDefaultTeacherRemarks(singleSummary, singleStudent, singleRank);
    setCustomFormRemark(
      singlePublishedRemark?.formTeacherRemark?.trim() || autoRemarks.formTeacherRemark
    );
    setCustomHeadRemark(
      singlePublishedRemark?.headTeacherRemark?.trim() || autoRemarks.headTeacherRemark
    );
    if (singlePublishedRemark?.nextTermOpens !== undefined) {
      setNextTermOpens(singlePublishedRemark.nextTermOpens);
    }
    setRemarksDirty(false);
    setRemarkSaveFeedback(null);
  }, [singlePublishedRemark, singleRank, singleStudent, singleSummary]);

  const handlePublishRemarksToPortal = async () => {
    if (!singleStudent) return;
    setSavingRemarks(true);
    setRemarkSaveFeedback(null);
    try {
      const normalizedRole = (currentStaffRole || '').toLowerCase();
      const isHeadAuthor =
        normalizedRole.includes('head') || normalizedRole.includes('owner') || normalizedRole.includes('admin');
      await saveStudentReportRemark(school, singleStudent, {
        term: reportTerm,
        academicYear: school.academicYear,
        formTeacherRemark: customFormRemark.trim(),
        headTeacherRemark: customHeadRemark.trim(),
        nextTermOpens: nextTermOpens.trim(),
        formTeacherName: !isHeadAuthor
          ? currentStaffName || singlePublishedRemark?.formTeacherName || ''
          : singlePublishedRemark?.formTeacherName || '',
        headTeacherName: isHeadAuthor
          ? currentStaffName || singlePublishedRemark?.headTeacherName || ''
          : singlePublishedRemark?.headTeacherName || '',
        updatedByName: currentStaffName || '',
        updatedByRole: currentStaffRole || '',
      });
      setRemarksDirty(false);
      setRemarkSaveFeedback({
        ok: true,
        msg: singleStudent.registrationCode
          ? `Saved & synced to ${singleStudent.fullName}'s Student Portal (${singleStudent.registrationCode}).`
          : 'Saved to school report records. Issue a registration code so the student can view it online.',
      });
    } catch (err) {
      setRemarkSaveFeedback({
        ok: false,
        msg: err instanceof Error ? err.message : 'Unable to save report card remarks.',
      });
    } finally {
      setSavingRemarks(false);
    }
  };

  const previewCard = useMemo(() => {
    if (scopeMode === 'batch') {
      return batchCards[0] || null;
    }
    if (!singleStudent || !singleSummary) return null;
    return buildStudentReportCardPayload({
      school,
      student: singleStudent,
      term: reportTerm,
      summary: singleSummary,
      classRank: singleRank,
      attendanceStats: singleAttendance,
      formTeacherRemark: customFormRemark,
      headTeacherRemark: customHeadRemark,
      nextTermOpens,
    });
  }, [
    batchCards,
    customFormRemark,
    customHeadRemark,
    nextTermOpens,
    reportTerm,
    school,
    scopeMode,
    singleAttendance,
    singleRank,
    singleStudent,
    singleSummary,
  ]);

  const activeTemplate = getReportTemplateMeta(templateId);

  const handleDownloadPdf = () => {
    if (scopeMode === 'single') {
      if (!singleStudent || !singleSummary || singleSummary.subjectCount === 0) return;
      downloadStudentTermReportCardPdf({
        school,
        student: singleStudent,
        term: reportTerm,
        summary: singleSummary,
        templateId,
        options,
        classRank: singleRank,
        attendanceStats: singleAttendance,
        formTeacherRemark: customFormRemark,
        headTeacherRemark: customHeadRemark,
        nextTermOpens,
      });
      setExportStatus(
        `Downloaded ${activeTemplate.name} PDF for ${singleStudent.fullName}.`
      );
      return;
    }

    if (batchCards.length === 0) return;
    const formLabel = batchForm === 'all' ? 'all-forms' : `form-${batchForm}`;
    const streamLabel = batchStream === 'all' ? '' : `-${batchStream}`;
    downloadBatchStudentReportCardsPdf({
      school,
      cards: batchCards,
      templateId,
      options,
      batchLabel: `${formLabel}${streamLabel}`,
      term: reportTerm,
    });
    setExportStatus(
      `Exported ${batchCards.length} printable report card${batchCards.length === 1 ? '' : 's'} using ${activeTemplate.name}.`
    );
  };

  const canExport =
    scopeMode === 'single'
      ? !!singleSummary && singleSummary.subjectCount > 0
      : batchCards.length > 0;

  if (!open) return null;

  const isCompact = templateId === 'compact-parent-slip';
  const isModern = templateId === 'modern-executive';
  const isDetailed = templateId === 'detailed-transcript';

  return (
    <ModalBackdrop
      open={open}
      onClose={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-3 sm:p-5 print:static print:bg-white print:p-0"
    >
      <div className="w-full max-w-6xl rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 shadow-xl max-h-[94vh] flex flex-col overflow-hidden print:max-h-none print:border-0 print:shadow-none">
        {/* Top Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div>
            <h2 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-white">
              Printable Student Report Cards (PDF)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {school.name} · {school.academicYear} · Select a pre-defined academic template and export single or batch A4 sheets
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => window.print()}
              disabled={!previewCard}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Print</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={!canExport}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileDown className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {scopeMode === 'batch'
                  ? `Download ${batchCards.length} Report Cards (PDF)`
                  : 'Download PDF'}
              </span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Report Card Exporter"
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body: Left Controls + Right Live Template Preview */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800 print:block">
          {/* Left Configuration Column */}
          <div className="lg:col-span-5 p-4 sm:p-5 space-y-5 overflow-y-auto print:hidden">
            {exportStatus && (
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/80 dark:bg-emerald-950/30 px-3.5 py-2.5 text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                <span>{exportStatus}</span>
              </div>
            )}

            {/* Scope Toggle */}
            <div>
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">
                Export Mode
              </div>
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => setScopeMode('single')}
                  className={`inline-flex items-center justify-center gap-1.5 min-h-[38px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    scopeMode === 'single'
                      ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <User className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Single Student</span>
                </button>
                <button
                  type="button"
                  onClick={() => setScopeMode('batch')}
                  className={`inline-flex items-center justify-center gap-1.5 min-h-[38px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    scopeMode === 'batch'
                      ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Batch Class PDF</span>
                </button>
              </div>
            </div>

            {/* Pre-Defined Academic Templates */}
            <div>
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">
                Academic Report Template
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
                {ACADEMIC_REPORT_TEMPLATES.map((tpl) => {
                  const selected = tpl.id === templateId;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => handleTemplateSelect(tpl.id)}
                      className={`w-full text-left p-3 rounded-xl border transition-colors cursor-pointer ${
                        selected
                          ? 'border-emerald-600 bg-emerald-50/60 dark:bg-emerald-950/30 dark:border-emerald-500'
                          : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900 dark:text-white">
                          {tpl.name}
                        </span>
                        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 shrink-0">
                          {tpl.bestFor}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                        {tpl.subtitle}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Target Filters */}
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Academic Term
                  </label>
                  <select
                    value={reportTerm}
                    onChange={(e) => setReportTerm(e.target.value as TermName)}
                    className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium"
                  >
                    {TERMS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Next Term Opens (Optional)
                  </label>
                  <input
                    type="text"
                    value={nextTermOpens}
                    onChange={(e) => setNextTermOpens(e.target.value)}
                    placeholder="e.g. 12 January 2027"
                    className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                  />
                </div>
              </div>

              {scopeMode === 'single' ? (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Student
                  </label>
                  {sortedStudents.length > 8 && (
                    <div className="relative">
                      <Search
                        className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                        aria-hidden="true"
                      />
                      <input
                        type="text"
                        value={studentQuery}
                        onChange={(e) => setStudentQuery(e.target.value)}
                        placeholder="Search by surname, name, reg/adm code, or form..."
                        className="w-full min-h-[38px] pl-8 pr-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                      />
                    </div>
                  )}
                  <select
                    aria-label="Select student for report card"
                    value={singleStudent?.id || ''}
                    onChange={(e) => setSelectedStudentId(e.target.value)}
                    className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium"
                  >
                    {filteredSingleStudents.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fullName} — {s.admissionNo} (Form {s.formLevel}{s.stream})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Form Level
                      </label>
                      <select
                        value={batchForm}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBatchForm(val === 'all' ? 'all' : (Number(val) as FormLevel));
                          setBatchStream('all');
                        }}
                        className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium"
                      >
                        <option value="all">All Forms (1–4)</option>
                        {FORM_LEVELS.map((f) => (
                          <option key={f} value={f}>
                            Form {f}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Stream
                      </label>
                      <select
                        value={batchStream}
                        onChange={(e) => setBatchStream(e.target.value)}
                        className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium"
                      >
                        <option value="all">All Streams</option>
                        {availableStreams.map((st) => (
                          <option key={st} value={st}>
                            Stream {st}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={onlyWithMarks}
                      onChange={(e) => setOnlyWithMarks(e.target.checked)}
                      className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                    />
                    <span>
                      Include only students with recorded {reportTerm} marks ({batchCards.length} ready)
                    </span>
                  </label>
                </div>
              )}
            </div>

            {/* Template Sections Toggle */}
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Report Card Sections
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-700 dark:text-slate-300">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.includeRank}
                    onChange={(e) =>
                      setOptions((prev) => ({ ...prev, includeRank: e.target.checked }))
                    }
                    className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                  />
                  <span>Class Position / Rank</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.includeAttendance}
                    onChange={(e) =>
                      setOptions((prev) => ({ ...prev, includeAttendance: e.target.checked }))
                    }
                    className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                  />
                  <span>Attendance Summary</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.includeGradingKey}
                    onChange={(e) =>
                      setOptions((prev) => ({ ...prev, includeGradingKey: e.target.checked }))
                    }
                    className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                  />
                  <span>MANEB / JCE Grading Key</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.includeRemarks}
                    onChange={(e) =>
                      setOptions((prev) => ({ ...prev, includeRemarks: e.target.checked }))
                    }
                    className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                  />
                  <span>Teacher &amp; Head Remarks</span>
                </label>
                <label className="flex items-center gap-2 sm:col-span-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.includeGuardianSlip}
                    onChange={(e) =>
                      setOptions((prev) => ({ ...prev, includeGuardianSlip: e.target.checked }))
                    }
                    className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                  />
                  <span>Guardian Tear-Off Acknowledgement Slip</span>
                </label>
              </div>
            </div>

            {/* Editable Teacher Remarks for Single Student */}
            {scopeMode === 'single' && options.includeRemarks && singleStudent && singleSummary && (
              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Customize Remarks
                  </span>
                  {remarksDirty && (
                    <button
                      type="button"
                      onClick={() => {
                        const auto = generateDefaultTeacherRemarks(
                          singleSummary,
                          singleStudent,
                          singleRank
                        );
                        setCustomFormRemark(auto.formTeacherRemark);
                        setCustomHeadRemark(auto.headTeacherRemark);
                        setRemarksDirty(false);
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" aria-hidden="true" />
                      <span>Reset Auto</span>
                    </button>
                  )}
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                    Form Teacher Comment
                  </label>
                  <textarea
                    rows={2}
                    value={customFormRemark}
                    onChange={(e) => {
                      setCustomFormRemark(e.target.value);
                      setRemarksDirty(true);
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                    Head Teacher Comment
                  </label>
                  <textarea
                    rows={2}
                    maxLength={500}
                    value={customHeadRemark}
                    onChange={(e) => {
                      setCustomHeadRemark(e.target.value);
                      setRemarksDirty(true);
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                  />
                </div>
                <div className="pt-1 space-y-1.5">
                  <button
                    type="button"
                    disabled={savingRemarks}
                    onClick={handlePublishRemarksToPortal}
                    className="w-full min-h-[38px] px-3 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    {savingRemarks
                      ? 'Saving Remarks...'
                      : singlePublishedRemark
                      ? 'Update Published Portal Remarks'
                      : 'Save Remarks to Student Portal'}
                  </button>
                  {singlePublishedRemark && !remarkSaveFeedback && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Published to Student Portal
                      {singlePublishedRemark.updatedByName
                        ? ` · Last edited by ${singlePublishedRemark.updatedByName}`
                        : ''}
                    </p>
                  )}
                  {remarkSaveFeedback && (
                    <p
                      className={`text-[11px] font-medium ${
                        remarkSaveFeedback.ok
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {remarkSaveFeedback.msg}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right Panel: Live A4 Template Sheet Preview */}
          <div className="lg:col-span-7 bg-slate-100/80 dark:bg-[#0D1117] p-4 sm:p-6 overflow-y-auto print:bg-white print:p-0">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-3 print:hidden">
              <span>
                Template Preview · {activeTemplate.name}
                {scopeMode === 'batch' && batchCards.length > 0
                  ? ` · Sample 1 of ${batchCards.length}`
                  : ''}
              </span>
              <span>A4 Portrait</span>
            </div>

            {!previewCard ? (
              <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center text-sm text-slate-500 dark:text-slate-400">
                No students match the current batch selection for {reportTerm}.
              </div>
            ) : (
              <div className="bg-white text-slate-900 border border-slate-200 rounded-xl shadow-xs overflow-hidden print:border-0 print:rounded-none print:shadow-none">
                {/* Top Template Accent Bar */}
                {!isCompact ? (
                  <div
                    className="h-1.5 w-full"
                    style={{ backgroundColor: activeTemplate.accentHex }}
                  />
                ) : (
                  <div className="mx-5 mt-4 border-t-2 border-slate-700" />
                )}

                <div className="p-5 sm:p-6 space-y-4">
                  {/* School Letterhead */}
                  <div className="flex items-start justify-between gap-4 pb-3 border-b border-slate-200">
                    <div className="flex items-start gap-3">
                      {school.logoDataUrl && (
                        <img
                          src={school.logoDataUrl}
                          alt={`${school.name} crest`}
                          className="w-11 h-11 rounded-lg object-contain border border-slate-200 bg-white shrink-0"
                        />
                      )}
                      <div>
                        <div className="text-sm sm:text-base font-bold tracking-tight text-slate-900 uppercase">
                          {school.name}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {school.district} District · {formatSchoolTypeLabel(school.schoolType)}
                          {school.motto ? ` · "${school.motto}"` : ''}
                        </div>
                      </div>
                    </div>
                    <div className="text-right text-[11px] text-slate-600 shrink-0 font-mono tabular-nums">
                      <div className="font-semibold text-slate-900">{school.academicYear}</div>
                      <div>{previewCard.term}</div>
                    </div>
                  </div>

                  {/* Report Heading */}
                  <div>
                    <h3
                      className="text-xs sm:text-sm font-bold tracking-wide"
                      style={{ color: activeTemplate.accentHex }}
                    >
                      {templateId === 'classic-maneb'
                        ? 'OFFICIAL STUDENT ACADEMIC REPORT CARD'
                        : templateId === 'modern-executive'
                        ? 'Executive Student Term Report Card'
                        : templateId === 'compact-parent-slip'
                        ? 'Term Parent Academic Slip'
                        : 'Detailed Continuous Assessment & Exam Transcript'}
                    </h3>
                  </div>

                  {/* Student Biodata Box */}
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <div className="font-semibold text-slate-900">
                        {previewCard.student.fullName}
                      </div>
                      <div className="text-[11px] text-slate-600 mt-0.5">
                        Adm #: <span className="font-mono">{previewCard.student.admissionNo}</span> ·
                        Form {previewCard.student.formLevel}
                        {previewCard.student.stream} ({previewCard.summary.system}) ·{' '}
                        {previewCard.student.boardingStatus}
                        {isCompact && previewCard.student.guardianName
                          ? ` · Guardian: ${previewCard.student.guardianName}`
                          : ''}
                      </div>
                    </div>
                    <div className="text-right text-[11px] text-slate-600 font-mono tabular-nums">
                      <div className="font-semibold text-slate-900">
                        {options.includeRank && previewCard.classRank
                          ? `Position: ${formatOrdinalPosition(previewCard.classRank.rank)} / ${previewCard.classRank.totalRanked}`
                          : `${previewCard.summary.subjectCount} Subjects`}
                      </div>
                      <div>
                        {options.includeAttendance &&
                        previewCard.attendanceStats &&
                        previewCard.attendanceStats.ratePct !== null
                          ? `Attendance: ${previewCard.attendanceStats.present + previewCard.attendanceStats.late}/${previewCard.attendanceStats.totalMarked}d (${previewCard.attendanceStats.ratePct.toFixed(0)}%)`
                          : `${previewCard.term}`}
                      </div>
                    </div>
                  </div>

                  {/* Standing KPI Strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
                      <div className="text-[10px] text-slate-500">
                        {previewCard.student.formLevel >= 3 ? 'MSCE Best 6' : 'Subjects Passed'}
                      </div>
                      <div className="text-sm font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                        {previewCard.summary.subjectCount === 0
                          ? '—'
                          : previewCard.student.formLevel >= 3
                          ? previewCard.summary.standing.bestSixPoints !== null
                            ? `${previewCard.summary.standing.bestSixPoints} pts`
                            : `${previewCard.summary.subjectCount}/6`
                          : `${previewCard.summary.passedSubjectCount}/${previewCard.summary.subjectCount}`}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
                      <div className="text-[10px] text-slate-500">Term Average</div>
                      <div className="text-sm font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                        {previewCard.summary.subjectCount > 0
                          ? `${previewCard.summary.weightedAverage.toFixed(1)}%`
                          : '—'}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
                      <div className="text-[10px] text-slate-500">Overall Grade</div>
                      <div className="text-sm font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                        {previewCard.summary.overallGrade} · {previewCard.summary.overallRemark}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
                      <div className="text-[10px] text-slate-500">
                        {options.includeRank && previewCard.classRank
                          ? `${previewCard.classRank.formLabel} Rank`
                          : `${previewCard.summary.system} Standing`}
                      </div>
                      <div className="text-sm font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                        {options.includeRank && previewCard.classRank
                          ? `${formatOrdinalPosition(previewCard.classRank.rank)} / ${previewCard.classRank.totalRanked}`
                          : previewCard.summary.standing.outcome}
                      </div>
                    </div>
                  </div>

                  {/* Modern Executive Score Composition Bar */}
                  {isModern && previewCard.summary.subjectCount > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-slate-600 font-mono tabular-nums">
                        <span>
                          CA1 {previewCard.summary.ca1Average.toFixed(1)}/20 · CA2{' '}
                          {previewCard.summary.ca2Average.toFixed(1)}/20 · Exam{' '}
                          {previewCard.summary.summativeAverage.toFixed(1)}/60
                        </span>
                        <span className="font-semibold text-slate-900">
                          Total {previewCard.summary.weightedAverage.toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-sm bg-slate-200 overflow-hidden flex">
                        <div
                          className="bg-emerald-500 h-full"
                          style={{
                            width: `${Math.min(20, previewCard.summary.ca1Average)}%`,
                          }}
                        />
                        <div
                          className="bg-sky-500 h-full"
                          style={{
                            width: `${Math.min(20, previewCard.summary.ca2Average)}%`,
                          }}
                        />
                        <div
                          className="bg-slate-900 h-full"
                          style={{
                            width: `${Math.min(60, previewCard.summary.summativeAverage)}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Subject Marks Table */}
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    {previewCard.summary.rows.length === 0 ? (
                      <div className="py-8 px-4 text-center text-xs text-slate-500">
                        No {previewCard.term} marks recorded for {previewCard.student.fullName}.
                      </div>
                    ) : (
                      <table className="w-full text-left text-[11px]">
                        <thead>
                          <tr
                            className={
                              isCompact
                                ? 'bg-slate-100 text-slate-900 border-b border-slate-300'
                                : 'text-white'
                            }
                            style={
                              isCompact
                                ? undefined
                                : { backgroundColor: activeTemplate.accentHex }
                            }
                          >
                            <th className="py-2 px-2.5 font-semibold">Subject</th>
                            {isCompact ? (
                              <th className="py-2 px-2 font-semibold text-right">CA (40%)</th>
                            ) : (
                              <>
                                <th className="py-2 px-2 font-semibold text-right">CA 1</th>
                                <th className="py-2 px-2 font-semibold text-right">CA 2</th>
                              </>
                            )}
                            {isDetailed && (
                              <th className="py-2 px-2 font-semibold text-right">CA Δ</th>
                            )}
                            <th className="py-2 px-2 font-semibold text-right">Exam</th>
                            <th className="py-2 px-2 font-semibold text-right">Total</th>
                            {!isCompact && (
                              <th className="py-2 px-2 font-semibold text-right">Pts</th>
                            )}
                            <th className="py-2 px-2 font-semibold text-center">Grade</th>
                            <th className="py-2 px-2.5 font-semibold text-right">Remark</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {previewCard.summary.rows.map((r) => {
                            const delta = computeSubjectCaDeltaPct(r);
                            return (
                              <tr key={r.assessment.id} className="odd:bg-white even:bg-slate-50/50">
                                <td className="py-1.5 px-2.5 font-medium text-slate-900">
                                  {r.assessment.subject}
                                </td>
                                {isCompact ? (
                                  <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-700">
                                    {(r.ca1Score + r.ca2Score).toFixed(1)}
                                  </td>
                                ) : (
                                  <>
                                    <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-700">
                                      {r.hasCa1 ? r.ca1Score.toFixed(1) : '—'}
                                    </td>
                                    <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-700">
                                      {r.hasCa2 ? r.ca2Score.toFixed(1) : '—'}
                                    </td>
                                  </>
                                )}
                                {isDetailed && (
                                  <td
                                    className={`py-1.5 px-2 text-right font-mono tabular-nums ${
                                      delta === null
                                        ? 'text-slate-400'
                                        : delta < -10
                                        ? 'text-rose-600 font-semibold'
                                        : delta > 0
                                        ? 'text-emerald-700'
                                        : 'text-slate-600'
                                    }`}
                                  >
                                    {delta === null
                                      ? '—'
                                      : `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}%`}
                                  </td>
                                )}
                                <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-700">
                                  {r.hasExam ? r.examScore.toFixed(1) : '—'}
                                </td>
                                <td className="py-1.5 px-2 text-right font-mono tabular-nums font-semibold text-slate-900">
                                  {r.totalScore.toFixed(1)}%
                                </td>
                                {!isCompact && (
                                  <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-700">
                                    {r.gradePoint}
                                  </td>
                                )}
                                <td className="py-1.5 px-2 text-center font-mono font-bold text-slate-900">
                                  {r.grade}
                                </td>
                                <td className="py-1.5 px-2.5 text-right text-slate-600">
                                  {r.remark}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-slate-200 bg-slate-100 font-semibold text-slate-900">
                            <td className="py-2 px-2.5">
                              OVERALL ({previewCard.summary.subjectCount})
                            </td>
                            {isCompact ? (
                              <td className="py-2 px-2 text-right font-mono tabular-nums">
                                {previewCard.summary.caAverage.toFixed(1)}
                              </td>
                            ) : (
                              <>
                                <td className="py-2 px-2 text-right font-mono tabular-nums">
                                  {previewCard.summary.ca1Average.toFixed(1)}
                                </td>
                                <td className="py-2 px-2 text-right font-mono tabular-nums">
                                  {previewCard.summary.ca2Average.toFixed(1)}
                                </td>
                              </>
                            )}
                            {isDetailed && (
                              <td className="py-2 px-2 text-right font-mono">—</td>
                            )}
                            <td className="py-2 px-2 text-right font-mono tabular-nums">
                              {previewCard.summary.summativeAverage.toFixed(1)}
                            </td>
                            <td className="py-2 px-2 text-right font-mono tabular-nums">
                              {previewCard.summary.weightedAverage.toFixed(1)}%
                            </td>
                            {!isCompact && (
                              <td className="py-2 px-2 text-right font-mono tabular-nums">
                                {previewCard.summary.meanManebPoint !== null
                                  ? previewCard.summary.meanManebPoint.toFixed(1)
                                  : '—'}
                              </td>
                            )}
                            <td className="py-2 px-2 text-center font-mono font-bold">
                              {previewCard.summary.overallGrade}
                            </td>
                            <td className="py-2 px-2.5 text-right">
                              {previewCard.summary.overallRemark}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    )}
                  </div>

                  {/* Detailed Attendance Breakdown */}
                  {isDetailed && options.includeAttendance && previewCard.attendanceStats && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
                      <span className="font-semibold text-slate-900">Attendance Record: </span>
                      Present {previewCard.attendanceStats.present} · Late{' '}
                      {previewCard.attendanceStats.late} · Absent{' '}
                      {previewCard.attendanceStats.absent} · Excused{' '}
                      {previewCard.attendanceStats.excused} (
                      {previewCard.attendanceStats.totalMarked} sessions marked)
                    </div>
                  )}

                  {/* Teacher & Head Remarks */}
                  {options.includeRemarks && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 space-y-1.5 text-[11px] text-slate-700">
                      <div>
                        <span className="font-semibold text-slate-900">Form Teacher: </span>
                        {previewCard.formTeacherRemark}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-900">Head Teacher: </span>
                        {previewCard.headTeacherRemark}
                      </div>
                      {previewCard.nextTermOpens && (
                        <div className="font-semibold text-emerald-800 pt-0.5">
                          Next Term Opens: {previewCard.nextTermOpens}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Grading Key Legend */}
                  {options.includeGradingKey && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-[10px] text-slate-600">
                      <span className="font-semibold text-slate-800">
                        {previewCard.student.formLevel <= 2
                          ? 'JCE Grading Key (Forms 1–2): '
                          : 'MSCE Grading Key (Forms 3–4): '}
                      </span>
                      {previewCard.student.formLevel <= 2
                        ? 'A (80–100% Distinction · Pt 1) | B (70–79% Very Good · Pt 3) | C (60–69% Credit · Pt 5) | D (50–59% Pass · Pt 7) | F (0–49% Fail · Pt 9)'
                        : '1–2 (75–100% Distinction) | 3 (70–74% Strong Credit) | 4–6 (55–69% Credit) | 7–8 (40–54% Pass) | 9 (0–39% Fail) | Pass requires English'}
                    </div>
                  )}

                  {/* Signatures */}
                  <div className="pt-4 grid grid-cols-2 gap-8 text-[11px] text-slate-600">
                    <div>
                      <div className="border-t border-slate-400 pt-1">
                        Form Teacher Signature &amp; Date
                      </div>
                    </div>
                    <div>
                      <div className="border-t border-slate-400 pt-1">
                        Head Teacher Signature &amp; School Stamp
                      </div>
                    </div>
                  </div>

                  {/* Optional Guardian Return Slip */}
                  {options.includeGuardianSlip && (
                    <div className="pt-3 border-t border-dashed border-slate-400 space-y-2 text-[10px] text-slate-600">
                      <div className="font-semibold text-slate-800 uppercase tracking-wide">
                        Parent / Guardian Acknowledgement Return Slip
                      </div>
                      <p>
                        I acknowledge receipt of {previewCard.term} ({school.academicYear}) report
                        card for {previewCard.student.fullName} (Adm #:{' '}
                        {previewCard.student.admissionNo}, Form {previewCard.student.formLevel}
                        {previewCard.student.stream}).
                      </p>
                      <div className="pt-3 grid grid-cols-3 gap-4">
                        <div className="border-t border-slate-400 pt-1">
                          {previewCard.student.guardianName
                            ? `Guardian: ${previewCard.student.guardianName}`
                            : 'Guardian Name'}
                        </div>
                        <div className="border-t border-slate-400 pt-1">Guardian Signature</div>
                        <div className="border-t border-slate-400 pt-1">Date Returned</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
};
