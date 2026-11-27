import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Search,
  Send,
  X,
} from 'lucide-react';
import { FORM_LEVELS, formatMWK } from '../../school/malawi';
import {
  buildModalDraftKey,
  clearModalDraft,
  loadModalDraft,
  saveModalDraft,
} from '../../school/modalDrafts';
import {
  BulkSmsDispatchSummary,
  DEFAULT_PAYMENT_REMINDER_TEMPLATE,
  dispatchBulkPaymentReminders,
  filterOutstandingSmsRecipients,
  OutstandingSmsRecipient,
  renderPaymentReminderMessage,
  SMS_REMINDER_PRESETS,
  SMS_TEMPLATE_TOKENS,
  SmsGatewayStatusResponse,
  SmsReminderPreset,
} from '../../school/smsService';
import type { FormLevel, School, TermName } from '../../school/types';
import { DraftRestoredNotice, ModalBackdrop } from './ModalBackdrop';

interface BulkSmsModalProps {
  open: boolean;
  school: School;
  ownerId: string;
  termFilter: TermName;
  senderLabel: string;
  lowBalanceThresholdMWK: number;
  gatewayStatus: SmsGatewayStatusResponse;
  recipients: OutstandingSmsRecipient[];
  selectedInvoiceIds: ReadonlySet<string>;
  onChangeSelectedIds: (next: Set<string>) => void;
  onClose: () => void;
  onCompleted: (summary: BulkSmsDispatchSummary) => void;
}

