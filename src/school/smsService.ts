import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import {
  OutstandingSmsRecipient,
  renderPaymentReminderMessage,
  wasLowBalanceAlertSentRecently,
} from './bulkSmsUtils';
import { formatMalawiSmsPhone, formatMWK, formatSmsSenderLabel } from './malawi';
import {
  PaymentMethod,
  SmsConfig,
  SmsDeliveryStatus,
  SmsNotificationType,
  TermName,
} from './types';

export {
  buildOutstandingSmsRecipients,
  DEFAULT_PAYMENT_REMINDER_TEMPLATE,
  filterOutstandingSmsRecipients,
  renderPaymentReminderMessage,
  SMS_REMINDER_PRESETS,
  SMS_TEMPLATE_TOKENS,
  wasLowBalanceAlertSentRecently,
  type OutstandingSmsRecipient,
  type RenderedSmsPreview,
  type RenderPaymentReminderParams,
  type SmsReminderPreset,
} from './bulkSmsUtils';

export interface SmsGatewayStatusResponse {
  configured: boolean;
  provider: 'africastalking' | 'twilio' | 'sandbox';
  providerLabel: string;
}

export async function fetchSmsGatewayStatus(): Promise<SmsGatewayStatusResponse> {
  try {
    const res = await fetch('/api/sms/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as SmsGatewayStatusResponse;
  } catch {
    return {
      configured: false,
      provider: 'sandbox',
      providerLabel: 'Preview Outbox (Offline / Local)',
    };
  }
}

export function buildDefaultSmsConfig(
  schoolName: string,
  ownerId: string
): Omit<SmsConfig, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    ownerId,
    autoPaymentSms: true,
    autoLowBalanceSms: true,
    lowBalanceThresholdMWK: 1000,
    senderLabel: formatSmsSenderLabel(schoolName),
  };
}

