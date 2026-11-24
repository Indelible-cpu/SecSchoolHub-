import type { Assessment, FormLevel, TermName } from './types.ts';

export const TERM_SEQUENCE: TermName[] = ['Term 1', 'Term 2', 'Term 3'];

export interface TermPerformancePoint {
  key: string;
  academicYear: string;
  term: TermName;
  label: string;
  fullLabel: string;
  aggregateMean: number | null;
  passRatePct: number | null;
  deltaFromPrev: number | null;
  form1: number | null;
  form2: number | null;
  form3: number | null;
  form4: number | null;
  studentCount: number;
  assessmentCount: number;
  hasData: boolean;
}

export interface TermPerformanceSummary {
  points: TermPerformancePoint[];
  activeForms: FormLevel[];
  availableYears: string[];
  availableSubjects: string[];
  activeTermsCount: number;
  latestPoint: TermPerformancePoint | null;
  previousPoint: TermPerformancePoint | null;
  bestPoint: TermPerformancePoint | null;
  totalAssessments: number;
}

export interface TermPerformanceFilterOptions {
  currentAcademicYear?: string;
  formFilter?: 'ALL' | FormLevel;
  subjectFilter?: 'ALL' | string;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function termOrderIndex(term: string): number {
  const idx = TERM_SEQUENCE.indexOf(term as TermName);
  return idx >= 0 ? idx : 99;
}

function isPassingRecord(assessment: Assessment): boolean {
  const threshold = assessment.formLevel <= 2 ? 7 : 8;
  return assessment.gradePoint <= threshold;
}

function computeStudentAggregateMean(records: Assessment[]): {
  mean: number | null;
  studentCount: number;
} {
  if (records.length === 0) {
    return { mean: null, studentCount: 0 };
  }
  const byStudent = new Map<string, { sum: number; count: number }>();
  for (const r of records) {
    const score = Number(r.totalScore);
    if (!Number.isFinite(score)) continue;
    const prev = byStudent.get(r.studentId) || { sum: 0, count: 0 };
    prev.sum += score;
    prev.count += 1;
    byStudent.set(r.studentId, prev);
  }
  if (byStudent.size === 0) {
    return { mean: null, studentCount: 0 };
  }
  let totalStudentMeans = 0;
  for (const entry of byStudent.values()) {
    totalStudentMeans += entry.sum / entry.count;
  }
  return {
    mean: round1(totalStudentMeans / byStudent.size),
    studentCount: byStudent.size,
  };
}

export function buildTermPerformanceTrends(
  assessments: Assessment[],
  options: TermPerformanceFilterOptions = {}
): TermPerformanceSummary {
  const formFilter = options.formFilter ?? 'ALL';
  const subjectFilter = options.subjectFilter ?? 'ALL';
  const fallbackYear = (options.currentAcademicYear || String(new Date().getFullYear())).trim();

  const yearSet = new Set<string>();
  const subjectSet = new Set<string>();
  for (const a of assessments) {
    const yr = (a.academicYear || fallbackYear).trim();
    if (yr) yearSet.add(yr);
    if (a.subject && a.subject.trim()) subjectSet.add(a.subject.trim());
  }

  const availableYears = Array.from(yearSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const availableSubjects = Array.from(subjectSet).sort((a, b) => a.localeCompare(b));

  const filtered = assessments.filter((a) => {
    if (formFilter !== 'ALL' && a.formLevel !== formFilter) return false;
    if (
      subjectFilter !== 'ALL' &&
      a.subject.trim().toLowerCase() !== subjectFilter.trim().toLowerCase()
    ) {
      return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    return {
      points: [],
      activeForms: [],
      availableYears,
      availableSubjects,
      activeTermsCount: 0,
      latestPoint: null,
      previousPoint: null,
      bestPoint: null,
      totalAssessments: 0,
    };
  }

  // Group filtered records by (academicYear, term)
  const bucketMap = new Map<string, { academicYear: string; term: TermName; records: Assessment[] }>();
  const filteredYears = new Set<string>();

  for (const a of filtered) {
    const yr = (a.academicYear || fallbackYear).trim();
    const term = TERM_SEQUENCE.includes(a.term) ? a.term : 'Term 1';
    filteredYears.add(yr);
    const key = `${yr}::${term}`;
    const existing = bucketMap.get(key) || { academicYear: yr, term, records: [] };
    existing.records.push(a);
    bucketMap.set(key, existing);
  }

  // Ensure all 3 terms are present for every academic year that has assessment data
  // (or at least the latest/current academic year) so Term 1 -> Term 2 -> Term 3
  // renders as an intuitive academic progression.
  for (const yr of filteredYears) {
    for (const term of TERM_SEQUENCE) {
      const key = `${yr}::${term}`;
      if (!bucketMap.has(key)) {
        bucketMap.set(key, { academicYear: yr, term, records: [] });
      }
    }
  }

  const sortedBuckets = Array.from(bucketMap.entries())
    .sort(([, a], [, b]) => {
      const yearCmp = a.academicYear.localeCompare(b.academicYear, undefined, { numeric: true });
      if (yearCmp !== 0) return yearCmp;
      return termOrderIndex(a.term) - termOrderIndex(b.term);
    });

  const multiYear = filteredYears.size > 1;
  const activeFormsSet = new Set<FormLevel>();

  const points: TermPerformancePoint[] = [];
  let prevActiveMean: number | null = null;

  for (const [key, bucket] of sortedBuckets) {
    const { academicYear, term, records } = bucket;
    const { mean: aggregateMean, studentCount } = computeStudentAggregateMean(records);

    const passed = records.filter(isPassingRecord).length;
    const passRatePct = records.length > 0 ? round1((passed / records.length) * 100) : null;

    const formMeans: Record<FormLevel, number | null> = { 1: null, 2: null, 3: null, 4: null };
    for (const f of [1, 2, 3, 4] as FormLevel[]) {
      const fRecords = records.filter((r) => r.formLevel === f);
      if (fRecords.length > 0) {
        formMeans[f] = computeStudentAggregateMean(fRecords).mean;
        activeFormsSet.add(f);
      }
    }

    const hasData = records.length > 0 && aggregateMean !== null;
    const deltaFromPrev =
      hasData && prevActiveMean !== null && aggregateMean !== null
        ? round1(aggregateMean - prevActiveMean)
        : null;

    if (hasData && aggregateMean !== null) {
      prevActiveMean = aggregateMean;
    }

    const shortYear = academicYear.length >= 4 ? `'${academicYear.slice(-2)}` : academicYear;
    const label = multiYear ? `${term} ${shortYear}` : term;
    const fullLabel = `${term} (${academicYear})`;

    points.push({
      key,
      academicYear,
      term,
      label,
      fullLabel,
      aggregateMean,
      passRatePct,
      deltaFromPrev,
      form1: formMeans[1],
      form2: formMeans[2],
      form3: formMeans[3],
      form4: formMeans[4],
      studentCount,
      assessmentCount: records.length,
      hasData,
    });
  }

  const activePoints = points.filter((p) => p.hasData);
  const latestPoint = activePoints.length > 0 ? activePoints[activePoints.length - 1] : null;
  const previousPoint = activePoints.length > 1 ? activePoints[activePoints.length - 2] : null;
  const bestPoint =
    activePoints.length > 0
      ? activePoints.reduce((best, curr) =>
          (curr.aggregateMean ?? -1) > (best.aggregateMean ?? -1) ? curr : best
        )
      : null;

  return {
    points,
    activeForms: ([1, 2, 3, 4] as FormLevel[]).filter((f) => activeFormsSet.has(f)),
    availableYears,
    availableSubjects,
    activeTermsCount: activePoints.length,
    latestPoint,
    previousPoint,
    bestPoint,
    totalAssessments: filtered.length,
  };
}
