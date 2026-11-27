import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  formatMWK,
  normalizeAssessmentComponents,
  rankAssessmentsByPerformance,
  TermReportCardSummary,
} from './malawi';
import {
  buildStudentReportCardPayload,
  BuiltStudentReportCard,
  computeSubjectCaDeltaPct,
  formatOrdinalPosition,
  getReportTemplateMeta,
  ReportCardExportOptions,
  ReportCardTemplateId,
  StudentClassRank,
  StudentReportAttendanceStats,
} from './reportCardTemplates';
import {
  Assessment,
  FeeInvoice,
  FeePayment,
  FormLevel,
  InvoiceStatus,
  School,
  StaffTimebookEntry,
  Student,
  TermName,
} from './types';

function slugifySchool(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'school';
}

function drawReportHeader(
  doc: jsPDF,
  school: School,
  reportTitle: string,
  filterSummary: string
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;

  // Top accent bar
  doc.setFillColor(13, 110, 82);
  doc.rect(0, 0, pageWidth, 4, 'F');

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

  // School name & district
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text(school.name.toUpperCase(), textOffsetX, 15);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const subline = [
    `${school.district} District`,
    school.schoolType,
    school.motto ? `"${school.motto}"` : '',
  ]
    .filter(Boolean)
    .join('  ·  ');
  doc.text(subline, textOffsetX, 20.5);

  // Date stamp top right
  const generatedStr = new Date().toLocaleDateString('en-MW', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  doc.setFontSize(8.5);
  doc.text(`Generated: ${generatedStr}`, pageWidth - margin, 15, { align: 'right' });
  doc.text(`Academic Year: ${school.academicYear}`, pageWidth - margin, 20.5, { align: 'right' });

  // Divider line
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.line(margin, 24.5, pageWidth - margin, 24.5);

  // Report title & active filter summary
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(reportTitle, margin, 32);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(filterSummary, margin, 37.5);

  return 43;
}

function drawSummaryStrip(
  doc: jsPDF,
  startY: number,
  items: { label: string; value: string }[]
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const usableWidth = pageWidth - margin * 2;
  const gap = 3;
  const cardWidth = (usableWidth - gap * (items.length - 1)) / items.length;
  const cardHeight = 16;

  items.forEach((item, idx) => {
    const x = margin + idx * (cardWidth + gap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, startY, cardWidth, cardHeight, 2, 2, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(item.label, x + 3.5, startY + 5.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(item.value, x + 3.5, startY + 12.2);
  });

  return startY + cardHeight + 6;
}

function addPageFooters(doc: jsPDF, schoolName: string) {
  const totalPages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 13, pageWidth - margin, pageHeight - 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`${schoolName} — Official School Report`, margin, pageHeight - 8);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
  }
}

export function downloadMarksPdfReport(params: {
  school: School;
  assessments: Assessment[];
  termFilter: TermName;
  formFilter: 'all' | FormLevel;
  subjectFilter: string;
}) {
  const { school, assessments, termFilter, formFilter, subjectFilter } = params;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const formLabel = formFilter === 'all' ? 'All Forms (1–4)' : `Form ${formFilter}`;
  const subjectLabel = subjectFilter === 'all' ? 'All Subjects' : subjectFilter;
  const filterSummary = `Term: ${termFilter}  ·  Class: ${formLabel}  ·  Subject: ${subjectLabel}  ·  Weights: CA1 (20%) + CA2 (20%) + Exam (60%)`;

  let y = drawReportHeader(doc, school, 'Exam Marks & Gradebook Report', filterSummary);

  const count = assessments.length;
  const meanScore =
    count > 0 ? assessments.reduce((sum, a) => sum + a.totalScore, 0) / count : 0;
  const passCount = assessments.filter((a) =>
    a.formLevel <= 2 ? a.gradePoint <= 7 : a.gradePoint <= 8
  ).length;
  const distinctionCount = assessments.filter((a) => a.gradePoint <= 2).length;
  const passRate = count > 0 ? Math.round((passCount / count) * 100) : 0;

  y = drawSummaryStrip(doc, y, [
    { label: 'Graded Entries', value: String(count) },
    { label: 'Mean Score', value: `${meanScore.toFixed(1)}%` },
    { label: 'Pass Rate', value: `${passRate}% (${passCount}/${count})` },
    { label: 'Distinctions', value: String(distinctionCount) },
  ]);

  autoTable(doc, {
    startY: y,
    margin: { left: 14, right: 14, bottom: 18 },
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
      fontSize: 7.8,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 7 },
      1: { cellWidth: 35 },
      2: { cellWidth: 16 },
      3: { cellWidth: 25 },
      4: { halign: 'right', cellWidth: 17 },
      5: { halign: 'right', cellWidth: 17 },
      6: { halign: 'right', cellWidth: 20 },
      7: { halign: 'right', cellWidth: 13, fontStyle: 'bold' },
      8: { halign: 'center', cellWidth: 11, fontStyle: 'bold' },
      9: { cellWidth: 21 },
    },
    head: [['Rank', 'Student Name', 'Class', 'Subject', 'CA 1 (20%)', 'CA 2 (20%)', 'Summative (60%)', 'Total', 'Grade', 'Remark']],
    body: rankAssessmentsByPerformance(assessments).map(({ assessment: a, rank, isTied }) => {
      const b = normalizeAssessmentComponents(a);
      return [
        isTied ? `#${rank}=` : `#${rank}`,
        a.studentName,
        `Form ${a.formLevel}${a.stream}`,
        a.subject,
        b.hasCa1 ? String(Math.round(b.ca1Score)) : '—',
        b.hasCa2 ? String(Math.round(b.ca2Score)) : '—',
        b.hasExam ? String(Math.round(b.examScore)) : '—',
        `${a.totalScore}%`,
        a.grade,
        a.remark,
      ];
    }),
  });

  addPageFooters(doc, school.name);
  const slug = slugifySchool(school.name);
  const termSlug = termFilter.toLowerCase().replace(/\s+/g, '-');
  doc.save(`${slug}-marks-report-${termSlug}.pdf`);
}

