import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOutstandingSmsRecipients,
  DEFAULT_PAYMENT_REMINDER_TEMPLATE,
  filterOutstandingSmsRecipients,
  renderPaymentReminderMessage,
  SMS_REMINDER_PRESETS,
} from '../src/school/bulkSmsUtils';
import type { FeeInvoice, SmsLog, Student } from '../src/school/types';

function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: 'stu-1',
    ownerId: 'owner-1',
    admissionNo: 'SCH/2026/001',
    fullName: 'Chimwemwe Banda',
    gender: 'Female',
    formLevel: 2,
    stream: 'A',
    boardingStatus: 'Day Scholar',
    guardianName: 'Mary Banda',
    guardianPhone: '0999112233',
    status: 'Active',
    ...overrides,
  };
}

function makeInvoice(overrides: Partial<FeeInvoice> = {}): FeeInvoice {
  return {
    id: 'inv-1',
    ownerId: 'owner-1',
    studentId: 'stu-1',
    studentName: 'Chimwemwe Banda',
    formLevel: 2,
    stream: 'A',
    term: 'Term 2',
    academicYear: '2026',
    tuitionFee: 50000,
    gpfFee: 5000,
    examFee: 5000,
    otherFee: 0,
    totalBilled: 60000,
    totalPaid: 20000,
    status: 'Partial',
    ...overrides,
  };
}

test('renderPaymentReminderMessage expands all tokens and enforces 320-char SMS limit', () => {
  const rendered = renderPaymentReminderMessage(DEFAULT_PAYMENT_REMINDER_TEMPLATE, {
    senderLabel: 'KamuzuSec',
    guardianName: 'Mary Banda',
    studentName: 'Chimwemwe Banda',
    formClass: 'Form 2A',
    term: 'Term 2',
    balanceMWK: 40000,
    totalBilledMWK: 60000,
    totalPaidMWK: 20000,
  });

  assert.equal(rendered.wasTruncated, false);
  assert.ok(rendered.message.includes('[KamuzuSec]'));
  assert.ok(rendered.message.includes('Dear Mary Banda'));
  assert.ok(rendered.message.includes('Chimwemwe Banda (Form 2A)'));
  assert.ok(rendered.message.includes('Term 2'));
  assert.ok(rendered.message.includes('40,000'));
  assert.ok(rendered.message.includes('60,000'));
  assert.ok(rendered.segmentCount >= 1);

  const urgentPreset = SMS_REMINDER_PRESETS.find((p) => p.id === 'urgent');
  assert.ok(urgentPreset);
  const urgentRendered = renderPaymentReminderMessage(urgentPreset.template, {
    senderLabel: 'School',
    guardianName: 'Peter Mwale',
    studentName: 'Tadala Mwale',
    formClass: 'Form 4B',
    term: 'Term 2',
    balanceMWK: 15000,
    totalBilledMWK: 45000,
    totalPaidMWK: 30000,
  });
  assert.ok(urgentRendered.message.includes('15,000'));

  // Long custom message should truncate cleanly at <= 320 characters
  const hugeTemplate = `[{sender}] ${'Notice '.repeat(60)} {balance}`;
  const truncated = renderPaymentReminderMessage(hugeTemplate, {
    senderLabel: 'School',
    guardianName: 'Guardian',
    studentName: 'Student',
    formClass: 'Form 1A',
    term: 'Term 1',
    balanceMWK: 10000,
    totalBilledMWK: 10000,
    totalPaidMWK: 0,
  });
  assert.equal(truncated.wasTruncated, true);
  assert.ok(truncated.charCount <= 320);
  assert.ok(truncated.message.endsWith('...'));
});

