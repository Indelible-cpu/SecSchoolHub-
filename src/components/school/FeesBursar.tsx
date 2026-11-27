import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote,
  BellRing,
  CheckCircle2,
  Download,
  Eye,
  FileDown,
  FileText,
  Image as ImageIcon,
  Layers,
  MessageSquare,
  Plus,
  Send,
  SlidersHorizontal,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import {
  FeeInvoice,
  FeePayment,
  FeeSubmissionStatus,
  FormLevel,
  InvoiceStatus,
  PaymentMethod,
  School,
  SmsConfig,
  SmsLog,
  SmsNotificationType,
  Student,
  StudentFeeSubmission,
  TermName,
} from '../../school/types';
import {
  compareStudentsRegisterOrder,
  downloadCSV,
  FORM_LEVELS,
  formatMalawiSmsPhone,
  formatMWK,
  formatSmsSenderLabel,
  isGovernmentSchool,
  sortStudentsForRegister,
  TERMS,
} from '../../school/malawi';
import { formatFileSizeLabel } from '../../school/digitalMaterialParser';
import { downloadFeesPdfReport } from '../../school/pdfReports';
import {
  approveStudentFeeSubmission,
  billEntireFormBatch,
  createFeeInvoice,
  recordAtomicFeePayment,
  rejectStudentFeeSubmission,
  removeFeeInvoice,
} from '../../school/firestoreService';
import {
  buildDefaultSmsConfig,
  buildOutstandingSmsRecipients,
  BulkSmsDispatchSummary,
  dispatchAndLogParentSms,
  fetchSmsGatewayStatus,
  saveSmsConfig,
  SmsGatewayStatusResponse,
} from '../../school/smsService';
import {
  buildModalDraftKey,
  clearModalDraft,
  loadModalDraft,
  saveModalDraft,
} from '../../school/modalDrafts';
import { BulkSmsModal } from './BulkSmsModal';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';
import { DraftRestoredNotice, ModalBackdrop } from './ModalBackdrop';
import { PaymentProofPreviewModal } from './PaymentProofPreviewModal';

interface FeesBursarProps {
  school: School;
  ownerId: string;
  students: Student[];
  invoices: FeeInvoice[];
  payments: FeePayment[];
  feeSubmissions?: StudentFeeSubmission[];
  smsLogs: SmsLog[];
  smsConfig: SmsConfig | null;
  canWriteFees?: boolean;
}

const PAYMENT_METHODS: PaymentMethod[] = [
  'Cash (Bursar)',
  'Bank Deposit',
  'Airtel Money',
  'TNM Mpamba',
];

