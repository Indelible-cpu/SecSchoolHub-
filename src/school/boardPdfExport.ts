import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  calculateStudentStanding,
  FORM_LEVELS,
  formatMWK,
  normalizeAssessmentComponents,
} from './malawi.ts';
import { buildTermPerformanceTrends, type TermPerformanceSummary } from './termPerformanceUtils.ts';
import { buildStudentAttendanceHeatmap } from './attendanceHeatmapUtils.ts';
import type {
  Assessment,
  AttendanceRecord,
  FeeInvoice,
  FormLevel,
  School,
  Student,
  Teacher,
  TermName,
} from './types.ts';

export type BoardReportOrientation = 'landscape' | 'portrait';
export type BoardChartKey = 'term-trend' | 'class-trend' | 'attendance-heatmap';

export interface BoardReportSections {
  includeTermTrends: boolean;
  includeClassTrends: boolean;
  includeAttendanceHeatmap: boolean;
  includeGradeAndSubjects: boolean;
  includeEnrollmentAndMsce: boolean;
  includeFinancialSummary: boolean;
}

export interface BoardReportConfig {
  reportTitle: string;
  meetingDate: string;
  preparedBy: string;
  orientation: BoardReportOrientation;
  executiveNotes: string;
  sections: BoardReportSections;
}

export interface BoardChartLegendItem {
  label: string;
  color: string;
  dashed?: boolean;
  borderColor?: string;
}

export interface CapturedBoardChart {
  key: BoardChartKey;
  title: string;
  filterSummary: string;
  imageDataUrl: string | null;
  widthPx: number;
  heightPx: number;
  legendItems: BoardChartLegendItem[];
}

export interface BoardSubjectRow {
  subject: string;
  ca1: number;
  ca2: number;
  exam: number;
  total: number;
  count: number;
}

export interface BoardFormBreakdownRow {
  form: FormLevel;
  levelLabel: string;
  total: number;
  male: number;
  female: number;
  boarders: number;
  attMarked: number;
  attPresent: number;
  attRate: number | null;
}

export interface BoardMsceRow {
  studentName: string;
  classLabel: string;
  subjectCount: number;
  averageScore: number;
  bestSixPoints: number | null;
  outcome: string;
}

export interface BoardFeeSummary {
  totalBilled: number;
  totalPaid: number;
  balance: number;
  collectionRate: number;
  invoiceCount: number;
  paidCount: number;
  partialCount: number;
  unpaidCount: number;
}

export interface BoardReportSummaryData {
  activeStudentsCount: number;
  activeStaffCount: number;
  totalStaffCount: number;
  termAssessmentsCount: number;
  termTrends: TermPerformanceSummary;
  stageSummary: {
    ca1Avg: number | null;
    ca2Avg: number | null;
    examAvg: number | null;
  };
  gradeDistribution: {
    total: number;
    distinction: number;
    credit: number;
    pass: number;
    fail: number;
    passRate: number;
    meanScore: number;
  };
  subjectRows: BoardSubjectRow[];
  formBreakdown: BoardFormBreakdownRow[];
  msceTopRows: BoardMsceRow[];
  attendanceOverview: {
    todayMarked: number;
    todayPresent: number;
    todayRate: number | null;
    termMeanRate: number | null;
    daysMarked: number;
  };
  feeSummary: BoardFeeSummary | null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'school';
}

