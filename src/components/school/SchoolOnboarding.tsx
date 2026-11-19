import React, { useState } from 'react';
import { Building2, Sparkles, ArrowRight } from 'lucide-react';
import {
  MALAWI_DISTRICTS,
  SCHOOL_TYPES,
  TERMS,
  formatMWK,
  isGovernmentSchool,
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
  const [schoolType, setSchoolType] = useState<SchoolType>('Government Day');
  const [motto, setMotto] = useState('Knowledge and Service');
  const [academicYear, setAcademicYear] = useState('2026/2027');
  const [currentTerm, setCurrentTerm] = useState<TermName>('Term 2');
  const [tuitionStr, setTuitionStr] = useState('65000');
  const [gpfStr, setGpfStr] = useState('0');
  const [examFeeStr, setExamFeeStr] = useState('0');

  const [submitting, setSubmitting] = useState<'none' | 'create' | 'demo'>('none');
  const [formError, setFormError] = useState('');

  const govTuitionOnly = isGovernmentSchool(schoolType);

  const handleSchoolTypeChange = (nextType: SchoolType) => {
    setSchoolType(nextType);
    if (isGovernmentSchool(nextType)) {
      setGpfStr('0');
      setExamFeeStr('0');
    } else if (gpfStr === '0' && examFeeStr === '0') {
      setGpfStr('10000');
      setExamFeeStr('12000');
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
        defaultTuitionMWK: Number(tuitionStr) || 0,
        defaultGpfMWK: govTuitionOnly ? 0 : Number(gpfStr) || 0,
        defaultExamFeeMWK: govTuitionOnly ? 0 : Number(examFeeStr) || 0,
      });
      await onSchoolReady(schoolId);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to register school.');
    } finally {
      setSubmitting('none');
    }
  };

  const previewTotal =
    (Number(tuitionStr) || 0) +
    (govTuitionOnly ? 0 : (Number(gpfStr) || 0) + (Number(examFeeStr) || 0));

  return (
    <div className="max-w-4xl mx-auto py-6 sm:py-10 px-4">
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
              placeholder="e.g. Dedza Secondary School"
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
            />
          </div>

          <div>
            <label htmlFor="sch-district" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              District
            </label>
            <select
              id="sch-district"
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
            >
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
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
            >
              {SCHOOL_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
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
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
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
          {govTuitionOnly && (
            <div className="mb-3 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/35 border border-emerald-200/80 dark:border-emerald-900/60 px-3.5 py-2.5 text-xs text-emerald-900 dark:text-emerald-200">
              <strong>Malawi Government School Fee Policy:</strong> Government Day &amp; Boarding schools charge Tuition Fee only. GPF / Development and Exam / Lab fees are automatically waived at MK 0.
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="sch-tuition" className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                Tuition Fee (MK)
              </label>
              <input
                id="sch-tuition"
                type="number"
                min="0"
                value={tuitionStr}
                onChange={(e) => setTuitionStr(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="sch-gpf" className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                GPF / Development (MK){govTuitionOnly ? ' · Waived' : ''}
              </label>
              <input
                id="sch-gpf"
                type="number"
                min="0"
                disabled={govTuitionOnly}
                value={govTuitionOnly ? '0' : gpfStr}
                onChange={(e) => setGpfStr(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 disabled:opacity-55 disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label htmlFor="sch-exam" className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                Exam / Lab Fee (MK){govTuitionOnly ? ' · Waived' : ''}
              </label>
              <input
                id="sch-exam"
                type="number"
                min="0"
                disabled={govTuitionOnly}
                value={govTuitionOnly ? '0' : examFeeStr}
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