function formatSmsTimestamp(ts?: { toDate?: () => Date }): string {
  const date = ts?.toDate?.();
  if (!date) return 'Just now';
  return date.toLocaleString('en-MW', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const FeesBursar: React.FC<FeesBursarProps> = ({
  school,
  ownerId,
  students,
  invoices,
  payments,
  feeSubmissions = [],
  smsLogs,
  smsConfig,
  canWriteFees = true,
}) => {
  const [viewMode, setViewMode] = useState<'invoices' | 'receipts' | 'proofs' | 'sms'>('invoices');
  const [termFilter, setTermFilter] = useState<TermName>(school.currentTerm);
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceStatus>('all');
  const [proofStatusFilter, setProofStatusFilter] = useState<'all' | FeeSubmissionStatus>('all');
  const [smsTypeFilter, setSmsTypeFilter] = useState<'all' | SmsNotificationType>('all');

  // Gateway & toast feedback
  const [gatewayStatus, setGatewayStatus] = useState<SmsGatewayStatusResponse>({
    configured: false,
    provider: 'sandbox',
    providerLabel: 'Preview Outbox',
  });
  const [smsBanner, setSmsBanner] = useState<{ tone: 'success' | 'warn'; text: string } | null>(null);
  const [sendingInvoiceSmsId, setSendingInvoiceSmsId] = useState<string | null>(null);

  // Bill modal
  const [billModalOpen, setBillModalOpen] = useState(false);
  const [billScope, setBillScope] = useState<'single' | 'form'>('single');
  const [billStudentId, setBillStudentId] = useState('');
  const [billFormLevel, setBillFormLevel] = useState<FormLevel>(1);
  const [tuitionStr, setTuitionStr] = useState(String(school.defaultTuitionMWK));
  const [gpfStr, setGpfStr] = useState(String(school.defaultGpfMWK));
  const [examStr, setExamStr] = useState(String(school.defaultExamFeeMWK));
  const [otherStr, setOtherStr] = useState('0');
  const [billingBusy, setBillingBusy] = useState(false);
  const [billError, setBillError] = useState('');

  // Payment modal
  const [payInvoice, setPayInvoice] = useState<FeeInvoice | null>(null);
  const [payAmountStr, setPayAmountStr] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('Airtel Money');
  const [payRef, setPayRef] = useState('');
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState('');

  // SMS Policy Settings modal
  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [policyAutoPay, setPolicyAutoPay] = useState(true);
  const [policyAutoLow, setPolicyAutoLow] = useState(true);
  const [policyThresholdStr, setPolicyThresholdStr] = useState('1000');
  const [policySenderLabel, setPolicySenderLabel] = useState(formatSmsSenderLabel(school.name));
  const [policySaving, setPolicySaving] = useState(false);
  const [policyError, setPolicyError] = useState('');

  // Bulk SMS Payment Reminder modal & multi-student selection
  const [bulkSmsOpen, setBulkSmsOpen] = useState(false);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(() => new Set());
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null);

  // Safe Delete modal
  const [confirmInvoice, setConfirmInvoice] = useState<FeeInvoice | null>(null);
  const [deletingInvoice, setDeletingInvoice] = useState(false);
  const [deleteInvoiceError, setDeleteInvoiceError] = useState('');

  // Payment proof review & preview
  const [previewSubmission, setPreviewSubmission] = useState<StudentFeeSubmission | null>(null);
  const [approveTarget, setApproveTarget] = useState<StudentFeeSubmission | null>(null);
  const [approveInvoiceId, setApproveInvoiceId] = useState('');
  const [approveAmountStr, setApproveAmountStr] = useState('');
  const [approveMethod, setApproveMethod] = useState<PaymentMethod>('Bank Deposit');
  const [approveRef, setApproveRef] = useState('');
  const [approveNote, setApproveNote] = useState('');
  const [approveBusy, setApproveBusy] = useState(false);
  const [approveError, setApproveError] = useState('');

  const [rejectTarget, setRejectTarget] = useState<StudentFeeSubmission | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectBusy, setRejectBusy] = useState(false);
  const [rejectError, setRejectError] = useState('');

  const [billDraftRestored, setBillDraftRestored] = useState(false);
  const [payDraftRestored, setPayDraftRestored] = useState(false);
  const [policyDraftRestored, setPolicyDraftRestored] = useState(false);
  const [approveDraftRestored, setApproveDraftRestored] = useState(false);
  const [rejectDraftRestored, setRejectDraftRestored] = useState(false);

  const billDraftKey = useMemo(
    () => buildModalDraftKey(school.id, 'fee_bill', billScope),
    [school.id, billScope]
  );
  const payDraftKey = useMemo(
    () => buildModalDraftKey(school.id, 'fee_payment', payInvoice?.id || 'none'),
    [school.id, payInvoice?.id]
  );
  const policyDraftKey = useMemo(
    () => buildModalDraftKey(school.id, 'fee_sms_policy', 'default'),
    [school.id]
  );
  const approveDraftKey = useMemo(
    () => buildModalDraftKey(school.id, 'fee_approve', approveTarget?.id || 'none'),
    [school.id, approveTarget?.id]
  );
  const rejectDraftKey = useMemo(
    () => buildModalDraftKey(school.id, 'fee_reject', rejectTarget?.id || 'none'),
    [school.id, rejectTarget?.id]
  );

  useEffect(() => {
    if (!billModalOpen) return;
    saveModalDraft(billDraftKey, {
      billStudentId,
      billFormLevel,
      tuitionStr,
      gpfStr,
      examStr,
      otherStr,
    });
  }, [billModalOpen, billDraftKey, billStudentId, billFormLevel, tuitionStr, gpfStr, examStr, otherStr]);

  useEffect(() => {
    if (!payInvoice) return;
    saveModalDraft(payDraftKey, { payAmountStr, payMethod, payRef });
  }, [payInvoice, payDraftKey, payAmountStr, payMethod, payRef]);

  useEffect(() => {
    if (!policyModalOpen) return;
    saveModalDraft(policyDraftKey, {
      policyAutoPay,
      policyAutoLow,
      policyThresholdStr,
      policySenderLabel,
    });
  }, [policyModalOpen, policyDraftKey, policyAutoPay, policyAutoLow, policyThresholdStr, policySenderLabel]);

  useEffect(() => {
    if (!approveTarget) return;
    saveModalDraft(approveDraftKey, {
      approveInvoiceId,
      approveAmountStr,
      approveMethod,
      approveRef,
      approveNote,
    });
  }, [approveTarget, approveDraftKey, approveInvoiceId, approveAmountStr, approveMethod, approveRef, approveNote]);

  useEffect(() => {
    if (!rejectTarget) return;
    saveModalDraft(rejectDraftKey, { rejectNote });
  }, [rejectTarget, rejectDraftKey, rejectNote]);

  useEffect(() => {
    let active = true;
    fetchSmsGatewayStatus().then((status) => {
      if (active) setGatewayStatus(status);
    });
    return () => {
      active = false;
    };
  }, []);

  const effectiveSmsConfig = useMemo(() => {
    const defaults = buildDefaultSmsConfig(school.name, ownerId);
    if (!smsConfig) return defaults;
    return {
      ownerId: smsConfig.ownerId,
      autoPaymentSms: smsConfig.autoPaymentSms,
      autoLowBalanceSms: smsConfig.autoLowBalanceSms,
      lowBalanceThresholdMWK: smsConfig.lowBalanceThresholdMWK,
      senderLabel: smsConfig.senderLabel,
    };
  }, [ownerId, school.name, smsConfig]);

  const govTuitionOnly = isGovernmentSchool(school.schoolType);

  const studentById = useMemo(() => {
    const map = new Map<string, Student>();
    for (const s of students) {
      map.set(s.id, s);
    }
    return map;
  }, [students]);

  const activeStudents = useMemo(
    () => sortStudentsForRegister(students.filter((s) => s.status === 'Active'), { groupByForm: true }),
    [students]
  );

  const filteredInvoices = useMemo(() => {
    return invoices
      .filter((inv) => {
        if (inv.term !== termFilter) return false;
        if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
        return true;
      })
      .sort((a, b) => {
        const stuA = studentById.get(a.studentId);
        const stuB = studentById.get(b.studentId);
        return compareStudentsRegisterOrder(
          stuA || { fullName: a.studentName, formLevel: a.formLevel, stream: a.stream },
          stuB || { fullName: b.studentName, formLevel: b.formLevel, stream: b.stream },
          { groupByForm: true }
        );
      });
  }, [invoices, statusFilter, studentById, termFilter]);

  const filteredPayments = useMemo(() => {
    return payments.filter((p) => p.term === termFilter);
  }, [payments, termFilter]);

  const filteredSubmissions = useMemo(() => {
    return feeSubmissions.filter((sub) => {
      if (sub.term !== termFilter) return false;
      if (proofStatusFilter !== 'all' && sub.status !== proofStatusFilter) return false;
      return true;
    });
  }, [feeSubmissions, proofStatusFilter, termFilter]);

  const pendingProofCounts = useMemo(() => {
    const allPending = feeSubmissions.filter((s) => s.status === 'Pending');
    const inTerm = allPending.filter((s) => s.term === termFilter).length;
    const firstOtherTerm = allPending.find((s) => s.term !== termFilter)?.term || null;
    return {
      total: allPending.length,
      inTerm,
      otherTermCount: allPending.length - inTerm,
      firstOtherTerm,
    };
  }, [feeSubmissions, termFilter]);

  const filteredSmsLogs = useMemo(() => {
    return smsLogs.filter((log) => {
      if (log.term !== termFilter) return false;
      if (smsTypeFilter !== 'all' && log.type !== smsTypeFilter) return false;
      return true;
    });
  }, [smsLogs, smsTypeFilter, termFilter]);

  const totals = useMemo(() => {
    const termInvs = invoices.filter((i) => i.term === termFilter);
    const billed = termInvs.reduce((s, i) => s + i.totalBilled, 0);
    const paid = termInvs.reduce((s, i) => s + i.totalPaid, 0);
    const paidCount = termInvs.filter((i) => i.status === 'Paid').length;
    const partialCount = termInvs.filter((i) => i.status === 'Partial').length;
    const unpaidCount = termInvs.filter((i) => i.status === 'Unpaid').length;
    const rate = billed > 0 ? Math.min(100, Math.round((paid / billed) * 100)) : 0;
    return {
      billed,
      paid,
      balance: Math.max(0, billed - paid),
      paidCount,
      partialCount,
      unpaidCount,
      totalCount: termInvs.length,
      rate,
    };
  }, [invoices, termFilter]);

  // All students with outstanding balances in the current term
  const outstandingRecipients = useMemo(
    () =>
      buildOutstandingSmsRecipients({
        invoices,
        studentById,
        smsLogs,
        termFilter,
      }),
    [invoices, smsLogs, studentById, termFilter]
  );

  const outstandingRecipientById = useMemo(() => {
    const map = new Map<string, (typeof outstandingRecipients)[number]>();
    for (const item of outstandingRecipients) {
      map.set(item.invoice.id, item);
    }
    return map;
  }, [outstandingRecipients]);

  const validSelectedInvoiceIds = useMemo(() => {
    const next = new Set<string>();
    for (const id of selectedInvoiceIds) {
      if (outstandingRecipientById.has(id)) {
        next.add(id);
      }
    }
    return next;
  }, [outstandingRecipientById, selectedInvoiceIds]);

  const visibleOutstandingInvoices = useMemo(
    () => filteredInvoices.filter((inv) => Math.max(0, inv.totalBilled - inv.totalPaid) > 0),
    [filteredInvoices]
  );

  const visibleSelectedCount = useMemo(
    () => visibleOutstandingInvoices.filter((inv) => validSelectedInvoiceIds.has(inv.id)).length,
    [validSelectedInvoiceIds, visibleOutstandingInvoices]
  );

  const allVisibleOutstandingSelected =
    visibleOutstandingInvoices.length > 0 &&
    visibleSelectedCount === visibleOutstandingInvoices.length;
  const someVisibleOutstandingSelected =
    visibleSelectedCount > 0 && visibleSelectedCount < visibleOutstandingInvoices.length;

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = someVisibleOutstandingSelected;
    }
  }, [someVisibleOutstandingSelected]);

  const selectedSmsSummary = useMemo(() => {
    let totalBalanceMWK = 0;
    let reachableCount = 0;
    let missingPhoneCount = 0;
    for (const id of validSelectedInvoiceIds) {
      const rec = outstandingRecipientById.get(id);
      if (!rec) continue;
      totalBalanceMWK += rec.balance;
      if (rec.formattedPhone) reachableCount += 1;
      else missingPhoneCount += 1;
    }
    return {
      count: validSelectedInvoiceIds.size,
      totalBalanceMWK,
      reachableCount,
      missingPhoneCount,
    };
  }, [outstandingRecipientById, validSelectedInvoiceIds]);

  const openBillModal = (scope: 'single' | 'form') => {
    if (!canWriteFees) return;
    const key = buildModalDraftKey(school.id, 'fee_bill', scope);
    const draft = loadModalDraft<{
      billStudentId: string;
      billFormLevel: FormLevel;
      tuitionStr: string;
      gpfStr: string;
      examStr: string;
      otherStr: string;
    }>(key);
    setBillScope(scope);
    if (draft) {
      setBillStudentId(draft.billStudentId || activeStudents[0]?.id || '');
      setBillFormLevel(draft.billFormLevel || 1);
      setTuitionStr(draft.tuitionStr ?? String(school.defaultTuitionMWK));
      setGpfStr(draft.gpfStr ?? (govTuitionOnly ? '0' : String(school.defaultGpfMWK)));
      setExamStr(draft.examStr ?? (govTuitionOnly ? '0' : String(school.defaultExamFeeMWK)));
      setOtherStr(draft.otherStr ?? '0');
      setBillDraftRestored(true);
    } else {
      setBillStudentId(activeStudents[0]?.id || '');
      setTuitionStr(String(school.defaultTuitionMWK));
      setGpfStr(govTuitionOnly ? '0' : String(school.defaultGpfMWK));
      setExamStr(govTuitionOnly ? '0' : String(school.defaultExamFeeMWK));
      setOtherStr('0');
      setBillDraftRestored(false);
    }
    setBillError('');
    setBillModalOpen(true);
  };

  const handleDiscardBillDraft = () => {
    clearModalDraft(billDraftKey);
    setBillStudentId(activeStudents[0]?.id || '');
    setBillFormLevel(1);
    setTuitionStr(String(school.defaultTuitionMWK));
    setGpfStr(govTuitionOnly ? '0' : String(school.defaultGpfMWK));
    setExamStr(govTuitionOnly ? '0' : String(school.defaultExamFeeMWK));
    setOtherStr('0');
    setBillDraftRestored(false);
  };

  const handleCreateBills = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteFees) return;
    setBillError('');
    setBillingBusy(true);
    try {
      const tuition = Math.max(0, Number(tuitionStr) || 0);
      const gpf = govTuitionOnly ? 0 : Math.max(0, Number(gpfStr) || 0);
      const exam = govTuitionOnly ? 0 : Math.max(0, Number(examStr) || 0);
      const other = govTuitionOnly ? 0 : Math.max(0, Number(otherStr) || 0);

      if (billScope === 'single') {
        const stu = activeStudents.find((s) => s.id === billStudentId);
        if (!stu) {
          setBillError('Select a student to invoice.');
          setBillingBusy(false);
          return;
        }
        await createFeeInvoice(school.id, ownerId, {
          studentId: stu.id,
          studentName: stu.fullName,
          formLevel: stu.formLevel,
          stream: stu.stream,
          term: termFilter,
          academicYear: school.academicYear,
          tuitionFee: tuition,
          gpfFee: gpf,
          examFee: exam,
          otherFee: other,
          schoolType: school.schoolType,
          registrationCode: stu.registrationCode,
        });
      } else {
        const existingStudentIds = new Set(
          invoices.filter((i) => i.term === termFilter).map((i) => i.studentId)
        );
        const targetStudents = activeStudents.filter(
          (s) => s.formLevel === billFormLevel && !existingStudentIds.has(s.id)
        );
        if (targetStudents.length === 0) {
          setBillError(`All active Form ${billFormLevel} students already have a ${termFilter} invoice.`);
          setBillingBusy(false);
          return;
        }
        await billEntireFormBatch(school.id, ownerId, {
          students: targetStudents,
          term: termFilter,
          academicYear: school.academicYear,
          tuitionFee: tuition,
          gpfFee: gpf,
          examFee: exam,
          schoolType: school.schoolType,
        });
      }
      clearModalDraft(billDraftKey);
      setBillDraftRestored(false);
      setBillModalOpen(false);
    } catch (err) {
      setBillError(err instanceof Error ? err.message : 'Unable to generate invoice.');
    } finally {
      setBillingBusy(false);
    }
  };

  const openPaymentModal = (inv: FeeInvoice) => {
    if (!canWriteFees) return;
    const balance = Math.max(0, inv.totalBilled - inv.totalPaid);
    const key = buildModalDraftKey(school.id, 'fee_payment', inv.id);
    const draft = loadModalDraft<{
      payAmountStr: string;
      payMethod: PaymentMethod;
      payRef: string;
    }>(key);
    setPayInvoice(inv);
    if (draft) {
      setPayAmountStr(draft.payAmountStr ?? String(balance > 0 ? balance : 0));
      setPayMethod(draft.payMethod || 'Airtel Money');
      setPayRef(draft.payRef ?? '');
      setPayDraftRestored(true);
    } else {
      setPayAmountStr(String(balance > 0 ? balance : 0));
      setPayMethod('Airtel Money');
      setPayRef('');
      setPayDraftRestored(false);
    }
    setPayError('');
  };

  const handleDiscardPayDraft = () => {
    clearModalDraft(payDraftKey);
    if (payInvoice) {
      const balance = Math.max(0, payInvoice.totalBilled - payInvoice.totalPaid);
      setPayAmountStr(String(balance > 0 ? balance : 0));
    }
    setPayMethod('Airtel Money');
    setPayRef('');
    setPayDraftRestored(false);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteFees || !payInvoice) return;
    const amount = Number(payAmountStr);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPayError('Payment amount must be greater than MK 0.');
      return;
    }
    setPayBusy(true);
    setPayError('');
    try {
      const receiptNo = `RCT-${new Date().getFullYear()}-${String(payments.length + 101).padStart(4, '0')}`;
      const targetStu = studentById.get(payInvoice.studentId);
      await recordAtomicFeePayment(school.id, ownerId, {
        invoiceId: payInvoice.id,
        studentId: payInvoice.studentId,
        studentName: payInvoice.studentName,
        currentTotalPaid: payInvoice.totalPaid,
        totalBilled: payInvoice.totalBilled,
        amount,
        method: payMethod,
        reference: payRef.trim() || 'Bursar Counter',
        receiptNo,
        term: payInvoice.term,
        registrationCode: targetStu?.registrationCode,
      });

      const targetInvoice = payInvoice;
      const student = studentById.get(targetInvoice.studentId);
      const nextBalance = Math.max(0, targetInvoice.totalBilled - (targetInvoice.totalPaid + amount));
      clearModalDraft(payDraftKey);
      setPayDraftRestored(false);
      setPayInvoice(null);

      // Automated Parent SMS Notifications (Confirmation + Low Balance Alert if partial balance remains)
      const notes: string[] = [];
      let hadIssue = false;

      if (effectiveSmsConfig.autoPaymentSms) {
        const paySms = await dispatchAndLogParentSms({
          schoolId: school.id,
          ownerId,
          senderLabel: effectiveSmsConfig.senderLabel,
          invoiceId: targetInvoice.id,
          studentId: targetInvoice.studentId,
          studentName: targetInvoice.studentName,
          guardianName: student?.guardianName || 'Parent/Guardian',
          guardianPhoneRaw: student?.guardianPhone || student?.guardianSecondaryPhone || '',
          type: 'Payment Confirmation',
          term: targetInvoice.term,
          amountMWK: amount,
          balanceAfterMWK: nextBalance,
          totalBilledMWK: targetInvoice.totalBilled,
          method: payMethod,
          receiptNo,
        });
        if (paySms.status === 'Sent' || paySms.status === 'Simulated') {
          notes.push(`Payment Confirmation SMS (${paySms.status}) to ${paySms.guardianPhone}`);
        } else {
          hadIssue = true;
          notes.push(`Confirmation SMS ${paySms.status}: ${paySms.errorReason}`);
        }
      }

      if (
        effectiveSmsConfig.autoLowBalanceSms &&
        nextBalance > 0 &&
        nextBalance >= effectiveSmsConfig.lowBalanceThresholdMWK
      ) {
        const lowSms = await dispatchAndLogParentSms({
          schoolId: school.id,
          ownerId,
          senderLabel: effectiveSmsConfig.senderLabel,
          invoiceId: targetInvoice.id,
          studentId: targetInvoice.studentId,
          studentName: targetInvoice.studentName,
          guardianName: student?.guardianName || 'Parent/Guardian',
          guardianPhoneRaw: student?.guardianPhone || student?.guardianSecondaryPhone || '',
          type: 'Low Balance Alert',
          term: targetInvoice.term,
          amountMWK: amount,
          balanceAfterMWK: nextBalance,
          totalBilledMWK: targetInvoice.totalBilled,
        });
        if (lowSms.status === 'Sent' || lowSms.status === 'Simulated') {
          notes.push(`Low Balance Alert SMS (${formatMWK(nextBalance)} due)`);
        } else {
          hadIssue = true;
          notes.push(`Low Balance Alert ${lowSms.status}: ${lowSms.errorReason}`);
        }
      }

      if (notes.length > 0) {
        setSmsBanner({
          tone: hadIssue ? 'warn' : 'success',
          text: `Receipt ${receiptNo} saved · ${notes.join(' · ')}`,
        });
      }
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Payment recording failed.');
    } finally {
      setPayBusy(false);
    }
  };

  const openApproveModal = (sub: StudentFeeSubmission) => {
    if (!canWriteFees) return;
    const studentInvoices = invoices.filter((inv) => inv.studentId === sub.studentId);
    const matched =
      studentInvoices.find((inv) => inv.id === sub.invoiceId) ||
      studentInvoices.find((inv) => inv.term === sub.term) ||
      studentInvoices[0] ||
      null;
    const key = buildModalDraftKey(school.id, 'fee_approve', sub.id);
    const draft = loadModalDraft<{
      approveInvoiceId: string;
      approveAmountStr: string;
      approveMethod: PaymentMethod;
      approveRef: string;
      approveNote: string;
    }>(key);
    setApproveTarget(sub);
    if (draft) {
      setApproveInvoiceId(draft.approveInvoiceId || matched?.id || '');
      setApproveAmountStr(draft.approveAmountStr ?? String(sub.amount));
      setApproveMethod(draft.approveMethod || sub.method);
      setApproveRef(draft.approveRef ?? (sub.reference || 'Student Proof Upload'));
      setApproveNote(draft.approveNote ?? 'Verified against uploaded payment reference.');
      setApproveDraftRestored(true);
    } else {
      setApproveInvoiceId(matched?.id || '');
      setApproveAmountStr(String(sub.amount));
      setApproveMethod(sub.method);
      setApproveRef(sub.reference || 'Student Proof Upload');
      setApproveNote('Verified against uploaded payment reference.');
      setApproveDraftRestored(false);
    }
    setApproveError('');
  };

  const handleDiscardApproveDraft = () => {
    clearModalDraft(approveDraftKey);
    if (approveTarget) {
      const studentInvoices = invoices.filter((inv) => inv.studentId === approveTarget.studentId);
      const matched =
        studentInvoices.find((inv) => inv.id === approveTarget.invoiceId) ||
        studentInvoices.find((inv) => inv.term === approveTarget.term) ||
        studentInvoices[0] ||
        null;
      setApproveInvoiceId(matched?.id || '');
      setApproveAmountStr(String(approveTarget.amount));
      setApproveMethod(approveTarget.method);
      setApproveRef(approveTarget.reference || 'Student Proof Upload');
      setApproveNote('Verified against uploaded payment reference.');
    }
    setApproveDraftRestored(false);
  };

  const handleConfirmApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteFees || !approveTarget) return;
    const targetInvoice = invoices.find((inv) => inv.id === approveInvoiceId);
    if (!targetInvoice) {
      setApproveError('Select a student fee invoice before approving.');
      return;
    }
    const amount = Number(approveAmountStr);
    if (!Number.isFinite(amount) || amount <= 0) {
      setApproveError('Approved payment amount must be greater than MK 0.');
      return;
    }

    setApproveBusy(true);
    setApproveError('');
    try {
      const receiptNo = `RCT-${new Date().getFullYear()}-${String(payments.length + 101).padStart(4, '0')}`;
      await approveStudentFeeSubmission({
        schoolId: school.id,
        ownerId,
        submission: approveTarget,
        invoice: targetInvoice,
        amount,
        method: approveMethod,
        reference: approveRef.trim() || 'Student Proof Upload',
        receiptNo,
        reviewNote: approveNote.trim(),
      });

      const student = studentById.get(targetInvoice.studentId);
      const nextBalance = Math.max(0, targetInvoice.totalBilled - (targetInvoice.totalPaid + amount));
      const approvedName = approveTarget.studentName;
      clearModalDraft(approveDraftKey);
      setApproveDraftRestored(false);
      setApproveTarget(null);

      const notes: string[] = [];
      let hadIssue = false;

      if (effectiveSmsConfig.autoPaymentSms) {
        const paySms = await dispatchAndLogParentSms({
          schoolId: school.id,
          ownerId,
          senderLabel: effectiveSmsConfig.senderLabel,
          invoiceId: targetInvoice.id,
          studentId: targetInvoice.studentId,
          studentName: targetInvoice.studentName,
          guardianName: student?.guardianName || 'Parent/Guardian',
          guardianPhoneRaw: student?.guardianPhone || student?.guardianSecondaryPhone || '',
          type: 'Payment Confirmation',
          term: targetInvoice.term,
          amountMWK: amount,
          balanceAfterMWK: nextBalance,
          totalBilledMWK: targetInvoice.totalBilled,
          method: approveMethod,
          receiptNo,
        });
        if (paySms.status === 'Sent' || paySms.status === 'Simulated') {
          notes.push(`Payment Confirmation SMS (${paySms.status}) to ${paySms.guardianPhone}`);
        } else {
          hadIssue = true;
          notes.push(`Confirmation SMS ${paySms.status}: ${paySms.errorReason}`);
        }
      }

      if (
        effectiveSmsConfig.autoLowBalanceSms &&
        nextBalance > 0 &&
        nextBalance >= effectiveSmsConfig.lowBalanceThresholdMWK
      ) {
        const lowSms = await dispatchAndLogParentSms({
          schoolId: school.id,
          ownerId,
          senderLabel: effectiveSmsConfig.senderLabel,
          invoiceId: targetInvoice.id,
          studentId: targetInvoice.studentId,
          studentName: targetInvoice.studentName,
          guardianName: student?.guardianName || 'Parent/Guardian',
          guardianPhoneRaw: student?.guardianPhone || student?.guardianSecondaryPhone || '',
          type: 'Low Balance Alert',
          term: targetInvoice.term,
          amountMWK: amount,
          balanceAfterMWK: nextBalance,
          totalBilledMWK: targetInvoice.totalBilled,
        });
        if (lowSms.status === 'Sent' || lowSms.status === 'Simulated') {
          notes.push(`Low Balance Alert SMS (${formatMWK(nextBalance)} due)`);
        } else {
          hadIssue = true;
          notes.push(`Low Balance Alert ${lowSms.status}: ${lowSms.errorReason}`);
        }
      }

      setSmsBanner({
        tone: hadIssue ? 'warn' : 'success',
        text:
          notes.length > 0
            ? `Approved ${approvedName} (${receiptNo}) · ${notes.join(' · ')}`
            : `Approved payment reference for ${approvedName} (${receiptNo}).`,
      });
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : 'Unable to approve payment reference.');
    } finally {
      setApproveBusy(false);
    }
  };

  const openRejectModal = (sub: StudentFeeSubmission) => {
    if (!canWriteFees) return;
    const key = buildModalDraftKey(school.id, 'fee_reject', sub.id);
    const draft = loadModalDraft<{ rejectNote: string }>(key);
    setRejectTarget(sub);
    if (draft?.rejectNote) {
      setRejectNote(draft.rejectNote);
      setRejectDraftRestored(true);
    } else {
      setRejectNote('');
      setRejectDraftRestored(false);
    }
    setRejectError('');
  };

  const handleDiscardRejectDraft = () => {
    clearModalDraft(rejectDraftKey);
    setRejectNote('');
    setRejectDraftRestored(false);
  };

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteFees || !rejectTarget) return;
    setRejectBusy(true);
    setRejectError('');
    try {
      await rejectStudentFeeSubmission({
        schoolId: school.id,
        submission: rejectTarget,
        reviewNote: rejectNote.trim() || 'Payment reference could not be verified.',
      });
      const rejectedName = rejectTarget.studentName;
      clearModalDraft(rejectDraftKey);
      setRejectDraftRestored(false);
      setRejectTarget(null);
      setSmsBanner({
        tone: 'warn',
        text: `Marked payment proof from ${rejectedName} as Rejected.`,
      });
    } catch (err) {
      setRejectError(err instanceof Error ? err.message : 'Unable to reject payment reference.');
    } finally {
      setRejectBusy(false);
    }
  };

  const handleSendSingleLowBalanceSms = async (inv: FeeInvoice) => {
    if (!canWriteFees) return;
    const balance = Math.max(0, inv.totalBilled - inv.totalPaid);
    if (balance <= 0) return;
    const student = studentById.get(inv.studentId);
    setSendingInvoiceSmsId(inv.id);
    try {
      const outcome = await dispatchAndLogParentSms({
        schoolId: school.id,
        ownerId,
        senderLabel: effectiveSmsConfig.senderLabel,
        invoiceId: inv.id,
        studentId: inv.studentId,
        studentName: inv.studentName,
        guardianName: student?.guardianName || 'Parent/Guardian',
        guardianPhoneRaw: student?.guardianPhone || student?.guardianSecondaryPhone || '',
        type: 'Low Balance Alert',
        term: inv.term,
        amountMWK: 0,
        balanceAfterMWK: balance,
        totalBilledMWK: inv.totalBilled,
      });
      setSmsBanner({
        tone: outcome.status === 'Sent' || outcome.status === 'Simulated' ? 'success' : 'warn',
        text:
          outcome.status === 'Sent' || outcome.status === 'Simulated'
            ? `Low Balance Alert (${outcome.status}) sent to ${student?.guardianName || 'Guardian'} (${outcome.guardianPhone}) for ${inv.studentName} (${formatMWK(balance)} due).`
            : `Low Balance Alert ${outcome.status} for ${inv.studentName}: ${outcome.errorReason}`,
      });
    } catch (err) {
      setSmsBanner({
        tone: 'warn',
        text: err instanceof Error ? err.message : 'Failed to dispatch SMS alert.',
      });
    } finally {
      setSendingInvoiceSmsId(null);
    }
  };

  const toggleInvoiceSelection = (invoiceId: string) => {
    setSelectedInvoiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(invoiceId)) next.delete(invoiceId);
      else next.add(invoiceId);
      return next;
    });
  };

  const toggleAllVisibleOutstanding = () => {
    if (visibleOutstandingInvoices.length === 0) return;
    setSelectedInvoiceIds((prev) => {
      const next = new Set(prev);
      if (allVisibleOutstandingSelected) {
        for (const inv of visibleOutstandingInvoices) {
          next.delete(inv.id);
        }
      } else {
        for (const inv of visibleOutstandingInvoices) {
          next.add(inv.id);
        }
      }
      return next;
    });
  };

  const openBulkSmsModal = (useCurrentSelectionOnly = false) => {
    if (!canWriteFees || outstandingRecipients.length === 0) return;
    if (!useCurrentSelectionOnly && validSelectedInvoiceIds.size === 0) {
      const thresholdReachable = outstandingRecipients.filter(
        (r) =>
          r.balance >= effectiveSmsConfig.lowBalanceThresholdMWK &&
          !!r.formattedPhone &&
          !r.recentlySent
      );
      const fallbackReachable = outstandingRecipients.filter(
        (r) => !!r.formattedPhone && !r.recentlySent
      );
      const initialTargets =
        thresholdReachable.length > 0
          ? thresholdReachable
          : fallbackReachable.length > 0
          ? fallbackReachable
          : outstandingRecipients;
      setSelectedInvoiceIds(new Set(initialTargets.map((r) => r.invoice.id)));
    }
    setBulkSmsOpen(true);
  };

  const handleBulkSmsCompleted = (summary: BulkSmsDispatchSummary) => {
    setBulkSmsOpen(false);
    setSelectedInvoiceIds(new Set());
    const dispatchedCount = summary.sentCount + summary.simulatedCount;
    const issueCount = summary.failedCount + summary.skippedCount;
    const parts: string[] = [];
    if (summary.sentCount > 0) parts.push(`${summary.sentCount} sent`);
    if (summary.simulatedCount > 0) parts.push(`${summary.simulatedCount} simulated`);
    if (summary.skippedCount > 0) parts.push(`${summary.skippedCount} skipped`);
    if (summary.failedCount > 0) parts.push(`${summary.failedCount} failed`);
    setSmsBanner({
      tone: issueCount > 0 && dispatchedCount === 0 ? 'warn' : 'success',
      text: `Bulk Payment Reminders finished (${summary.total} queued): ${parts.join(', ') || 'completed'}.`,
    });
    setViewMode('sms');
  };

  const openPolicyModal = () => {
    if (!canWriteFees) return;
    const key = buildModalDraftKey(school.id, 'fee_sms_policy', 'default');
    const draft = loadModalDraft<{
      policyAutoPay: boolean;
      policyAutoLow: boolean;
      policyThresholdStr: string;
      policySenderLabel: string;
    }>(key);
    if (draft) {
      setPolicyAutoPay(draft.policyAutoPay);
      setPolicyAutoLow(draft.policyAutoLow);
      setPolicyThresholdStr(draft.policyThresholdStr);
      setPolicySenderLabel(draft.policySenderLabel);
      setPolicyDraftRestored(true);
    } else {
      setPolicyAutoPay(effectiveSmsConfig.autoPaymentSms);
      setPolicyAutoLow(effectiveSmsConfig.autoLowBalanceSms);
      setPolicyThresholdStr(String(effectiveSmsConfig.lowBalanceThresholdMWK));
      setPolicySenderLabel(effectiveSmsConfig.senderLabel);
      setPolicyDraftRestored(false);
    }
    setPolicyError('');
    setPolicyModalOpen(true);
  };

  const handleDiscardPolicyDraft = () => {
    clearModalDraft(policyDraftKey);
    setPolicyAutoPay(effectiveSmsConfig.autoPaymentSms);
    setPolicyAutoLow(effectiveSmsConfig.autoLowBalanceSms);
    setPolicyThresholdStr(String(effectiveSmsConfig.lowBalanceThresholdMWK));
    setPolicySenderLabel(effectiveSmsConfig.senderLabel);
    setPolicyDraftRestored(false);
  };

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteFees) return;
    setPolicySaving(true);
    setPolicyError('');
    try {
      await saveSmsConfig(
        school.id,
        ownerId,
        {
          autoPaymentSms: policyAutoPay,
          autoLowBalanceSms: policyAutoLow,
          lowBalanceThresholdMWK: Number(policyThresholdStr) || 0,
          senderLabel: policySenderLabel,
        },
        !!smsConfig
      );
      clearModalDraft(policyDraftKey);
      setPolicyDraftRestored(false);
      setPolicyModalOpen(false);
      setSmsBanner({
        tone: 'success',
        text: 'Parent SMS notification policy saved.',
      });
    } catch (err) {
      setPolicyError(err instanceof Error ? err.message : 'Failed to save SMS policy.');
    } finally {
      setPolicySaving(false);
    }
  };

  const handleExportCSV = () => {
    if (viewMode === 'invoices') {
      downloadCSV(
        `${school.name.toLowerCase().replace(/\s+/g, '-')}-fees-${termFilter}.csv`,
        ['Student', 'Form', 'Term', 'Billed (MWK)', 'Paid (MWK)', 'Balance (MWK)', 'Status'],
        filteredInvoices.map((i) => [
          i.studentName,
          `Form ${i.formLevel}${i.stream}`,
          i.term,
          i.totalBilled,
          i.totalPaid,
          Math.max(0, i.totalBilled - i.totalPaid),
          i.status,
        ])
      );
    } else if (viewMode === 'receipts') {
      downloadCSV(
        `${school.name.toLowerCase().replace(/\s+/g, '-')}-receipts-${termFilter}.csv`,
        ['Receipt #', 'Student', 'Term', 'Method', 'Reference', 'Amount (MWK)'],
        filteredPayments.map((p) => [
          p.receiptNo,
          p.studentName,
          p.term,
          p.method,
          p.reference,
          p.amount,
        ])
      );
    } else if (viewMode === 'proofs') {
      downloadCSV(
        `${school.name.toLowerCase().replace(/\s+/g, '-')}-payment-proofs-${termFilter}.csv`,
        ['Submitted Date', 'Student', 'Form', 'Term', 'Method', 'Reference', 'Amount (MWK)', 'Status', 'Receipt #', 'Review Note'],
        filteredSubmissions.map((s) => [
          s.submittedDate,
          s.studentName,
          `Form ${s.formLevel}${s.stream}`,
          s.term,
          s.method,
          s.reference || '',
          s.amount,
          s.status,
          s.receiptNo || '',
          s.reviewNote || '',
        ])
      );
    } else {
      downloadCSV(
        `${school.name.toLowerCase().replace(/\s+/g, '-')}-sms-alerts-${termFilter}.csv`,
        ['Type', 'Student', 'Guardian', 'Phone', 'Balance After (MWK)', 'Status', 'Provider', 'Message'],
        filteredSmsLogs.map((l) => [
          l.type,
          l.studentName,
          l.guardianName,
          l.guardianPhone,
          l.balanceAfterMWK,
          l.status,
          l.provider,
          l.message,
        ])
      );
    }
  };

  const handleDownloadPdf = () => {
    downloadFeesPdfReport({
      school,
      viewMode: viewMode === 'receipts' ? 'receipts' : 'invoices',
      termFilter,
      statusFilter,
      invoices: filteredInvoices,
      payments: filteredPayments,
    });
  };

  const hasRowsForExport =
    viewMode === 'invoices'
      ? filteredInvoices.length > 0
      : viewMode === 'receipts'
      ? filteredPayments.length > 0
      : viewMode === 'proofs'
      ? filteredSubmissions.length > 0
      : filteredSmsLogs.length > 0;

  return (
    <div className="space-y-5">
      {/* Summary Strip + Collection Visual */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">{termFilter} Billed</div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {formatMWK(totals.billed)}
          </div>
        </div>
        <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{termFilter} Collected</span>
            <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
              {totals.rate}%
            </span>
          </div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatMWK(totals.paid)}
          </div>
        </div>
        <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">{termFilter} Outstanding</div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-amber-700 dark:text-amber-400">
            {formatMWK(totals.balance)}
          </div>
        </div>
      </div>

      {totals.totalCount > 0 && (
        <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-3 space-y-2">
          <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
            {totals.paidCount > 0 && (
              <div
                style={{ width: `${(totals.paidCount / totals.totalCount) * 100}%` }}
                className="bg-emerald-600 dark:bg-emerald-500"
              />
            )}
            {totals.partialCount > 0 && (
              <div
                style={{ width: `${(totals.partialCount / totals.totalCount) * 100}%` }}
                className="bg-amber-500"
              />
            )}
            {totals.unpaidCount > 0 && (
              <div
                style={{ width: `${(totals.unpaidCount / totals.totalCount) * 100}%` }}
                className="bg-rose-500"
              />
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
            <div className="flex items-center gap-4">
              <span className="text-emerald-700 dark:text-emerald-400">{totals.paidCount} Paid</span>
              <span className="text-amber-700 dark:text-amber-400">{totals.partialCount} Partial</span>
              <span className="text-rose-600 dark:text-rose-400">{totals.unpaidCount} Unpaid</span>
            </div>
            <span className="text-slate-500 dark:text-slate-400">
              {totals.rate}% collected · {totals.totalCount} invoices
            </span>
          </div>
        </div>
      )}

      {smsBanner && (
        <div
          className={`rounded-2xl border px-4 py-3 flex items-start justify-between gap-3 text-xs ${
            smsBanner.tone === 'success'
              ? 'bg-emerald-50/90 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200'
              : 'bg-amber-50/90 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200'
          }`}
        >
          <div className="flex items-start gap-2.5 pt-0.5">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{smsBanner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setSmsBanner(null)}
            aria-label="Dismiss SMS notification status"
            className="min-h-[28px] min-w-[28px] flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Controls */}
      <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Bursar Fee Ledger (MWK)
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
              {govTuitionOnly ? 'Tuition-Only Gov. Policy · ' : ''}SMS: {gatewayStatus.providerLabel}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canWriteFees && (
              <>
                <button
                  type="button"
                  onClick={openPolicyModal}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>SMS Policy</span>
                </button>
                <button
                  type="button"
                  onClick={() => openBulkSmsModal(false)}
                  disabled={outstandingRecipients.length === 0}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 text-xs font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100/70 dark:hover:bg-amber-950/50 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {validSelectedInvoiceIds.size > 0
                      ? `Bulk SMS (${validSelectedInvoiceIds.size} Selected)`
                      : `Bulk SMS (${outstandingRecipients.length})`}
                  </span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={viewMode === 'sms' || viewMode === 'proofs' ? filteredInvoices.length === 0 : !hasRowsForExport}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileDown className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Download Report</span>
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              disabled={!hasRowsForExport}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Export CSV</span>
            </button>
            {canWriteFees && (
              <>
                <button
                  type="button"
                  onClick={() => openBillModal('form')}
                  disabled={activeStudents.length === 0}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Bill Form</span>
                </button>
                <button
                  type="button"
                  onClick={() => openBillModal('single')}
                  disabled={activeStudents.length === 0}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>New Invoice</span>
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setViewMode('invoices')}
                className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                  viewMode === 'invoices'
                    ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Invoices ({filteredInvoices.length})
              </button>
              <button
                type="button"
                onClick={() => setViewMode('receipts')}
                className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                  viewMode === 'receipts'
                    ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Receipts ({filteredPayments.length})
              </button>
              <button
                type="button"
                onClick={() => setViewMode('proofs')}
                className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 ${
                  viewMode === 'proofs'
                    ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <span>Proofs ({filteredSubmissions.length})</span>
                {pendingProofCounts.total > 0 && (
                  <span className="font-mono text-[11px] font-bold text-amber-700 dark:text-amber-400">
                    · {pendingProofCounts.total} pending
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setViewMode('sms')}
                className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 ${
                  viewMode === 'sms'
                    ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
                <span>SMS Alerts ({filteredSmsLogs.length})</span>
              </button>
            </div>

            <select
              aria-label="Select term"
              value={termFilter}
              onChange={(e) => setTermFilter(e.target.value as TermName)}
              className="min-h-[38px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium"
            >
              {TERMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {viewMode === 'invoices' && (
            <div className="flex items-center gap-1.5">
              {(['all', 'Unpaid', 'Partial', 'Paid'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-medium cursor-pointer ${
                    statusFilter === st
                      ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {st === 'all' ? 'All' : st}
                </button>
              ))}
            </div>
          )}

          {viewMode === 'proofs' && (
            <div className="flex items-center gap-1.5">
              {(['all', 'Pending', 'Approved', 'Rejected'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setProofStatusFilter(st)}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-medium cursor-pointer ${
                    proofStatusFilter === st
                      ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {st === 'all' ? 'All' : st}
                </button>
              ))}
            </div>
          )}

          {viewMode === 'sms' && (
            <div className="flex items-center gap-1.5">
              {(['all', 'Payment Confirmation', 'Low Balance Alert'] as const).map((tp) => (
                <button
                  key={tp}
                  type="button"
                  onClick={() => setSmsTypeFilter(tp)}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-medium cursor-pointer ${
                    smsTypeFilter === tp
                      ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {tp === 'all' ? 'All SMS' : tp}
                </button>
              ))}
            </div>
          )}
        </div>

        {govTuitionOnly && (
          <div className="rounded-xl bg-emerald-50/80 dark:bg-emerald-950/35 border border-emerald-200/80 dark:border-emerald-900/60 px-3.5 py-2.5 text-xs text-emerald-900 dark:text-emerald-200">
            <strong>Malawi Government School Fee Policy ({school.schoolType}):</strong> School fees are free except Tuition Fee. GPF / Development, Exam, and Other charges are locked at MK 0.
          </div>
        )}
      </div>

      {/* Invoices, Receipts, or SMS Alerts Table */}
      <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
        {viewMode === 'invoices' ? (
          filteredInvoices.length === 0 ? (
            <div className="py-12 px-6 text-center text-sm text-slate-500 dark:text-slate-400">
              No {termFilter} invoices yet. Use &ldquo;Bill Form&rdquo; or &ldquo;New Invoice&rdquo; to bill students in MWK.
            </div>
          ) : (
            <>
              {canWriteFees && selectedSmsSummary.count > 0 && (
                <div className="px-4 py-3 border-b border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/70 dark:bg-emerald-950/30 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-emerald-950 dark:text-emerald-100 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold font-mono tabular-nums">
                      {selectedSmsSummary.count} {selectedSmsSummary.count === 1 ? 'student' : 'students'} selected
                    </span>
                    <span aria-hidden="true" className="text-emerald-700/60 dark:text-emerald-400/60">·</span>
                    <span className="font-mono tabular-nums">
                      Total outstanding: {formatMWK(selectedSmsSummary.totalBalanceMWK)}
                    </span>
                    <span aria-hidden="true" className="text-emerald-700/60 dark:text-emerald-400/60">·</span>
                    <span className="text-emerald-800 dark:text-emerald-300">
                      {selectedSmsSummary.reachableCount} reachable via SMS
                    </span>
                    {selectedSmsSummary.missingPhoneCount > 0 && (
                      <>
                        <span aria-hidden="true" className="text-emerald-700/60 dark:text-emerald-400/60">·</span>
                        <span className="text-amber-800 dark:text-amber-300 font-medium">
                          {selectedSmsSummary.missingPhoneCount} missing valid phone
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setSelectedInvoiceIds(new Set())}
                      className="min-h-[36px] px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => openBulkSmsModal(true)}
                      className="inline-flex items-center gap-1.5 min-h-[36px] px-3.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Send Payment Reminders ({selectedSmsSummary.count})</span>
                    </button>
                  </div>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                      {canWriteFees && (
                        <th className="py-3 pl-4 pr-2 w-10">
                          <input
                            ref={selectAllCheckboxRef}
                            type="checkbox"
                            aria-label="Select all students with outstanding balances"
                            checked={allVisibleOutstandingSelected}
                            disabled={visibleOutstandingInvoices.length === 0}
                            onChange={toggleAllVisibleOutstanding}
                            className="rounded border-slate-300 dark:border-slate-600 disabled:opacity-40 cursor-pointer"
                          />
                        </th>
                      )}
                      <th className="py-3 px-4 font-medium">Student &amp; Guardian Phone</th>
                      <th className="py-3 px-4 font-medium">Class</th>
                      <th className="py-3 px-4 font-medium text-right">Billed</th>
                      <th className="py-3 px-4 font-medium text-right">Paid</th>
                      <th className="py-3 px-4 font-medium text-right">Balance</th>
                      <th className="py-3 px-4 font-medium">Status</th>
                      {canWriteFees && (
                        <th className="py-3 px-4 font-medium text-right">Action</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {filteredInvoices.map((inv) => {
                      const balance = Math.max(0, inv.totalBilled - inv.totalPaid);
                      const stu = studentById.get(inv.studentId);
                      const formattedPhone =
                        formatMalawiSmsPhone(stu?.guardianPhone) ||
                        formatMalawiSmsPhone(stu?.guardianSecondaryPhone);
                      const isSendingSms = sendingInvoiceSmsId === inv.id;
                      const isSelected = validSelectedInvoiceIds.has(inv.id);
                      return (
                        <tr
                          key={inv.id}
                          className={
                            isSelected
                              ? 'bg-emerald-50/50 dark:bg-emerald-950/20 hover:bg-emerald-50/80 dark:hover:bg-emerald-950/30'
                              : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/30'
                          }
                        >
                          {canWriteFees && (
                            <td className="py-3 pl-4 pr-2">
                              {balance > 0 ? (
                                <input
                                  type="checkbox"
                                  aria-label={`Select ${inv.studentName} for bulk payment reminder`}
                                  checked={isSelected}
                                  onChange={() => toggleInvoiceSelection(inv.id)}
                                  className="rounded border-slate-300 dark:border-slate-600 cursor-pointer"
                                />
                              ) : (
                                <span className="text-xs text-slate-300 dark:text-slate-700" aria-hidden="true">
                                  —
                                </span>
                              )}
                            </td>
                          )}
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {inv.studentName}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                              {stu?.guardianName || 'Guardian'} · {formattedPhone || stu?.guardianPhone || 'No phone on profile'}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-400">
                            Form {inv.formLevel}{inv.stream}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums">
                            {formatMWK(inv.totalBilled)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                            {formatMWK(inv.totalPaid)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold">
                            {formatMWK(balance)}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`text-xs font-semibold ${
                                inv.status === 'Paid'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : inv.status === 'Partial'
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {inv.status}
                            </span>
                          </td>
                          {canWriteFees && (
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                {balance > 0 && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleSendSingleLowBalanceSms(inv)}
                                      disabled={isSendingSms}
                                      title={
                                        formattedPhone
                                          ? `Send Low Balance SMS to ${formattedPhone}`
                                          : 'Guardian phone missing — click to log skipped check'
                                      }
                                      className="inline-flex items-center gap-1 min-h-[36px] px-2.5 rounded-lg border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-xs font-medium disabled:opacity-50 cursor-pointer"
                                    >
                                      <BellRing className="w-3.5 h-3.5" aria-hidden="true" />
                                      <span>{isSendingSms ? 'Sending...' : 'Alert'}</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openPaymentModal(inv)}
                                      className="inline-flex items-center gap-1 min-h-[36px] px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
                                    >
                                      <Banknote className="w-3.5 h-3.5" aria-hidden="true" />
                                      <span>Pay</span>
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeleteInvoiceError('');
                                    setConfirmInvoice(inv);
                                  }}
                                  aria-label={`Delete invoice for ${inv.studentName}`}
                                  className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )
        ) : viewMode === 'receipts' ? (
          filteredPayments.length === 0 ? (
            <div className="py-12 px-6 text-center text-sm text-slate-500 dark:text-slate-400">
              No payment receipts recorded for {termFilter} yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                    <th className="py-3 px-4 font-medium">Receipt #</th>
                    <th className="py-3 px-4 font-medium">Student</th>
                    <th className="py-3 px-4 font-medium">Method</th>
                    <th className="py-3 px-4 font-medium">Reference</th>
                    <th className="py-3 px-4 font-medium text-right">Amount Paid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {filteredPayments.map((p) => (
                    <tr key={p.id}>
                      <td className="py-3 px-4 font-mono text-xs text-slate-600 dark:text-slate-400">
                        {p.receiptNo}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900 dark:text-slate-100">
                        {p.studentName}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700 dark:text-slate-300">
                        {p.method}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-500 dark:text-slate-400">
                        {p.reference}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
                        {formatMWK(p.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : viewMode === 'proofs' ? (
          <>
            {pendingProofCounts.otherTermCount > 0 && pendingProofCounts.firstOtherTerm && (
              <div className="px-4 py-2.5 border-b border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200">
                <span>
                  {pendingProofCounts.otherTermCount} pending payment proof{pendingProofCounts.otherTermCount === 1 ? '' : 's'} submitted under {pendingProofCounts.firstOtherTerm}.
                </span>
                <button
                  type="button"
                  onClick={() => setTermFilter(pendingProofCounts.firstOtherTerm!)}
                  className="font-semibold underline underline-offset-2 cursor-pointer"
                >
                  Switch to {pendingProofCounts.firstOtherTerm}
                </button>
              </div>
            )}
            {filteredSubmissions.length === 0 ? (
              <div className="py-12 px-6 text-center text-sm text-slate-500 dark:text-slate-400">
                No student payment references uploaded for {termFilter}
                {proofStatusFilter !== 'all' ? ` with status ${proofStatusFilter}` : ''}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                      <th className="py-3 px-4 font-medium">Date</th>
                      <th className="py-3 px-4 font-medium">Student</th>
                      <th className="py-3 px-4 font-medium">Channel &amp; Ref</th>
                      <th className="py-3 px-4 font-medium">Proof File</th>
                      <th className="py-3 px-4 font-medium text-right">Amount</th>
                      <th className="py-3 px-4 font-medium">Status</th>
                      <th className="py-3 px-4 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {filteredSubmissions.map((sub) => (
                      <tr key={sub.id} className="align-top hover:bg-slate-50/80 dark:hover:bg-slate-800/30">
                        <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {sub.submittedDate}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {sub.studentName}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                            Form {sub.formLevel}{sub.stream} · {sub.admissionNo}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="text-xs font-medium text-slate-800 dark:text-slate-200">
                            {sub.method}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                            {sub.reference || '—'}
                          </div>
                          {sub.notes && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 max-w-xs truncate">
                              {sub.notes}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
                            {sub.fileFormat === 'pdf' ? (
                              <FileText className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" aria-hidden="true" />
                            ) : (
                              <ImageIcon className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                            )}
                            <span className="truncate max-w-[160px]">{sub.fileName}</span>
                          </div>
                          <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                            {sub.fileFormat.toUpperCase()} · {formatFileSizeLabel(sub.fileSizeBytes)}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {formatMWK(sub.amount)}
                        </td>
                        <td className="py-3 px-4">
                          <div
                            className={`text-xs font-semibold ${
                              sub.status === 'Approved'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : sub.status === 'Rejected'
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {sub.status}
                          </div>
                          {sub.receiptNo && (
                            <div className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 mt-0.5">
                              {sub.receiptNo}
                            </div>
                          )}
                          {sub.reviewNote && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 max-w-xs">
                              {sub.reviewNote}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setPreviewSubmission(sub)}
                              className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>View</span>
                            </button>
                            {canWriteFees && sub.status === 'Pending' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openApproveModal(sub)}
                                  className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>Approve</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openRejectModal(sub)}
                                  className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold cursor-pointer"
                                >
                                  <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>Reject</span>
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : filteredSmsLogs.length === 0 ? (
          <div className="py-12 px-6 text-center text-sm text-slate-500 dark:text-slate-400 space-y-2">
            <div>
              No parent SMS notifications logged for {termFilter} yet.
            </div>
            <div className="text-xs">
              Recording a fee payment automatically dispatches a Payment Confirmation SMS (and a Low Balance Alert if a balance remains). You can also select students on the Invoices tab or click &ldquo;Bulk SMS&rdquo; above.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4 font-medium">Sent</th>
                  <th className="py-3 px-4 font-medium">Type</th>
                  <th className="py-3 px-4 font-medium">Student &amp; Guardian</th>
                  <th className="py-3 px-4 font-medium">Phone</th>
                  <th className="py-3 px-4 font-medium">Message</th>
                  <th className="py-3 px-4 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filteredSmsLogs.map((log) => (
                  <tr key={log.id} className="align-top hover:bg-slate-50/80 dark:hover:bg-slate-800/30">
                    <td className="py-3 px-4 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {formatSmsTimestamp(log.createdAt)}
                    </td>
                    <td className="py-3 px-4 text-xs font-semibold whitespace-nowrap">
                      <span
                        className={
                          log.type === 'Payment Confirmation'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }
                      >
                        {log.type}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {log.studentName}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {log.guardianName}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {log.guardianPhone || '—'}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-300 max-w-md leading-relaxed">
                      <div>{log.message}</div>
                      {log.errorReason && (
                        <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                          {log.errorReason}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div
                        className={`text-xs font-semibold ${
                          log.status === 'Sent'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : log.status === 'Simulated'
                            ? 'text-sky-700 dark:text-sky-400'
                            : log.status === 'Skipped'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {log.status}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                        {log.provider}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Invoice Modal */}
      {billModalOpen && (
        <ModalBackdrop open={billModalOpen} disabled={billingBusy} onClose={() => setBillModalOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {billScope === 'single' ? `New ${termFilter} Invoice` : `Bill Entire Form (${termFilter})`}
              </h2>
              <button
                type="button"
                onClick={() => setBillModalOpen(false)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateBills} className="mt-4 space-y-4">
              <DraftRestoredNotice
                visible={billDraftRestored}
                onDiscard={handleDiscardBillDraft}
              />

              {billError && (
                <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                  {billError}
                </div>
              )}

              {billScope === 'single' ? (
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Student
                  </label>
                  <select
                    value={billStudentId}
                    onChange={(e) => setBillStudentId(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                  >
                    {activeStudents.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fullName} (Form {s.formLevel}{s.stream})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Select Form Level to Bill
                  </label>
                  <select
                    value={billFormLevel}
                    onChange={(e) => setBillFormLevel(Number(e.target.value) as FormLevel)}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                  >
                    {FORM_LEVELS.map((f) => (
                      <option key={f} value={f}>
                        Form {f} ({activeStudents.filter((s) => s.formLevel === f).length} active students)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {govTuitionOnly && (
                <div className="rounded-xl bg-emerald-50/80 dark:bg-emerald-950/35 border border-emerald-200/80 dark:border-emerald-900/60 px-3.5 py-2 text-[11px] text-emerald-900 dark:text-emerald-200">
                  <strong>Tuition-Only Mode:</strong> GPF, Exam, and Other fees are waived at MK 0 for {school.schoolType} schools.
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                    Tuition Fee (MK)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={tuitionStr}
                    onChange={(e) => setTuitionStr(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                    GPF / Dev (MK){govTuitionOnly ? ' · Waived' : ''}
                  </label>
                  <input
                    type="number"
                    min="0"
                    disabled={govTuitionOnly}
                    value={govTuitionOnly ? '0' : gpfStr}
                    onChange={(e) => setGpfStr(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm disabled:opacity-55 disabled:cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                    Exam Fee (MK){govTuitionOnly ? ' · Waived' : ''}
                  </label>
                  <input
                    type="number"
                    min="0"
                    disabled={govTuitionOnly}
                    value={govTuitionOnly ? '0' : examStr}
                    onChange={(e) => setExamStr(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm disabled:opacity-55 disabled:cursor-not-allowed"
                  />
                </div>
                {billScope === 'single' && (
                  <div>
                    <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                      Other Fee (MK){govTuitionOnly ? ' · Waived' : ''}
                    </label>
                    <input
                      type="number"
                      min="0"
                      disabled={govTuitionOnly}
                      value={govTuitionOnly ? '0' : otherStr}
                      onChange={(e) => setOtherStr(e.target.value)}
                      className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm disabled:opacity-55 disabled:cursor-not-allowed"
                    />
                  </div>
                )}
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setBillModalOpen(false)}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={billingBusy}
                  className="min-h-[42px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {billingBusy ? 'Generating...' : 'Generate Invoice'}
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}

      {/* Record Payment Modal */}
      {payInvoice && (
        <ModalBackdrop open={Boolean(payInvoice)} disabled={payBusy} onClose={() => setPayInvoice(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Record Fee Payment
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {payInvoice.studentName} · Balance: {formatMWK(Math.max(0, payInvoice.totalBilled - payInvoice.totalPaid))}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPayInvoice(null)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRecordPayment} className="mt-4 space-y-4">
              <DraftRestoredNotice
                visible={payDraftRestored}
                onDiscard={handleDiscardPayDraft}
              />

              {payError && (
                <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                  {payError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Amount Paid (MWK)
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={payAmountStr}
                  onChange={(e) => setPayAmountStr(e.target.value)}
                  className="w-full min-h-[46px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-base font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Payment Channel
                </label>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                  className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Transaction / Deposit Reference
                </label>
                <input
                  type="text"
                  maxLength={80}
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  placeholder="e.g. Airtel Money ID, Mpamba Ref, or Bank Slip #"
                  className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm"
                />
              </div>

              {(() => {
                const stu = studentById.get(payInvoice.studentId);
                const phone =
                  formatMalawiSmsPhone(stu?.guardianPhone) ||
                  formatMalawiSmsPhone(stu?.guardianSecondaryPhone);
                return (
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-[11px] text-slate-600 dark:text-slate-300">
                    {effectiveSmsConfig.autoPaymentSms ? (
                      phone ? (
                        <span>
                          Auto-SMS enabled: will notify <strong className="text-slate-900 dark:text-slate-100">{stu?.guardianName}</strong> ({phone}) on save.
                        </span>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-300">
                          Guardian phone missing or invalid on {payInvoice.studentName}&apos;s profile — SMS will be logged as Skipped.
                        </span>
                      )
                    ) : (
                      <span>Automated payment confirmation SMS is paused in SMS Policy.</span>
                    )}
                  </div>
                );
              })()}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPayInvoice(null)}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={payBusy}
                  className="min-h-[42px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {payBusy ? 'Recording...' : 'Confirm Payment'}
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}

      {/* Bulk Payment Reminder SMS Composer Modal */}
      <BulkSmsModal
        open={canWriteFees && bulkSmsOpen}
        school={school}
        ownerId={ownerId}
        termFilter={termFilter}
        senderLabel={effectiveSmsConfig.senderLabel}
        lowBalanceThresholdMWK={effectiveSmsConfig.lowBalanceThresholdMWK}
        gatewayStatus={gatewayStatus}
        recipients={outstandingRecipients}
        selectedInvoiceIds={validSelectedInvoiceIds}
        onChangeSelectedIds={setSelectedInvoiceIds}
        onClose={() => setBulkSmsOpen(false)}
        onCompleted={handleBulkSmsCompleted}
      />

      {/* SMS Policy Settings Modal */}
      {policyModalOpen && (
        <ModalBackdrop open={policyModalOpen} disabled={policySaving} onClose={() => setPolicyModalOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Parent SMS Notification Policy
              </h2>
              <button
                type="button"
                onClick={() => setPolicyModalOpen(false)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSavePolicy} className="mt-4 space-y-4">
              <DraftRestoredNotice
                visible={policyDraftRestored}
                onDiscard={handleDiscardPolicyDraft}
              />

              {policyError && (
                <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                  {policyError}
                </div>
              )}

              <div className="rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-xs">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  Server SMS Gateway: {gatewayStatus.providerLabel}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {gatewayStatus.configured
                    ? 'Live SMS carrier credentials are active on the server.'
                    : 'Running in Preview Outbox mode. Configure Africa’s Talking or Twilio server secrets for live carrier delivery.'}
                </div>
              </div>

              <label className="flex items-start gap-2.5 text-xs text-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={policyAutoPay}
                  onChange={(e) => setPolicyAutoPay(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300"
                />
                <span>
                  <strong className="block">Auto-send Fee Payment Confirmation SMS</strong>
                  <span className="text-slate-500 dark:text-slate-400">
                    Sends receipt number, MWK amount paid, and updated balance when recording a payment.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2.5 text-xs text-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={policyAutoLow}
                  onChange={(e) => setPolicyAutoLow(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300"
                />
                <span>
                  <strong className="block">Auto-send Low Balance Alert SMS</strong>
                  <span className="text-slate-500 dark:text-slate-400">
                    Sends a balance reminder after partial payments when unpaid fees meet or exceed the threshold below.
                  </span>
                </span>
              </label>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Low Balance Alert Threshold (MWK)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100000000"
                  value={policyThresholdStr}
                  onChange={(e) => setPolicyThresholdStr(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  SMS Sender Header (max 40 chars)
                </label>
                <input
                  type="text"
                  maxLength={40}
                  required
                  value={policySenderLabel}
                  onChange={(e) => setPolicySenderLabel(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPolicyModalOpen(false)}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={policySaving}
                  className="min-h-[42px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {policySaving ? 'Saving...' : 'Save Policy'}
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}

      {/* Safe Delete Confirmation Modal */}
      <ConfirmDeleteModal
        open={!!confirmInvoice}
        title="Delete Fee Invoice"
        itemName={
          confirmInvoice
            ? `${confirmInvoice.studentName} · ${confirmInvoice.term} (${formatMWK(confirmInvoice.totalBilled)})`
            : ''
        }
        description="This permanently removes this fee invoice from the Bursar ledger. Past payment receipts remain recorded."
        warningNote={
          confirmInvoice && confirmInvoice.totalPaid > 0
            ? `Caution: ${formatMWK(confirmInvoice.totalPaid)} has already been paid toward this invoice. Deleting it will remove the balance record.`
            : undefined
        }
        requireKeyword={confirmInvoice && confirmInvoice.totalPaid > 0 ? 'DELETE' : undefined}
        confirmLabel="Delete Invoice"
        deleting={deletingInvoice}
        error={deleteInvoiceError}
        onCancel={() => {
          if (!deletingInvoice) setConfirmInvoice(null);
        }}
        onConfirm={async () => {
          if (!confirmInvoice) return;
          setDeletingInvoice(true);
          setDeleteInvoiceError('');
          try {
            const stu = studentById.get(confirmInvoice.studentId);
            await removeFeeInvoice(school.id, confirmInvoice.id, stu?.registrationCode);
            setConfirmInvoice(null);
          } catch (err) {
            setDeleteInvoiceError(
              err instanceof Error ? err.message : 'Unable to delete fee invoice.'
            );
          } finally {
            setDeletingInvoice(false);
          }
        }}
      />

      {/* Approve Student Payment Proof Modal */}
      {approveTarget && (
        <ModalBackdrop open={Boolean(approveTarget)} disabled={approveBusy} onClose={() => setApproveTarget(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Approve Payment Reference
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {approveTarget.studentName} · {approveTarget.term}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setApproveTarget(null)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmApprove} className="mt-4 space-y-4">
              <DraftRestoredNotice
                visible={approveDraftRestored}
                onDiscard={handleDiscardApproveDraft}
              />

              {approveError && (
                <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                  {approveError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Apply to Invoice
                </label>
                {(() => {
                  const stuInvs = invoices.filter((inv) => inv.studentId === approveTarget.studentId);
                  if (stuInvs.length === 0) {
                    return (
                      <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200">
                        No fee invoice exists for {approveTarget.studentName} yet. Create a term invoice under the Invoices tab before approving this proof.
                      </div>
                    );
                  }
                  return (
                    <select
                      value={approveInvoiceId}
                      onChange={(e) => setApproveInvoiceId(e.target.value)}
                      required
                      className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                    >
                      {stuInvs.map((inv) => (
                        <option key={inv.id} value={inv.id}>
                          {inv.term} {inv.academicYear} · Balance {formatMWK(Math.max(0, inv.totalBilled - inv.totalPaid))}
                        </option>
                      ))}
                    </select>
                  );
                })()}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Verified Amount (MWK)
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={approveAmountStr}
                    onChange={(e) => setApproveAmountStr(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Channel
                  </label>
                  <select
                    value={approveMethod}
                    onChange={(e) => setApproveMethod(e.target.value as PaymentMethod)}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Transaction / Deposit Reference
                </label>
                <input
                  type="text"
                  maxLength={80}
                  value={approveRef}
                  onChange={(e) => setApproveRef(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Bursar Note (Visible to Student)
                </label>
                <input
                  type="text"
                  maxLength={240}
                  value={approveNote}
                  onChange={(e) => setApproveNote(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setApproveTarget(null)}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={approveBusy || !approveInvoiceId}
                  className="min-h-[42px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {approveBusy ? 'Recording...' : 'Approve & Issue Receipt'}
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}

      {/* Reject Student Payment Proof Modal */}
      {rejectTarget && (
        <ModalBackdrop open={Boolean(rejectTarget)} disabled={rejectBusy} onClose={() => setRejectTarget(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Reject Payment Reference
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {rejectTarget.studentName} · {formatMWK(rejectTarget.amount)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmReject} className="mt-4 space-y-4">
              <DraftRestoredNotice
                visible={rejectDraftRestored}
                onDiscard={handleDiscardRejectDraft}
              />

              {rejectError && (
                <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                  {rejectError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Reason for Rejection (Visible to Student)
                </label>
                <textarea
                  rows={3}
                  maxLength={240}
                  required
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  placeholder="e.g. Deposit slip unclear or transaction reference not found in bank statement."
                  className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRejectTarget(null)}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={rejectBusy}
                  className="min-h-[42px] px-5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {rejectBusy ? 'Updating...' : 'Confirm Rejection'}
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}

      <PaymentProofPreviewModal
        submission={previewSubmission}
        onClose={() => setPreviewSubmission(null)}
      />
    </div>
  );
};