function addSchoolLogoSafe(
  doc: jsPDF,
  school: School,
  x: number,
  y: number,
  size: number
): boolean {
  if (!school.logoDataUrl || !school.logoDataUrl.startsWith('data:image/')) {
    return false;
  }
  try {
    const imgFormat = school.logoDataUrl.startsWith('data:image/jpeg')
      ? 'JPEG'
      : school.logoDataUrl.startsWith('data:image/webp')
      ? 'WEBP'
      : 'PNG';
    doc.addImage(school.logoDataUrl, imgFormat, x, y, size, size);
    return true;
  } catch {
    return false;
  }
}

function drawGradingKeyBox(
  doc: jsPDF,
  startY: number,
  formLevel: FormLevel,
  monochrome = false
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const usableWidth = pageWidth - margin * 2;
  const boxHeight = 14;

  doc.setFillColor(monochrome ? 255 : 248, monochrome ? 255 : 250, monochrome ? 255 : 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.25);
  doc.roundedRect(margin, startY, usableWidth, boxHeight, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(30, 41, 59);
  const title =
    formLevel <= 2
      ? 'JCE GRADING KEY (Forms 1–2):'
      : 'MSCE GRADING KEY (Forms 3–4):';
  doc.text(title, margin + 3, startY + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(71, 85, 105);
  const scaleText =
    formLevel <= 2
      ? 'A (80–100% Distinction · Pt 1)  |  B (70–79% Very Good · Pt 3)  |  C (60–69% Credit · Pt 5)  |  D (50–59% Pass · Pt 7)  |  F (0–49% Fail · Pt 9)'
      : '1–2 (75–100% Distinction)  |  3 (70–74% Strong Credit)  |  4–6 (55–69% Credit)  |  7–8 (40–54% Pass)  |  9 (0–39% Fail)  |  Pass requires English';
  doc.text(scaleText, margin + 3, startY + 10.5, { maxWidth: usableWidth - 6 });

  return startY + boxHeight + 4;
}

function drawRemarksBlock(
  doc: jsPDF,
  startY: number,
  card: BuiltStudentReportCard,
  monochrome = false
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const usableWidth = pageWidth - margin * 2;
  const boxHeight = card.nextTermOpens ? 24 : 20;

  doc.setFillColor(monochrome ? 255 : 248, monochrome ? 255 : 250, monochrome ? 255 : 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.25);
  doc.roundedRect(margin, startY, usableWidth, boxHeight, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.setTextColor(15, 23, 42);
  doc.text('Form Teacher:', margin + 3, startY + 5.2);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  doc.text(card.formTeacherRemark, margin + 27, startY + 5.2, { maxWidth: usableWidth - 30 });

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('Head Teacher:', margin + 3, startY + 13.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  doc.text(card.headTeacherRemark, margin + 27, startY + 13.5, { maxWidth: usableWidth - 30 });

  if (card.nextTermOpens) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(monochrome ? 30 : 13, monochrome ? 41 : 110, monochrome ? 59 : 82);
    doc.text(`Next Term Opens: ${card.nextTermOpens}`, margin + 3, startY + 21);
  }

  return startY + boxHeight + 4;
}

function drawSignaturesBlock(
  doc: jsPDF,
  startY: number,
  leftLabel = 'Form Teacher Signature & Date',
  rightLabel = 'Head Teacher Signature & Official School Stamp'
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const sigY = Math.min(pageHeight - 23, Math.max(startY + 9, startY));

  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.35);
  doc.line(14, sigY, 82, sigY);
  doc.line(pageWidth - 88, sigY, pageWidth - 14, sigY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.6);
  doc.setTextColor(71, 85, 105);
  doc.text(leftLabel, 14, sigY + 4.2);
  doc.text(rightLabel, pageWidth - 88, sigY + 4.2);

  return sigY + 7;
}

function drawGuardianTearOffSlip(
  doc: jsPDF,
  startY: number,
  card: BuiltStudentReportCard
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const slipY = Math.min(pageHeight - 38, Math.max(startY + 4, startY));

  // Dashed cut line
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  doc.setLineDashPattern([2, 1.5], 0);
  doc.line(margin, slipY, pageWidth - margin, slipY);
  doc.setLineDashPattern([], 0);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(30, 41, 59);
  doc.text('PARENT / GUARDIAN ACKNOWLEDGEMENT RETURN SLIP', margin, slipY + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `I acknowledge receipt of ${card.term} (${card.school.academicYear}) academic report for ${card.student.fullName} (Adm #: ${card.student.admissionNo}, Form ${card.student.formLevel}${card.student.stream}).`,
    margin,
    slipY + 10,
    { maxWidth: pageWidth - margin * 2 }
  );

  const lineY = slipY + 20;
  doc.setDrawColor(148, 163, 184);
  doc.line(margin, lineY, margin + 62, lineY);
  doc.line(margin + 72, lineY, margin + 132, lineY);
  doc.line(margin + 142, lineY, pageWidth - margin, lineY);

  doc.setFontSize(7);
  doc.text(
    card.student.guardianName ? `Guardian: ${card.student.guardianName}` : 'Parent / Guardian Name',
    margin,
    lineY + 3.8
  );
  doc.text('Parent / Guardian Signature', margin + 72, lineY + 3.8);
  doc.text('Date Returned', margin + 142, lineY + 3.8);
}

function getStandingStripItems(
  card: BuiltStudentReportCard,
  options: ReportCardExportOptions
): { label: string; value: string }[] {
  const { student, summary, classRank, attendanceStats } = card;
  const bestOrPassValue =
    student.formLevel >= 3
      ? summary.standing.bestSixPoints !== null
        ? `${summary.standing.bestSixPoints} pts (Mean ${summary.meanManebPoint ?? '—'})`
        : `${summary.subjectCount}/6 subjects`
      : `${summary.passedSubjectCount}/${summary.subjectCount} (${summary.creditSubjectCount} credits)`;

  const items: { label: string; value: string }[] = [
    {
      label: student.formLevel >= 3 ? 'MSCE Best 6 Pts' : 'Subjects Passed',
      value: bestOrPassValue,
    },
    { label: 'Term Average', value: `${summary.weightedAverage.toFixed(1)}% (${summary.overallGrade})` },
    { label: `${summary.system} Standing`, value: `${summary.standing.outcome} · ${summary.overallRemark}` },
  ];

  if (options.includeRank && classRank) {
    items.push({
      label: `${classRank.formLabel} Position`,
      value: `${formatOrdinalPosition(classRank.rank)} of ${classRank.totalRanked}`,
    });
  } else if (options.includeAttendance && attendanceStats && attendanceStats.ratePct !== null) {
    items.push({
      label: 'Term Attendance',
      value: `${attendanceStats.ratePct.toFixed(0)}% (${attendanceStats.present + attendanceStats.late}/${attendanceStats.totalMarked}d)`,
    });
  } else {
    items.push({
      label: 'CA / Exam Split',
      value: `${summary.caAverage.toFixed(1)} / ${summary.summativeAverage.toFixed(1)}`,
    });
  }

  return items;
}

function renderReportCardPage(
  doc: jsPDF,
  card: BuiltStudentReportCard,
  templateId: ReportCardTemplateId,
  options: ReportCardExportOptions
) {
  const { school, student, term, summary, classRank, attendanceStats } = card;
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const usableWidth = pageWidth - margin * 2;
  const isCompact = templateId === 'compact-parent-slip';
  const isModern = templateId === 'modern-executive';
  const isDetailed = templateId === 'detailed-transcript';
  const compactRows = summary.rows.length > 9;

  // Theme colors per pre-defined template
  const headerRgb: [number, number, number] =
    templateId === 'classic-maneb'
      ? [13, 110, 82]
      : templateId === 'modern-executive'
      ? [15, 23, 42]
      : templateId === 'detailed-transcript'
      ? [30, 58, 95]
      : [51, 65, 85];

  let y = 10;

  if (isCompact) {
    // Monochrome ink-saving border bar
    doc.setDrawColor(51, 65, 85);
    doc.setLineWidth(0.7);
    doc.line(margin, 7, pageWidth - margin, 7);
    let textX = margin;
    if (addSchoolLogoSafe(doc, school, margin, 9, 10)) {
      textX = margin + 12.5;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    doc.setTextColor(15, 23, 42);
    doc.text(school.name.toUpperCase(), textX, 13.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(
      `${school.district} District  ·  ${school.academicYear}  ·  ${term} Parent Academic Slip`,
      textX,
      18
    );
    y = 22;
  } else {
    // Top colored accent bar
    doc.setFillColor(...headerRgb);
    doc.rect(0, 0, pageWidth, 4, 'F');

    let textX = margin;
    if (addSchoolLogoSafe(doc, school, margin, 8, 13)) {
      textX = margin + 16;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14.5);
    doc.setTextColor(15, 23, 42);
    doc.text(school.name.toUpperCase(), textX, 14);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    const subline = [
      `${school.district} District`,
      school.schoolType,
      school.motto ? `"${school.motto}"` : '',
    ]
      .filter(Boolean)
      .join('  ·  ');
    doc.text(subline, textX, 19.2);

    const generatedStr = new Date().toLocaleDateString('en-MW', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    doc.setFontSize(8);
    doc.text(`${school.academicYear}  ·  ${term}`, pageWidth - margin, 14, { align: 'right' });
    doc.text(`Issued: ${generatedStr}`, pageWidth - margin, 19.2, { align: 'right' });

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.35);
    doc.line(margin, 23, pageWidth - margin, 23);

    const reportHeading =
      templateId === 'classic-maneb'
        ? 'OFFICIAL STUDENT ACADEMIC REPORT CARD'
        : templateId === 'modern-executive'
        ? 'Executive Student Term Report Card'
        : 'Detailed Continuous Assessment & Exam Transcript';

    if (isModern) {
      doc.setFillColor(13, 110, 82);
      doc.rect(margin, 26.5, 2, 5.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11.5);
      doc.setTextColor(15, 23, 42);
      doc.text(reportHeading, margin + 4.5, 31);
      y = 35;
    } else {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11.5);
      doc.setTextColor(...headerRgb);
      doc.text(reportHeading, margin, 29.5);
      y = 33.5;
    }
  }

  // Student Biodata Grid
  const bioHeight = isCompact ? 13 : 16;
  doc.setFillColor(isCompact ? 255 : 248, isCompact ? 255 : 250, isCompact ? 255 : 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.25);
  doc.roundedRect(margin, y, usableWidth, bioHeight, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(15, 23, 42);
  doc.text(`Student: ${student.fullName}`, margin + 3.5, y + 5.2);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(71, 85, 105);
  const leftLine2Parts = [
    `Adm #: ${student.admissionNo}`,
    `Class: Form ${student.formLevel}${student.stream} (${summary.system})`,
    student.boardingStatus,
  ];
  if (isCompact && student.guardianName) {
    leftLine2Parts.push(`Guardian: ${student.guardianName}`);
  }
  doc.text(leftLine2Parts.join('  ·  '), margin + 3.5, y + (isCompact ? 10 : 11.2));

  const rightLine1 =
    options.includeRank && classRank
      ? `Position: ${formatOrdinalPosition(classRank.rank)} / ${classRank.totalRanked}`
      : `Subjects: ${summary.subjectCount}`;
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(rightLine1, pageWidth - margin - 3.5, y + 5.2, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  const rightLine2 =
    options.includeAttendance && attendanceStats && attendanceStats.ratePct !== null
      ? `Attendance: ${attendanceStats.present + attendanceStats.late}/${attendanceStats.totalMarked} days (${attendanceStats.ratePct.toFixed(0)}%)`
      : `Term: ${term} (${school.academicYear})`;
  doc.text(rightLine2, pageWidth - margin - 3.5, y + (isCompact ? 10 : 11.2), { align: 'right' });

  y += bioHeight + 3.5;

  // Summary strip
  y = drawSummaryStrip(doc, y, getStandingStripItems(card, options)) - 2;

  // Modern template: horizontal weighted score composition visual bar
  if (isModern && summary.subjectCount > 0) {
    const barW = usableWidth;
    const barH = 4.2;
    const totalPossible = 100;
    const ca1W = (Math.min(20, summary.ca1Average) / totalPossible) * barW;
    const ca2W = (Math.min(20, summary.ca2Average) / totalPossible) * barW;
    const examW = (Math.min(60, summary.summativeAverage) / totalPossible) * barW;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.text(
      `Weighted Score Composition: CA1 ${summary.ca1Average.toFixed(1)}/20  +  CA2 ${summary.ca2Average.toFixed(1)}/20  +  Exam ${summary.summativeAverage.toFixed(1)}/60  =  ${summary.weightedAverage.toFixed(1)}%`,
      margin,
      y + 2.5
    );
    y += 4;
    doc.setFillColor(226, 232, 240);
    doc.rect(margin, y, barW, barH, 'F');
    if (ca1W > 0) {
      doc.setFillColor(16, 185, 129);
      doc.rect(margin, y, ca1W, barH, 'F');
    }
    if (ca2W > 0) {
      doc.setFillColor(14, 165, 233);
      doc.rect(margin + ca1W, y, ca2W, barH, 'F');
    }
    if (examW > 0) {
      doc.setFillColor(15, 23, 42);
      doc.rect(margin + ca1W + ca2W, y, examW, barH, 'F');
    }
    y += barH + 4;
  }

  // Subject marks table tailored to template
  const tableHead = isCompact
    ? [['Subject', 'CA (40%)', 'Exam (60%)', 'Total (100%)', 'Grade', 'Remark']]
    : isDetailed
    ? [['Subject', 'CA 1 (20%)', 'CA 2 (20%)', 'CA Δ', 'Exam (60%)', 'Total', 'Pts', 'Grade', 'Remark']]
    : [['Subject', 'CA 1 (20%)', 'CA 2 (20%)', 'Summative (60%)', 'Total (100%)', 'Pts (1-9)', 'Grade', 'Remark']];

  const tableBody = summary.rows.map((r) => {
    if (isCompact) {
      return [
        r.assessment.subject,
        String(Math.round(r.ca1Score + r.ca2Score)),
        r.hasExam ? String(Math.round(r.examScore)) : '—',
        `${Math.round(r.totalScore)}%`,
        r.grade,
        r.remark,
      ];
    }
    if (isDetailed) {
      const delta = computeSubjectCaDeltaPct(r);
      const deltaStr = delta === null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}%`;
      return [
        r.assessment.subject,
        r.hasCa1 ? String(Math.round(r.ca1Score)) : '—',
        r.hasCa2 ? String(Math.round(r.ca2Score)) : '—',
        deltaStr,
        r.hasExam ? String(Math.round(r.examScore)) : '—',
        `${Math.round(r.totalScore)}%`,
        String(r.gradePoint),
        r.grade,
        r.remark,
      ];
    }
    return [
      r.assessment.subject,
      r.hasCa1 ? String(Math.round(r.ca1Score)) : '—',
      r.hasCa2 ? String(Math.round(r.ca2Score)) : '—',
      r.hasExam ? String(Math.round(r.examScore)) : '—',
      `${Math.round(r.totalScore)}%`,
      String(r.gradePoint),
      r.grade,
      r.remark,
    ];
  });

  const tableFoot = isCompact
    ? [[
        `OVERALL (${summary.subjectCount} Subjects)`,
        summary.caAverage.toFixed(1),
        summary.summativeAverage.toFixed(1),
        `${summary.weightedAverage.toFixed(1)}%`,
        summary.overallGrade,
        summary.overallRemark,
      ]]
    : isDetailed
    ? [[
        `OVERALL (${summary.subjectCount} Subjects)`,
        summary.ca1Average.toFixed(1),
        summary.ca2Average.toFixed(1),
        '—',
        summary.summativeAverage.toFixed(1),
        `${summary.weightedAverage.toFixed(1)}%`,
        summary.meanManebPoint !== null ? summary.meanManebPoint.toFixed(1) : '—',
        summary.overallGrade,
        summary.overallRemark,
      ]]
    : [[
        `OVERALL (${summary.subjectCount} Subjects)`,
        summary.ca1Average.toFixed(1),
        summary.ca2Average.toFixed(1),
        summary.summativeAverage.toFixed(1),
        `${summary.weightedAverage.toFixed(1)}%`,
        summary.meanManebPoint !== null ? summary.meanManebPoint.toFixed(1) : '—',
        summary.overallGrade,
        summary.overallRemark,
      ]];

  const colStyles: Record<number, { halign?: 'left' | 'right' | 'center'; cellWidth?: number; fontStyle?: 'normal' | 'bold' }> =
    isCompact
      ? {
          0: { cellWidth: 58 },
          1: { halign: 'right', cellWidth: 23 },
          2: { halign: 'right', cellWidth: 24 },
          3: { halign: 'right', cellWidth: 25, fontStyle: 'bold' },
          4: { halign: 'center', cellWidth: 18, fontStyle: 'bold' },
          5: { cellWidth: 34 },
        }
      : isDetailed
      ? {
          0: { cellWidth: 36 },
          1: { halign: 'right', cellWidth: 18 },
          2: { halign: 'right', cellWidth: 18 },
          3: { halign: 'right', cellWidth: 14 },
          4: { halign: 'right', cellWidth: 21 },
          5: { halign: 'right', cellWidth: 18, fontStyle: 'bold' },
          6: { halign: 'right', cellWidth: 12 },
          7: { halign: 'center', cellWidth: 14, fontStyle: 'bold' },
          8: { cellWidth: 31 },
        }
      : {
          0: { cellWidth: 40 },
          1: { halign: 'right', cellWidth: 21 },
          2: { halign: 'right', cellWidth: 21 },
          3: { halign: 'right', cellWidth: 25 },
          4: { halign: 'right', cellWidth: 22, fontStyle: 'bold' },
          5: { halign: 'right', cellWidth: 16 },
          6: { halign: 'center', cellWidth: 14, fontStyle: 'bold' },
          7: { cellWidth: 23 },
        };

  autoTable(doc, {
    startY: y,
    margin: { left: 14, right: 14, bottom: 26 },
    theme: isCompact ? 'plain' : 'grid',
    styles: {
      font: 'helvetica',
      fontSize: compactRows ? 7.6 : 8.2,
      cellPadding: compactRows ? 1.8 : 2.3,
      textColor: [30, 41, 59],
      lineColor: [203, 213, 225],
      lineWidth: 0.25,
    },
    headStyles: isCompact
      ? {
          fillColor: [241, 245, 249],
          textColor: [15, 23, 42],
          fontStyle: 'bold',
          lineWidth: 0.3,
          lineColor: [148, 163, 184],
        }
      : {
          fillColor: headerRgb,
          textColor: [255, 255, 255],
          fontStyle: 'bold',
        },
    footStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
    },
    alternateRowStyles: isCompact
      ? undefined
      : {
          fillColor: [248, 250, 252],
        },
    columnStyles: colStyles,
    head: tableHead,
    body: tableBody,
    foot: tableFoot,
  });

  let nextY =
    ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 60) + 4;

  // Attendance Breakdown Box for Detailed Transcript when enabled
  if (isDetailed && options.includeAttendance && attendanceStats && nextY < 236) {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.25);
    doc.roundedRect(margin, nextY, usableWidth, 10, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.4);
    doc.setTextColor(15, 23, 42);
    doc.text('Attendance Record:', margin + 3, nextY + 6.2);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(
      `Present: ${attendanceStats.present}  ·  Late: ${attendanceStats.late}  ·  Absent: ${attendanceStats.absent}  ·  Excused: ${attendanceStats.excused}  ·  Total Sessions Marked: ${attendanceStats.totalMarked}${attendanceStats.ratePct !== null ? ` (${attendanceStats.ratePct.toFixed(1)}%)` : ''}`,
      margin + 34,
      nextY + 6.2
    );
    nextY += 13;
  }

  if (options.includeRemarks && nextY < 248) {
    nextY = drawRemarksBlock(doc, nextY, card, isCompact);
  }

  if (options.includeGradingKey && nextY < 252) {
    nextY = drawGradingKeyBox(doc, nextY, student.formLevel, isCompact);
  }

  if (options.includeGuardianSlip) {
    nextY = drawSignaturesBlock(doc, nextY, 'Form Teacher Signature', 'Head Teacher & Stamp');
    if (nextY < 266) {
      drawGuardianTearOffSlip(doc, nextY, card);
    }
  } else {
    drawSignaturesBlock(doc, nextY);
  }
}

export function downloadStudentTermReportCardPdf(params: {
  school: School;
  student: Student;
  term: TermName;
  summary: TermReportCardSummary;
  templateId?: ReportCardTemplateId;
  options?: Partial<ReportCardExportOptions>;
  classRank?: StudentClassRank | null;
  attendanceStats?: StudentReportAttendanceStats | null;
  formTeacherRemark?: string;
  headTeacherRemark?: string;
  nextTermOpens?: string;
}) {
  const templateId = params.templateId ?? 'classic-maneb';
  const meta = getReportTemplateMeta(templateId);
  const options: ReportCardExportOptions = {
    ...meta.defaultOptions,
    ...(params.options || {}),
  };

  const card = buildStudentReportCardPayload({
    school: params.school,
    student: params.student,
    term: params.term,
    summary: params.summary,
    classRank: params.classRank,
    attendanceStats: params.attendanceStats,
    formTeacherRemark: params.formTeacherRemark,
    headTeacherRemark: params.headTeacherRemark,
    nextTermOpens: params.nextTermOpens,
  });

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  renderReportCardPage(doc, card, templateId, options);
  addPageFooters(doc, params.school.name);

  const stuSlug = slugifySchool(params.student.fullName);
  const termSlug = params.term.toLowerCase().replace(/\s+/g, '-');
  doc.save(`${stuSlug}-${termSlug}-${templateId}-report-card.pdf`);
}

export function downloadBatchStudentReportCardsPdf(params: {
  school: School;
  cards: BuiltStudentReportCard[];
  templateId: ReportCardTemplateId;
  options?: Partial<ReportCardExportOptions>;
  batchLabel: string;
  term: TermName;
}) {
  if (params.cards.length === 0) return;

  const meta = getReportTemplateMeta(params.templateId);
  const options: ReportCardExportOptions = {
    ...meta.defaultOptions,
    ...(params.options || {}),
  };

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  params.cards.forEach((card, index) => {
    if (index > 0) {
      doc.addPage('a4', 'portrait');
    }
    renderReportCardPage(doc, card, params.templateId, options);
  });

  // Add subtle per-student footers on every page
  const totalPages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 11, pageWidth - margin, pageHeight - 11);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `${params.school.name} — ${params.term} (${params.school.academicYear})`,
      margin,
      pageHeight - 6.5
    );
    doc.text(`Sheet ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 6.5, {
      align: 'right',
    });
  }

  const schoolSlug = slugifySchool(params.school.name);
  const batchSlug = slugifySchool(params.batchLabel);
  const termSlug = params.term.toLowerCase().replace(/\s+/g, '-');
  doc.save(`${schoolSlug}-${batchSlug}-${termSlug}-${params.templateId}-report-cards.pdf`);
}

export function downloadFeesPdfReport(params: {
  school: School;
  viewMode: 'invoices' | 'receipts';
  termFilter: TermName;
  statusFilter: 'all' | InvoiceStatus;
  invoices: FeeInvoice[];
  payments: FeePayment[];
}) {
  const { school, viewMode, termFilter, statusFilter, invoices, payments } = params;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  if (viewMode === 'invoices') {
    const statusLabel = statusFilter === 'all' ? 'All Statuses' : `${statusFilter} Only`;
    const filterSummary = `Term: ${termFilter}  ·  View: Student Fee Invoices  ·  Filter: ${statusLabel}`;

    let y = drawReportHeader(doc, school, 'Bursar Fee Statement Report (MWK)', filterSummary);

    const totalBilled = invoices.reduce((s, i) => s + i.totalBilled, 0);
    const totalPaid = invoices.reduce((s, i) => s + i.totalPaid, 0);
    const totalBalance = Math.max(0, totalBilled - totalPaid);
    const paidCount = invoices.filter((i) => i.status === 'Paid').length;

    y = drawSummaryStrip(doc, y, [
      { label: 'Invoices Shown', value: `${invoices.length} (${paidCount} Paid)` },
      { label: 'Total Billed', value: formatMWK(totalBilled) },
      { label: 'Total Collected', value: formatMWK(totalPaid) },
      { label: 'Balance Due', value: formatMWK(totalBalance) },
    ]);

    autoTable(doc, {
      startY: y,
      margin: { left: 14, right: 14, bottom: 18 },
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 8.5,
        cellPadding: 2.8,
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240],
        lineWidth: 0.25,
      },
      headStyles: {
        fillColor: [13, 110, 82],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      footStyles: {
        fillColor: [241, 245, 249],
        textColor: [15, 23, 42],
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 9 },
        2: { cellWidth: 20 },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right', fontStyle: 'bold' },
        6: { halign: 'center', cellWidth: 20 },
      },
      head: [['#', 'Student Name', 'Class', 'Billed', 'Paid', 'Balance', 'Status']],
      body: invoices.map((inv, idx) => {
        const balance = Math.max(0, inv.totalBilled - inv.totalPaid);
        return [
          String(idx + 1),
          inv.studentName,
          `Form ${inv.formLevel}${inv.stream}`,
          formatMWK(inv.totalBilled),
          formatMWK(inv.totalPaid),
          formatMWK(balance),
          inv.status,
        ];
      }),
      foot: [
        [
          '',
          'TOTALS',
          `${invoices.length} students`,
          formatMWK(totalBilled),
          formatMWK(totalPaid),
          formatMWK(totalBalance),
          '',
        ],
      ],
    });
  } else {
    const filterSummary = `Term: ${termFilter}  ·  View: Official Fee Payment Receipts`;
    let y = drawReportHeader(doc, school, 'Bursar Fee Receipts Ledger (MWK)', filterSummary);

    const totalAmount = payments.reduce((s, p) => s + p.amount, 0);
    const mobileMoneyTotal = payments
      .filter((p) => p.method === 'Airtel Money' || p.method === 'TNM Mpamba')
      .reduce((s, p) => s + p.amount, 0);
    const bankTotal = payments
      .filter((p) => p.method === 'Bank Deposit')
      .reduce((s, p) => s + p.amount, 0);

    y = drawSummaryStrip(doc, y, [
      { label: 'Receipts Issued', value: String(payments.length) },
      { label: 'Total Collected', value: formatMWK(totalAmount) },
      { label: 'Bank Deposits', value: formatMWK(bankTotal) },
      { label: 'Airtel / Mpamba', value: formatMWK(mobileMoneyTotal) },
    ]);

    autoTable(doc, {
      startY: y,
      margin: { left: 14, right: 14, bottom: 18 },
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 8.5,
        cellPadding: 2.8,
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240],
        lineWidth: 0.25,
      },
      headStyles: {
        fillColor: [13, 110, 82],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      footStyles: {
        fillColor: [241, 245, 249],
        textColor: [15, 23, 42],
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 9 },
        5: { halign: 'right', fontStyle: 'bold' },
      },
      head: [['#', 'Receipt No.', 'Student Name', 'Channel', 'Reference', 'Amount Paid']],
      body: payments.map((p, idx) => [
        String(idx + 1),
        p.receiptNo,
        p.studentName,
        p.method,
        p.reference,
        formatMWK(p.amount),
      ]),
      foot: [['', 'TOTAL COLLECTED', `${payments.length} receipts`, '', '', formatMWK(totalAmount)]],
    });
  }

  addPageFooters(doc, school.name);
  const slug = slugifySchool(school.name);
  const termSlug = termFilter.toLowerCase().replace(/\s+/g, '-');
  doc.save(`${slug}-fees-${viewMode}-${termSlug}.pdf`);
}

export function downloadStaffTimebookPdfReport(params: {
  school: School;
  dateLabel: string;
  entries: StaffTimebookEntry[];
  totalStaffCount: number;
  gpsAutoCount: number;
  adminRecordedCount: number;
  absentOrUnsignedCount: number;
}): void {
  const { school, dateLabel, entries } = params;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const filterSummary = `Period: ${dateLabel}  ·  Register Type: GPS Verified vs Admin Recorded`;
  let y = drawReportHeader(doc, school, 'Staff Timebook & Attendance Register', filterSummary);

  y = drawSummaryStrip(doc, y, [
    { label: 'Total Staff', value: String(params.totalStaffCount) },
    { label: 'GPS Auto Verified', value: String(params.gpsAutoCount) },
    { label: 'Admin Recorded', value: String(params.adminRecordedCount) },
    { label: 'Absent / Unsigned', value: String(params.absentOrUnsignedCount) },
  ]);

  autoTable(doc, {
    startY: y,
    margin: { left: 14, right: 14, bottom: 18 },
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.2,
      cellPadding: 2.5,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.25,
    },
    headStyles: {
      fillColor: [13, 110, 82],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 9 },
      1: { cellWidth: 22 },
      3: { cellWidth: 24 },
      5: { cellWidth: 28 },
      6: { cellWidth: 26 },
      7: { halign: 'right', cellWidth: 24 },
    },
    head: [
      [
        '#',
        'Date',
        'Staff Member',
        'Code / Role',
        'Status',
        'Method',
        'Time In',
        'Distance (m)',
        'Remarks / Audit',
      ],
    ],
    body: entries.map((e, idx) => [
      String(idx + 1),
      e.date,
      e.staffName,
      `${e.staffCode} · ${e.roleTitle}`,
      e.status,
      e.recordingMethod,
      e.timeInDisplay || '—',
      e.recordingMethod === 'GPS Auto' ? `${Math.round(e.distanceMeters)} m` : 'Override',
      e.correctionReason || (e.isSuspicious ? `Flagged: ${e.spoofingFlags.join(', ')}` : e.gpsVerificationStatus),
    ]),
  });

  addPageFooters(doc, school.name);
  const slug = slugifySchool(school.name);
  const cleanDate = dateLabel.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  doc.save(`${slug}-staff-timebook-${cleanDate}.pdf`);
}

