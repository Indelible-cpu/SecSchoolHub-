import React from 'react';
import { GraduationCap } from 'lucide-react';

interface SecSchoolHubLoaderProps {
  message?: string;
  subMessage?: string;
}

export const SecSchoolHubLoader: React.FC<SecSchoolHubLoaderProps> = ({
  message = 'Connecting to school portal...',
  subMessage = 'Malawi Secondary Education Portal',
}) => {
  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center justify-center bg-[#F7F8FA] dark:bg-[#0D1117] text-slate-900 dark:text-slate-100 p-6 select-none transition-colors">
      <div className="flex flex-col items-center max-w-sm w-full text-center space-y-4">
        {/* Animated Brand Badge */}
        <div className="relative flex items-center justify-center">
          <div className="absolute inset-0 rounded-2xl bg-emerald-500/25 blur-xl animate-pulse" />
          <div className="relative h-16 w-16 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center text-white shadow-lg shadow-emerald-700/25 border border-emerald-400/30">
            <GraduationCap className="w-8 h-8 drop-shadow-sm" aria-hidden="true" />
          </div>
        </div>

        {/* Wordmark */}
        <div className="space-y-1">
          <div className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white flex items-center justify-center gap-0.5">
            <span>SecSchool</span>
            <span className="text-emerald-700 dark:text-emerald-400">Hub</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium tracking-wide">
            {subMessage}
          </p>
        </div>

        {/* Robustic Forth & Back Slider */}
        <div className="w-56 space-y-2 pt-2">
          <div className="relative h-1.5 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden shadow-inner">
            <div className="absolute top-0 bottom-0 rounded-full bg-gradient-to-r from-emerald-600 via-emerald-400 to-teal-300 shadow-[0_0_12px_rgba(16,185,129,0.7)] animate-forth-and-back" />
          </div>
          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            {message}
          </div>
        </div>
      </div>
    </div>
  );
};