export function buildBoardReportSummaryData(params: {
  school: School;
  students: Student[];
  teachers: Teacher[];
  assessments: Assessment[];
  attendance: AttendanceRecord[];
  invoices?: FeeInvoice[];
  todayIso: string;
  includeFinancialSummary: boolean;
}): BoardReportSummaryData {
  const {
    school,
    students,
    teachers,
    assessments,
    attendance,
    invoices = [],
    todayIso,
    includeFinancialSummary,
  } = params;

  const activeStudents = students.filter((s) => s.status === 'Active');
  const activeStaffCount = teachers.filter((t) => t.status === 'Active').length;
  const termAssessments = assessments.filter((a) => a.term === school.currentTerm);

  const termTrends = buildTermPerformanceTrends(assessments, {
    currentAcademicYear: school.academicYear,
    formFilter: 'ALL',
    subjectFilter: 'ALL',
  });

  // CA 1, CA 2, Summative stage averages
  let ca1Sum = 0;
  let ca1N = 0;
  let ca2Sum = 0;
  let ca2N = 0;
  let examSum = 0;
  let examN = 0;

  let distinction = 0;
  let credit = 0;
  let pass = 0;
  let fail = 0;
  let totalScoreSum = 0;

  const bySubj = new Map<
    string,
    { ca1Sum: number; ca2Sum: number; examSum: number; totalSum: number; count: number }
  >();

  for (const a of termAssessments) {
    const b = normalizeAssessmentComponents(a);
    if (b.hasCa1) {
      ca1Sum += (b.ca1Score / 20) * 100;
      ca1N += 1;
    }
    if (b.hasCa2) {
      ca2Sum += (b.ca2Score / 20) * 100;
      ca2N += 1;
    }
    if (b.hasExam) {
      examSum += (b.examScore / 60) * 100;
      examN += 1;
    }

    if (a.gradePoint <= 2) distinction += 1;
    else if (a.gradePoint <= 6) credit += 1;
    else if (a.gradePoint <= 8) pass += 1;
    else fail += 1;

    totalScoreSum += a.totalScore;

    const cur = bySubj.get(a.subject) || {
      ca1Sum: 0,
      ca2Sum: 0,
      examSum: 0,
      totalSum: 0,
      count: 0,
    };
    cur.ca1Sum += b.ca1Score;
    cur.ca2Sum += b.ca2Score;
    cur.examSum += b.examScore;
    cur.totalSum += a.totalScore;
    cur.count += 1;
    bySubj.set(a.subject, cur);
  }

  const totalGrades = termAssessments.length;
  const passRate = totalGrades > 0 ? Math.round(((totalGrades - fail) / totalGrades) * 100) : 0;
  const meanScore = totalGrades > 0 ? round1(totalScoreSum / totalGrades) : 0;

  const subjectRows: BoardSubjectRow[] = Array.from(bySubj.entries())
    .map(([subject, s]) => ({
      subject,
      ca1: round1(s.ca1Sum / s.count),
      ca2: round1(s.ca2Sum / s.count),
      exam: round1(s.examSum / s.count),
      total: round1(s.totalSum / s.count),
      count: s.count,
    }))
    .sort((a, b) => b.total - a.total);

  const todayRows = attendance.filter((a) => a.date === todayIso);
  const todayPresent = todayRows.filter(
    (a) => a.status === 'Present' || a.status === 'Late'
  ).length;
  const todayRate = todayRows.length > 0 ? Math.round((todayPresent / todayRows.length) * 100) : null;

  const heatmapModel = buildStudentAttendanceHeatmap({
    attendance,
    todayIso,
    term: school.currentTerm,
    formFilter: 'ALL',
    weeksCount: 13,
  });

  const formBreakdown: BoardFormBreakdownRow[] = FORM_LEVELS.map((form) => {
    const list = activeStudents.filter((s) => s.formLevel === form);
    const male = list.filter((s) => s.gender === 'Male').length;
    const female = list.filter((s) => s.gender === 'Female').length;
    const boarders = list.filter((s) => s.boardingStatus === 'Boarder').length;
    const formAtt = todayRows.filter((a) => a.formLevel === form);
    const attPresent = formAtt.filter(
      (a) => a.status === 'Present' || a.status === 'Late'
    ).length;
    return {
      form,
      levelLabel: form <= 2 ? 'JCE' : 'MSCE',
      total: list.length,
      male,
      female,
      boarders,
      attMarked: formAtt.length,
      attPresent,
      attRate: formAtt.length > 0 ? Math.round((attPresent / formAtt.length) * 100) : null,
    };
  });

  const msceTopRows: BoardMsceRow[] = activeStudents
    .filter((s) => s.formLevel >= 3)
    .map((student) => {
      const studentMarks = termAssessments.filter((a) => a.studentId === student.id);
      const standing = calculateStudentStanding(student.formLevel, studentMarks);
      return {
        studentName: student.fullName,
        classLabel: `Form ${student.formLevel}${student.stream}`,
        subjectCount: standing.subjectCount,
        averageScore: round1(standing.averageScore),
        bestSixPoints: standing.bestSixPoints,
        outcome: standing.outcome,
      };
    })
    .filter((row) => row.subjectCount > 0)
    .sort((a, b) => {
      if (a.bestSixPoints !== null && b.bestSixPoints !== null) {
        return a.bestSixPoints - b.bestSixPoints;
      }
      return b.averageScore - a.averageScore;
    })
    .slice(0, 8);

  let feeSummary: BoardFeeSummary | null = null;
  if (includeFinancialSummary) {
    const termInvoices = invoices.filter((inv) => inv.term === school.currentTerm);
    const totalBilled = termInvoices.reduce((sum, i) => sum + i.totalBilled, 0);
    const totalPaid = termInvoices.reduce((sum, i) => sum + i.totalPaid, 0);
    const balance = Math.max(0, totalBilled - totalPaid);
    const collectionRate = totalBilled > 0 ? Math.round((totalPaid / totalBilled) * 100) : 0;
    feeSummary = {
      totalBilled,
      totalPaid,
      balance,
      collectionRate,
      invoiceCount: termInvoices.length,
      paidCount: termInvoices.filter((i) => i.status === 'Paid').length,
      partialCount: termInvoices.filter((i) => i.status === 'Partial').length,
      unpaidCount: termInvoices.filter((i) => i.status === 'Unpaid').length,
    };
  }

  return {
    activeStudentsCount: activeStudents.length,
    activeStaffCount,
    totalStaffCount: teachers.length,
    termAssessmentsCount: totalGrades,
    termTrends,
    stageSummary: {
      ca1Avg: ca1N > 0 ? round1(ca1Sum / ca1N) : null,
      ca2Avg: ca2N > 0 ? round1(ca2Sum / ca2N) : null,
      examAvg: examN > 0 ? round1(examSum / examN) : null,
    },
    gradeDistribution: {
      total: totalGrades,
      distinction,
      credit,
      pass,
      fail,
      passRate,
      meanScore,
    },
    subjectRows,
    formBreakdown,
    msceTopRows,
    attendanceOverview: {
      todayMarked: todayRows.length,
      todayPresent,
      todayRate,
      termMeanRate: heatmapModel.summary.overallRate,
      daysMarked: heatmapModel.summary.daysMarked,
    },
    feeSummary,
  };
}

