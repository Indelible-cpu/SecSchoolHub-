import { formatMalawiSmsPhone, formatMWK, matchesStudentSearchQuery } from './malawi';
import type { FeeInvoice, FormLevel, SmsLog, Student, TermName } from './types';

export interface SmsReminderPreset {
  id: 'standard' | 'urgent' | 'instalment';
  label: string;
  description: string;
  template: string;
}

export const SMS_REMINDER_PRESETS: SmsReminderPreset[] = [
  {
    id: 'standard',
    label: 'Standard Balance Reminder',
    description: 'Includes balance due, total billed, and accepted payment channels.',
    template:
      '[{sender}] Fee Balance Alert: Dear {guardian}, {student} ({class}) has an unpaid {term} balance of {balance} (of {billed} billed). Please clear via Bursar, Bank, Airtel Money or Mpamba.',
  },
  {
    id: 'urgent',
    label: 'Urgent Clearance Notice',
    description: 'Direct reminder for overdue accounts ahead of exams or term deadlines.',
    template:
      '[{sender}] Urgent Fee Notice: Dear {guardian}, please settle {student} ({class}) {term} fee balance of {balance} before the clearance deadline. Contact the Bursar for assistance.',
  },
  {
    id: 'instalment',
    label: 'Instalment Follow-Up',
    description: 'Supportive follow-up showing amount paid so far and remaining balance.',
    template:
      '[{sender}] Fee Follow-Up: Dear {guardian}, {student} has paid {paid} toward {term} fees with {balance} remaining. Partial or full payments via Bank, Airtel Money or Mpamba are welcome.',
  },
];

export const DEFAULT_PAYMENT_REMINDER_TEMPLATE = SMS_REMINDER_PRESETS[0].template;

export interface SmsTemplateTokenMeta {
  token: string;
  label: string;
  description: string;
}

export const SMS_TEMPLATE_TOKENS: SmsTemplateTokenMeta[] = [
  { token: '{guardian}', label: 'Guardian', description: 'Parent or guardian name' },
  { token: '{student}', label: 'Student', description: 'Student full name' },
  { token: '{class}', label: 'Class', description: 'e.g. Form 2A' },
  { token: '{term}', label: 'Term', description: 'Current academic term' },
  { token: '{balance}', label: 'Balance', description: 'Outstanding balance in MWK' },
  { token: '{billed}', label: 'Total Billed', description: 'Term invoice total in MWK' },
  { token: '{paid}', label: 'Amount Paid', description: 'Total paid so far in MWK' },
  { token: '{sender}', label: 'Sender Header', description: 'Configured school SMS label' },
];

export interface RenderPaymentReminderParams {
  senderLabel: string;
  guardianName: string;
  studentName: string;
  formClass: string;
  term: TermName;
  balanceMWK: number;
  totalBilledMWK: number;
  totalPaidMWK: number;
}

export interface RenderedSmsPreview {
  message: string;
  fullLength: number;
  charCount: number;
  segmentCount: number;
  wasTruncated: boolean;
}

export function renderPaymentReminderMessage(
  template: string,
  vars: RenderPaymentReminderParams
): RenderedSmsPreview {
  const source = template.trim() || DEFAULT_PAYMENT_REMINDER_TEMPLATE;
  const sender = (vars.senderLabel || 'SecSchoolHub').trim().slice(0, 40) || 'SecSchoolHub';
  const guardian = vars.guardianName.trim() || 'Parent/Guardian';
  const student = vars.studentName.trim() || 'Student';
  const formClass = vars.formClass.trim() || 'Secondary';
  const balance = formatMWK(Math.max(0, vars.balanceMWK));
  const billed = formatMWK(Math.max(0, vars.totalBilledMWK));
  const paid = formatMWK(Math.max(0, vars.totalPaidMWK));

  const replacements: Record<string, string> = {
    '{sender}': sender,
    '{guardian}': guardian,
    '{student}': student,
    '{class}': formClass,
    '{term}': vars.term,
    '{balance}': balance,
    '{billed}': billed,
    '{paid}': paid,
  };

  const expanded = source
    .replace(
      /\{(sender|guardian|student|class|term|balance|billed|paid)\}/gi,
      (match) => replacements[match.toLowerCase()] ?? match
    )
    .replace(/\s+/g, ' ')
    .trim();

  const fullLength = expanded.length;
  const wasTruncated = fullLength > 320;
  const message = wasTruncated ? `${expanded.slice(0, 317).trimEnd()}...` : expanded;
  const charCount = message.length;
  const segmentCount = charCount === 0 ? 0 : charCount <= 160 ? 1 : Math.ceil(charCount / 153);

  return {
    message,
    fullLength,
    charCount,
    segmentCount,
    wasTruncated,
  };
}

