import React from 'react';
import { ArrowRight, Moon, Sun } from 'lucide-react';
import { PWAInstallButton } from '../PWAInstallButton';

export type LoginIntent = 'admin' | 'staff' | 'student';

interface LandingPageProps {
  loginIntent: LoginIntent;
  onChangeLoginIntent: (intent: LoginIntent) => void;
  studentCodeInput: string;
  onChangeStudentCodeInput: (val: string) => void;
  verifyingStudentCode: boolean;
  signingIn: boolean;
  authError: string;
  onGoogleSignIn: () => void;
  onStudentCodeSignIn: (e: React.FormEvent) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  loginIntent,
  onChangeLoginIntent,
  studentCodeInput,
  onChangeStudentCodeInput,
  verifyingStudentCode,
  signingIn,
  authError,
  onGoogleSignIn,
  onStudentCodeSignIn,
  theme,
  onToggleTheme,
}) => {
  return (
    <div className="min-h-screen flex flex-col bg-[#F7F8FA] dark:bg-[#0D1117] text-slate-900 dark:text-slate-100">
      {/* Minimal Single-Row Header */}
      <header className="h-16 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/90 dark:bg-[#161B22]/90">
        <div className="max-w-5xl mx-auto h-full px-6 flex items-center justify-between gap-8">
          <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
            SecSchoolHub
          </span>

          <div className="flex items-center gap-2.5 shrink-0">
            <PWAInstallButton variant="header" />
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Moon className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Single-Screen Centered Split */}
      <main className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
          <div className="lg:col-span-6 space-y-5 text-center">
            <h1 className="text-3xl sm:text-4xl lg:text-[2.65rem] font-bold tracking-tight leading-[1.12] text-slate-900 dark:text-white text-balance">
              Manage your school in one place.
            </h1>

            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-md mx-auto">
              Student records, JCE &amp; MSCE exam grading, MWK fee ledgers, and school library
              circulation for administrators, staff, and students.
            </p>

            <div className="pt-2 text-xs text-slate-500 dark:text-slate-400">
              Head Teachers · Teachers &amp; HODs · Librarians · Bursars · Students
            </div>
          </div>

          <div className="lg:col-span-6 lg:pl-6">
            <div className="w-full max-w-md lg:mx-auto bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-7 space-y-5">
              <div
                role="tablist"
                aria-label="Portal sign-in role"
                className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900"
              >
                {(
                  [
                    { id: 'admin', label: 'Admin' },
                    { id: 'staff', label: 'Staff' },
                    { id: 'student', label: 'Student' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={loginIntent === tab.id}
                    onClick={() => onChangeLoginIntent(tab.id)}
                    className={`min-h-[38px] px-3 rounded-lg text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                      loginIntent === tab.id
                        ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="text-center">
                <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
                  {loginIntent === 'student'
                    ? 'Student Sign In'
                    : loginIntent === 'staff'
                    ? 'Staff & Librarian Sign In'
                    : 'School Admin Sign In'}
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {loginIntent === 'student'
                    ? 'Use the registration code issued by your school.'
                    : loginIntent === 'staff'
                    ? 'Teachers, Form Teachers, HODs, Librarians, and Bursars.'
                    : 'School administration and role oversight workspace.'}
                </p>
              </div>

              {authError && (
                <div
                  role="alert"
                  className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200"
                >
                  {authError}
                </div>
              )}

              {loginIntent === 'student' ? (
                <form onSubmit={onStudentCodeSignIn} className="space-y-4">
                  <div>
                    <label
                      htmlFor="student-reg-code-input"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                    >
                      Registration Code
                    </label>
                    <input
                      id="student-reg-code-input"
                      type="text"
                      required
                      maxLength={32}
                      autoComplete="off"
                      value={studentCodeInput}
                      onChange={(e) =>
                        onChangeStudentCodeInput(
                          e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '')
                        )
                      }
                      placeholder="e.g. F1A-2026-001"
                      className="w-full min-h-[46px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm tracking-wider uppercase text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={verifyingStudentCode}
                    className="w-full min-h-[46px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <span>
                      {verifyingStudentCode ? 'Verifying Code...' : 'Open Student Portal'}
                    </span>
                    {!verifyingStudentCode && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={onGoogleSignIn}
                  disabled={signingIn}
                  className="w-full min-h-[46px] px-4 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer whitespace-nowrap"
                >
                  <span>
                    {signingIn
                      ? 'Signing in...'
                      : loginIntent === 'staff'
                      ? 'Sign In with Staff Google Account'
                      : 'Continue with Google'}
                  </span>
                  {!signingIn && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
