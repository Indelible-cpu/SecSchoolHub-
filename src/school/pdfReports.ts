import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatMWK, normalizeAssessmentComponents, TermReportCardSummary } from './malawi';
import {
  Assessment,
  FeeInvoice,
  FeePayment,
  FormLevel,
  InvoiceStatus,
  School,
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

  // School name & district
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text(school.name.toUpperCase(), margin, 15);

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
  doc.text(subline, margin, 20.5);

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
    head: [['#', 'Student Name', 'Class', 'Subject', 'CA 1 (20%)', 'CA 2 (20%)', 'Summative (60%)', 'Total', 'Grade', 'Remark']],
    body: assessments.map((a, idx) => {
      const b = normalizeAssessmentComponents(a);
      return [
        String(idx + 1),
        a.studentName,
        `Form ${a.formLevel}${a.stream}`,
        a.subject,
        b.hasCa1 ? b.ca1Score.toFixed(1) : '—',
        b.hasCa2 ? b.ca2Score.toFixed(1) : '—',
        b.hasExam ? b.examScore.toFixed(1) : '—',
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

export function downloadStudentTermReportCardPdf(params: {
  school: School;
  student: Student;
  term: TermName;
  summary: TermReportCardSummary;
}) {
  const { school, student, term, summary } = params;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const studentLine = `${student.fullName}  ·  Adm #: ${student.admissionNo}  ·  Form ${student.formLevel}${student.stream} (${summary.system})  ·  ${term}`;
  let y = drawReportHeader(doc, school, 'Official Student Term Report Card', studentLine);

  y = drawSummaryStrip(doc, y, [
    {
      label: student.formLevel >= 3 ? 'MSCE Best 6 Pts' : 'Subjects Passed',
      value:
        student.formLevel >= 3
          ? summary.standing.bestSixPoints !== null
            ? `${summary.standing.bestSixPoints} pts (Mean ${summary.meanManebPoint ?? '—'})`
            : `${summary.subjectCount}/6 subjects`
          : `${summary.passedSubjectCount} / ${summary.subjectCount} (${summary.creditSubjectCount} credits)`,
    },
    { label: 'Overall Grade', value: `${summary.overallGrade} (${summary.overallRemark})` },
    { label: 'Term Average', value: `${summary.weightedAverage.toFixed(1)}%` },
    {
      label: `${summary.system} Standing`,
      value: summary.standing.outcome,
    },
  ]);

  autoTable(doc, {
    startY: y,
    margin: { left: 14, right: 14, bottom: 26 },
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 2.6,
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
      0: { cellWidth: 40 },
      1: { halign: 'right', cellWidth: 21 },
      2: { halign: 'right', cellWidth: 21 },
      3: { halign: 'right', cellWidth: 25 },
      4: { halign: 'right', cellWidth: 22, fontStyle: 'bold' },
      5: { halign: 'right', cellWidth: 16 },
      6: { halign: 'center', cellWidth: 14, fontStyle: 'bold' },
      7: { cellWidth: 23 },
    },
    head: [['Subject', 'CA 1 (20%)', 'CA 2 (20%)', 'Summative (60%)', 'Total (100%)', 'Pts (1-9)', 'Grade', 'Remark']],
    body: summary.rows.map((r) => [
      r.assessment.subject,
      r.hasCa1 ? r.ca1Score.toFixed(1) : '—',
      r.hasCa2 ? r.ca2Score.toFixed(1) : '—',
      r.hasExam ? r.examScore.toFixed(1) : '—',
      `${r.totalScore.toFixed(1)}%`,
      String(r.gradePoint),
      r.grade,
      r.remark,
    ]),
    foot: [
      [
        `OVERALL (${summary.subjectCount} Subjects)`,
        summary.ca1Average.toFixed(1),
        summary.ca2Average.toFixed(1),
        summary.summativeAverage.toFixed(1),
        `${summary.weightedAverage.toFixed(1)}%`,
        summary.meanManebPoint !== null ? summary.meanManebPoint.toFixed(1) : '—',
        summary.overallGrade,
        summary.overallRemark,
      ],
    ],
  });

  // Signature block below table
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 60;
  const sigY = Math.min(pageHeight - 28, finalY + 14);

  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.35);
  doc.line(14, sigY, 82, sigY);
  doc.line(pageWidth - 82, sigY, pageWidth - 14, sigY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('Form Master Signature & Date', 14, sigY + 4.5);
  doc.text('Head Teacher Signature & School Stamp', pageWidth - 82, sigY + 4.5);

  addPageFooters(doc, school.name);
  const stuSlug = slugifySchool(student.fullName);
  const termSlug = term.toLowerCase().replace(/\s+/g, '-');
  doc.save(`${stuSlug}-${termSlug}-report-card.pdf`);
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
