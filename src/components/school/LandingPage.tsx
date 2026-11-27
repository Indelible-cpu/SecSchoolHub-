import React, { useState } from 'react';
import { ArrowRight, Eye, EyeOff, KeyRound, Lock, Mail, Moon, ShieldAlert, Sun } from 'lucide-react';
import { PWAInstallButton } from '../PWAInstallButton';
import { resetUserPassword } from '../../firebase';

export type LoginIntent = 'admin' | 'staff' | 'student';

interface LandingPageProps {
  loginIntent: LoginIntent;
  onChangeLoginIntent: (intent: LoginIntent) => void;
  studentCodeInput: string;
  onChangeStudentCodeInput: (val: string) => void;
  studentPasswordInput: string;
  onChangeStudentPasswordInput: (val: string) => void;
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
  studentPasswordInput,
  onChangeStudentPasswordInput,
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
  const [showStudentPassword, setShowStudentPassword] = useState(false);

  // Password Reset Flow
  const [isResetMode, setIsResetMode] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSuccess, setResetSuccess] = useState('');
  const [resetError, setResetError] = useState('');

  const handleEmailFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput.trim() || !passwordInput.trim()) return;
    if (isRegisterMode) {
      onEmailRegister(emailInput, passwordInput);
    } else {
      onEmailSignIn(emailInput, passwordInput);
    }
  };

  const handlePasswordResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEmail = resetEmail.trim() || emailInput.trim();
    if (!targetEmail) {
      setResetError('Please enter your school email address.');
      return;
    }
    setResetLoading(true);
    setResetError('');
    setResetSuccess('');
    try {
      await resetUserPassword(targetEmail);
      setResetSuccess(
        `A password reset link has been sent to ${targetEmail}. Please check your inbox and follow the instructions.`
      );
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/user-not-found') {
        setResetError('No registered account was found with this email address.');
      } else if (code === 'auth/invalid-email') {
        setResetError('Please enter a valid email address.');
      } else {
        setResetError(
          err instanceof Error ? err.message : 'Unable to send password reset link right now.'
        );
      }
    } finally {
      setResetLoading(false);
    }
  };

  const handleSwitchTab = (tabId: LoginIntent) => {
    onChangeLoginIntent(tabId);
    setIsRegisterMode(false);
    setIsResetMode(false);
    setResetSuccess('');
    setResetError('');
  };

  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-[#F7F8FA] dark:bg-[#0D1117] text-slate-900 dark:text-slate-100">
      {/* Minimal Single-Row Header */}
      <header className="h-16 w-full border-b border-slate-200/80 dark:border-slate-800/80 bg-white/90 dark:bg-[#161B22]/90">
        <div className="w-full h-full px-4 sm:px-8 flex items-center justify-between gap-8">
          <div className="flex items-center gap-2.5 shrink-0">
            <img
              src="/brand-logo.png"
              alt="SecSchoolHub logo"
              className="h-8 w-8 object-contain rounded-full border border-sky-400/30 shadow-xs"
            />
            <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
              SecSchoolHub
            </span>
          </div>

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
                    { id: 'admin', label: 'Head Teacher' },
                    { id: 'staff', label: 'Staff' },
                    { id: 'student', label: 'Student' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={loginIntent === tab.id}
                    onClick={() => handleSwitchTab(tab.id)}
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

              {/* Title & Subtitle */}
              <div className="text-center">
                <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
                  {loginIntent === 'student'
                    ? 'Student Sign In'
                    : isResetMode
                    ? 'Reset Password'
                    : isRegisterMode
                    ? 'Head Teacher Registration'
                    : loginIntent === 'staff'
                    ? 'Staff & Teacher Sign In'
                    : 'Head Teacher Sign In'}
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {loginIntent === 'student'
                    ? 'Enter your school Registration Code and Password / PIN.'
                    : isResetMode
                    ? 'Enter your institutional email to receive a password reset link.'
                    : isRegisterMode
                    ? 'Create your administrative password to register your school workspace.'
                    : loginIntent === 'staff'
                    ? 'Teachers, Form Teachers, HODs, Librarians, and Bursars.'
                    : 'School administration, Head Teacher oversight, and management workspace.'}
                </p>
              </div>

              {authError && !isResetMode && (
                <div
                  role="alert"
                  className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200"
                >
                  {authError}
                </div>
              )}

              {/* Reset Password Form Mode */}
              {isResetMode ? (
                <form onSubmit={handlePasswordResetSubmit} className="space-y-4">
                  {resetSuccess && (
                    <div
                      role="status"
                      className="rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 px-3.5 py-2.5 text-xs text-emerald-800 dark:text-emerald-200 leading-relaxed"
                    >
                      {resetSuccess}
                    </div>
                  )}

                  {resetError && (
                    <div
                      role="alert"
                      className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200"
                    >
                      {resetError}
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="reset-email-input"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Registered Email Address
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" aria-hidden="true" />
                      <input
                        id="reset-email-input"
                        type="email"
                        required
                        autoComplete="email"
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        placeholder="e.g. name@school.edu"
                        className="w-full min-h-[44px] pl-9.5 pr-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 dark:focus:border-slate-100"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={resetLoading}
                    className="w-full min-h-[44px] px-4 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer whitespace-nowrap"
                  >
                    <span>{resetLoading ? 'Sending Link...' : 'Send Password Reset Link'}</span>
                    {!resetLoading && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
                  </button>

                  <div className="text-center pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIsResetMode(false);
                        setResetSuccess('');
                        setResetError('');
                      }}
                      className="text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                    >
                      ← Back to Sign In
                    </button>
                  </div>
                </form>
              ) : loginIntent === 'student' ? (
                /* Student Registration Code & Password/PIN Sign-In */
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

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label
                        htmlFor="student-password-input"
                        className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                      >
                        Student Password / PIN
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowStudentPassword((prev) => !prev)}
                        className="text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                      >
                        {showStudentPassword ? (
                          <>
                            <EyeOff className="w-3.5 h-3.5" />
                            <span>Hide</span>
                          </>
                        ) : (
                          <>
                            <Eye className="w-3.5 h-3.5" />
                            <span>Show</span>
                          </>
                        )}
                      </button>
                    </div>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" aria-hidden="true" />
                      <input
                        id="student-password-input"
                        type={showStudentPassword ? 'text' : 'password'}
                        required
                        autoComplete="current-password"
                        value={studentPasswordInput}
                        onChange={(e) => onChangeStudentPasswordInput(e.target.value)}
                        placeholder="Enter password or Admission No."
                        className="w-full min-h-[46px] pl-9.5 pr-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
                      />
                    </div>
                    <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                      Default password is your school Admission Number (e.g. 2026/001). Once signed in, you can update your PIN anytime.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={verifyingStudentCode}
                    className="w-full min-h-[46px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <span>
                      {verifyingStudentCode ? 'Verifying Credentials...' : 'Open Student Portal'}
                    </span>
                    {!verifyingStudentCode && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
                  </button>
                </form>
              ) : (
                /* Head Teacher & Staff Sign-In Forms */
                <div className="space-y-4">
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
                      <div className="flex items-center justify-between mb-1">
                        <label
                          htmlFor="password-input"
                          className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                        >
                          Password
                        </label>
                        {!isRegisterMode && (
                          <button
                            type="button"
                            onClick={() => {
                              setResetEmail(emailInput);
                              setResetSuccess('');
                              setResetError('');
                              setIsResetMode(true);
                            }}
                            className="text-[11px] text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                          >
                            Forgot password?
                          </button>
                        )}
                      </div>
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

                    {isRegisterMode && loginIntent === 'admin' && (
                      <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 p-3 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
                        <ShieldAlert className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                        <span>
                          <strong>Institutional Verification:</strong> Only authorized Head Teachers and administrators may register. School profile verification is required before accessing records.
                        </span>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={signingIn}
                      className="w-full min-h-[44px] px-4 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer whitespace-nowrap"
                    >
                      <span>
                        {signingIn
                          ? 'Processing...'
                          : isRegisterMode
                          ? 'Register Head Teacher Account'
                          : 'Sign In'}
                      </span>
                      {!signingIn && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
                    </button>

                    {/* Registration is restricted for staff, only available for Head Teacher */}
                    {loginIntent === 'admin' ? (
                      <div className="text-center pt-1">
                        <button
                          type="button"
                          onClick={() => setIsRegisterMode((m) => !m)}
                          className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                        >
                          {isRegisterMode
                            ? 'Already have an account? Sign in'
                            : 'First time here? Register as Head Teacher'}
                        </button>
                      </div>
                    ) : (
                      /* Staff Institutional Access Security Notice */
                      <div className="pt-1.5 text-center">
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
                          Staff accounts are provisioned by the Head Teacher. If your email is not activated yet, contact your school administrator.
                        </p>
                      </div>
                    )}
                  </form>

                  {/* Clean Divider */}
                  <div className="relative flex py-1 items-center">
                    <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
                    <span className="flex-shrink mx-3 text-[11px] text-slate-400 font-medium">OR</span>
                    <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
                  </div>

                  {/* One-Click Google Sign-In */}
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
