import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileDown,
  FileText,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  TrendingDown,
  Trophy,
  X,
} from 'lucide-react';
import {
  Assessment,
  AssessmentType,
  AttendanceRecord,
  FormLevel,
  School,
  SchoolSubject,
  Student,
  StudentReportRemark,
  TermName,
} from '../../school/types';
import {
  calculateManebGrade,
  calculateWeightedComponent,
  compareStudentsRegisterOrder,
  detectCaDownwardAlerts,
  detectNextAssessmentStage,
  downloadCSV,
  getSubjectsForForm,
  MALAWI_SUBJECTS,
  normalizeAssessmentComponents,
  rankAssessmentsByPerformance,
  RankedAssessmentEntry,
  sortStudentsForRegister,
  TERMS,
} from '../../school/malawi';
import {
  buildLiveCohortMeritStandings,
  formatOrdinalPosition,
} from '../../school/reportCardTemplates';
import { downloadMarksPdfReport } from '../../school/pdfReports';
import { removeAssessment, saveAssessment } from '../../school/firestoreService';
import { buildModalDraftKey, clearModalDraft, loadModalDraft, saveModalDraft } from '../../school/modalDrafts';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';
import { DraftRestoredNotice, ModalBackdrop } from './ModalBackdrop';
import { ReportCardExportModal } from './ReportCardExportModal';
import {
  ManebGradeDistributionChart,
  SubjectComponentBarChart,
  summarizeSubjectComponents,
} from './AnalyticsCharts';

interface MarksGradebookProps {
  school: School;
  ownerId: string;
  students: Student[];
  assessments: Assessment[];
  reportRemarks?: StudentReportRemark[];
  attendance?: AttendanceRecord[];
  schoolSubjects?: SchoolSubject[];
  canWriteMarks?: boolean;
  currentStaffName?: string;
  currentStaffRole?: string;
  onOpenStaffSettings?: () => void;
}

const QUICK_TOTALS_CA = [20, 25, 30, 40, 50, 100];
const QUICK_TOTALS_EXAM = [50, 60, 80, 100, 120];

