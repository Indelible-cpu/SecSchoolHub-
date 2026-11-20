import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { formatMalawiSmsPhone, formatMWK, formatSmsSenderLabel } from './malawi';
import { PaymentMethod, SmsConfig, SmsDeliveryStatus, SmsLog, SmsNotificationType, TermName } from './types';

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

export function buildDefaultSmsConfig(schoolName: string, ownerId: string): Omit<SmsConfig, 'id' | 'createdAt' | 'updatedAt'> {
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
  const cleanThreshold = Math.min(100000000, Math.max(0, Math.round(Number(input.lowBalanceThresholdMWK) || 0)));
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
}

export interface DispatchSmsOutcome {
  smsId: string;
  status: SmsDeliveryStatus;
  guardianPhone: string;
  provider: string;
  message: string;
  errorReason: string;
}

export async function dispatchAndLogParentSms(params: DispatchSmsParams): Promise<DispatchSmsOutcome> {
  const smsId = `sms_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const path = `schools/${params.schoolId}/smsLogs/${smsId}`;
  const cleanSender = (params.senderLabel || 'SecSchoolHub').trim().slice(0, 40) || 'SecSchoolHub';
  const cleanStudentName = params.studentName.trim().slice(0, 120) || 'Student';
  const cleanGuardianName = params.guardianName.trim().slice(0, 120) || 'Parent/Guardian';

  const message =
    params.type === 'Payment Confirmation'
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
      const response = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      };
      status = result.status || (response.ok ? 'Simulated' : 'Failed');
      provider = String(result.provider || 'Gateway').slice(0, 40);
      providerRef = String(result.providerRef || '').slice(0, 100);
      errorReason = String(result.errorReason || '').slice(0, 160);
    } catch (err) {
      status = 'Failed';
      provider = 'Network Error';
      errorReason = err instanceof Error ? err.message.slice(0, 150) : 'Unable to reach SMS gateway.';
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

export function wasLowBalanceAlertSentRecently(
  smsLogs: SmsLog[],
  invoiceId: string,
  balanceMWK: number
): boolean {
  const nowMs = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  return smsLogs.some((log) => {
    if (log.invoiceId !== invoiceId) return false;
    if (log.type !== 'Low Balance Alert') return false;
    if (log.status !== 'Sent' && log.status !== 'Simulated') return false;
    if (Math.round(log.balanceAfterMWK) !== Math.round(balanceMWK)) return false;
    const createdMs = log.createdAt?.toMillis?.();
    if (!createdMs) return true; // Optimistic guard for just-written pending timestamps
    return nowMs - createdMs < oneDayMs;
  });
}
