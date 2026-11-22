import React, { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { ModalBackdrop } from './ModalBackdrop';

interface ConfirmDeleteModalProps {
  open: boolean;
  title: string;
  itemName: string;
  description: string;
  warningNote?: string;
  requireKeyword?: string;
  confirmLabel?: string;
  deleting?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}

export const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({
  open,
  title,
  itemName,
  description,
  warningNote,
  requireKeyword,
  confirmLabel = 'Confirm Delete',
  deleting = false,
  error = '',
  onCancel,
  onConfirm,
}) => {
  const [typedKeyword, setTypedKeyword] = useState('');

  useEffect(() => {
    if (open) {
      setTypedKeyword('');
    }
  }, [open, itemName]);

  if (!open) return null;

  const keywordSatisfied =
    !requireKeyword || typedKeyword.trim().toUpperCase() === requireKeyword.toUpperCase();

  return (
    <ModalBackdrop
      open={open}
      onClose={onCancel}
      disabled={deleting}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4"
      ariaLabelledBy="confirm-delete-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-rose-50 dark:bg-rose-950/60 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0">
              <AlertTriangle className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="confirm-delete-title"
                className="text-base font-semibold text-slate-900 dark:text-white"
              >
                {title}
              </h2>
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mt-0.5 truncate max-w-[260px]">
                {itemName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            aria-label="Close confirmation dialog"
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          {description}
        </p>

        {warningNote && (
          <div className="rounded-xl bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/70 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
            {warningNote}
          </div>
        )}

        {requireKeyword && (
          <div>
            <label
              htmlFor="confirm-delete-keyword"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Type <span className="font-mono font-bold text-rose-600 dark:text-rose-400">{requireKeyword}</span> to confirm permanent removal
            </label>
            <input
              id="confirm-delete-keyword"
              type="text"
              autoComplete="off"
              value={typedKeyword}
              onChange={(e) => setTypedKeyword(e.target.value)}
              placeholder={requireKeyword}
              className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm text-slate-900 dark:text-white focus:outline-none focus:border-rose-500"
            />
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
            {error}
          </div>
        )}

        <div className="pt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting || !keywordSatisfied}
            className="min-h-[42px] px-5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold disabled:opacity-40 cursor-pointer transition-colors"
          >
            {deleting ? 'Deleting...' : confirmLabel}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
};