export function wasLowBalanceAlertSentRecently(
  smsLogs: SmsLog[],
  invoiceId: string,
  balanceMWK: number,
  nowMs = Date.now()
): boolean {
  const oneDayMs = 24 * 60 * 60 * 1000;
  return smsLogs.some((log) => {
    if (log.invoiceId !== invoiceId) return false;
    if (log.type !== 'Low Balance Alert') return false;
    if (log.status !== 'Sent' && log.status !== 'Simulated') return false;
    if (Math.round(log.balanceAfterMWK) !== Math.round(balanceMWK)) return false;
    const createdMs = log.createdAt?.toMillis?.();
    if (!createdMs) return true;
    return nowMs - createdMs < oneDayMs;
  });
}

export interface OutstandingSmsRecipient {
  invoice: FeeInvoice;
  student: Student | undefined;
  studentName: string;
  admissionNo: string;
  formClass: string;
  guardianName: string;
  rawPhone: string;
  formattedPhone: string;
  balance: number;
  recentlySent: boolean;
}

export function buildOutstandingSmsRecipients(params: {
  invoices: FeeInvoice[];
  studentById: ReadonlyMap<string, Student>;
  smsLogs: SmsLog[];
  termFilter: TermName;
  nowMs?: number;
}): OutstandingSmsRecipient[] {
  const { invoices, studentById, smsLogs, termFilter, nowMs } = params;
  return invoices
    .filter((inv) => inv.term === termFilter)
    .map((inv) => {
      const balance = Math.max(0, inv.totalBilled - inv.totalPaid);
      const student = studentById.get(inv.studentId);
      const formattedPhone =
        formatMalawiSmsPhone(student?.guardianPhone) ||
        formatMalawiSmsPhone(student?.guardianSecondaryPhone) ||
        '';
      const rawPhone = (student?.guardianPhone || student?.guardianSecondaryPhone || '').trim();
      const recentlySent = wasLowBalanceAlertSentRecently(smsLogs, inv.id, balance, nowMs);
      return {
        invoice: inv,
        student,
        studentName: inv.studentName,
        admissionNo: student?.admissionNo || '',
        formClass: `Form ${inv.formLevel}${inv.stream}`,
        guardianName: student?.guardianName || 'Parent/Guardian',
        rawPhone,
        formattedPhone,
        balance,
        recentlySent,
      };
    })
    .filter((item) => item.balance > 0)
    .sort((a, b) => b.balance - a.balance || a.studentName.localeCompare(b.studentName));
}

export function filterOutstandingSmsRecipients(
  recipients: OutstandingSmsRecipient[],
  params: {
    search?: string;
    formFilter?: 'all' | FormLevel;
    onlyReachable?: boolean;
  }
): OutstandingSmsRecipient[] {
  const q = (params.search || '').trim().toLowerCase();
  const formFilter = params.formFilter ?? 'all';
  const onlyReachable = Boolean(params.onlyReachable);

  return recipients.filter((r) => {
    if (formFilter !== 'all' && r.invoice.formLevel !== formFilter) return false;
    if (onlyReachable && !r.formattedPhone) return false;
    if (!q) return true;
    return matchesStudentSearchQuery(
      {
        fullName: r.studentName,
        admissionNo: r.admissionNo,
        registrationCode: r.student?.registrationCode,
        guardianName: r.guardianName,
        guardianPhone: r.rawPhone,
        extraTerms: [r.formClass, r.formattedPhone],
      },
      q,
      { includeGuardian: true }
    );
  });
}