export function sanitizeSvgMarkupForPrint(
  rawMarkup: string,
  dims?: { width?: number; height?: number }
): string {
  let markup = rawMarkup.trim();

  if (!/xmlns=/.test(markup)) {
    markup = markup.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  if (dims?.width && dims.width > 0) {
    if (/\swidth=/.test(markup.slice(0, markup.indexOf('>')))) {
      markup = markup.replace(/(<svg[^>]*\swidth=")[^"]*(")/i, `$1${dims.width}$2`);
    } else {
      markup = markup.replace('<svg', `<svg width="${dims.width}"`);
    }
  }

  if (dims?.height && dims.height > 0) {
    if (/\sheight=/.test(markup.slice(0, markup.indexOf('>')))) {
      markup = markup.replace(/(<svg[^>]*\sheight=")[^"]*(")/i, `$1${dims.height}$2`);
    } else {
      markup = markup.replace('<svg', `<svg height="${dims.height}"`);
    }
  }

  // Normalize CSS variables & currentColor so standalone SVG rendering matches white paper
  markup = markup
    .replace(/var\(--font-mono\)/g, 'Courier New, ui-monospace, monospace')
    .replace(/var\(--font-sans\)/g, 'Helvetica, Arial, sans-serif')
    .replace(/currentColor/g, '#475569');

  // Remap dark-mode heatmap neutral fills/strokes to light print-safe neutrals
  markup = markup
    .replace(/fill="#1e293b"/gi, 'fill="#f1f5f9"')
    .replace(/fill="#0f172a"/gi, 'fill="#f8fafc"')
    .replace(/stroke="#334155"/gi, 'stroke="#cbd5e1"')
    .replace(/fill="#94a3b8"/gi, 'fill="#475569"')
    .replace(/stroke="#f8fafc"/gi, 'stroke="#0f172a"');

  return markup;
}

export function extractRechartsLegendItems(containerEl: HTMLElement): BoardChartLegendItem[] {
  const items: BoardChartLegendItem[] = [];
  const legendEls = containerEl.querySelectorAll('.recharts-legend-item');

  legendEls.forEach((el) => {
    const text = (el.textContent || '').trim();
    if (!text) return;
    const iconPath = el.querySelector<SVGElement>('svg path, svg rect, svg line');
    const colorAttr =
      iconPath?.getAttribute('stroke') ||
      iconPath?.getAttribute('fill') ||
      (el as HTMLElement).style.color ||
      '#059669';
    const dashed = Boolean(iconPath?.getAttribute('stroke-dasharray'));
    const normalizedColor = colorAttr && colorAttr !== 'none' ? colorAttr : '#059669';
    items.push({ label: text, color: normalizedColor, dashed });
  });

  return items;
}

function getHeatmapLegendItems(isDark: boolean): BoardChartLegendItem[] {
  const colors = isDark
    ? ['#f43f5e', '#f59e0b', '#065f46', '#059669', '#34d399']
    : ['#e11d48', '#d97706', '#34d399', '#10b981', '#047857'];

  return [
    { label: 'No mark', color: '#f1f5f9', borderColor: '#cbd5e1' },
    { label: '<60%', color: colors[0] },
    { label: '60-74%', color: colors[1] },
    { label: '75-84%', color: colors[2] },
    { label: '85-94%', color: colors[3] },
    { label: '95-100%', color: colors[4] },
  ];
}

async function rasterizeSvgElementToPng(
  svgEl: SVGSVGElement
): Promise<{ dataUrl: string; widthPx: number; heightPx: number } | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  const rect = svgEl.getBoundingClientRect();
  const vb = svgEl.viewBox?.baseVal;
  const widthPx = Math.max(
    1,
    Math.round(rect.width || Number(svgEl.getAttribute('width')) || vb?.width || 720)
  );
  const heightPx = Math.max(
    1,
    Math.round(rect.height || Number(svgEl.getAttribute('height')) || vb?.height || 260)
  );

  try {
    const cloned = svgEl.cloneNode(true) as SVGSVGElement;
    cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    cloned.setAttribute('width', String(widthPx));
    cloned.setAttribute('height', String(heightPx));
    if (!cloned.getAttribute('viewBox')) {
      cloned.setAttribute('viewBox', `0 0 ${widthPx} ${heightPx}`);
    }
    cloned.style.color = '#475569';
    cloned.style.backgroundColor = '#ffffff';
    cloned.style.fontFamily = 'Helvetica, Arial, sans-serif';

    const rawSerialized = new XMLSerializer().serializeToString(cloned);
    const sanitized = sanitizeSvgMarkupForPrint(rawSerialized, {
      width: widthPx,
      height: heightPx,
    });

    const blob = new Blob([sanitized], { type: 'image/svg+xml;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);

    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        const timer = window.setTimeout(() => reject(new Error('SVG rasterize timeout')), 4000);
        image.onload = () => {
          window.clearTimeout(timer);
          resolve(image);
        };
        image.onerror = () => {
          window.clearTimeout(timer);
          reject(new Error('SVG image load error'));
        };
        image.src = objectUrl;
      });

      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = widthPx * scale;
      canvas.height = heightPx * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, widthPx, heightPx);

      return {
        dataUrl: canvas.toDataURL('image/png'),
        widthPx,
        heightPx,
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return null;
  }
}

export function readOverviewChartFilterSummaries(rootEl: HTMLElement | null): Record<BoardChartKey, string> {
  const defaults: Record<BoardChartKey, string> = {
    'term-trend': 'Aggregate Marks Trend (Terms 1-3)',
    'class-trend': 'Class-Wide CA 1, CA 2 & Summative Performance',
    'attendance-heatmap': '13-Week Term Roll-Call Frequency',
  };
  if (!rootEl) return defaults;

  (['term-trend', 'class-trend', 'attendance-heatmap'] as BoardChartKey[]).forEach((key) => {
    const el = rootEl.querySelector<HTMLElement>(`[data-board-chart="${key}"]`);
    const summary = el?.getAttribute('data-chart-filter-summary')?.trim();
    if (summary) defaults[key] = summary;
  });

  return defaults;
}

export async function captureDashboardChartsFromDom(
  rootEl: HTMLElement | null,
  currentTerm: TermName
): Promise<Record<BoardChartKey, CapturedBoardChart>> {
  const isDark =
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const filterSummaries = readOverviewChartFilterSummaries(rootEl);

  const descriptors: Array<{
    key: BoardChartKey;
    title: string;
    svgSelector: string;
  }> = [
    {
      key: 'term-trend',
      title: 'Student Performance Trends (Term-over-Term Aggregate Marks)',
      svgSelector: 'svg.recharts-surface',
    },
    {
      key: 'class-trend',
      title: `Class-Wide Academic Performance Trends (${currentTerm})`,
      svgSelector: 'svg.recharts-surface',
    },
    {
      key: 'attendance-heatmap',
      title: `Student Attendance Frequency Heatmap (${currentTerm})`,
      svgSelector: 'svg[role="img"]',
    },
  ];

  const entries = await Promise.all(
    descriptors.map(async (desc): Promise<[BoardChartKey, CapturedBoardChart]> => {
      const sectionEl = rootEl?.querySelector<HTMLElement>(`[data-board-chart="${desc.key}"]`) ?? null;
      const svgEl = sectionEl?.querySelector<SVGSVGElement>(desc.svgSelector) ?? null;
      const raster = svgEl ? await rasterizeSvgElementToPng(svgEl) : null;
      const legendItems =
        desc.key === 'attendance-heatmap'
          ? getHeatmapLegendItems(isDark)
          : sectionEl
          ? extractRechartsLegendItems(sectionEl)
          : [];

      return [
        desc.key,
        {
          key: desc.key,
          title: desc.title,
          filterSummary: filterSummaries[desc.key],
          imageDataUrl: raster?.dataUrl ?? null,
          widthPx: raster?.widthPx ?? 720,
          heightPx: raster?.heightPx ?? 260,
          legendItems,
        },
      ];
    })
  );

  return Object.fromEntries(entries) as Record<BoardChartKey, CapturedBoardChart>;
}

function hexToRgb(color: string): [number, number, number] {
  const clean = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(clean)) {
    return [
      parseInt(clean.slice(1, 3), 16),
      parseInt(clean.slice(3, 5), 16),
      parseInt(clean.slice(5, 7), 16),
    ];
  }
  const rgbMatch = clean.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (rgbMatch) {
    return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
  }
  return [5, 150, 105];
}

function drawBoardHeader(
  doc: jsPDF,
  school: School,
  config: BoardReportConfig
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;

  doc.setFillColor(13, 110, 82);
  doc.rect(0, 0, pageWidth, 4.5, 'F');

  let textOffsetX = margin;
  if (school.logoDataUrl && school.logoDataUrl.startsWith('data:image/')) {
    try {
      const imgFormat = school.logoDataUrl.startsWith('data:image/jpeg')
        ? 'JPEG'
        : school.logoDataUrl.startsWith('data:image/webp')
        ? 'WEBP'
        : 'PNG';
      doc.addImage(school.logoDataUrl, imgFormat, margin, 8.5, 13, 13);
      textOffsetX = margin + 16;
    } catch {
      textOffsetX = margin;
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(school.name.toUpperCase(), textOffsetX, 14.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  const metaLine = [
    `${school.district} District`,
    school.schoolType,
    `${school.currentTerm} (${school.academicYear})`,
  ].join('  ·  ');
  doc.text(metaLine, textOffsetX, 19.8);

  doc.setFontSize(8.5);
  doc.text(`Board Meeting: ${config.meetingDate}`, pageWidth - margin, 14.5, { align: 'right' });
  doc.text(
    `Prepared By: ${config.preparedBy.trim() || 'School Administration'}`,
    pageWidth - margin,
    19.8,
    { align: 'right' }
  );

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.35);
  doc.line(margin, 24, pageWidth - margin, 24);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(15, 23, 42);
  doc.text(
    config.reportTitle.trim() || 'School Board Academic & Performance Report',
    margin,
    30.5
  );

  return 35;
}

function drawBoardKpiStrip(
  doc: jsPDF,
  startY: number,
  items: Array<{ label: string; value: string; note?: string }>
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const usableWidth = pageWidth - margin * 2;
  const gap = 3;
  const cardWidth = (usableWidth - gap * (items.length - 1)) / items.length;
  const cardHeight = 17.5;

  items.forEach((item, idx) => {
    const x = margin + idx * (cardWidth + gap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, startY, cardWidth, cardHeight, 2, 2, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(100, 116, 139);
    doc.text(item.label, x + 3.2, startY + 5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(item.value, x + 3.2, startY + 11.2);

    if (item.note) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(71, 85, 105);
      doc.text(item.note, x + 3.2, startY + 15.2);
    }
  });

  return startY + cardHeight + 5.5;
}

function ensureSpace(doc: jsPDF, currentY: number, neededHeightMm: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  const bottomSafe = pageHeight - 18;
  if (currentY + neededHeightMm > bottomSafe) {
    doc.addPage();
    return 15;
  }
  return currentY;
}

function drawCapturedChartSection(
  doc: jsPDF,
  startY: number,
  chart: CapturedBoardChart,
  maxImageHeightMm: number
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const boxWidth = pageWidth - margin * 2;
  const innerPad = 4;
  const contentWidth = boxWidth - innerPad * 2;

  const aspect = chart.widthPx > 0 ? chart.heightPx / chart.widthPx : 0.36;
  const rawImgH = contentWidth * aspect;
  const imgH = chart.imageDataUrl ? Math.min(maxImageHeightMm, Math.max(38, rawImgH)) : 16;
  const imgW = chart.imageDataUrl ? Math.min(contentWidth, imgH / Math.max(0.15, aspect)) : contentWidth;

  const hasLegend = chart.legendItems.length > 0;
  const totalBoxHeight = 14 + imgH + (hasLegend ? 8 : 3);
  const y = ensureSpace(doc, startY, totalBoxHeight + 4);

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.35);
  doc.roundedRect(margin, y, boxWidth, totalBoxHeight, 2.5, 2.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(chart.title, margin + innerPad, y + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(chart.filterSummary, margin + innerPad, y + 10.5);

  const imgY = y + 13;
  if (chart.imageDataUrl) {
    const imgX = margin + (boxWidth - imgW) / 2;
    doc.addImage(chart.imageDataUrl, 'PNG', imgX, imgY, imgW, imgH);
  } else {
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin + innerPad, imgY, contentWidth, 13, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      'Chart visual is currently empty for the active filter selection. Numeric metrics appear below.',
      margin + boxWidth / 2,
      imgY + 8,
      { align: 'center' }
    );
  }

  if (hasLegend) {
    const legendY = imgY + imgH + 4.5;
    let cursorX = margin + innerPad;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);

    chart.legendItems.forEach((item) => {
      const labelWidth = doc.getTextWidth(item.label);
      const itemWidth = 5 + labelWidth + 5;
      if (cursorX + itemWidth > margin + boxWidth - innerPad) return;

      const [r, g, b] = hexToRgb(item.color);
      doc.setFillColor(r, g, b);
      if (item.borderColor) {
        const [br, bg, bb] = hexToRgb(item.borderColor);
        doc.setDrawColor(br, bg, bb);
        doc.setLineWidth(0.25);
        doc.rect(cursorX, legendY - 2.4, 2.8, 2.8, 'FD');
      } else {
        doc.rect(cursorX, legendY - 2.4, 2.8, 2.8, 'F');
      }
      doc.setTextColor(71, 85, 105);
      doc.text(item.label, cursorX + 4, legendY);
      cursorX += itemWidth;
    });
  }

  return y + totalBoxHeight + 5;
}

function addBoardFooters(doc: jsPDF, schoolName: string) {
  const totalPages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `${schoolName} — School Board Meeting Performance Pack`,
      margin,
      pageHeight - 7.5
    );
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 7.5, {
      align: 'right',
    });
  }
}

export async function exportOverviewChartsToBoardPdf(params: {
  school: School;
  config: BoardReportConfig;
  summary: BoardReportSummaryData;
  dashboardRootEl: HTMLElement | null;
}): Promise<{ fileName: string; capturedChartsCount: number; pageCount: number }> {
  const { school, config, summary, dashboardRootEl } = params;
  const captured = await captureDashboardChartsFromDom(dashboardRootEl, school.currentTerm);

  const doc = new jsPDF({
    orientation: config.orientation,
    unit: 'mm',
    format: 'a4',
  });
  const margin = 14;
  const isLandscape = config.orientation === 'landscape';
  const maxChartH = isLandscape ? 72 : 66;

  let y = drawBoardHeader(doc, school, config);

  const latestMean = summary.termTrends.latestPoint?.aggregateMean;
  const latestDelta = summary.termTrends.latestPoint?.deltaFromPrev;
  const deltaStr =
    latestDelta !== null && latestDelta !== undefined
      ? `${latestDelta >= 0 ? '+' : ''}${latestDelta.toFixed(1)} pts vs prior term`
      : `${summary.termTrends.activeTermsCount} active term(s)`;

  const kpiItems: Array<{ label: string; value: string; note?: string }> = [
    {
      label: 'Active Enrollment',
      value: `${summary.activeStudentsCount} Students`,
      note: `${summary.activeStaffCount}/${summary.totalStaffCount} active staff`,
    },
    {
      label: 'Latest Aggregate Mean',
      value: latestMean !== null && latestMean !== undefined ? `${latestMean.toFixed(1)}%` : '—',
      note: deltaStr,
    },
    {
      label: `${school.currentTerm} Pass Rate`,
      value: summary.termAssessmentsCount > 0 ? `${summary.gradeDistribution.passRate}%` : '—',
      note: `${summary.termAssessmentsCount} graded marks`,
    },
    summary.feeSummary
      ? {
          label: `${school.currentTerm} Fee Collection`,
          value: `${summary.feeSummary.collectionRate}%`,
          note: `${formatMWK(summary.feeSummary.totalPaid)} collected`,
        }
      : {
          label: 'Term Attendance Mean',
          value:
            summary.attendanceOverview.termMeanRate !== null
              ? `${summary.attendanceOverview.termMeanRate}%`
              : '—',
          note: `${summary.attendanceOverview.daysMarked} roll-call days`,
        },
  ];

  y = drawBoardKpiStrip(doc, y, kpiItems);

  let capturedChartsCount = 0;

  // 1. Term-over-Term Aggregate Performance Chart + Table
  if (config.sections.includeTermTrends) {
    if (captured['term-trend'].imageDataUrl) capturedChartsCount += 1;
    y = drawCapturedChartSection(doc, y, captured['term-trend'], maxChartH);

    const activePoints = summary.termTrends.points.filter((p) => p.hasData);
    if (activePoints.length > 0) {
      y = ensureSpace(doc, y, 28);
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin, bottom: 16 },
        theme: 'grid',
        styles: {
          font: 'helvetica',
          fontSize: 7.8,
          cellPadding: 2.1,
          textColor: [30, 41, 59],
          lineColor: [226, 232, 240],
          lineWidth: 0.25,
        },
        headStyles: {
          fillColor: [13, 110, 82],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        head: [
          ['Academic Term', 'Aggregate Mean', 'Term Delta', 'Pass Rate', 'Students', 'Marks', 'F1 / F2 / F3 / F4'],
        ],
        body: activePoints.map((pt) => [
          pt.fullLabel,
          pt.aggregateMean !== null ? `${pt.aggregateMean.toFixed(1)}%` : '—',
          pt.deltaFromPrev !== null
            ? `${pt.deltaFromPrev >= 0 ? '+' : ''}${pt.deltaFromPrev.toFixed(1)} pts`
            : 'Baseline',
          pt.passRatePct !== null ? `${pt.passRatePct.toFixed(1)}%` : '—',
          String(pt.studentCount),
          String(pt.assessmentCount),
          [pt.form1, pt.form2, pt.form3, pt.form4]
            .map((v) => (v !== null ? `${v.toFixed(0)}%` : '—'))
            .join(' / '),
        ]),
      });
      y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;
    }
  }

  // 2. Class-Wide CA1 / CA2 / Summative Trend Chart
  if (config.sections.includeClassTrends) {
    if (captured['class-trend'].imageDataUrl) capturedChartsCount += 1;
    y = drawCapturedChartSection(doc, y, captured['class-trend'], maxChartH);
  }

  // 3. D3 Student Attendance Frequency Heatmap
  if (config.sections.includeAttendanceHeatmap) {
    if (captured['attendance-heatmap'].imageDataUrl) capturedChartsCount += 1;
    y = drawCapturedChartSection(doc, y, captured['attendance-heatmap'], maxChartH);
  }

  // 4. MANEB Grade Distribution & Subject Mean Breakdown
  if (config.sections.includeGradeAndSubjects) {
    y = ensureSpace(doc, y, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `MANEB Grade Distribution & Subject Breakdown (${school.currentTerm})`,
      margin,
      y + 3
    );
    y += 6;

    const gd = summary.gradeDistribution;
    const pct = (n: number) => (gd.total > 0 ? `${Math.round((n / gd.total) * 100)}%` : '0%');
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin, bottom: 16 },
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 7.8,
        cellPadding: 2.2,
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240],
        lineWidth: 0.25,
      },
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      head: [
        [
          'Distinction (A / 1-2)',
          'Credit (B-C / 3-6)',
          'Pass (D / 7-8)',
          'Fail (F / 9)',
          'Overall Pass Rate',
          'School Mean',
        ],
      ],
      body: [
        [
          `${gd.distinction} (${pct(gd.distinction)})`,
          `${gd.credit} (${pct(gd.credit)})`,
          `${gd.pass} (${pct(gd.pass)})`,
          `${gd.fail} (${pct(gd.fail)})`,
          `${gd.passRate}%`,
          `${gd.meanScore.toFixed(1)}%`,
        ],
      ],
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 5;

    if (summary.subjectRows.length > 0) {
      y = ensureSpace(doc, y, 36);
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin, bottom: 16 },
        theme: 'grid',
        styles: {
          font: 'helvetica',
          fontSize: 7.8,
          cellPadding: 2.1,
          textColor: [30, 41, 59],
          lineColor: [226, 232, 240],
          lineWidth: 0.25,
        },
        headStyles: {
          fillColor: [13, 110, 82],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          1: { halign: 'right' },
          2: { halign: 'right' },
          3: { halign: 'right' },
          4: { halign: 'right', fontStyle: 'bold' },
          5: { halign: 'right' },
        },
        head: [['Subject', 'CA 1 (/20)', 'CA 2 (/20)', 'Summative (/60)', 'Total Mean (%)', 'Assessments']],
        body: summary.subjectRows.slice(0, 12).map((row) => [
          row.subject,
          row.ca1.toFixed(1),
          row.ca2.toFixed(1),
          row.exam.toFixed(1),
          `${row.total.toFixed(1)}%`,
          String(row.count),
        ]),
      });
      y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;
    }
  }

  // 5. Enrollment & Form 3-4 MSCE Standing
  if (config.sections.includeEnrollmentAndMsce) {
    y = ensureSpace(doc, y, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(`Form 1-4 Enrollment & Turnout (${school.currentTerm})`, margin, y + 3);
    y += 6;

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin, bottom: 16 },
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 7.8,
        cellPadding: 2.1,
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240],
        lineWidth: 0.25,
      },
      headStyles: {
        fillColor: [13, 110, 82],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      columnStyles: {
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right', fontStyle: 'bold' },
        6: { halign: 'right' },
      },
      head: [['Form Level', 'Stage', 'Boys', 'Girls', 'Boarders', 'Total Active', 'Today Turnout']],
      body: summary.formBreakdown.map((row) => [
        `Form ${row.form}`,
        row.levelLabel,
        String(row.male),
        String(row.female),
        String(row.boarders),
        String(row.total),
        row.attRate !== null ? `${row.attRate}% (${row.attPresent}/${row.attMarked})` : 'Not marked',
      ]),
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 5;

    if (summary.msceTopRows.length > 0) {
      y = ensureSpace(doc, y, 36);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(15, 23, 42);
      doc.text(`Form 3 & Form 4 MSCE Standing (${school.currentTerm})`, margin, y + 3);
      y += 6;

      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin, bottom: 16 },
        theme: 'grid',
        styles: {
          font: 'helvetica',
          fontSize: 7.8,
          cellPadding: 2.1,
          textColor: [30, 41, 59],
          lineColor: [226, 232, 240],
          lineWidth: 0.25,
        },
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
        },
        columnStyles: {
          2: { halign: 'right' },
          3: { halign: 'right' },
          4: { halign: 'right', fontStyle: 'bold' },
          5: { halign: 'right' },
        },
        head: [['Student', 'Class', 'Subjects', 'Mean Score', 'Best 6 Points', 'Status']],
        body: summary.msceTopRows.map((row) => [
          row.studentName,
          row.classLabel,
          String(row.subjectCount),
          `${row.averageScore.toFixed(1)}%`,
          row.bestSixPoints !== null ? `${row.bestSixPoints} pts` : 'Need 6',
          row.outcome,
        ]),
      });
      y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;
    }
  }

  // 6. Optional Financial Summary (only when permitted & requested)
  if (config.sections.includeFinancialSummary && summary.feeSummary) {
    y = ensureSpace(doc, y, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(`Term Fee Collection Summary (${school.currentTerm})`, margin, y + 3);
    y += 6;

    const fs = summary.feeSummary;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin, bottom: 16 },
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 7.8,
        cellPadding: 2.2,
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240],
        lineWidth: 0.25,
      },
      headStyles: {
        fillColor: [13, 110, 82],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      head: [
        ['Total Billed', 'Collected', 'Outstanding', 'Collection Rate', 'Paid / Partial / Unpaid'],
      ],
      body: [
        [
          formatMWK(fs.totalBilled),
          formatMWK(fs.totalPaid),
          formatMWK(fs.balance),
          `${fs.collectionRate}%`,
          `${fs.paidCount} / ${fs.partialCount} / ${fs.unpaidCount} (${fs.invoiceCount} invoices)`,
        ],
      ],
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;
  }

  // 7. Executive Board Notes & Sign-Off Block
  const trimmedNotes = config.executiveNotes.trim();
  const signOffNeeded = trimmedNotes ? 44 : 26;
  y = ensureSpace(doc, y, signOffNeeded);
  const pageWidth = doc.internal.pageSize.getWidth();
  const usableWidth = pageWidth - margin * 2;

  if (trimmedNotes) {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    const wrapped = doc.splitTextToSize(trimmedNotes, usableWidth - 8);
    const noteBoxH = Math.max(16, wrapped.length * 4.2 + 9);
    doc.roundedRect(margin, y, usableWidth, noteBoxH, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(15, 23, 42);
    doc.text('Board Meeting Remarks & Action Items', margin + 4, y + 5.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    doc.text(wrapped, margin + 4, y + 10.5);
    y += noteBoxH + 6;
  }

  y = ensureSpace(doc, y, 22);
  const sigWidth = (usableWidth - 16) / 3;
  const labels = ['Head Teacher / Principal', 'Board Chairperson', 'Secretary / Date'];
  labels.forEach((label, idx) => {
    const sx = margin + idx * (sigWidth + 8);
    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.35);
    doc.line(sx, y + 11, sx + sigWidth, y + 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(label, sx, y + 15.5);
  });

  addBoardFooters(doc, school.name);

  const schoolSlug = slugify(school.name);
  const termSlug = slugify(school.currentTerm);
  const dateSlug = config.meetingDate.replace(/[^0-9-]+/g, '') || new Date().toISOString().slice(0, 10);
  const fileName = `${schoolSlug}-board-performance-report-${termSlug}-${dateSlug}.pdf`;
  doc.save(fileName);

  return {
    fileName,
    capturedChartsCount,
    pageCount: doc.getNumberOfPages(),
  };
}