export const BulkSmsModal: React.FC<BulkSmsModalProps> = ({
  open,
  school,
  ownerId,
  termFilter,
  senderLabel,
  lowBalanceThresholdMWK,
  gatewayStatus,
  recipients,
  selectedInvoiceIds,
  onChangeSelectedIds,
  onClose,
  onCompleted,
}) => {
  const [search, setSearch] = useState('');
  const [formFilter, setFormFilter] = useState<'all' | FormLevel>('all');
  const [skipRecentAlerts, setSkipRecentAlerts] = useState(true);
  const [presetId, setPresetId] = useState<SmsReminderPreset['id'] | 'custom'>('standard');
  const [template, setTemplate] = useState(DEFAULT_PAYMENT_REMINDER_TEMPLATE);
  const [draftRestored, setDraftRestored] = useState(false);
  const [previewIdx, setPreviewIdx] = useState(0);

  const [sending, setSending] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const draftKey = useMemo(
    () => buildModalDraftKey(school.id, 'bulk_sms_template', termFilter),
    [school.id, termFilter]
  );

  // Restore saved template draft when modal opens
  useEffect(() => {
    if (!open) return;
    setSearch('');
    setFormFilter('all');
    setErrorMsg('');
    setProgressText('');
    setProgressPct(0);
    setPreviewIdx(0);

    const draft = loadModalDraft<{
      presetId: SmsReminderPreset['id'] | 'custom';
      template: string;
      skipRecentAlerts: boolean;
    }>(draftKey);

    if (draft?.template) {
      setPresetId(draft.presetId || 'custom');
      setTemplate(draft.template);
      setSkipRecentAlerts(
        typeof draft.skipRecentAlerts === 'boolean' ? draft.skipRecentAlerts : true
      );
      setDraftRestored(true);
    } else {
      setPresetId('standard');
      setTemplate(DEFAULT_PAYMENT_REMINDER_TEMPLATE);
      setSkipRecentAlerts(true);
      setDraftRestored(false);
    }
  }, [open, draftKey]);

  // Persist template edits while open
  useEffect(() => {
    if (!open) return;
    saveModalDraft(draftKey, { presetId, template, skipRecentAlerts });
  }, [open, draftKey, presetId, template, skipRecentAlerts]);

  const filteredRecipients = useMemo(
    () =>
      filterOutstandingSmsRecipients(recipients, {
        search,
        formFilter,
      }),
    [recipients, search, formFilter]
  );

  const selectedRecipients = useMemo(
    () => recipients.filter((r) => selectedInvoiceIds.has(r.invoice.id)),
    [recipients, selectedInvoiceIds]
  );

  const sendableTargets = useMemo(
    () =>
      selectedRecipients.filter(
        (r) => !!r.formattedPhone && (!skipRecentAlerts || !r.recentlySent)
      ),
    [selectedRecipients, skipRecentAlerts]
  );

  const skippedMissingPhoneCount = useMemo(
    () => selectedRecipients.filter((r) => !r.formattedPhone).length,
    [selectedRecipients]
  );

  const skippedRecentCount = useMemo(
    () =>
      skipRecentAlerts
        ? selectedRecipients.filter((r) => !!r.formattedPhone && r.recentlySent).length
        : 0,
    [selectedRecipients, skipRecentAlerts]
  );

  const selectedBalanceTotal = useMemo(
    () => sendableTargets.reduce((sum, r) => sum + r.balance, 0),
    [sendableTargets]
  );

  const previewTarget =
    sendableTargets[previewIdx] ||
    selectedRecipients[previewIdx] ||
    sendableTargets[0] ||
    selectedRecipients[0] ||
    filteredRecipients[0] ||
    recipients[0] ||
    null;

  const previewRendered = useMemo(() => {
    if (!previewTarget) return null;
    return renderPaymentReminderMessage(template, {
      senderLabel,
      guardianName: previewTarget.guardianName,
      studentName: previewTarget.studentName,
      formClass: previewTarget.formClass,
      term: previewTarget.invoice.term,
      balanceMWK: previewTarget.balance,
      totalBilledMWK: previewTarget.invoice.totalBilled,
      totalPaidMWK: previewTarget.invoice.totalPaid,
    });
  }, [previewTarget, senderLabel, template]);

  useEffect(() => {
    if (previewIdx > 0 && previewIdx >= Math.max(sendableTargets.length, selectedRecipients.length)) {
      setPreviewIdx(0);
    }
  }, [previewIdx, selectedRecipients.length, sendableTargets.length]);

  const toggleRecipient = (invoiceId: string) => {
    if (sending) return;
    const next = new Set(selectedInvoiceIds);
    if (next.has(invoiceId)) next.delete(invoiceId);
    else next.add(invoiceId);
    onChangeSelectedIds(next);
  };

  const handleSelectVisible = () => {
    const next = new Set(selectedInvoiceIds);
    for (const r of filteredRecipients) {
      next.add(r.invoice.id);
    }
    onChangeSelectedIds(next);
  };

  const handleSelectReachableVisible = () => {
    const next = new Set(selectedInvoiceIds);
    for (const r of filteredRecipients) {
      if (r.formattedPhone && (!skipRecentAlerts || !r.recentlySent)) {
        next.add(r.invoice.id);
      }
    }
    onChangeSelectedIds(next);
  };

  const handleSelectAboveThreshold = () => {
    const next = new Set<string>();
    for (const r of recipients) {
      if (r.balance >= lowBalanceThresholdMWK && r.formattedPhone) {
        next.add(r.invoice.id);
      }
    }
    onChangeSelectedIds(next);
  };

  const handleClearSelection = () => {
    onChangeSelectedIds(new Set());
  };

  const handleInsertToken = (token: string) => {
    const el = textareaRef.current;
    if (!el) {
      setTemplate((prev) => `${prev}${prev.endsWith(' ') || !prev ? '' : ' '}${token}`);
      setPresetId('custom');
      return;
    }
    const start = el.selectionStart ?? template.length;
    const end = el.selectionEnd ?? template.length;
    const next = `${template.slice(0, start)}${token}${template.slice(end)}`;
    setTemplate(next);
    setPresetId('custom');
    requestAnimationFrame(() => {
      el.focus();
      const cursorPos = start + token.length;
      el.setSelectionRange(cursorPos, cursorPos);
    });
  };

  const handleDiscardDraft = () => {
    clearModalDraft(draftKey);
    setPresetId('standard');
    setTemplate(DEFAULT_PAYMENT_REMINDER_TEMPLATE);
    setSkipRecentAlerts(true);
    setDraftRestored(false);
  };

  const handleSendBulkSms = async () => {
    if (sending || sendableTargets.length === 0 || !template.trim()) return;
    setSending(true);
    setErrorMsg('');
    setProgressPct(0);
    setProgressText(`Preparing ${sendableTargets.length} payment reminder(s)...`);

    try {
      const summary = await dispatchBulkPaymentReminders({
        schoolId: school.id,
        ownerId,
        senderLabel,
        targets: sendableTargets,
        template,
        onProgress: (completed, total, studentName) => {
          setProgressPct(Math.round((completed / Math.max(1, total)) * 100));
          setProgressText(`Sending ${completed} of ${total} (${studentName})...`);
        },
      });
      clearModalDraft(draftKey);
      setDraftRestored(false);
      onCompleted(summary);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Bulk SMS dispatch failed.');
    } finally {
      setSending(false);
      setProgressText('');
      setProgressPct(0);
    }
  };

  if (!open) return null;

  const previewListLength =
    sendableTargets.length > 0 ? sendableTargets.length : selectedRecipients.length;

  return (
    <ModalBackdrop open={open} disabled={sending} onClose={onClose}>
      <div className="w-full max-w-5xl rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 shadow-xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Bulk Fee Payment Reminder SMS
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex flex-wrap items-center gap-1.5">
              <span>{termFilter}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{gatewayStatus.providerLabel}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums font-medium text-emerald-700 dark:text-emerald-400">
                {sendableTargets.length} ready to send ({formatMWK(selectedBalanceTotal)} due)
              </span>
            </p>
          </div>
          <button
            type="button"
            disabled={sending}
            onClick={onClose}
            aria-label="Close bulk SMS composer"
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          <DraftRestoredNotice visible={draftRestored} onDiscard={handleDiscardDraft} />

          {errorMsg && (
            <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{errorMsg}</span>
            </div>
          )}

          {!gatewayStatus.configured && (
            <div className="rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200">
              <strong>Preview Outbox Active:</strong> No live Africa&apos;s Talking or Twilio gateway secret is configured on the server yet, so messages will be recorded as Simulated in the SMS Alerts log.
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left Column: Outstanding Student Selection */}
            <div className="lg:col-span-7 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  1. Select Students with Outstanding Balances ({selectedRecipients.length} of {recipients.length})
                </h3>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search
                    className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search student, admission #, guardian, or phone..."
                    className="w-full min-h-[40px] pl-9 pr-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
                <select
                  aria-label="Filter outstanding students by form level"
                  value={formFilter}
                  onChange={(e) =>
                    setFormFilter(e.target.value === 'all' ? 'all' : (Number(e.target.value) as FormLevel))
                  }
                  className="min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200"
                >
                  <option value="all">All Forms</option>
                  {FORM_LEVELS.map((lvl) => (
                    <option key={lvl} value={lvl}>
                      Form {lvl}
                    </option>
                  ))}
                </select>
              </div>

              {/* Bulk Selection Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={sending || filteredRecipients.length === 0}
                    onClick={handleSelectReachableVisible}
                    className="min-h-[34px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Select Reachable ({filteredRecipients.filter((r) => !!r.formattedPhone && (!skipRecentAlerts || !r.recentlySent)).length})
                  </button>
                  <button
                    type="button"
                    disabled={sending || filteredRecipients.length === 0}
                    onClick={handleSelectVisible}
                    className="min-h-[34px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Select Visible ({filteredRecipients.length})
                  </button>
                  <button
                    type="button"
                    disabled={sending || recipients.length === 0}
                    onClick={handleSelectAboveThreshold}
                    className="min-h-[34px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Select ≥ {formatMWK(lowBalanceThresholdMWK)}
                  </button>
                  <button
                    type="button"
                    disabled={sending || selectedRecipients.length === 0}
                    onClick={handleClearSelection}
                    className="min-h-[34px] px-2.5 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={skipRecentAlerts}
                  disabled={sending}
                  onChange={(e) => setSkipRecentAlerts(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span>Skip guardians already alerted for the same balance in the last 24 hours</span>
              </label>

              {/* Checklist */}
              <div className="max-h-[340px] overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
                {filteredRecipients.length === 0 ? (
                  <div className="py-8 px-4 text-center text-xs text-slate-500 dark:text-slate-400">
                    No students with outstanding {termFilter} balances match your filter.
                  </div>
                ) : (
                  filteredRecipients.map((item) => {
                    const checked = selectedInvoiceIds.has(item.invoice.id);
                    const willSkipRecent = checked && item.formattedPhone && skipRecentAlerts && item.recentlySent;
                    const willSend = checked && !!item.formattedPhone && !willSkipRecent;

                    return (
                      <label
                        key={item.invoice.id}
                        className={`px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs cursor-pointer transition-colors ${
                          checked
                            ? 'bg-emerald-50/60 dark:bg-emerald-950/25'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-900/40'
                        }`}
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={sending}
                            onChange={() => toggleRecipient(item.invoice.id)}
                            className="mt-0.5 rounded border-slate-300 shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {item.studentName} · {item.formClass}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
                              {item.guardianName} ·{' '}
                              {item.formattedPhone ? (
                                item.formattedPhone
                              ) : (
                                <span className="text-rose-600 dark:text-rose-400">
                                  No valid +265 phone
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div className="font-mono tabular-nums font-semibold text-amber-700 dark:text-amber-400">
                            {formatMWK(item.balance)}
                          </div>
                          <div
                            className={`text-[11px] font-medium ${
                              !item.formattedPhone
                                ? 'text-rose-600 dark:text-rose-400'
                                : willSkipRecent
                                ? 'text-slate-400'
                                : willSend
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : item.recentlySent
                                ? 'text-slate-400'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {!item.formattedPhone
                              ? 'Unreachable'
                              : item.recentlySent && skipRecentAlerts
                              ? 'Alerted <24h'
                              : willSend
                              ? 'Ready'
                              : item.recentlySent
                              ? 'Alerted <24h'
                              : 'Not selected'}
                          </div>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>

              {(skippedMissingPhoneCount > 0 || skippedRecentCount > 0) && (
                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-2">
                  {skippedMissingPhoneCount > 0 && (
                    <span>
                      {skippedMissingPhoneCount} selected lack a valid +265 phone and will not be queued.
                    </span>
                  )}
                  {skippedRecentCount > 0 && (
                    <span>
                      {skippedRecentCount} alerted in the last 24h are excluded.
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Right Column: Automated Reminder Message Template & Preview */}
            <div className="lg:col-span-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  2. Automated Reminder Message
                </h3>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  Sender: {senderLabel}
                </span>
              </div>

              {/* Preset Buttons */}
              <div className="grid grid-cols-3 gap-1.5">
                {SMS_REMINDER_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={sending}
                    onClick={() => {
                      setPresetId(preset.id);
                      setTemplate(preset.template);
                    }}
                    className={`min-h-[38px] px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold text-left transition-colors cursor-pointer ${
                      presetId === preset.id
                        ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="block truncate">{preset.label}</span>
                  </button>
                ))}
              </div>

              <div>
                <label
                  htmlFor="bulk-sms-template"
                  className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
                >
                  Message Template (personalized per student)
                </label>
                <textarea
                  id="bulk-sms-template"
                  ref={textareaRef}
                  rows={5}
                  disabled={sending}
                  value={template}
                  onChange={(e) => {
                    setTemplate(e.target.value);
                    setPresetId('custom');
                  }}
                  placeholder="Write your automated fee payment reminder..."
                  className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 leading-relaxed"
                />
              </div>

              {/* Merge Variable Insertion Buttons */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Insert dynamic student/invoice fields:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {SMS_TEMPLATE_TOKENS.map((item) => (
                    <button
                      key={item.token}
                      type="button"
                      disabled={sending}
                      title={item.description}
                      onClick={() => handleInsertToken(item.token)}
                      className="min-h-[28px] px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 font-mono text-[11px] text-slate-700 dark:text-slate-300 cursor-pointer"
                    >
                      {item.token}
                    </button>
                  ))}
                </div>
              </div>

              {/* Live Personalized Preview */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200 min-w-0">
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      Preview{previewTarget ? `: ${previewTarget.studentName}` : ''}
                    </span>
                  </div>
                  {previewListLength > 1 && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        aria-label="Preview previous recipient"
                        onClick={() =>
                          setPreviewIdx((idx) => (idx - 1 + previewListLength) % previewListLength)
                        }
                        className="min-h-[26px] min-w-[26px] flex items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <span className="font-mono tabular-nums text-slate-500">
                        {Math.min(previewIdx + 1, previewListLength)}/{previewListLength}
                      </span>
                      <button
                        type="button"
                        aria-label="Preview next recipient"
                        onClick={() => setPreviewIdx((idx) => (idx + 1) % previewListLength)}
                        className="min-h-[26px] min-w-[26px] flex items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {previewRendered ? (
                  <>
                    <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed break-words">
                      {previewRendered.message}
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums pt-1 border-t border-slate-200/70 dark:border-slate-800">
                      <span
                        className={
                          previewRendered.wasTruncated
                            ? 'text-amber-700 dark:text-amber-400 font-semibold'
                            : 'text-slate-500 dark:text-slate-400'
                        }
                      >
                        {previewRendered.charCount}/320 chars · {previewRendered.segmentCount} SMS{' '}
                        {previewRendered.segmentCount === 1 ? 'part' : 'parts'}
                      </span>
                      {previewTarget?.formattedPhone && (
                        <span className="text-slate-500 dark:text-slate-400">
                          To: {previewTarget.formattedPhone}
                        </span>
                      )}
                    </div>
                    {previewRendered.wasTruncated && (
                      <div className="text-[11px] text-amber-700 dark:text-amber-300">
                        Rendered message exceeded 320 characters and will be trimmed to fit SMS gateway limits.
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Select a student to preview their personalized payment reminder.
                  </p>
                )}
              </div>
            </div>
          </div>

          {sending && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs font-medium text-emerald-900 dark:text-emerald-200">
                <span>{progressText || 'Dispatching bulk SMS reminders...'}</span>
                <span className="font-mono tabular-nums">{progressPct}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-emerald-100 dark:bg-emerald-950 overflow-hidden">
                <div
                  className="h-full bg-emerald-600 dark:bg-emerald-500 transition-all duration-200"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
            <span>
              Each sent reminder is logged to <span className="font-medium text-slate-700 dark:text-slate-200">SMS Alerts</span> for audit tracking.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={sending}
              onClick={onClose}
              className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={sending || sendableTargets.length === 0 || !template.trim()}
              onClick={handleSendBulkSms}
              className="inline-flex items-center gap-1.5 min-h-[42px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {sending
                  ? 'Sending Reminders...'
                  : `Send ${sendableTargets.length} Reminder${sendableTargets.length === 1 ? '' : 's'}`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
};
