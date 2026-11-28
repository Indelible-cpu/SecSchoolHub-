import React from 'react';
import {
  Award,
  Banknote,
  BookOpen,
  GraduationCap,
  LogIn,
  Moon,
  ShieldCheck,
  Sun,
  Users,
} from 'lucide-react';

interface LandingPageProps {
  onNavigateToLogin: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

const PLATFORM_MODULES = [
  { id: 'students', label: 'Students', icon: Users, desc: 'Enrolment & Profiles' },
  { id: 'staff', label: 'Staff', icon: GraduationCap, desc: 'Teachers & Timebook' },
  { id: 'grading', label: 'Grading', icon: Award, desc: 'CA & Exam Marksheets' },
  { id: 'fees', label: 'Fees', icon: Banknote, desc: 'Ledgers & Invoicing' },
  { id: 'library', label: 'Library', icon: BookOpen, desc: 'Circulation & E-Books' },
  { id: 'administration', label: 'Administration', icon: ShieldCheck, desc: 'Security & Oversight' },
] as const;

export const LandingPage: React.FC<LandingPageProps> = ({
  onNavigateToLogin,
  theme,
  onToggleTheme,
}) => {
  return (
    <div className="h-[100dvh] w-full flex flex-col justify-between bg-[#F7F8FA] dark:bg-[#0D1117] text-slate-900 dark:text-slate-100 overflow-hidden select-none">
      {/* Top Header */}
      <header className="h-16 w-full border-b border-slate-200/80 dark:border-slate-800/80 bg-white/90 dark:bg-[#161B22]/90 shrink-0 backdrop-blur-md">
        <div className="w-full max-w-7xl mx-auto h-full px-4 sm:px-8 flex items-center justify-between gap-4">
          {/* Brand Logo & Name */}
          <div className="flex items-center gap-2.5 shrink-0">
            <img
              src="/brand-logo.png"
              alt="SecSchoolHub logo"
              className="h-8 w-8 object-contain rounded-full border border-sky-400/30 shadow-xs"
            />
            <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
              SecSchool<span className="text-sky-500 dark:text-sky-400">Hub</span>
            </span>
          </div>

          {/* Top-Right Corner Actions: Theme Toggle & Single Sign In Button */}
          <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Moon className="w-4 h-4" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              onClick={onNavigateToLogin}
              className="min-h-[38px] px-4 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs sm:text-sm font-semibold inline-flex items-center gap-2 hover:opacity-90 transition-opacity cursor-pointer whitespace-nowrap shadow-xs"
            >
              <LogIn className="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
              <span>Sign In</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Single-Page Content Area */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-8 flex flex-col justify-center items-center gap-8 md:gap-12 py-4">
        {/* Hero Section */}
        <div className="max-w-3xl mx-auto text-center space-y-4">
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold tracking-tight text-slate-900 dark:text-white leading-[1.12] text-balance">
            Manage your school in one place.
          </h1>
          <p className="text-sm sm:text-base md:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl mx-auto text-balance">
            One platform for student records, exam results, school finances, library management and administration.
          </p>
        </div>

        {/* Six Platform Modules Strip */}
        <div className="w-full max-w-4xl">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-3.5">
            {PLATFORM_MODULES.map((item) => {
              const IconComponent = item.icon;
              return (
                <div
                  key={item.id}
                  className="flex flex-col items-center text-center p-3 sm:p-4 rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200/90 dark:border-slate-800 shadow-xs hover:border-sky-300 dark:hover:border-sky-700/60 transition-colors"
                >
                  <div className="h-9 w-9 rounded-xl bg-sky-50 dark:bg-sky-950/50 flex items-center justify-center text-sky-600 dark:text-sky-400 mb-2">
                    <IconComponent className="w-4 h-4" aria-hidden="true" />
                  </div>
                  <span className="text-xs sm:text-sm font-bold tracking-tight text-slate-900 dark:text-white">
                    {item.label}
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 hidden sm:block">
                    {item.desc}
                  </span>
                </div>
              );
            })}
          </div>
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
