import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, Lock, Mail, Moon, Sun } from 'lucide-react';
import { resetUserPassword } from '../../firebase';

interface LoginPageProps {
  signingIn: boolean;
  authError: string;
  onSignIn: (identifier: string, pass: string) => void;
  onNavigateToLanding: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  signingIn,
  authError,
  onSignIn,
  onNavigateToLanding,
  theme,
  onToggleTheme,
}) => {
  const [identifierInput, setIdentifierInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Password Reset Flow
  const [isResetMode, setIsResetMode] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSuccess, setResetSuccess] = useState('');
  const [resetError, setResetError] = useState('');

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifierInput.trim() || !passwordInput.trim()) return;
    onSignIn(identifierInput.trim(), passwordInput.trim());
  };

  const handlePasswordResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEmail = resetEmail.trim() || (identifierInput.includes('@') ? identifierInput.trim() : '');
    if (!targetEmail) {
      setResetError('Please enter your registered school email address.');
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

  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-[#F7F8FA] dark:bg-[#0D1117] text-slate-900 dark:text-slate-100">
      {/* Top Header */}
      <header className="h-16 w-full border-b border-slate-200/80 dark:border-slate-800/80 bg-white/90 dark:bg-[#161B22]/90 sticky top-0 z-20 backdrop-blur-md">
        <div className="w-full max-w-7xl mx-auto h-full px-4 sm:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onNavigateToLanding}
              className="flex items-center gap-2.5 text-left group cursor-pointer focus:outline-none"
              title="Return to Home"
            >
              <img
                src="/brand-logo.png"
                alt="SecSchoolHub logo"
                className="h-8 w-8 object-contain rounded-full border border-sky-400/30 shadow-xs"
              />
              <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
                SecSchool<span className="text-sky-500 dark:text-sky-400">Hub</span>
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
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

            <button
              type="button"
              onClick={onNavigateToLanding}
              className="min-h-[38px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Back to Home</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Centered Login Section */}
      <main className="flex-1 w-full flex items-center justify-center px-4 sm:px-6 py-12 sm:py-16">
        <div className="w-full max-w-md bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-sm">
          {/* Header Title & Subtitle */}
          <div className="text-center space-y-1.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {isResetMode ? 'Reset Password' : 'Sign In'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              {isResetMode
                ? 'Enter your institutional email to receive a password reset link.'
                : 'Enter your credentials to access your portal.'}
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

          {/* Password Reset Form */}
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
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Email Address
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
                  className="text-xs font-medium text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300 transition-colors cursor-pointer"
                >
                  ← Back to Sign In
                </button>
              </div>
            </form>
          ) : (
            /* Dedicated Portal Sign-In Form */
            <form onSubmit={handleFormSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="identifier-input"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" aria-hidden="true" />
                  <input
                    id="identifier-input"
                    type="text"
                    required
                    autoComplete="username"
                    value={identifierInput}
                    onChange={(e) => setIdentifierInput(e.target.value)}
                    placeholder="e.g. name@school.edu"
                    className="w-full min-h-[44px] pl-9.5 pr-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 dark:focus:border-slate-100"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="password-input"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setResetEmail(identifierInput.includes('@') ? identifierInput.trim() : '');
                      setResetSuccess('');
                      setResetError('');
                      setIsResetMode(true);
                    }}
                    className="text-[11px] font-medium text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300 transition-colors cursor-pointer"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" aria-hidden="true" />
                  <input
                    id="password-input"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder="••••••••"
                    className="w-full min-h-[44px] pl-9.5 pr-10 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 dark:focus:border-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-3 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={signingIn}
                className="w-full min-h-[44px] px-4 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer whitespace-nowrap shadow-xs"
              >
                <span>{signingIn ? 'Signing in...' : 'Sign In'}</span>
                {!signingIn && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
              </button>

              <div className="pt-2 text-center">
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
                  Credentials are secure and provisioned by your school administration.
                </p>
              </div>
            </form>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-slate-200/80 dark:border-slate-800/80 bg-white/70 dark:bg-[#161B22]/70 py-4 px-4 sm:px-8 text-center shrink-0">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          &copy; {new Date().getFullYear()} SecSchoolHub. All rights reserved. &bull; Powered by{' '}
          <span className="font-semibold text-slate-800 dark:text-slate-200">Indelible Technologies</span>
        </p>
      </footer>
    </div>
  );
};
