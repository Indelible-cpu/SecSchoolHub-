import React, { useState } from 'react';
import { Download, Share, PlusSquare, MoreVertical, Smartphone, X, CheckCircle2 } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { ModalBackdrop } from './school/ModalBackdrop';

interface PWAInstallButtonProps {
  variant?: 'header' | 'card';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'header' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  const handleAction = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (!accepted) {
        return;
      }
      return;
    }
    setShowGuide(true);
  };

  if (variant === 'header') {
    return null;
  }

  return (
    <>
      {variant === 'header' ? (
        <button
          type="button"
          onClick={handleAction}
          className="inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:scale-[0.98] text-white text-xs font-semibold transition-all whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Install App</span>
        </button>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {isInstalled ? 'Installed on Device' : 'Install SecSchoolHub on Mobile'}
              </h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {isInstalled
                ? 'Running as a standalone offline-ready app on your device.'
                : 'Add SecSchoolHub to your home screen for instant offline school portal access.'}
            </p>
          </div>
          {isInstalled ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap shrink-0">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              Installed
            </span>
          ) : (
            <button
              type="button"
              onClick={handleAction}
              className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:scale-[0.98] text-white text-sm font-semibold transition-all whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 cursor-pointer"
            >
              <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{isInstallable ? 'Install Now' : 'How to Install'}</span>
            </button>
          )}
        </div>
      )}

      {showGuide && (
        <ModalBackdrop
          open={showGuide}
          onClose={() => setShowGuide(false)}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4"
          ariaLabelledBy="install-guide-title"
        >
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl">
            <div className="w-10 h-1 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mb-4 sm:hidden" />
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id="install-guide-title"
                  className="text-lg font-semibold text-slate-900 dark:text-slate-100"
                >
                  Install on Your Phone
                </h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  Use SecSchoolHub offline from your home screen with zero browser bars.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install instructions"
                className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              {isIOS ? (
                <div className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
                  <div className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                      1
                    </span>
                    <p className="leading-relaxed">
                      Open this page in <strong className="font-semibold text-slate-900 dark:text-white">Safari</strong> and tap the{' '}
                      <span className="inline-flex items-center gap-1 font-semibold text-slate-900 dark:text-white">
                        <Share className="w-3.5 h-3.5" aria-hidden="true" /> Share
                      </span>{' '}
                      button in the toolbar.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                      2
                    </span>
                    <p className="leading-relaxed">
                      Scroll down and tap{' '}
                      <span className="inline-flex items-center gap-1 font-semibold text-slate-900 dark:text-white">
                        <PlusSquare className="w-3.5 h-3.5" aria-hidden="true" /> Add to Home Screen
                      </span>
                      , then confirm <strong className="font-semibold text-slate-900 dark:text-white">Add</strong>.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
                  <div className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                      1
                    </span>
                    <p className="leading-relaxed">
                      On Android Chrome or Edge, open the browser menu{' '}
                      <span className="inline-flex items-center gap-0.5 font-semibold text-slate-900 dark:text-white">
                        (<MoreVertical className="w-3.5 h-3.5 inline" aria-hidden="true" />)
                      </span>{' '}
                      in the top corner.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                      2
                    </span>
                    <p className="leading-relaxed">
                      Tap <strong className="font-semibold text-slate-900 dark:text-white">Install app</strong> or{' '}
                      <strong className="font-semibold text-slate-900 dark:text-white">Add to Home screen</strong>.
                    </p>
                  </div>
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                    If you are on iPhone or iPad, open in Safari, tap Share, and select Add to Home Screen.
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-6 w-full min-h-[44px] rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer"
            >
              Done
            </button>
          </div>
        </ModalBackdrop>
      )}
    </>
  );
};