test('buildOutstandingSmsRecipients filters to outstanding term balances, normalizes phones, and flags recent alerts', () => {
  const s1 = makeStudent({ id: 'stu-1', fullName: 'Chimwemwe Banda', guardianPhone: '0999112233' });
  const s2 = makeStudent({
    id: 'stu-2',
    admissionNo: 'SCH/2026/002',
    fullName: 'Kondwani Phiri',
    guardianName: 'Grace Phiri',
    guardianPhone: '',
    guardianSecondaryPhone: '+265888234567',
    formLevel: 3,
    stream: 'B',
  });
  const s3 = makeStudent({
    id: 'stu-3',
    admissionNo: 'SCH/2026/003',
    fullName: 'Settled Student',
    guardianPhone: '0999000111',
  });
  const s4 = makeStudent({
    id: 'stu-4',
    admissionNo: 'SCH/2026/004',
    fullName: 'Missing Phone Student',
    guardianPhone: '123',
  });

  const invoices: FeeInvoice[] = [
    makeInvoice({ id: 'inv-1', studentId: 'stu-1', studentName: 'Chimwemwe Banda', totalBilled: 60000, totalPaid: 20000, term: 'Term 2' }),
    makeInvoice({ id: 'inv-2', studentId: 'stu-2', studentName: 'Kondwani Phiri', formLevel: 3, stream: 'B', totalBilled: 80000, totalPaid: 0, status: 'Unpaid', term: 'Term 2' }),
    makeInvoice({ id: 'inv-3', studentId: 'stu-3', studentName: 'Settled Student', totalBilled: 50000, totalPaid: 50000, status: 'Paid', term: 'Term 2' }),
    makeInvoice({ id: 'inv-4', studentId: 'stu-4', studentName: 'Missing Phone Student', totalBilled: 50000, totalPaid: 10000, term: 'Term 2' }),
    makeInvoice({ id: 'inv-5', studentId: 'stu-1', studentName: 'Chimwemwe Banda', totalBilled: 60000, totalPaid: 0, term: 'Term 1' }),
  ];

  const nowMs = Date.UTC(2026, 10, 26, 12, 0, 0);
  const recentLog: SmsLog = {
    id: 'sms-1',
    ownerId: 'owner-1',
    invoiceId: 'inv-1',
    studentId: 'stu-1',
    studentName: 'Chimwemwe Banda',
    guardianName: 'Mary Banda',
    guardianPhone: '+265999112233',
    type: 'Low Balance Alert',
    message: 'Reminder',
    amountMWK: 0,
    balanceAfterMWK: 40000,
    status: 'Sent',
    provider: "Africa's Talking",
    providerRef: 'ref-1',
    errorReason: '',
    term: 'Term 2',
    createdAt: { toMillis: () => nowMs - 2 * 60 * 60 * 1000 } as SmsLog['createdAt'],
  };

  const studentById = new Map<string, Student>([
    [s1.id, s1],
    [s2.id, s2],
    [s3.id, s3],
    [s4.id, s4],
  ]);

  const recipients = buildOutstandingSmsRecipients({
    invoices,
    studentById,
    smsLogs: [recentLog],
    termFilter: 'Term 2',
    nowMs,
  });

  // Excludes Paid (inv-3) and Term 1 (inv-5), sorted by balance desc
  assert.equal(recipients.length, 3);
  assert.equal(recipients[0].invoice.id, 'inv-2');
  assert.equal(recipients[0].balance, 80000);
  assert.equal(recipients[0].formattedPhone, '+265888234567');
  assert.equal(recipients[0].recentlySent, false);

  // inv-1 and inv-4 both have 40,000 balance, sorted alphabetically by studentName
  assert.equal(recipients[1].invoice.id, 'inv-1');
  assert.equal(recipients[1].formattedPhone, '+265999112233');
  assert.equal(recipients[1].recentlySent, true);

  assert.equal(recipients[2].invoice.id, 'inv-4');
  assert.equal(recipients[2].formattedPhone, '');

  // Filtering checks
  assert.equal(
    filterOutstandingSmsRecipients(recipients, { formFilter: 3 }).length,
    1
  );
  assert.equal(
    filterOutstandingSmsRecipients(recipients, { onlyReachable: true }).length,
    2
  );
  assert.equal(
    filterOutstandingSmsRecipients(recipients, { search: 'grace' })[0]?.invoice.id,
    'inv-2'
  );
});