export async function saveSmsConfig(
  schoolId: string,
  ownerId: string,
  input: {
    autoPaymentSms: boolean;
    autoLowBalanceSms: boolean;
    lowBalanceThresholdMWK: number;
    senderLabel: string;
  },
  existsInDb: boolean
): Promise<void> {
  const path = `schools/${schoolId}/smsSettings/default`;
  const cleanThreshold = Math.min(
    100000000,
    Math.max(0, Math.round(Number(input.lowBalanceThresholdMWK) || 0))
  );
  const cleanLabel = (input.senderLabel || 'SecSchoolHub').trim().slice(0, 40) || 'SecSchoolHub';

  try {
    if (existsInDb) {
      await updateDoc(doc(db, 'schools', schoolId, 'smsSettings', 'default'), {
        autoPaymentSms: Boolean(input.autoPaymentSms),
        autoLowBalanceSms: Boolean(input.autoLowBalanceSms),
        lowBalanceThresholdMWK: cleanThreshold,
        senderLabel: cleanLabel,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'schools', schoolId, 'smsSettings', 'default'), {
        ownerId,
        autoPaymentSms: Boolean(input.autoPaymentSms),
        autoLowBalanceSms: Boolean(input.autoLowBalanceSms),
        lowBalanceThresholdMWK: cleanThreshold,
        senderLabel: cleanLabel,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, existsInDb ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export function buildPaymentConfirmationSms(params: {
  senderLabel: string;
  studentName: string;
  term: TermName;
  amountMWK: number;
  method: PaymentMethod;
  receiptNo: string;
  balanceAfterMWK: number;
}): string {
  const balanceText =
    params.balanceAfterMWK <= 0
      ? 'Balance: MK 0 (Settled).'
      : `Remaining balance: ${formatMWK(params.balanceAfterMWK)}.`;
  const msg = `[${params.senderLabel}] Fee Payment Confirmed: ${formatMWK(params.amountMWK)} received for ${params.studentName} (${params.term}, ${params.method}). Receipt ${params.receiptNo}. ${balanceText} Thank you.`;
  return msg.slice(0, 320);
}

export function buildLowBalanceAlertSms(params: {
  senderLabel: string;
  guardianName: string;
  studentName: string;
  term: TermName;
  balanceAfterMWK: number;
  totalBilledMWK: number;
}): string {
  const guardian = params.guardianName.trim() || 'Parent/Guardian';
  const msg = `[${params.senderLabel}] Fee Balance Alert: Dear ${guardian}, ${params.studentName} has an unpaid ${params.term} balance of ${formatMWK(params.balanceAfterMWK)} (of ${formatMWK(params.totalBilledMWK)} billed). Please clear via Bursar, Bank, Airtel Money or Mpamba.`;
  return msg.slice(0, 320);
}

export interface DispatchSmsParams {
  schoolId: string;
  ownerId: string;
  senderLabel: string;
  invoiceId: string;
  studentId: string;
  studentName: string;
  guardianName: string;
  guardianPhoneRaw: string;
  type: SmsNotificationType;
  term: TermName;
  amountMWK: number;
  balanceAfterMWK: number;
  totalBilledMWK: number;
  method?: PaymentMethod;
  receiptNo?: string;
  customMessage?: string;
}

export interface DispatchSmsOutcome {
  smsId: string;
  status: SmsDeliveryStatus;
  guardianPhone: string;
  provider: string;
  message: string;
  errorReason: string;
}

export async function dispatchAndLogParentSms(
  params: DispatchSmsParams
): Promise<DispatchSmsOutcome> {
  const smsId = `sms_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const path = `schools/${params.schoolId}/smsLogs/${smsId}`;
  const cleanSender = (params.senderLabel || 'SecSchoolHub').trim().slice(0, 40) || 'SecSchoolHub';
  const cleanStudentName = params.studentName.trim().slice(0, 120) || 'Student';
  const cleanGuardianName = params.guardianName.trim().slice(0, 120) || 'Parent/Guardian';
  const customCleaned = (params.customMessage || '').replace(/\s+/g, ' ').trim().slice(0, 320);

  const message =
    customCleaned.length > 0
      ? customCleaned
      : params.type === 'Payment Confirmation'
      ? buildPaymentConfirmationSms({
          senderLabel: cleanSender,
          studentName: cleanStudentName,
          term: params.term,
          amountMWK: params.amountMWK,
          method: params.method || 'Cash (Bursar)',
          receiptNo: params.receiptNo || 'RCT',
          balanceAfterMWK: params.balanceAfterMWK,
        })
      : buildLowBalanceAlertSms({
          senderLabel: cleanSender,
          guardianName: cleanGuardianName,
          studentName: cleanStudentName,
          term: params.term,
          balanceAfterMWK: params.balanceAfterMWK,
          totalBilledMWK: params.totalBilledMWK,
        });

  const normalizedPhone = formatMalawiSmsPhone(params.guardianPhoneRaw);

  let status: SmsDeliveryStatus = 'Skipped';
  let provider = 'None';
  let providerRef = '';
  let errorReason = '';

  if (!normalizedPhone) {
    status = 'Skipped';
    errorReason = 'Guardian phone missing or invalid (+265 format required).';
  } else {
    try {
      const idToken = await auth.currentUser?.getIdToken().catch(() => undefined);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (idToken) {
        headers.Authorization = `Bearer ${idToken}`;
      }

      const response = await fetch('/api/sms/send', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          to: normalizedPhone,
          message,
          type: params.type,
          studentId: params.studentId,
          invoiceId: params.invoiceId,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        status?: SmsDeliveryStatus;
        provider?: string;
        providerRef?: string;
        errorReason?: string;
        error?: string;
      };
      status = result.status || (response.ok ? 'Simulated' : 'Failed');
      provider = String(result.provider || (response.status === 401 ? 'Auth Required' : 'Gateway')).slice(
        0,
        40
      );
      providerRef = String(result.providerRef || '').slice(0, 100);
      errorReason = String(
        result.errorReason || result.error || (response.ok ? '' : `HTTP ${response.status}`)
      ).slice(0, 160);
    } catch (err) {
      status = 'Failed';
      provider = 'Network Error';
      errorReason =
        err instanceof Error ? err.message.slice(0, 150) : 'Unable to reach SMS gateway.';
    }
  }

  const phoneForLog = (normalizedPhone || params.guardianPhoneRaw || '').trim().slice(0, 30);

  try {
    await setDoc(doc(db, 'schools', params.schoolId, 'smsLogs', smsId), {
      ownerId: params.ownerId,
      invoiceId: params.invoiceId,
      studentId: params.studentId,
      studentName: cleanStudentName,
      guardianName: cleanGuardianName,
      guardianPhone: phoneForLog,
      type: params.type,
      message,
      amountMWK: Math.max(0, Math.round(params.amountMWK)),
      balanceAfterMWK: Math.max(0, Math.round(params.balanceAfterMWK)),
      status,
      provider,
      providerRef,
      errorReason,
      term: params.term,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  return {
    smsId,
    status,
    guardianPhone: phoneForLog,
    provider,
    message,
    errorReason,
  };
}

export interface BulkSmsDispatchSummary {
  total: number;
  sentCount: number;
  simulatedCount: number;
  skippedCount: number;
  failedCount: number;
  outcomes: Array<{
    studentName: string;
    guardianPhone: string;
    status: SmsDeliveryStatus;
    errorReason: string;
  }>;
}

export async function dispatchBulkPaymentReminders(params: {
  schoolId: string;
  ownerId: string;
  senderLabel: string;
  targets: OutstandingSmsRecipient[];
  template: string;
  onProgress?: (completed: number, total: number, currentStudentName: string) => void;
}): Promise<BulkSmsDispatchSummary> {
  const { schoolId, ownerId, senderLabel, targets, template, onProgress } = params;
  const summary: BulkSmsDispatchSummary = {
    total: targets.length,
    sentCount: 0,
    simulatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    outcomes: [],
  };

  for (let idx = 0; idx < targets.length; idx += 1) {
    const item = targets[idx];
    onProgress?.(idx + 1, targets.length, item.studentName);

    const rendered = renderPaymentReminderMessage(template, {
      senderLabel,
      guardianName: item.guardianName,
      studentName: item.studentName,
      formClass: item.formClass,
      term: item.invoice.term,
      balanceMWK: item.balance,
      totalBilledMWK: item.invoice.totalBilled,
      totalPaidMWK: item.invoice.totalPaid,
    });

    const outcome = await dispatchAndLogParentSms({
      schoolId,
      ownerId,
      senderLabel,
      invoiceId: item.invoice.id,
      studentId: item.invoice.studentId,
      studentName: item.studentName,
      guardianName: item.guardianName,
      guardianPhoneRaw: item.rawPhone,
      type: 'Low Balance Alert',
      term: item.invoice.term,
      amountMWK: 0,
      balanceAfterMWK: item.balance,
      totalBilledMWK: item.invoice.totalBilled,
      customMessage: rendered.message,
    });

    if (outcome.status === 'Sent') summary.sentCount += 1;
    else if (outcome.status === 'Simulated') summary.simulatedCount += 1;
    else if (outcome.status === 'Skipped') summary.skippedCount += 1;
    else summary.failedCount += 1;

    summary.outcomes.push({
      studentName: item.studentName,
      guardianPhone: outcome.guardianPhone,
      status: outcome.status,
      errorReason: outcome.errorReason,
    });
  }

  // Keep reference to helper explicit if tree-shaken checks look at imports
  void wasLowBalanceAlertSentRecently;

  return summary;
}
