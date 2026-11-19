import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 md:bottom-5 left-4 right-4 md:left-auto md:right-6 z-40 flex items-center justify-center md:justify-start gap-2 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-4 py-2.5 text-xs font-medium shadow-lg"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0 text-amber-400 dark:text-amber-600" aria-hidden="true" />
      <span>Offline mode active — all calculators &amp; saved ledger work without internet.</span>
    </div>
  );
};
