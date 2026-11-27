import React, { useState } from 'react';
import { Building2, Sparkles, ArrowRight, CheckCircle2 } from 'lucide-react';
import {
  MALAWI_DISTRICTS,
  SCHOOL_TYPES,
  TERMS,
  formatMWK,
} from '../../school/malawi';
import { SchoolType, TermName } from '../../school/types';
import { createSchoolWorkspace, seedDemoMalawiSchool } from '../../school/firestoreService';

interface SchoolOnboardingProps {
  ownerId: string;
  ownerDisplayName: string;
  ownerEmail: string;
  onSchoolReady: (schoolId: string) => Promise<void>;
  onCancel?: () => void;
}

export const SchoolOnboarding: React.FC<SchoolOnboardingProps> = ({
  ownerId,
  ownerDisplayName,
  ownerEmail,
  onSchoolReady,
  onCancel,
}) => {
  const [name, setName] = useState('');
  const [district, setDistrict] = useState('Lilongwe');
  const [schoolType, setSchoolType] = useState<SchoolType>('Community Day');
  const [motto, setMotto] = useState('Knowledge and Service');
  const [academicYear, setAcademicYear] = useState('2026/2027');
  const [currentTerm, setCurrentTerm] = useState<TermName>('Term 2');

  // Malawi Policy: Community Day Secondary Schools (CDSS) & Government Day schools are 100% tuition-free & exam-free
  const [tuitionStr, setTuitionStr] = useState('0');
  const [gpfStr, setGpfStr] = useState('0');
  const [examFeeStr, setExamFeeStr] = useState('0');

  const [submitting, setSubmitting] = useState<'none' | 'create' | 'demo'>('none');
  const [formError, setFormError] = useState('');

  const isGovDay = schoolType === 'Community Day' || schoolType === 'Government Day';
  const isGovBoarding = schoolType === 'Government Boarding';
  const isPublicSchool = isGovDay || isGovBoarding;

  const handleSchoolTypeChange = (nextType: SchoolType) => {
    setSchoolType(nextType);
    if (nextType === 'Community Day' || nextType === 'Government Day') {
      // Community Day Sec Schools (CDSS) and Govt Day are completely free
      setTuitionStr('0');
      setGpfStr('0');
      setExamFeeStr('0');
    } else if (nextType === 'Government Boarding') {
      // Tuition and exams are free; boarding upkeep fee applies
      setTuitionStr('0');
      setGpfStr('65000'); // Boarding / Catering Upkeep Fee
      setExamFeeStr('0'); // National exams free
    } else if (nextType === 'Grant-Aided') {
      setTuitionStr('35000');
      setGpfStr('15000');
      setExamFeeStr('0');
    } else {
      // Private Secondary School
      setTuitionStr('95000');
      setGpfStr('20000');
      setExamFeeStr('15000');
    }
  };

  const handleLoadDemo = async () => {
    setFormError('');
    setSubmitting('demo');
    try {
      const schoolId = await seedDemoMalawiSchool(ownerId);
      await onSchoolReady(schoolId);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to create sample school.');
    } finally {
      setSubmitting('none');
    }
  };

  const handleCreateCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      setFormError('Please enter the secondary school name.');
      return;
    }
    if (!district) {
      setFormError('Please select a district for your school.');
      return;
    }
    setFormError('');
    setSubmitting('create');
    try {
      const schoolId = await createSchoolWorkspace({
        ownerId,
        ownerDisplayName,
        ownerEmail,
        name: name.trim(),
        district,
        schoolType,
        motto: motto.trim(),
        academicYear: academicYear.trim() || '2026/2027',
        currentTerm,
        defaultTuitionMWK: isPublicSchool ? 0 : Number(tuitionStr) || 0,
        defaultGpfMWK: isGovDay ? 0 : Number(gpfStr) || 0,
        defaultExamFeeMWK: isPublicSchool ? 0 : Number(examFeeStr) || 0,
      });
      await onSchoolReady(schoolId);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to register school.');
    } finally {
      setSubmitting('none');
    }
  };

  const previewTotal =
    (isPublicSchool ? 0 : Number(tuitionStr) || 0) +
    (isGovDay ? 0 : Number(gpfStr) || 0) +
    (isPublicSchool ? 0 : Number(examFeeStr) || 0);

  return (
    <div className="w-full py-6 sm:py-8 px-4 sm:px-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            Set Up Your Secondary School
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Configure a Malawi secondary school workspace with Form 1–4 Exam grading and MWK fee ledgers.
          </p>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[40px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Quick Start Sample School Card */}
      <div className="mb-6 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Sparkles className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
            <span>Load Sample Malawi Secondary School</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-xl">
            Creates Chilambula Secondary School (Lilongwe) pre-populated with Form 1–4 students,
            teachers, Exam JCE/MSCE marks, Airtel Money / Mpamba fee receipts, and attendance so you can explore right away.
          </p>
        </div>
        <button
          type="button"
          onClick={handleLoadDemo}
          disabled={submitting !== 'none'}
          className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-sm font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer"
        >
          <span>{submitting === 'demo' ? 'Creating School...' : 'Load Sample School'}</span>
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {/* Custom School Registration Form */}
      <form
        onSubmit={handleCreateCustom}
        className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5"
      >
        <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100 dark:border-slate-800">
          <Building2 className="w-4 h-4 text-slate-500" aria-hidden="true" />
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Or Register Your Own School
          </h2>
        </div>

        {formError && (
          <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-4 py-3 text-xs text-rose-800 dark:text-rose-200">
            {formError}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label htmlFor="sch-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Secondary School Name
            </label>
            <input
              id="sch-name"
              type="text"
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Dedza Secondary School, Nkhotakota CDSS"
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
            />
          </div>

          <div>
            <label htmlFor="sch-district" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              District (All 28 Districts of Malawi)
            </label>
            <select
              id="sch-district"
              required
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 cursor-pointer"
            >
              <option value="" disabled>-- Select School District --</option>
              {MALAWI_DISTRICTS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="sch-type" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              School Category
            </label>
            <select
              id="sch-type"
              value={schoolType}
              onChange={(e) => handleSchoolTypeChange(e.target.value as SchoolType)}
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 cursor-pointer"
            >
              {SCHOOL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t === 'Community Day' ? 'Community Day (CDSS)' : t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="sch-year" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Academic Year
            </label>
            <input
              id="sch-year"
              type="text"
              maxLength={20}
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
            />
          </div>

          <div>
            <label htmlFor="sch-term" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Active Term
            </label>
            <select
              id="sch-term"
              value={currentTerm}
              onChange={(e) => setCurrentTerm(e.target.value as TermName)}
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 cursor-pointer"
            >
              {TERMS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="sch-motto" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              School Motto
            </label>
            <input
              id="sch-motto"
              type="text"
              maxLength={140}
              value={motto}
              onChange={(e) => setMotto(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Default Term Fee Structure (Malawi Kwacha)
            </span>
            <span className="text-xs font-mono tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold">
              Total / Term: {formatMWK(previewTotal)}
            </span>
          </div>

          {/* Malawi Secondary School Free Education Policy Banner */}
          {isGovDay && (
            <div className="mb-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 p-3.5 space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-900 dark:text-emerald-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
                <span>Malawi Government Policy: 100% Free Secondary Education</span>
              </div>
              <p className="text-xs text-emerald-800 dark:text-emerald-300 leading-relaxed">
                In all Community Day Secondary Schools (CDSS) and Government Day secondary schools, <strong>Tuition Fee</strong>, <strong>National Examinations (MANEB)</strong>, <strong>Science Lab &amp; Library</strong>, and <strong>GPF</strong> are completely <strong>FREE (MK 0)</strong>.
              </p>
            </div>
          )}

          {isGovBoarding && (
            <div className="mb-4 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 p-3.5 space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-blue-900 dark:text-blue-200">
                <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
                <span>Malawi Government Boarding School Policy</span>
              </div>
              <p className="text-xs text-blue-800 dark:text-blue-300 leading-relaxed">
                Tuition, national exams, library, and GPF are <strong>FREE (MK 0)</strong>. Only the <strong>Boarding &amp; Catering Upkeep Fee</strong> is payable by boarding students.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="sch-tuition" className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                Tuition Fee (MK){isPublicSchool ? ' · Free (Govt)' : ''}
              </label>
              <input
                id="sch-tuition"
                type="number"
                min="0"
                disabled={isPublicSchool}
                value={isPublicSchool ? '0' : tuitionStr}
                onChange={(e) => setTuitionStr(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 disabled:opacity-55 disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label htmlFor="sch-gpf" className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                {isGovBoarding ? 'Boarding Fee (MK)' : isGovDay ? 'GPF / Lab / Library (Free)' : 'GPF / Development (MK)'}
              </label>
              <input
                id="sch-gpf"
                type="number"
                min="0"
                disabled={isGovDay}
                value={isGovDay ? '0' : gpfStr}
                onChange={(e) => setGpfStr(e.target.value)}
                placeholder={isGovBoarding ? '65000' : '0'}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 disabled:opacity-55 disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label htmlFor="sch-exam" className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                Exam Fee (MK){isPublicSchool ? ' · Free (Govt)' : ''}
              </label>
              <input
                id="sch-exam"
                type="number"
                min="0"
                disabled={isPublicSchool}
                value={isPublicSchool ? '0' : examFeeStr}
                onChange={(e) => setExamFeeStr(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 disabled:opacity-55 disabled:cursor-not-allowed"
              />
            </div>
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            disabled={submitting !== 'none'}
            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-6 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer"
          >
            {submitting === 'create' ? 'Registering...' : 'Create School Workspace'}
          </button>
        </div>
      </form>
    </div>
  );
};