export const MarksGradebook: React.FC<MarksGradebookProps> = ({
  school,
  ownerId,
  students,
  assessments,
  reportRemarks = [],
  attendance = [],
  schoolSubjects = [],
  canWriteMarks = true,
  currentStaffName,
  currentStaffRole,
  onOpenStaffSettings,
}) => {
  const [formFilter, setFormFilter] = useState<'all' | FormLevel>('all');
  const [termFilter, setTermFilter] = useState<TermName>(school.currentTerm);
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [atRiskOnly, setAtRiskOnly] = useState(false);
  const [gradebookView, setGradebookView] = useState<'entries' | 'merit'>('entries');
  const [entriesSortOrder, setEntriesSortOrder] = useState<'ranked' | 'register'>('ranked');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [lockedStudentSubject, setLockedStudentSubject] = useState(false);

  const [studentId, setStudentId] = useState('');
  const [subject, setSubject] = useState(MALAWI_SUBJECTS[0]);
  const [term, setTerm] = useState<TermName>(school.currentTerm);
  const [entryMode, setEntryMode] = useState<AssessmentType>('ca1');
  const [autoDetectedStage, setAutoDetectedStage] = useState<AssessmentType>('ca1');

  const [ca1RawStr, setCa1RawStr] = useState('');
  const [ca1MaxStr, setCa1MaxStr] = useState('20');
  const [ca2RawStr, setCa2RawStr] = useState('');
  const [ca2MaxStr, setCa2MaxStr] = useState('20');
  const [examRawStr, setExamRawStr] = useState('');
  const [examMaxStr, setExamMaxStr] = useState('100');
  const [teacherCommentStr, setTeacherCommentStr] = useState('');

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [markDraftRestored, setMarkDraftRestored] = useState(false);

  const markDraftKey = useMemo(
    () =>
      buildModalDraftKey(
        school.id,
        'mark_entry',
        lockedStudentSubject ? editingId : 'new'
      ),
    [editingId, lockedStudentSubject, school.id]
  );

  useEffect(() => {
    if (!modalOpen) return;
    saveModalDraft(markDraftKey, {
      studentId,
      subject,
      term,
      entryMode,
      ca1RawStr,
      ca1MaxStr,
      ca2RawStr,
      ca2MaxStr,
      examRawStr,
      examMaxStr,
      teacherCommentStr,
    });
  }, [
    ca1MaxStr,
    ca1RawStr,
    ca2MaxStr,
    ca2RawStr,
    entryMode,
    examMaxStr,
    examRawStr,
    markDraftKey,
    modalOpen,
    studentId,
    subject,
    teacherCommentStr,
    term,
  ]);

  // Term Report Card Generator state
  const [reportCardOpen, setReportCardOpen] = useState(false);
  const [reportStudentId, setReportStudentId] = useState('');
  const [reportTerm, setReportTerm] = useState<TermName>(school.currentTerm);

  // Safe Delete Assessment state
  const [confirmAssessment, setConfirmAssessment] = useState<Assessment | null>(null);
  const [deletingAssessment, setDeletingAssessment] = useState(false);
  const [deleteAssessmentError, setDeleteAssessmentError] = useState('');

  const studentsById = useMemo(() => {
    const map = new Map<string, Student>();
    for (const s of students) {
      map.set(s.id, s);
    }
    return map;
  }, [students]);

  const activeStudents = useMemo(
    () =>
      sortStudentsForRegister(
        students.filter((s) => s.status === 'Active'),
        { groupByForm: true }
      ),
    [students]
  );

  const baseFiltered = useMemo(() => {
    return assessments.filter((a) => {
      if (a.term !== termFilter) return false;
      if (formFilter !== 'all' && a.formLevel !== formFilter) return false;
      if (subjectFilter !== 'all' && a.subject !== subjectFilter) return false;
      return true;
    });
  }, [assessments, formFilter, subjectFilter, termFilter]);

  const rankedEntries = useMemo(
    () => rankAssessmentsByPerformance(baseFiltered, studentsById),
    [baseFiltered, studentsById]
  );

  const rankByAssessmentId = useMemo(() => {
    const map = new Map<string, RankedAssessmentEntry<Assessment>>();
    for (const entry of rankedEntries) {
      map.set(entry.assessment.id, entry);
    }
    return map;
  }, [rankedEntries]);

  const caDropAnalysis = useMemo(
    () => detectCaDownwardAlerts(baseFiltered, 10),
    [baseFiltered]
  );

  const displayedRankedEntries = useMemo(() => {
    const scoped = atRiskOnly
      ? rankedEntries.filter((e) => caDropAnalysis.byAssessmentId.has(e.assessment.id))
      : rankedEntries;

    if (entriesSortOrder === 'register') {
      return [...scoped].sort((a, b) => {
        const stuA = studentsById.get(a.assessment.studentId);
        const stuB = studentsById.get(b.assessment.studentId);
        return (
          compareStudentsRegisterOrder(
            stuA || {
              fullName: a.assessment.studentName,
              formLevel: a.assessment.formLevel,
              stream: a.assessment.stream,
            },
            stuB || {
              fullName: b.assessment.studentName,
              formLevel: b.assessment.formLevel,
              stream: b.assessment.stream,
            },
            { groupByForm: true }
          ) || a.assessment.subject.localeCompare(b.assessment.subject)
        );
      });
    }
    return scoped;
  }, [atRiskOnly, caDropAnalysis.byAssessmentId, entriesSortOrder, rankedEntries, studentsById]);

  const filtered = useMemo(
    () => displayedRankedEntries.map((e) => e.assessment),
    [displayedRankedEntries]
  );

  const meritStandings = useMemo(
    () =>
      buildLiveCohortMeritStandings({
        students,
        assessments,
        term: termFilter,
        academicYear: school.academicYear,
        formFilter,
      }),
    [assessments, formFilter, school.academicYear, students, termFilter]
  );

  const matchedAssessment = useMemo(() => {
    if (editingId && lockedStudentSubject) {
      return assessments.find((a) => a.id === editingId) || null;
    }
    return (
      assessments.find(
        (a) =>
          a.studentId === studentId &&
          a.subject === subject &&
          a.term === term &&
          a.academicYear === school.academicYear
      ) ||
      assessments.find(
        (a) => a.studentId === studentId && a.subject === subject && a.term === term
      ) ||
      null
    );
  }, [assessments, editingId, lockedStudentSubject, school.academicYear, studentId, subject, term]);

  const matchedBreakdown = useMemo(
    () => (matchedAssessment ? normalizeAssessmentComponents(matchedAssessment) : null),
    [matchedAssessment]
  );

  const selectedStudent = useMemo(
    () => activeStudents.find((s) => s.id === studentId) || null,
    [activeStudents, studentId]
  );

  const activeEntryFormLevel: FormLevel =
    selectedStudent?.formLevel || matchedAssessment?.formLevel || 1;

  const modalFormSubjects = useMemo(() => {
    const base = getSubjectsForForm(schoolSubjects, activeEntryFormLevel);
    if (lockedStudentSubject && subject && !base.includes(subject)) {
      return [subject, ...base];
    }
    return base;
  }, [activeEntryFormLevel, lockedStudentSubject, schoolSubjects, subject]);

  const filterSubjectOptions = useMemo(() => {
    const configured =
      schoolSubjects.length > 0
        ? formFilter === 'all'
          ? schoolSubjects.map((s) => s.name)
          : getSubjectsForForm(schoolSubjects, formFilter)
        : MALAWI_SUBJECTS;
    const fromAssessments = assessments
      .filter((a) => a.term === termFilter && (formFilter === 'all' || a.formLevel === formFilter))
      .map((a) => a.subject);
    return Array.from(new Set([...configured, ...fromAssessments])).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [assessments, formFilter, schoolSubjects, termFilter]);

  const syncContextForSelection = (
    nextStudentId: string,
    nextSubject: string,
    nextTerm: TermName,
    preserveMaxForBatch?: { ca1Max: string; ca2Max: string; examMax: string }
  ) => {
    const existing =
      assessments.find(
        (a) =>
          a.studentId === nextStudentId &&
          a.subject === nextSubject &&
          a.term === nextTerm &&
          a.academicYear === school.academicYear
      ) ||
      assessments.find(
        (a) => a.studentId === nextStudentId && a.subject === nextSubject && a.term === nextTerm
      ) ||
      null;

    const detected = detectNextAssessmentStage(existing);
    setEditingId(existing?.id || null);
    setAutoDetectedStage(detected);
    setEntryMode(detected);

    if (existing) {
      const b = normalizeAssessmentComponents(existing);
      setCa1RawStr(b.hasCa1 ? String(b.ca1Raw) : '');
      setCa1MaxStr(
        b.hasCa1
          ? String(b.ca1Max)
          : preserveMaxForBatch && detected === 'ca1'
          ? preserveMaxForBatch.ca1Max
          : '20'
      );
      setCa2RawStr(b.hasCa2 ? String(b.ca2Raw) : '');
      setCa2MaxStr(
        b.hasCa2
          ? String(b.ca2Max)
          : preserveMaxForBatch && detected === 'ca2'
          ? preserveMaxForBatch.ca2Max
          : '20'
      );
      setExamRawStr(b.hasExam ? String(b.examRaw) : '');
      setExamMaxStr(
        b.hasExam
          ? String(b.examMax)
          : preserveMaxForBatch && detected === 'exam'
          ? preserveMaxForBatch.examMax
          : '100'
      );
      setTeacherCommentStr(existing.teacherComment || '');
    } else {
      setCa1RawStr('');
      setCa1MaxStr(preserveMaxForBatch ? preserveMaxForBatch.ca1Max : '20');
      setCa2RawStr('');
      setCa2MaxStr(preserveMaxForBatch ? preserveMaxForBatch.ca2Max : '20');
      setExamRawStr('');
      setExamMaxStr(preserveMaxForBatch ? preserveMaxForBatch.examMax : '100');
      setTeacherCommentStr('');
    }
    setErrorMsg('');
  };

  const openNewMark = () => {
    if (!canWriteMarks || activeStudents.length === 0) return;
    const defaultStudent =
      (formFilter !== 'all'
        ? activeStudents.find((s) => s.formLevel === formFilter)
        : undefined) || activeStudents[0];
    const formSubjs = getSubjectsForForm(schoolSubjects, defaultStudent.formLevel);
    const defaultSubj =
      subjectFilter !== 'all' && formSubjs.includes(subjectFilter)
        ? subjectFilter
        : formSubjs[0] || '';
    setLockedStudentSubject(false);
    const key = buildModalDraftKey(school.id, 'mark_entry', 'new');
    const saved = loadModalDraft<{
      studentId?: string;
      subject?: string;
      term?: TermName;
      entryMode?: AssessmentType;
      ca1RawStr?: string;
      ca1MaxStr?: string;
      ca2RawStr?: string;
      ca2MaxStr?: string;
      examRawStr?: string;
      examMaxStr?: string;
      teacherCommentStr?: string;
    }>(key);

    if (
      saved &&
      (saved.ca1RawStr || saved.ca2RawStr || saved.examRawStr || saved.teacherCommentStr) &&
      saved.studentId &&
      activeStudents.some((s) => s.id === saved.studentId)
    ) {
      setStudentId(saved.studentId);
      setSubject(saved.subject || defaultSubj);
      setTerm(saved.term || termFilter);
      setEntryMode(saved.entryMode || 'ca1');
      setCa1RawStr(saved.ca1RawStr || '');
      setCa1MaxStr(saved.ca1MaxStr || '20');
      setCa2RawStr(saved.ca2RawStr || '');
      setCa2MaxStr(saved.ca2MaxStr || '20');
      setExamRawStr(saved.examRawStr || '');
      setExamMaxStr(saved.examMaxStr || '100');
      setTeacherCommentStr(saved.teacherCommentStr || '');
      setMarkDraftRestored(true);
      setErrorMsg('');
    } else {
      setStudentId(defaultStudent.id);
      setSubject(defaultSubj);
      setTerm(termFilter);
      syncContextForSelection(defaultStudent.id, defaultSubj, termFilter);
      setMarkDraftRestored(false);
    }
    setModalOpen(true);
  };

  const openEditMark = (row: Assessment) => {
    if (!canWriteMarks) return;
    const b = normalizeAssessmentComponents(row);
    const detected = detectNextAssessmentStage(row);
    setLockedStudentSubject(true);
    setEditingId(row.id);
    setStudentId(row.studentId);
    setSubject(row.subject);
    setTerm(row.term);
    setAutoDetectedStage(detected);
    const key = buildModalDraftKey(school.id, 'mark_entry', row.id);
    const saved = loadModalDraft<{
      entryMode?: AssessmentType;
      ca1RawStr?: string;
      ca1MaxStr?: string;
      ca2RawStr?: string;
      ca2MaxStr?: string;
      examRawStr?: string;
      examMaxStr?: string;
      teacherCommentStr?: string;
    }>(key);

    const baseCa1 = b.hasCa1 ? String(b.ca1Raw) : '';
    const baseCa2 = b.hasCa2 ? String(b.ca2Raw) : '';
    const baseExam = b.hasExam ? String(b.examRaw) : '';
    const baseComment = row.teacherComment || '';
    if (
      saved &&
      ((saved.ca1RawStr ?? '') !== baseCa1 ||
        (saved.ca2RawStr ?? '') !== baseCa2 ||
        (saved.examRawStr ?? '') !== baseExam ||
        (saved.teacherCommentStr ?? baseComment) !== baseComment)
    ) {
      setEntryMode(saved.entryMode || (!b.hasCa1 ? 'ca1' : !b.hasCa2 ? 'ca2' : !b.hasExam ? 'exam' : 'ca1'));
      setCa1RawStr(saved.ca1RawStr ?? baseCa1);
      setCa1MaxStr(saved.ca1MaxStr || (b.hasCa1 ? String(b.ca1Max) : '20'));
      setCa2RawStr(saved.ca2RawStr ?? baseCa2);
      setCa2MaxStr(saved.ca2MaxStr || (b.hasCa2 ? String(b.ca2Max) : '20'));
      setExamRawStr(saved.examRawStr ?? baseExam);
      setExamMaxStr(saved.examMaxStr || (b.hasExam ? String(b.examMax) : '100'));
      setTeacherCommentStr(saved.teacherCommentStr ?? baseComment);
      setMarkDraftRestored(true);
    } else {
      setEntryMode(!b.hasCa1 ? 'ca1' : !b.hasCa2 ? 'ca2' : !b.hasExam ? 'exam' : 'ca1');
      setCa1RawStr(baseCa1);
      setCa1MaxStr(b.hasCa1 ? String(b.ca1Max) : '20');
      setCa2RawStr(baseCa2);
      setCa2MaxStr(b.hasCa2 ? String(b.ca2Max) : '20');
      setExamRawStr(baseExam);
      setExamMaxStr(b.hasExam ? String(b.examMax) : '100');
      setTeacherCommentStr(baseComment);
      setMarkDraftRestored(false);
    }
    setErrorMsg('');
    setModalOpen(true);
  };

  const discardMarkDraft = () => {
    clearModalDraft(markDraftKey);
    if (lockedStudentSubject && editingId) {
      const existing = assessments.find((a) => a.id === editingId);
      if (existing) {
        const b = normalizeAssessmentComponents(existing);
        setEntryMode(!b.hasCa1 ? 'ca1' : !b.hasCa2 ? 'ca2' : !b.hasExam ? 'exam' : 'ca1');
        setCa1RawStr(b.hasCa1 ? String(b.ca1Raw) : '');
        setCa1MaxStr(b.hasCa1 ? String(b.ca1Max) : '20');
        setCa2RawStr(b.hasCa2 ? String(b.ca2Raw) : '');
        setCa2MaxStr(b.hasCa2 ? String(b.ca2Max) : '20');
        setExamRawStr(b.hasExam ? String(b.examRaw) : '');
        setExamMaxStr(b.hasExam ? String(b.examMax) : '100');
        setTeacherCommentStr(existing.teacherComment || '');
      }
    } else {
      syncContextForSelection(studentId, subject, term);
    }
    setMarkDraftRestored(false);
  };

  const liveCalc = useMemo(() => {
    const parsePair = (rawStr: string, maxStr: string) => {
      if (rawStr.trim() === '') return { raw: 0, max: 0 };
      const raw = Number(rawStr);
      const max = Number(maxStr);
      if (!Number.isFinite(raw) || !Number.isFinite(max) || max <= 0) {
        return { raw: 0, max: 0 };
      }
      return { raw: Math.min(max, Math.max(0, raw)), max };
    };

    const ca1 = parsePair(ca1RawStr, ca1MaxStr);
    const ca2 = parsePair(ca2RawStr, ca2MaxStr);
    const exam = parsePair(examRawStr, examMaxStr);

    const ca1Score = calculateWeightedComponent(ca1.raw, ca1.max, 20);
    const ca2Score = calculateWeightedComponent(ca2.raw, ca2.max, 20);
    const caTotal = Math.round((ca1Score + ca2Score) * 10) / 10;
    const examScore = calculateWeightedComponent(exam.raw, exam.max, 60);

    const level: FormLevel = selectedStudent?.formLevel || matchedAssessment?.formLevel || 4;
    const maneb = calculateManebGrade(level, caTotal, examScore);

    const hasBothCaInputs = ca1RawStr.trim() !== '' && ca2RawStr.trim() !== '' && ca1.max > 0 && ca2.max > 0;
    const liveCa1Pct = hasBothCaInputs ? Math.round((ca1Score / 20) * 1000) / 10 : 0;
    const liveCa2Pct = hasBothCaInputs ? Math.round((ca2Score / 20) * 1000) / 10 : 0;
    const liveCaDropPct = hasBothCaInputs ? Math.round((liveCa1Pct - liveCa2Pct) * 10) / 10 : 0;

    return {
      ca1,
      ca1Score,
      ca2,
      ca2Score,
      caTotal,
      exam,
      examScore,
      maneb,
      hasBothCaInputs,
      liveCa1Pct,
      liveCa2Pct,
      liveCaDropPct,
    };
  }, [
    ca1MaxStr,
    ca1RawStr,
    ca2MaxStr,
    ca2RawStr,
    examMaxStr,
    examRawStr,
    matchedAssessment,
    selectedStudent,
  ]);

  const liveProjectedRank = useMemo(() => {
    if (!modalOpen || !studentId || !subject) return null;
    const stu = studentsById.get(studentId);
    const targetForm: FormLevel = stu?.formLevel || matchedAssessment?.formLevel || 1;
    const hasAnyInput =
      ca1RawStr.trim() !== '' || ca2RawStr.trim() !== '' || examRawStr.trim() !== '';
    if (!hasAnyInput && !matchedAssessment) return null;

    const peerAssessments = assessments.filter(
      (a) =>
        a.term === term &&
        a.formLevel === targetForm &&
        a.subject === subject &&
        a.studentId !== studentId &&
        (!a.academicYear || a.academicYear === school.academicYear)
    );

    const candidate: Assessment = {
      id: matchedAssessment?.id || '__live_preview__',
      ownerId,
      studentId,
      studentName: stu?.fullName || matchedAssessment?.studentName || 'Current Student',
      formLevel: targetForm,
      stream: stu?.stream || matchedAssessment?.stream || 'A',
      term,
      academicYear: school.academicYear,
      subject,
      caScore: liveCalc.caTotal,
      examScore: liveCalc.examScore,
      totalScore: liveCalc.maneb.totalScore,
      grade: liveCalc.maneb.grade,
      gradePoint: liveCalc.maneb.gradePoint,
      remark: liveCalc.maneb.remark,
    };

    const ranked = rankAssessmentsByPerformance([...peerAssessments, candidate], studentsById);
    const match = ranked.find((r) => r.assessment.studentId === studentId);
    if (!match) return null;
    return {
      rank: match.rank,
      ordinal: match.ordinal,
      totalEntries: match.totalEntries,
      isTied: match.isTied,
      formLevel: targetForm,
    };
  }, [
    assessments,
    ca1RawStr,
    ca2RawStr,
    examRawStr,
    liveCalc.caTotal,
    liveCalc.examScore,
    liveCalc.maneb.grade,
    liveCalc.maneb.gradePoint,
    liveCalc.maneb.remark,
    liveCalc.maneb.totalScore,
    matchedAssessment,
    modalOpen,
    ownerId,
    school.academicYear,
    studentId,
    studentsById,
    subject,
    term,
  ]);

  const validateAndBuildPayload = () => {
    const stu = students.find((s) => s.id === studentId);
    if (!stu) {
      return { error: 'Please select a valid student.' } as const;
    }
    if (!subject.trim()) {
      return {
        error: `No subjects are assigned to Form ${stu.formLevel}. Assign subjects in Staff & Settings first.`,
      } as const;
    }

    const checkComponent = (
      label: string,
      rawStr: string,
      maxStr: string,
      required: boolean
    ): { ok: true; raw: number; max: number } | { ok: false; error: string } => {
      if (!required && rawStr.trim() === '') {
        return { ok: true, raw: 0, max: 0 };
      }
      const raw = Number(rawStr);
      const max = Number(maxStr);
      if (rawStr.trim() === '' || !Number.isFinite(raw) || raw < 0) {
        return { ok: false, error: `${label}: Please enter a valid student score (0 or higher).` };
      }
      if (maxStr.trim() === '' || !Number.isFinite(max) || max <= 0 || max > 1000) {
        return { ok: false, error: `${label}: Total marks must be between 1 and 1000.` };
      }
      if (raw > max) {
        return {
          ok: false,
          error: `${label}: Student score (${raw}) cannot exceed total marks (${max}).`,
        };
      }
      return { ok: true, raw, max };
    };

    const r1 = checkComponent('CA 1 (20%)', ca1RawStr, ca1MaxStr, entryMode === 'ca1');
    if (!r1.ok) return { error: r1.error } as const;

    const r2 = checkComponent('CA 2 (20%)', ca2RawStr, ca2MaxStr, entryMode === 'ca2');
    if (!r2.ok) return { error: r2.error } as const;

    const r3 = checkComponent('Summative Exam (60%)', examRawStr, examMaxStr, entryMode === 'exam');
    if (!r3.ok) return { error: r3.error } as const;

    return {
      error: null,
      payload: {
        studentId: stu.id,
        studentName: stu.fullName,
        studentEmail: (stu.studentEmail || '').trim().toLowerCase(),
        formLevel: stu.formLevel,
        stream: stu.stream,
        term,
        academicYear: school.academicYear,
        subject,
        ca1Raw: r1.raw,
        ca1Max: r1.max,
        ca2Raw: r2.raw,
        ca2Max: r2.max,
        examRaw: r3.raw,
        examMax: r3.max,
        teacherComment: teacherCommentStr.trim(),
      },
    } as const;
  };

  const handleSave = async (advanceToNextStudent: boolean) => {
    if (!canWriteMarks) return;
    const validated = validateAndBuildPayload();
    if (validated.error || !validated.payload) {
      setErrorMsg(validated.error || 'Please check your assessment inputs.');
      return;
    }

    setSaving(true);
    setErrorMsg('');
    try {
      const targetDocId = editingId || matchedAssessment?.id || undefined;
      await saveAssessment(school.id, ownerId, validated.payload, targetDocId);
      clearModalDraft(markDraftKey);
      setMarkDraftRestored(false);

      if (advanceToNextStudent && !lockedStudentSubject) {
        const currentIdx = activeStudents.findIndex((s) => s.id === studentId);
        const nextStudent =
          currentIdx >= 0 && currentIdx + 1 < activeStudents.length
            ? activeStudents[currentIdx + 1]
            : null;
        if (nextStudent) {
          const nextFormSubjs = getSubjectsForForm(schoolSubjects, nextStudent.formLevel);
          const nextSubj = nextFormSubjs.includes(subject) ? subject : nextFormSubjs[0] || '';
          setStudentId(nextStudent.id);
          setSubject(nextSubj);
          syncContextForSelection(nextStudent.id, nextSubj, term, {
            ca1Max: ca1MaxStr || '20',
            ca2Max: ca2MaxStr || '20',
            examMax: examMaxStr || '100',
          });
          setSaving(false);
          return;
        }
      }
      setModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save assessment.');
    } finally {
      setSaving(false);
    }
  };

  const handleExportCSV = () => {
    downloadCSV(
      `${school.name.toLowerCase().replace(/\s+/g, '-')}-marks-${termFilter}.csv`,
      [
        'Rank',
        'Student',
        'Form',
        'Term',
        'Subject',
        'CA 1 Score',
        'CA 1 Out Of',
        'CA 1 (20%)',
        'CA 2 Score',
        'CA 2 Out Of',
        'CA 2 (20%)',
        'Summative Score',
        'Summative Out Of',
        'Summative (60%)',
        'Total (100%)',
        'Exam Grade',
        'Remark',
      ],
      displayedRankedEntries.map(({ assessment: a, rank, isTied }) => {
        const b = normalizeAssessmentComponents(a);
        return [
          isTied ? `#${rank}=` : `#${rank}`,
          a.studentName,
          `Form ${a.formLevel}${a.stream}`,
          a.term,
          a.subject,
          b.hasCa1 ? b.ca1Raw : '-',
          b.hasCa1 ? b.ca1Max : '-',
          b.hasCa1 ? b.ca1Score : '-',
          b.hasCa2 ? b.ca2Raw : '-',
          b.hasCa2 ? b.ca2Max : '-',
          b.hasCa2 ? b.ca2Score : '-',
          b.hasExam ? b.examRaw : '-',
          b.hasExam ? b.examMax : '-',
          b.hasExam ? b.examScore : '-',
          a.totalScore,
          a.grade,
          a.remark,
        ];
      })
    );
  };

  const handleDownloadPdf = () => {
    downloadMarksPdfReport({
      school,
      assessments: filtered,
      termFilter,
      formFilter,
      subjectFilter,
    });
  };

  const hasNextStudent = useMemo(() => {
    if (lockedStudentSubject) return false;
    const idx = activeStudents.findIndex((s) => s.id === studentId);
    return idx >= 0 && idx + 1 < activeStudents.length;
  }, [activeStudents, lockedStudentSubject, studentId]);

  const activeConfig = useMemo(() => {
    if (entryMode === 'ca1') {
      return {
        label: 'CA 1 (Continuous Assessment 1)',
        weight: 20,
        rawStr: ca1RawStr,
        setRawStr: setCa1RawStr,
        maxStr: ca1MaxStr,
        setMaxStr: setCa1MaxStr,
        weightedScore: liveCalc.ca1Score,
        quickTotals: QUICK_TOTALS_CA,
      };
    }
    if (entryMode === 'ca2') {
      return {
        label: 'CA 2 (Continuous Assessment 2)',
        weight: 20,
        rawStr: ca2RawStr,
        setRawStr: setCa2RawStr,
        maxStr: ca2MaxStr,
        setMaxStr: setCa2MaxStr,
        weightedScore: liveCalc.ca2Score,
        quickTotals: QUICK_TOTALS_CA,
      };
    }
    return {
      label: 'Summative Assessment (Final Exam)',
      weight: 60,
      rawStr: examRawStr,
      setRawStr: setExamRawStr,
      maxStr: examMaxStr,
      setMaxStr: setExamMaxStr,
      weightedScore: liveCalc.examScore,
      quickTotals: QUICK_TOTALS_EXAM,
    };
  }, [
    ca1MaxStr,
    ca1RawStr,
    ca2MaxStr,
    ca2RawStr,
    entryMode,
    examMaxStr,
    examRawStr,
    liveCalc.ca1Score,
    liveCalc.ca2Score,
    liveCalc.examScore,
  ]);

  const allThreeSaved =
    !!matchedBreakdown?.hasCa1 && !!matchedBreakdown?.hasCa2 && !!matchedBreakdown?.hasExam;

  const sortedReportStudents = useMemo(
    () => sortStudentsForRegister(students, { groupByForm: true }),
    [students]
  );

  const openTermReportCard = (targetStudentId?: string) => {
    if (sortedReportStudents.length === 0) return;
    const defaultWithMarks =
      filtered[0]?.studentId ||
      sortedReportStudents.find((s) => s.status === 'Active')?.id ||
      sortedReportStudents[0].id;
    setReportStudentId(targetStudentId || defaultWithMarks);
    setReportTerm(termFilter);
    setReportCardOpen(true);
  };

  return (
    <div className="space-y-5">
      {/* Header & Filters */}
      <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Exam Marks &amp; Gradebook
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
              CA1 20% + CA2 20% + Exam 60% · JCE A–F · MSCE 1–9
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openTermReportCard()}
              disabled={students.length === 0}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl border border-emerald-700/30 bg-emerald-50/70 dark:bg-emerald-950/40 text-xs font-semibold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/70 dark:hover:bg-emerald-950/70 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Report Cards PDF</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileDown className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Marks Ledger PDF</span>
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Export CSV</span>
            </button>
            {canWriteMarks && (
              <button
                type="button"
                onClick={openNewMark}
                disabled={activeStudents.length === 0}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Record Score</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
            {TERMS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTermFilter(t)}
                className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold cursor-pointer ${
                  termFilter === t
                    ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto">
            {(['all', 1, 2, 3, 4] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFormFilter(f)}
                className={`min-h-[38px] px-3 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer ${
                  formFilter === f
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                {f === 'all' ? 'All Forms' : `Form ${f}`}
              </button>
            ))}
          </div>

          <select
            aria-label="Filter by subject"
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium"
          >
            <option value="all">All Subjects</option>
            {filterSubjectOptions.map((subj) => (
              <option key={subj} value={subj}>
                {subj}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setAtRiskOnly((v) => !v)}
            className={`inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-xl border text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              atRiskOnly
                ? 'bg-rose-600 text-white border-rose-600'
                : caDropAnalysis.alerts.length > 0
                ? 'bg-rose-50/80 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 hover:bg-rose-100/70'
                : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
            }`}
          >
            <TrendingDown className="w-3.5 h-3.5" aria-hidden="true" />
            <span>At-Risk CA Drops ({caDropAnalysis.alerts.length})</span>
          </button>

          <div
            role="tablist"
            aria-label="Gradebook view mode"
            className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900 ml-auto"
          >
            <button
              type="button"
              role="tab"
              aria-selected={gradebookView === 'entries'}
              onClick={() => setGradebookView('entries')}
              className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${
                gradebookView === 'entries'
                  ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Marks Ledger ({filtered.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={gradebookView === 'merit'}
              onClick={() => setGradebookView('merit')}
              className={`inline-flex items-center gap-1.5 min-h-[34px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${
                gradebookView === 'merit'
                  ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Trophy className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <span>Class Merit Ranking ({meritStandings.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Automated Early-Warning Banner */}
      {caDropAnalysis.alerts.length > 0 && (
        <div className="rounded-2xl border border-amber-300/80 dark:border-amber-900/70 bg-amber-50/80 dark:bg-amber-950/30 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 text-amber-950 dark:text-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
            <span>
              <strong>{caDropAnalysis.studentSummaries.length} at-risk student{caDropAnalysis.studentSummaries.length === 1 ? '' : 's'}</strong>{' '}
              flagged across {caDropAnalysis.alerts.length} subject{caDropAnalysis.alerts.length === 1 ? '' : 's'} (steepest drop:{' '}
              <span className="font-mono font-semibold">
                {caDropAnalysis.alerts[0].studentName} in {caDropAnalysis.alerts[0].subject}: {caDropAnalysis.alerts[0].ca1Pct.toFixed(0)}% → {caDropAnalysis.alerts[0].ca2Pct.toFixed(0)}%
              </span>
              ).
            </span>
          </div>
          <button
            type="button"
            onClick={() => setAtRiskOnly((v) => !v)}
            className="text-xs font-semibold text-amber-900 dark:text-amber-300 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
          >
            {atRiskOnly ? 'Show All Records' : 'Filter Flagged Students'}
          </button>
        </div>
      )}

      {/* Gradebook Visual Analytics */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
              Exam Grade Distribution
            </h2>
            <ManebGradeDistributionChart assessments={filtered} />
          </div>
          <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
              Subject Mean Composition
            </h2>
            <SubjectComponentBarChart items={summarizeSubjectComponents(filtered)} maxItems={6} />
          </div>
        </div>
      )}

      {gradebookView === 'merit' ? (
        /* Live Class Merit Ranking Leaderboard */
        <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Live Performance Merit Ranking · {termFilter}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {formFilter === 'all'
                  ? 'Auto-ranked by overall weighted term average across Forms 1–4 (tie-broken by MSCE Best-6 points & subjects passed).'
                  : `Auto-ranked for Form ${formFilter} by overall weighted term average (updates immediately as marks are entered).`}
              </p>
            </div>
            <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
              {meritStandings.length} student{meritStandings.length === 1 ? '' : 's'} ranked
            </div>
          </div>

          {meritStandings.length === 0 ? (
            <div className="py-12 px-6 text-center text-sm text-slate-500 dark:text-slate-400">
              No graded students found for {termFilter}
              {formFilter !== 'all' ? ` in Form ${formFilter}` : ''}. Record subject marks to generate live merit rankings.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 text-xs text-slate-500 dark:text-slate-400">
                    <th className="py-3 px-4 font-medium">Rank</th>
                    <th className="py-3 px-4 font-medium">Student</th>
                    <th className="py-3 px-3 font-medium">Class</th>
                    <th className="py-3 px-3 font-medium text-right">Subjects</th>
                    <th className="py-3 px-3 font-medium text-right">CA Mean (40%)</th>
                    <th className="py-3 px-3 font-medium text-right">Exam Mean (60%)</th>
                    <th className="py-3 px-3 font-medium text-right">Term Avg</th>
                    <th className="py-3 px-3 font-medium text-right">Best-6 / Credits</th>
                    <th className="py-3 px-3 font-medium">Standing</th>
                    <th className="py-3 px-4 font-medium text-right">Report</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {meritStandings.map((row) => {
                    const { student: stu, formRank, overallRank, overallOrdinal, summary } = row;
                    const displayPos =
                      formFilter === 'all'
                        ? overallOrdinal
                        : formatOrdinalPosition(formRank.rank);
                    const isTopThree =
                      (formFilter === 'all' ? overallRank : formRank.rank) <= 3;
                    return (
                      <tr
                        key={stu.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30"
                      >
                        <td className="py-3 px-4 whitespace-nowrap font-mono tabular-nums">
                          <div
                            className={`text-sm font-bold ${
                              isTopThree
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-slate-800 dark:text-slate-200'
                            }`}
                          >
                            {displayPos}
                          </div>
                          {formFilter === 'all' && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {formatOrdinalPosition(formRank.rank)}/{formRank.totalRanked} in F{stu.formLevel}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() => openTermReportCard(stu.id)}
                            className="font-semibold text-slate-900 dark:text-slate-100 hover:text-emerald-700 dark:hover:text-emerald-400 hover:underline text-left cursor-pointer"
                          >
                            {stu.fullName}
                          </button>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                            {stu.admissionNo} · {stu.gender}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          Form {stu.formLevel}{stu.stream}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300">
                          {summary.subjectCount} ({summary.passedSubjectCount} pass)
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300">
                          {summary.caAverage.toFixed(1)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300">
                          {summary.summativeAverage.toFixed(1)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                          {summary.weightedAverage.toFixed(1)}%
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300">
                          {stu.formLevel >= 3
                            ? summary.standing.bestSixPoints !== null
                              ? `${summary.standing.bestSixPoints} pts`
                              : `${summary.creditSubjectCount} cr`
                            : `${summary.creditSubjectCount} credits`}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap text-xs">
                          <span
                            className={`font-semibold ${
                              summary.standing.outcome === 'Pass'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : summary.standing.outcome === 'Fail'
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {summary.overallGrade} · {summary.standing.outcome}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openTermReportCard(stu.id)}
                            className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
                          >
                            <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Report</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* Marks Table (Auto-Ranked by Performance) */
        <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
          {filtered.length === 0 ? (
            <div className="py-12 px-6 text-center text-sm text-slate-500 dark:text-slate-400">
              No marks recorded for {termFilter}. Click &ldquo;Record Score&rdquo; to enter CA 1 (20%), CA 2 (20%), or Summative (60%) marks.
            </div>
          ) : (
            <>
              <div className="px-4 sm:px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="text-slate-600 dark:text-slate-300">
                  {rankedEntries[0] && (
                    <span>
                      <strong className="text-emerald-700 dark:text-emerald-400 font-mono">
                        #1 Top Performance:
                      </strong>{' '}
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {rankedEntries[0].assessment.studentName}
                      </span>{' '}
                      ({rankedEntries[0].assessment.subject} ·{' '}
                      <span className="font-mono font-semibold tabular-nums">
                        {rankedEntries[0].assessment.totalScore}%
                      </span>
                      )
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="marks-sort-mode" className="text-slate-500 dark:text-slate-400">
                    Order:
                  </label>
                  <select
                    id="marks-sort-mode"
                    value={entriesSortOrder}
                    onChange={(e) => setEntriesSortOrder(e.target.value as 'ranked' | 'register')}
                    className="min-h-[34px] px-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
                  >
                    <option value="ranked">Auto-Ranked by Performance (Highest First)</option>
                    <option value="register">Register Order (Boys ↑ A–Z · Girls ↓ A–Z)</option>
                  </select>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                      <th className="py-3 px-3 font-medium text-center w-14">Rank</th>
                      <th className="py-3 px-4 font-medium">Student</th>
                      <th className="py-3 px-3 font-medium">Class</th>
                      <th className="py-3 px-3 font-medium">Subject</th>
                      <th className="py-3 px-3 font-medium text-right">CA 1 (20%)</th>
                      <th className="py-3 px-3 font-medium text-right">CA 2 (20%)</th>
                      <th className="py-3 px-3 font-medium text-right">Summative (60%)</th>
                      <th className="py-3 px-3 font-medium text-right">Total</th>
                      <th className="py-3 px-3 font-medium text-right">Grade</th>
                      <th className="py-3 px-3 font-medium">Remark</th>
                      {canWriteMarks && (
                        <th className="py-3 px-4 font-medium text-right">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {displayedRankedEntries.map((entry) => {
                      const a = entry.assessment;
                      const b = normalizeAssessmentComponents(a);
                      const dropAlert = caDropAnalysis.byAssessmentId.get(a.id);
                      const rankMeta = rankByAssessmentId.get(a.id) || entry;
                      return (
                        <tr
                          key={a.id}
                          className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/30 ${
                            dropAlert?.severity === 'critical'
                              ? 'bg-rose-50/40 dark:bg-rose-950/15'
                              : dropAlert
                              ? 'bg-amber-50/35 dark:bg-amber-950/10'
                              : ''
                          }`}
                        >
                          <td className="py-3 px-3 text-center font-mono tabular-nums whitespace-nowrap">
                            <span
                              className={`text-xs font-bold ${
                                rankMeta.rank === 1
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : rankMeta.rank <= 3
                                  ? 'text-slate-900 dark:text-white'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                              title={
                                rankMeta.isTied
                                  ? `Tied for ${rankMeta.ordinal} place out of ${rankMeta.totalEntries}`
                                  : `${rankMeta.ordinal} out of ${rankMeta.totalEntries}`
                              }
                            >
                              {rankMeta.ordinal}
                              {rankMeta.isTied ? '=' : ''}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-900 dark:text-slate-100">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openTermReportCard(a.studentId)}
                                className="text-left hover:text-emerald-700 dark:hover:text-emerald-400 hover:underline cursor-pointer"
                                title={`Open ${a.studentName}'s Term Report Card`}
                              >
                                {a.studentName}
                              </button>
                              {dropAlert && (
                                <span
                                  className={`inline-flex items-center gap-0.5 text-[10px] font-semibold font-mono ${
                                    dropAlert.severity === 'critical'
                                      ? 'text-rose-600 dark:text-rose-400'
                                      : 'text-amber-700 dark:text-amber-400'
                                  }`}
                                  title={`CA dropped ${dropAlert.dropPct}% (${dropAlert.ca1Pct}% → ${dropAlert.ca2Pct}%)`}
                                >
                                  <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
                                  {dropAlert.severity === 'critical' ? 'High Risk' : 'Watch'}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            Form {a.formLevel}{a.stream}
                          </td>
                          <td className="py-3 px-3 text-slate-800 dark:text-slate-200">
                            <div>{a.subject}</div>
                            {a.teacherComment && (
                              <div
                                className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2 max-w-[230px]"
                                title={a.teacherComment}
                              >
                                {a.teacherComment}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums">
                            {b.hasCa1 ? (
                              <div>
                                <div className="text-slate-900 dark:text-slate-100">{b.ca1Score.toFixed(1)}</div>
                                <div className="text-[10px] text-slate-400">
                                  {b.ca1Raw}/{b.ca1Max}
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums">
                            {b.hasCa2 ? (
                              <div>
                                <div className="text-slate-900 dark:text-slate-100">{b.ca2Score.toFixed(1)}</div>
                                <div className="text-[10px] text-slate-400">
                                  {b.ca2Raw}/{b.ca2Max}
                                </div>
                                {dropAlert && (
                                  <div
                                    className={`text-[10px] font-semibold ${
                                      dropAlert.severity === 'critical'
                                        ? 'text-rose-600 dark:text-rose-400'
                                        : 'text-amber-700 dark:text-amber-400'
                                    }`}
                                  >
                                    ↓ -{dropAlert.dropPct.toFixed(0)}%
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums">
                            {b.hasExam ? (
                              <div>
                                <div className="text-slate-900 dark:text-slate-100">{b.examScore.toFixed(1)}</div>
                                <div className="text-[10px] text-slate-400">
                                  {b.examRaw}/{b.examMax}
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold">
                            {a.totalScore}%
                          </td>
                          <td
                            className={`py-3 px-3 text-right font-mono font-bold ${
                              a.gradePoint <= 6
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : a.gradePoint <= 8
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {a.grade}
                          </td>
                          <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-400">
                            {a.remark}
                          </td>
                          {canWriteMarks && (
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => openEditMark(a)}
                                aria-label={`Edit ${a.studentName} ${a.subject} score`}
                                className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteAssessmentError('');
                                  setConfirmAssessment(a);
                                }}
                                aria-label={`Delete ${a.studentName} ${a.subject} score`}
                                className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Record / Edit Mark Modal */}
      {modalOpen && (
        <ModalBackdrop
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          disabled={saving}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
        >
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {lockedStudentSubject ? 'Edit Assessment Score' : 'Record Assessment Score'}
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  2 Continuous Assessments (CA 1: 20%, CA 2: 20%) + Final Summative (60%)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSave(false);
              }}
              className="mt-4 space-y-4"
            >
              <DraftRestoredNotice visible={markDraftRestored} onDiscard={discardMarkDraft} />

              {errorMsg && (
                <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                  {errorMsg}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Student
                </label>
                <select
                  value={studentId}
                  disabled={lockedStudentSubject}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    const nextStu = activeStudents.find((s) => s.id === nextId);
                    const nextFormSubjs = nextStu
                      ? getSubjectsForForm(schoolSubjects, nextStu.formLevel)
                      : MALAWI_SUBJECTS;
                    const nextSubj = nextFormSubjs.includes(subject)
                      ? subject
                      : nextFormSubjs[0] || '';
                    setStudentId(nextId);
                    setSubject(nextSubj);
                    syncContextForSelection(nextId, nextSubj, term);
                  }}
                  className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm disabled:opacity-60"
                >
                  {activeStudents.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName} (Form {s.formLevel}{s.stream})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Subject
                    </label>
                    <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                      Form {activeEntryFormLevel}
                    </span>
                  </div>
                  <select
                    value={subject}
                    disabled={lockedStudentSubject || modalFormSubjects.length === 0}
                    onChange={(e) => {
                      const nextSubj = e.target.value;
                      setSubject(nextSubj);
                      syncContextForSelection(studentId, nextSubj, term);
                    }}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm disabled:opacity-60"
                  >
                    {modalFormSubjects.length === 0 ? (
                      <option value="">No subjects assigned to Form {activeEntryFormLevel}</option>
                    ) : (
                      modalFormSubjects.map((subj) => (
                        <option key={subj} value={subj}>
                          {subj}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Term
                  </label>
                  <select
                    value={term}
                    disabled={lockedStudentSubject}
                    onChange={(e) => {
                      const nextTerm = e.target.value as TermName;
                      setTerm(nextTerm);
                      syncContextForSelection(studentId, subject, nextTerm);
                    }}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm disabled:opacity-60"
                  >
                    {TERMS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {!lockedStudentSubject && modalFormSubjects.length === 0 && (
                <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200">
                  <span>No curriculum subjects assigned to Form {activeEntryFormLevel} yet.</span>
                  {onOpenStaffSettings && (
                    <button
                      type="button"
                      onClick={() => {
                        setModalOpen(false);
                        onOpenStaffSettings();
                      }}
                      className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Configure Subjects
                    </button>
                  )}
                </div>
              )}

              {!lockedStudentSubject && schoolSubjects.length === 0 && onOpenStaffSettings && (
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>Using default Malawi subject list.</span>
                  <button
                    type="button"
                    onClick={() => {
                      setModalOpen(false);
                      onOpenStaffSettings();
                    }}
                    className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                  >
                    Customize per Form
                  </button>
                </div>
              )}

              {/* Auto-Detected Stage Banner */}
              {!lockedStudentSubject && (
                <div className="rounded-xl bg-emerald-50/80 dark:bg-emerald-950/35 border border-emerald-200/80 dark:border-emerald-900/60 px-3.5 py-2.5 flex items-start gap-2.5 text-xs text-emerald-900 dark:text-emerald-200">
                  <Sparkles className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    {autoDetectedStage === 'ca1' && (
                      <span>
                        <strong>Auto-detected: CA 1 (20%)</strong> — First continuous assessment for this subject.
                      </span>
                    )}
                    {autoDetectedStage === 'ca2' && matchedBreakdown && (
                      <span>
                        <strong>Auto-detected: CA 2 (20%)</strong> — CA 1 already recorded ({matchedBreakdown.ca1Raw}/{matchedBreakdown.ca1Max} → {matchedBreakdown.ca1Score.toFixed(1)}%). Entering second continuous assessment.
                      </span>
                    )}
                    {autoDetectedStage === 'exam' && !allThreeSaved && matchedBreakdown && (
                      <span>
                        <strong>Auto-detected: Summative (60%)</strong> — Both CA 1 &amp; CA 2 recorded ({matchedBreakdown.caScore.toFixed(1)}/40). Entering final 60% exam score.
                      </span>
                    )}
                    {allThreeSaved && matchedBreakdown && (
                      <span>
                        <strong>All 3 assessments recorded</strong> — CA 1 ({matchedBreakdown.ca1Score.toFixed(1)}%), CA 2 ({matchedBreakdown.ca2Score.toFixed(1)}%), Summative ({matchedBreakdown.examScore.toFixed(1)}%). Select any tab below to edit.
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Strictly 3 Assessment Type Tabs: CA 1 (20%), CA 2 (20%), Summative (60%) */}
              <div>
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Assessment Type
                </div>
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
                  {(
                    [
                      { id: 'ca1', label: '1. CA 1 (20%)', done: !!matchedBreakdown?.hasCa1 },
                      { id: 'ca2', label: '2. CA 2 (20%)', done: !!matchedBreakdown?.hasCa2 },
                      { id: 'exam', label: '3. Summative (60%)', done: !!matchedBreakdown?.hasExam },
                    ] as const
                  ).map((tab) => {
                    const active = entryMode === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          setErrorMsg('');
                          setEntryMode(tab.id);
                        }}
                        className={`min-h-[38px] px-2 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                          active
                            ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                        }`}
                      >
                        {tab.done && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        )}
                        <span className="truncate">{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Active Assessment Input Card */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4 space-y-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {activeConfig.label}
                  </span>
                  <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                    Weight: {activeConfig.weight}%
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Student Score
                    </label>
                    <input
                      type="number"
                      min="0"
                      max={activeConfig.maxStr || '1000'}
                      step="0.5"
                      placeholder="e.g. 16"
                      value={activeConfig.rawStr}
                      onChange={(e) => activeConfig.setRawStr(e.target.value)}
                      className="w-full min-h-[44px] px-3 rounded-xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-700 font-mono text-base font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Total Marks (Out Of)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      step="1"
                      placeholder="e.g. 20"
                      value={activeConfig.maxStr}
                      onChange={(e) => activeConfig.setMaxStr(e.target.value)}
                      className="w-full min-h-[44px] px-3 rounded-xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-700 font-mono text-base font-semibold"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-1">
                    Out of:
                  </span>
                  {activeConfig.quickTotals.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => activeConfig.setMaxStr(String(preset))}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium cursor-pointer border ${
                        Number(activeConfig.maxStr) === preset
                          ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100'
                          : 'bg-white dark:bg-[#161B22] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      /{preset}
                    </button>
                  ))}
                </div>

                <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between text-xs">
                  <span className="font-mono text-slate-600 dark:text-slate-400">
                    ({activeConfig.rawStr || '0'} ÷ {activeConfig.maxStr || '0'}) ×{' '}
                    {activeConfig.weight}%
                  </span>
                  <span className="font-mono font-bold text-sm text-emerald-700 dark:text-emerald-400">
                    = {activeConfig.weightedScore.toFixed(1)} / {activeConfig.weight}
                  </span>
                </div>
              </div>

              {/* Combined 3-Part Breakdown & Exam Grade Preview */}
              <div className="rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
                <div className="grid grid-cols-3 gap-2 text-center text-[11px] pb-2 border-b border-slate-200/80 dark:border-slate-800">
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">CA 1 (20%)</div>
                    <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                      {liveCalc.ca1Score.toFixed(1)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">CA 2 (20%)</div>
                    <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                      {liveCalc.ca2Score.toFixed(1)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Summative (60%)</div>
                    <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                      {liveCalc.examScore.toFixed(1)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-0.5 gap-3">
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {liveCalc.maneb.system} Combined Standing (100%)
                    </div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                      {liveCalc.maneb.totalScore}% · {liveCalc.maneb.remark}
                    </div>
                    {liveProjectedRank && (
                      <div className="text-[11px] font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-0.5">
                        Live Subject Rank: {liveProjectedRank.ordinal}
                        {liveProjectedRank.isTied ? ' (tied)' : ''} of {liveProjectedRank.totalEntries} in Form {liveProjectedRank.formLevel}
                      </div>
                    )}
                  </div>
                  <div className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400">
                    {liveCalc.maneb.grade}
                  </div>
                </div>

                {liveCalc.hasBothCaInputs && liveCalc.liveCaDropPct >= 10 && (
                  <div className="mt-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 px-3 py-2 flex items-start gap-2 text-xs text-rose-800 dark:text-rose-200">
                    <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>
                      <strong>Early-Warning Flag:</strong> CA 2 dropped{' '}
                      <span className="font-mono font-semibold">-{liveCalc.liveCaDropPct}%</span>{' '}
                      from CA 1 ({liveCalc.liveCa1Pct}% → {liveCalc.liveCa2Pct}%). Student will be
                      flagged as at-risk.
                    </span>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Subject Teacher Comment (Optional)
                  </label>
                  <span className="text-[10px] font-mono text-slate-400">
                    {teacherCommentStr.length}/240
                  </span>
                </div>
                <input
                  type="text"
                  maxLength={240}
                  placeholder="e.g. Strong grasp of algebraic equations; practice essay structure."
                  value={teacherCommentStr}
                  onChange={(e) => setTeacherCommentStr(e.target.value)}
                  className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Shown to the student on their verified report card dashboard.
                </p>
              </div>

              <div className="pt-2 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                {hasNextStudent && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleSave(true)}
                    className="min-h-[42px] px-4 rounded-xl border border-emerald-700/40 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-xs font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    Save &amp; Next Student
                  </button>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[42px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {saving ? 'Saving...' : 'Save Score'}
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}

      {/* Printable Student Report Card PDF Exporter Modal */}
      <ReportCardExportModal
        open={reportCardOpen}
        onClose={() => setReportCardOpen(false)}
        school={school}
        students={students}
        assessments={assessments}
        reportRemarks={reportRemarks}
        attendance={attendance}
        initialStudentId={reportStudentId}
        initialTerm={reportTerm}
        currentStaffName={currentStaffName}
        currentStaffRole={currentStaffRole}
      />

      {/* Safe Delete Assessment Modal */}
      <ConfirmDeleteModal
        open={!!confirmAssessment}
        title="Delete Subject Assessment"
        itemName={
          confirmAssessment
            ? `${confirmAssessment.studentName} · ${confirmAssessment.subject} (${confirmAssessment.term})`
            : ''
        }
        description={
          confirmAssessment
            ? `This permanently deletes CA 1, CA 2, and Summative exam marks for this subject (Total: ${confirmAssessment.totalScore}%, Grade ${confirmAssessment.grade}). You can edit individual scores instead if you only want to correct a mark.`
            : ''
        }
        confirmLabel="Delete Score Record"
        deleting={deletingAssessment}
        error={deleteAssessmentError}
        onCancel={() => {
          if (!deletingAssessment) setConfirmAssessment(null);
        }}
        onConfirm={async () => {
          if (!confirmAssessment) return;
          setDeletingAssessment(true);
          setDeleteAssessmentError('');
          try {
            await removeAssessment(school.id, confirmAssessment.id);
            setConfirmAssessment(null);
          } catch (err) {
            setDeleteAssessmentError(
              err instanceof Error ? err.message : 'Unable to delete assessment record.'
            );
          } finally {
            setDeletingAssessment(false);
          }
        }}
      />
    </div>
  );
};
