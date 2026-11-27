import React, { useEffect } from 'react';
import { RotateCcw } from 'lucide-react';

interface ModalBackdropProps {
  open?: boolean;
  isOpen?: boolean;
  onClose: () => void;
  disabled?: boolean;
  className?: string;
  role?: 'dialog' | 'alertdialog';
  ariaLabelledBy?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}

/**
 * Accessible modal backdrop wrapper that closes cleanly when clicking outside
 * the dialog panel (via onMouseDown so text-selection drags inside the dialog
 * never trigger an accidental close) or pressing Escape.
 */
export const ModalBackdrop: React.FC<ModalBackdropProps> = ({
  open,
  isOpen,
  onClose,
  disabled = false,
  className = 'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4',
  role = 'dialog',
  ariaLabelledBy,
  ariaLabel,
  children,
}) => {
  const isModalOpen = open ?? isOpen ?? true;

  useEffect(() => {
    if (!isModalOpen || disabled) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, disabled, onClose]);

  if (!isModalOpen) return null;

  return (
    <div
      className={className}
      role={role}
      aria-modal="true"
      aria-labelledby={ariaLabelledBy}
      aria-label={ariaLabel}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !disabled) {
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
};

interface DraftRestoredNoticeProps {
  visible: boolean;
  onDiscard: () => void;
  label?: string;
}

export const DraftRestoredNotice: React.FC<DraftRestoredNoticeProps> = ({
  visible,
  onDiscard,
  label = 'Saved draft restored from your previous session — continue where you left off.',
}) => {
  if (!visible) return null;
  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-900/70 bg-amber-50/80 dark:bg-amber-950/40 px-3 py-2 flex items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200">
      <span>{label}</span>
      <button
        type="button"
        onClick={onDiscard}
        className="inline-flex items-center gap-1 font-semibold text-amber-800 dark:text-amber-300 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
      >
        <RotateCcw className="w-3 h-3" aria-hidden="true" />
        <span>Discard</span>
      </button>
    </div>
  );
};
