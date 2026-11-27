import React, { useState } from 'react';
import { ArrowRight, Lock, Mail, Moon, Sun } from 'lucide-react';
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
  onEmailSignIn: (email: string, pass: string) => void;
  onEmailRegister: (email: string, pass: string) => void;
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
  onEmailSignIn,
  onEmailRegister,
  onStudentCodeSignIn,
  theme,
  onToggleTheme,
}) => {
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [isRegisterMode, setIsRegisterMode] = useState(false);

  const handleEmailFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput.trim() || !passwordInput.trim()) return;
    if (isRegisterMode) {
      onEmailRegister(emailInput, passwordInput);
    } else {
      onEmailSignIn(emailInput, passwordInput);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-[#F7F8FA] dark:bg-[#0D1117] text-slate-900 dark:text-slate-100">
      {/* Minimal Single-Row Header */}
      <header className="h-16 w-full border-b border-slate-200/80 dark:border-slate-800/80 bg-white/90 dark:bg-[#161B22]/90">
        <div className="w-full h-full px-4 sm:px-8 flex items-center justify-between gap-8">
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
      <main className="flex-1 w-full flex items-center justify-center px-4 sm:px-8 py-10">
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
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
                    onClick={() => {
                      onChangeLoginIntent(tab.id);
                      setIsRegisterMode(false);
                    }}
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
                    : isRegisterMode
                    ? loginIntent === 'staff'
                      ? 'Staff Account Registration'
                      : 'School Admin Registration'
                    : loginIntent === 'staff'
                    ? 'Staff & Librarian Sign In'
                    : 'School Admin Sign In'}
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {loginIntent === 'student'
                    ? 'Use the registration code issued by your school.'
                    : isRegisterMode
                    ? 'Create your password to manage your school workspace.'
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
                <div className="space-y-4">
                  {/* Standard Direct Email & Password Form (No popups, zero configuration) */}
                  <form onSubmit={handleEmailFormSubmit} className="space-y-3.5">
                    <div>
                      <label
                        htmlFor="email-input"
                        className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                      >
                        Email Address
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" aria-hidden="true" />
                        <input
                          id="email-input"
                          type="email"
                          required
                          autoComplete="email"
                          value={emailInput}
                          onChange={(e) => setEmailInput(e.target.value)}
                          placeholder="e.g. name@school.edu"
                          className="w-full min-h-[44px] pl-9.5 pr-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 dark:focus:border-slate-100"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="password-input"
                        className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                      >
                        Password
                      </label>
                      <div className="relative">
                        <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" aria-hidden="true" />
                        <input
                          id="password-input"
                          type="password"
                          required
                          minLength={6}
                          autoComplete={isRegisterMode ? 'new-password' : 'current-password'}
                          value={passwordInput}
                          onChange={(e) => setPasswordInput(e.target.value)}
                          placeholder="••••••••"
                          className="w-full min-h-[44px] pl-9.5 pr-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 dark:focus:border-slate-100"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={signingIn}
                      className="w-full min-h-[44px] px-4 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer whitespace-nowrap"
                    >
                      <span>
                        {signingIn
                          ? 'Processing...'
                          : isRegisterMode
                          ? 'Create Account'
                          : 'Sign In'}
                      </span>
                      {!signingIn && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
                    </button>

                    <div className="text-center pt-1">
                      <button
                        type="button"
                        onClick={() => setIsRegisterMode((m) => !m)}
                        className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                      >
                        {isRegisterMode
                          ? 'Already have an account? Sign in'
                          : "First time here? Create an account"}
                      </button>
                    </div>
                  </form>

                  {/* Clean Divider */}
                  <div className="relative flex py-1 items-center">
                    <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
                    <span className="flex-shrink mx-3 text-[11px] text-slate-400 font-medium">OR</span>
                    <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
                  </div>

                  {/* One-Click Google Sign-In with Synchronous User Gesture Binding */}
                  <button
                    type="button"
                    onClick={onGoogleSignIn}
                    disabled={signingIn}
                    className="w-full min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>
                    <span>Continue with Google</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
