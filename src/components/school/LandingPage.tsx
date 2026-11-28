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
  { id: 'students', label: 'Students', icon: Users },
  { id: 'staff', label: 'Staff', icon: GraduationCap },
  { id: 'grading', label: 'Grading', icon: Award },
  { id: 'fees', label: 'Fees', icon: Banknote },
  { id: 'library', label: 'Library', icon: BookOpen },
  { id: 'administration', label: 'Administration', icon: ShieldCheck },
] as const;

export const LandingPage: React.FC<LandingPageProps> = ({
  onNavigateToLogin,
  theme,
  onToggleTheme,
}) => {
  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-[#F7F8FA] dark:bg-[#0D1117] text-slate-900 dark:text-slate-100 transition-colors">
      {/* Header */}
      <header className="h-16 w-full border-b border-slate-200/80 dark:border-slate-800/80 bg-white/90 dark:bg-[#161B22]/90 sticky top-0 z-20 backdrop-blur-md">
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

      {/* Main Hero & Showcase */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-8 py-8 sm:py-12 flex flex-col justify-between gap-10">
        {/* Hero Header Area */}
        <div className="max-w-3xl mx-auto text-center space-y-4">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-slate-900 dark:text-white leading-[1.15] text-balance">
            Manage your school in one place.
          </h1>
          <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl mx-auto text-balance">
            One platform for student records, exam results, school finances and library management.
          </p>
        </div>

        {/* African School Photography Showcase Grid (5 Distinct Scenes) */}
        <section aria-label="School Life & Operations" className="w-full space-y-4 sm:space-y-5">
          {/* Top Row: Headteacher & Teacher */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 sm:gap-5">
            {/* Scene 1: Headteacher in executive office */}
            <div className="md:col-span-7 group relative overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 shadow-xs">
              <img
                src="/landing/headteacher.jpg"
                alt="Headteacher overseeing school operations from executive office"
                loading="eager"
                className="w-full h-56 sm:h-72 md:h-80 object-cover object-center group-hover:scale-[1.01] transition-transform duration-500 ease-out"
              />
            </div>

            {/* Scene 2: Teacher in office reviewing exam marks */}
            <div className="md:col-span-5 group relative overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 shadow-xs">
              <img
                src="/landing/teacher.jpg"
                alt="Teacher reviewing student examination papers and marksheet"
                loading="eager"
                className="w-full h-56 sm:h-72 md:h-80 object-cover object-center group-hover:scale-[1.01] transition-transform duration-500 ease-out"
              />
            </div>
          </div>

          {/* Bottom Row: Librarian, Digital Library Student, Physical Library Student */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5">
            {/* Scene 3: Librarian organizing books */}
            <div className="group relative overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 shadow-xs">
              <img
                src="/landing/librarian.jpg"
                alt="School librarian organizing and managing books in library"
                loading="lazy"
                className="w-full h-52 sm:h-60 md:h-64 object-cover object-center group-hover:scale-[1.01] transition-transform duration-500 ease-out"
              />
            </div>

            {/* Scene 4: Digital library student using smartphone */}
            <div className="group relative overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 shadow-xs">
              <img
                src="/landing/student-digital.jpg"
                alt="Secondary school student using smartphone to browse digital online library"
                loading="lazy"
                className="w-full h-52 sm:h-60 md:h-64 object-cover object-center group-hover:scale-[1.01] transition-transform duration-500 ease-out"
              />
            </div>

            {/* Scene 5: Physical library student reading book */}
            <div className="group relative overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 shadow-xs sm:col-span-2 md:col-span-1">
              <img
                src="/landing/student-reading.jpg"
                alt="Secondary school student reading physical book at study desk in school library"
                loading="lazy"
                className="w-full h-52 sm:h-60 md:h-64 object-cover object-center group-hover:scale-[1.01] transition-transform duration-500 ease-out"
              />
            </div>
          </div>
        </section>

        {/* Six Platform Modules - Slim Elegant Feature Strip */}
        <section aria-label="Platform Core Modules" className="w-full">
          <div className="w-full bg-white dark:bg-[#161B22] border border-slate-200/90 dark:border-slate-800 rounded-2xl p-3 sm:px-6 sm:py-4 shadow-xs">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 items-center">
              {PLATFORM_MODULES.map((item) => {
                const IconComponent = item.icon;
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-center sm:justify-start gap-2.5 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-300"
                  >
                    <IconComponent className="w-4 h-4 text-sky-500 dark:text-sky-400 shrink-0" aria-hidden="true" />
                    <span className="text-xs sm:text-sm font-semibold tracking-tight whitespace-nowrap">
                      {item.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      {/* Minimal Footer */}
      <footer className="w-full border-t border-slate-200/80 dark:border-slate-800/80 bg-white/70 dark:bg-[#161B22]/70 py-6 px-4 sm:px-8 text-center">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          &copy; {new Date().getFullYear()} SecSchoolHub. All rights reserved. Provisioned for secondary school administration, academic excellence, and student access.
        </p>
      </footer>
    </div>
  );
};
