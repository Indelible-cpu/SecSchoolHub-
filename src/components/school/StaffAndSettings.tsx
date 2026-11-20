import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Check,
  X,
  Building2,
  Pencil,
  ShieldCheck,
  BookOpen,
  Sparkles,
} from 'lucide-react';
import {
  FormLevel,
  School,
  SchoolSubject,
  SchoolType,
  Teacher,
  TeacherRole,
  TermName,
} from '../../school/types';
import {
  DEFAULT_MALAWI_SUBJECT_PRESETS,
  FORM_LEVELS,
  isGovernmentSchool,
  MALAWI_DISTRICTS,
  MALAWI_SUBJECTS,
  SCHOOL_TYPES,
  TERMS,
} from '../../school/malawi';
import {
  removeSchoolSubject,
  removeTeacher,
  saveSchoolSubject,
  saveTeacher,
  SchoolSubjectPayload,
  seedDefaultSchoolSubjects,
  TeacherPayload,
  updateSchoolSettings,
} from '../../school/firestoreService';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';

interface StaffAndSettingsProps {
  school: School;
  schools: School[];
  ownerId: string;
  teachers: Teacher[];
  schoolSubjects: SchoolSubject[];
  canManageStaffAndSettings?: boolean;
  onSwitchSchool: (schoolId: string) => void;
  onAddNewSchool?: () => void;
}

const TEACHER_ROLES: TeacherRole[] = [
  'Head Teacher',
  'Deputy Head',
  'Head of Department',
  'Form Master',
  'Subject Teacher',
  'School Librarian',
  'School Bursar',
];

function getRoleDisplayLabel(role: TeacherRole): string {
  if (role === 'Form Master') return 'Form Master (Form Teacher)';
  if (role === 'Head of Department') return 'Head of Department (HOD)';
  return role;
}

function getRoleAccessSummary(role: TeacherRole): string {
  if (role === 'Head Teacher') return 'Full Academics, Attendance, Library & Bursar Access';
  if (role === 'Deputy Head') return 'Students, Marks, Attendance, Library & Staff Directory';
  if (role === 'Head of Department') return 'HOD: Department Subjects, Marks, Attendance & Library';
  if (role === 'Form Master') return 'Form Teacher: Class Roster, Daily Attendance, Marks & Library';
  if (role === 'School Librarian') return 'School Library Circulation, Analytics & Student Borrower Lookup (no marks/fees)';
  if (role === 'School Bursar') return 'Bursar Fee Ledger (MWK) & Student Lookup';
  return 'Subject Teacher: Exam Marks Gradebook, Roll Call & Library';
}

export const StaffAndSettings: React.FC<StaffAndSettingsProps> = ({
  school,
  schools,
  ownerId,
  teachers,
  schoolSubjects,
  canManageStaffAndSettings = true,
  onSwitchSchool,
  onAddNewSchool,
}) => {
  // School Settings Form
  const [name, setName] = useState(school.name);
  const [district, setDistrict] = useState(school.district);
  const [schoolType, setSchoolType] = useState<SchoolType>(school.schoolType);
  const [motto, setMotto] = useState(school.motto);
  const [academicYear, setAcademicYear] = useState(school.academicYear);
  const [currentTerm, setCurrentTerm] = useState<TermName>(school.currentTerm);
  const [tuition, setTuition] = useState(String(school.defaultTuitionMWK));
  const [gpf, setGpf] = useState(
    isGovernmentSchool(school.schoolType) ? '0' : String(school.defaultGpfMWK)
  );
  const [examFee, setExamFee] = useState(
    isGovernmentSchool(school.schoolType) ? '0' : String(school.defaultExamFeeMWK)
  );
  const [savingSettings, setSavingSettings] = useState(false);
  const [savedSettingsFlash, setSavedSettingsFlash] = useState(false);

  // Keep settings synced when switching between school workspaces
  useEffect(() => {
    setName(school.name);
    setDistrict(school.district);
    setSchoolType(school.schoolType);
    setMotto(school.motto);
    setAcademicYear(school.academicYear);
    setCurrentTerm(school.currentTerm);
    setTuition(String(school.defaultTuitionMWK));
    setGpf(isGovernmentSchool(school.schoolType) ? '0' : String(school.defaultGpfMWK));
    setExamFee(isGovernmentSchool(school.schoolType) ? '0' : String(school.defaultExamFeeMWK));
  }, [school]);

  // Add / Edit Teacher Modal
  const [teacherModalOpen, setTeacherModalOpen] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);
  const [tForm, setTForm] = useState<TeacherPayload>({
    staffCode: '',
    fullName: '',
    roleTitle: 'Subject Teacher',
    subjects: ['English'],
    assignedForm: 'Form 1A',
    phone: '+265 ',
    staffEmail: '',
    status: 'Active',
  });
  const [savingTeacher, setSavingTeacher] = useState(false);
  const [teacherFormError, setTeacherFormError] = useState('');

  // Safe Delete Teacher Modal
  const [confirmTeacher, setConfirmTeacher] = useState<Teacher | null>(null);
  const [deletingTeacher, setDeletingTeacher] = useState(false);
  const [deleteTeacherError, setDeleteTeacherError] = useState('');

  // Curriculum Subjects & Form Assignments State
  const [subjectFormFilter, setSubjectFormFilter] = useState<'all' | FormLevel>('all');
  const [subjectModalOpen, setSubjectModalOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<SchoolSubject | null>(null);
  const [subForm, setSubForm] = useState<SchoolSubjectPayload>({
    name: '',
    code: '',
    formLevels: [1, 2, 3, 4],
    isCore: false,
  });
  const [savingSubject, setSavingSubject] = useState(false);
  const [subjectFormError, setSubjectFormError] = useState('');
  const [togglingSubjectId, setTogglingSubjectId] = useState<string | null>(null);
  const [seedingSubjects, setSeedingSubjects] = useState(false);
  const [subjectNotice, setSubjectNotice] = useState('');
  const [confirmSubject, setConfirmSubject] = useState<SchoolSubject | null>(null);
  const [deletingSubject, setDeletingSubject] = useState(false);
  const [deleteSubjectError, setDeleteSubjectError] = useState('');

  const selectableTeacherSubjects = useMemo(() => {
    const names = new Set<string>([
      ...MALAWI_SUBJECTS,
      ...schoolSubjects.map((s) => s.name),
    ]);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [schoolSubjects]);

  const missingDefaultsCount = useMemo(() => {
    const existing = new Set(schoolSubjects.map((s) => s.name.trim().toLowerCase()));
    return DEFAULT_MALAWI_SUBJECT_PRESETS.filter(
      (p) => !existing.has(p.name.trim().toLowerCase())
    ).length;
  }, [schoolSubjects]);

  const filteredSubjects = useMemo(() => {
    if (subjectFormFilter === 'all') return schoolSubjects;
    return schoolSubjects.filter((s) => s.formLevels.includes(subjectFormFilter));
  }, [schoolSubjects, subjectFormFilter]);

  const govTuitionOnly = isGovernmentSchool(schoolType);

  const handleSchoolTypeChange = (nextType: SchoolType) => {
    setSchoolType(nextType);
    if (isGovernmentSchool(nextType)) {
      setGpf('0');
      setExamFee('0');
    }
  };

  const handleSaveSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageStaffAndSettings) return;
    setSavingSettings(true);
    try {
      await updateSchoolSettings(
        school.id,
        {
          name: name.trim(),
          district,
          schoolType,
          motto: motto.trim(),
          academicYear: academicYear.trim(),
          currentTerm,
          defaultTuitionMWK: Number(tuition) || 0,
          defaultGpfMWK: govTuitionOnly ? 0 : Number(gpf) || 0,
          defaultExamFeeMWK: govTuitionOnly ? 0 : Number(examFee) || 0,
        },
        ownerId
      );
      setSavedSettingsFlash(true);
      setTimeout(() => setSavedSettingsFlash(false), 1800);
    } finally {
      setSavingSettings(false);
    }
  };

  const openAddTeacherModal = () => {
    setEditingTeacher(null);
    setTForm({
      staffCode: `TSC-${Math.floor(40000 + Math.random() * 50000)}`,
      fullName: '',
      roleTitle: 'Subject Teacher',
      subjects: ['English'],
      assignedForm: 'Form 1A',
      phone: '+265 ',
      staffEmail: '',
      status: 'Active',
    });
    setTeacherFormError('');
    setTeacherModalOpen(true);
  };

  const openEditTeacherModal = (t: Teacher) => {
    setEditingTeacher(t);
    setTForm({
      staffCode: t.staffCode,
      fullName: t.fullName,
      roleTitle: t.roleTitle,
      subjects: t.subjects.length > 0 ? t.subjects : ['English'],
      assignedForm: t.assignedForm,
      phone: t.phone,
      staffEmail: t.staffEmail || '',
      status: t.status,
    });
    setTeacherFormError('');
    setTeacherModalOpen(true);
  };

  const handleSaveTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageStaffAndSettings) return;
    if (!tForm.fullName.trim() || !tForm.staffCode.trim()) {
      setTeacherFormError('Staff code and full name are required.');
      return;
    }
    const trimmedEmail = (tForm.staffEmail || '').trim().toLowerCase();
    if (trimmedEmail && (!trimmedEmail.includes('@') || !trimmedEmail.includes('.'))) {
      setTeacherFormError('Enter a valid Google email for staff portal access, or leave it blank.');
      return;
    }
    setTeacherFormError('');
    setSavingTeacher(true);
    try {
      await saveTeacher(
        school.id,
        ownerId,
        tForm,
        editingTeacher?.id,
        school,
        editingTeacher?.staffEmail
      );
      setTeacherModalOpen(false);
    } catch (err) {
      setTeacherFormError(err instanceof Error ? err.message : 'Unable to save staff record.');
    } finally {
      setSavingTeacher(false);
    }
  };

  const toggleSubject = (subj: string) => {
    setTForm((prev) => {
      const exists = prev.subjects.includes(subj);
      if (exists) {
        const next = prev.subjects.filter((s) => s !== subj);
        return { ...prev, subjects: next.length > 0 ? next : [subj] };
      }
      if (prev.subjects.length >= 8) return prev;
      return { ...prev, subjects: [...prev.subjects, subj] };
    });
  };

  const openAddSubjectModal = () => {
    setEditingSubject(null);
    setSubForm({
      name: '',
      code: '',
      formLevels: subjectFormFilter === 'all' ? [1, 2, 3, 4] : [subjectFormFilter],
      isCore: false,
    });
    setSubjectFormError('');
    setSubjectModalOpen(true);
  };

  const openEditSubjectModal = (sub: SchoolSubject) => {
    setEditingSubject(sub);
    setSubForm({
      name: sub.name,
      code: sub.code,
      formLevels: sub.formLevels.length > 0 ? [...sub.formLevels] : [1, 2, 3, 4],
      isCore: sub.isCore,
    });
    setSubjectFormError('');
    setSubjectModalOpen(true);
  };

  const toggleSubFormLevel = (level: FormLevel) => {
    setSubForm((prev) => {
      const exists = prev.formLevels.includes(level);
      if (exists) {
        if (prev.formLevels.length <= 1) return prev;
        return {
          ...prev,
          formLevels: prev.formLevels.filter((f) => f !== level),
        };
      }
      return {
        ...prev,
        formLevels: [...prev.formLevels, level].sort((a, b) => a - b),
      };
    });
  };

  const handleSaveSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageStaffAndSettings) return;
    const cleanName = subForm.name.trim();
    if (cleanName.length < 2) {
      setSubjectFormError('Subject name must be at least 2 characters.');
      return;
    }
    if (subForm.formLevels.length === 0) {
      setSubjectFormError('Assign this subject to at least one form (Form 1–4).');
      return;
    }
    const duplicate = schoolSubjects.find(
      (s) =>
        s.id !== editingSubject?.id &&
        s.name.trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (duplicate) {
      setSubjectFormError(`"${duplicate.name}" is already defined for this school.`);
      return;
    }
    setSubjectFormError('');
    setSavingSubject(true);
    try {
      const autoCode =
        subForm.code.trim() ||
        cleanName
          .replace(/[^a-zA-Z]/g, '')
          .slice(0, 3)
          .toUpperCase();
      await saveSchoolSubject(
        school.id,
        ownerId,
        {
          name: cleanName,
          code: autoCode,
          formLevels: subForm.formLevels,
          isCore: subForm.isCore,
        },
        editingSubject?.id
      );
      setSubjectModalOpen(false);
    } catch (err) {
      setSubjectFormError(err instanceof Error ? err.message : 'Unable to save subject.');
    } finally {
      setSavingSubject(false);
    }
  };

  const handleQuickToggleSubjectForm = async (sub: SchoolSubject, level: FormLevel) => {
    if (!canManageStaffAndSettings || togglingSubjectId) return;
    const hasLevel = sub.formLevels.includes(level);
    if (hasLevel && sub.formLevels.length <= 1) {
      setSubjectNotice(`${sub.name} must remain assigned to at least one Form.`);
      setTimeout(() => setSubjectNotice(''), 2500);
      return;
    }
    const nextForms = hasLevel
      ? sub.formLevels.filter((f) => f !== level)
      : ([...sub.formLevels, level].sort((a, b) => a - b) as FormLevel[]);
    setTogglingSubjectId(sub.id);
    setSubjectNotice('');
    try {
      await saveSchoolSubject(
        school.id,
        ownerId,
        {
          name: sub.name,
          code: sub.code,
          formLevels: nextForms,
          isCore: sub.isCore,
        },
        sub.id
      );
    } catch (err) {
      setSubjectNotice(err instanceof Error ? err.message : 'Unable to update form assignment.');
    } finally {
      setTogglingSubjectId(null);
    }
  };

  const handleSeedDefaultSubjects = async () => {
    if (!canManageStaffAndSettings || seedingSubjects) return;
    setSeedingSubjects(true);
    setSubjectNotice('');
    try {
      const added = await seedDefaultSchoolSubjects(school.id, ownerId, schoolSubjects);
      if (added > 0) {
        setSubjectNotice(`Loaded ${added} Malawi curriculum subject${added === 1 ? '' : 's'}.`);
        setTimeout(() => setSubjectNotice(''), 2500);
      }
    } catch (err) {
      setSubjectNotice(err instanceof Error ? err.message : 'Unable to load default subjects.');
    } finally {
      setSeedingSubjects(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-7 space-y-6">
        {/* Curriculum Subjects & Form Assignments */}
        <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Curriculum Subjects &amp; Forms ({schoolSubjects.length})
                </h1>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Define school subjects and toggle Form 1–4 assignments used in Exam Marks entry.
              </p>
            </div>
            {canManageStaffAndSettings ? (
              <div className="flex flex-wrap items-center gap-2">
                {missingDefaultsCount > 0 && (
                  <button
                    type="button"
                    disabled={seedingSubjects}
                    onClick={handleSeedDefaultSubjects}
                    className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                    <span>
                      {seedingSubjects ? 'Loading...' : `Load Malawi Defaults (${missingDefaultsCount})`}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={openAddSubjectModal}
                  className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Add Subject</span>
                </button>
              </div>
            ) : (
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Owner Editable
              </span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {(['all', 1, 2, 3, 4] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setSubjectFormFilter(f)}
                  className={`min-h-[34px] px-2.5 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer ${
                    subjectFormFilter === f
                      ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {f === 'all' ? 'All Forms' : `Form ${f}`}
                </button>
              ))}
            </div>
            {subjectNotice && (
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                {subjectNotice}
              </span>
            )}
          </div>

          <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800/80">
            {schoolSubjects.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
                <div>
                  No custom school subjects configured yet. Exam Marks is using the standard Malawi default list.
                </div>
                {canManageStaffAndSettings && (
                  <div className="pt-1 flex justify-center gap-2">
                    <button
                      type="button"
                      disabled={seedingSubjects}
                      onClick={handleSeedDefaultSubjects}
                      className="min-h-[36px] px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
                    >
                      Load 12 Malawi Secondary Subjects
                    </button>
                  </div>
                )}
              </div>
            ) : filteredSubjects.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                No subjects assigned to Form {subjectFormFilter} yet.
              </div>
            ) : (
              filteredSubjects.map((sub) => (
                <div
                  key={sub.id}
                  className="py-3 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                        {sub.name}
                      </span>
                      {sub.code && (
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          · {sub.code}
                        </span>
                      )}
                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        · {sub.isCore ? 'Core' : 'Elective'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1" role="group" aria-label={`Forms for ${sub.name}`}>
                      {FORM_LEVELS.map((lvl) => {
                        const active = sub.formLevels.includes(lvl);
                        return (
                          <button
                            key={lvl}
                            type="button"
                            disabled={!canManageStaffAndSettings || togglingSubjectId === sub.id}
                            onClick={() => handleQuickToggleSubjectForm(sub, lvl)}
                            title={
                              canManageStaffAndSettings
                                ? `${active ? 'Unassign' : 'Assign'} ${sub.name} for Form ${lvl}`
                                : `Form ${lvl}`
                            }
                            className={`min-h-[30px] min-w-[32px] px-1.5 rounded-lg text-[11px] font-mono font-semibold transition-colors ${
                              active
                                ? 'bg-emerald-700 text-white'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'
                            } ${
                              canManageStaffAndSettings
                                ? 'cursor-pointer hover:opacity-90'
                                : 'cursor-default opacity-80'
                            }`}
                          >
                            F{lvl}
                          </button>
                        );
                      })}
                    </div>

                    {canManageStaffAndSettings && (
                      <div className="flex items-center gap-0.5 pl-1">
                        <button
                          type="button"
                          onClick={() => openEditSubjectModal(sub)}
                          aria-label={`Edit ${sub.name}`}
                          className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteSubjectError('');
                            setConfirmSubject(sub);
                          }}
                          aria-label={`Remove ${sub.name}`}
                          className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Staff Directory & Role Assignments */}
        <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Teachers &amp; Staff RBAC ({teachers.length})
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Assign Google emails and roles so Teachers, Form Teachers, HODs, Librarians, Bursars, and Deputy Heads get role-based dashboards.
            </p>
          </div>
          {canManageStaffAndSettings && (
            <button
              type="button"
              onClick={openAddTeacherModal}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Add Staff</span>
            </button>
          )}
        </div>

        <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800/80">
          {teachers.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
              No staff members recorded yet.
            </div>
          ) : (
            teachers.map((t) => (
              <div key={t.id} className="py-3.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                      {t.fullName}
                    </span>
                    <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                      · {t.staffCode}
                    </span>
                    <span
                      className={`text-[11px] font-semibold ${
                        t.status === 'Active'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      · {t.status}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                    {t.roleTitle} · {t.assignedForm} · {t.subjects.join(', ')}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-mono">{t.phone}</span>
                    {t.staffEmail ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                        <ShieldCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>Portal: {t.staffEmail}</span>
                      </span>
                    ) : (
                      <span className="text-slate-400">No portal email linked</span>
                    )}
                  </div>
                </div>
                {canManageStaffAndSettings && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditTeacherModal(t)}
                      aria-label={`Edit ${t.fullName}`}
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteTeacherError('');
                        setConfirmTeacher(t);
                      }}
                      aria-label={`Remove ${t.fullName}`}
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        </section>
      </div>

      {/* School Profile & Workspace Switcher */}
      <aside className="lg:col-span-5 space-y-6">
        <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                School Workspaces
              </h2>
            </div>
            {onAddNewSchool && (
              <button
                type="button"
                onClick={onAddNewSchool}
                className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
              >
                + New School
              </button>
            )}
          </div>

          <select
            aria-label="Active school workspace"
            value={school.id}
            onChange={(e) => onSwitchSchool(e.target.value)}
            className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm font-medium"
          >
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.district})
              </option>
            ))}
          </select>
        </section>

        <form
          onSubmit={handleSaveSchool}
          className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              School Settings &amp; Term Fees
            </h2>
            {!canManageStaffAndSettings && (
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Owner Only
              </span>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              School Name
            </label>
            <input
              type="text"
              required
              disabled={!canManageStaffAndSettings}
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm disabled:opacity-60"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                District
              </label>
              <select
                disabled={!canManageStaffAndSettings}
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm disabled:opacity-60"
              >
                {MALAWI_DISTRICTS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Category
              </label>
              <select
                disabled={!canManageStaffAndSettings}
                value={schoolType}
                onChange={(e) => handleSchoolTypeChange(e.target.value as SchoolType)}
                className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm disabled:opacity-60"
              >
                {SCHOOL_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Academic Year
              </label>
              <input
                type="text"
                disabled={!canManageStaffAndSettings}
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Current Term
              </label>
              <select
                disabled={!canManageStaffAndSettings}
                value={currentTerm}
                onChange={(e) => setCurrentTerm(e.target.value as TermName)}
                className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm disabled:opacity-60"
              >
                {TERMS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Motto
            </label>
            <input
              type="text"
              disabled={!canManageStaffAndSettings}
              maxLength={140}
              value={motto}
              onChange={(e) => setMotto(e.target.value)}
              className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm disabled:opacity-60"
            />
          </div>

          {govTuitionOnly && (
            <div className="rounded-xl bg-emerald-50/80 dark:bg-emerald-950/35 border border-emerald-200/80 dark:border-emerald-900/60 px-3 py-2 text-[11px] text-emerald-900 dark:text-emerald-200">
              <strong>Government Tuition-Only Policy:</strong> GPF and Exam Fees are waived at MK 0 for {schoolType} schools.
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                Tuition (MK)
              </label>
              <input
                type="number"
                min="0"
                disabled={!canManageStaffAndSettings}
                value={tuition}
                onChange={(e) => setTuition(e.target.value)}
                className="w-full min-h-[40px] px-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-xs disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                GPF (MK){govTuitionOnly ? ' · 0' : ''}
              </label>
              <input
                type="number"
                min="0"
                disabled={!canManageStaffAndSettings || govTuitionOnly}
                value={govTuitionOnly ? '0' : gpf}
                onChange={(e) => setGpf(e.target.value)}
                className="w-full min-h-[40px] px-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-xs disabled:opacity-55 disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                Exam Fee (MK){govTuitionOnly ? ' · 0' : ''}
              </label>
              <input
                type="number"
                min="0"
                disabled={!canManageStaffAndSettings || govTuitionOnly}
                value={govTuitionOnly ? '0' : examFee}
                onChange={(e) => setExamFee(e.target.value)}
                className="w-full min-h-[40px] px-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-xs disabled:opacity-55 disabled:cursor-not-allowed"
              />
            </div>
          </div>

          {canManageStaffAndSettings && (
            <button
              type="submit"
              disabled={savingSettings}
              className="w-full inline-flex items-center justify-center gap-2 min-h-[44px] rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              {savedSettingsFlash ? (
                <>
                  <Check className="w-4 h-4" aria-hidden="true" />
                  <span>Settings Saved</span>
                </>
              ) : (
                <span>{savingSettings ? 'Saving...' : 'Save School Settings'}</span>
              )}
            </button>
          )}
        </form>
      </aside>

      {/* Add / Edit Staff Modal */}
      {teacherModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {editingTeacher ? 'Edit Staff Member & RBAC Role' : 'Add Teacher or Staff Member'}
              </h2>
              <button
                type="button"
                onClick={() => setTeacherModalOpen(false)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTeacher} className="mt-4 space-y-4">
              {teacherFormError && (
                <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                  {teacherFormError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    TSC / Staff Code
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={40}
                    value={tForm.staffCode}
                    onChange={(e) => setTForm({ ...tForm, staffCode: e.target.value })}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Role Title (Access Level)
                  </label>
                  <select
                    value={tForm.roleTitle}
                    onChange={(e) => {
                      const nextRole = e.target.value as TeacherRole;
                      setTForm((prev) => {
                        let nextAssignedForm = prev.assignedForm;
                        let nextSubjects = prev.subjects;
                        if (nextRole === 'School Librarian') {
                          if (
                            !prev.assignedForm ||
                            prev.assignedForm.startsWith('Form') ||
                            prev.assignedForm === 'Accounts Office'
                          ) {
                            nextAssignedForm = 'Main Library';
                          }
                          nextSubjects = ['General'];
                        } else if (nextRole === 'School Bursar') {
                          if (
                            !prev.assignedForm ||
                            prev.assignedForm.startsWith('Form') ||
                            prev.assignedForm === 'Main Library'
                          ) {
                            nextAssignedForm = 'Accounts Office';
                          }
                        } else if (
                          prev.assignedForm === 'Main Library' ||
                          prev.assignedForm === 'Accounts Office'
                        ) {
                          nextAssignedForm = 'Form 1A';
                        }
                        if (
                          nextRole !== 'School Librarian' &&
                          prev.subjects.length === 1 &&
                          prev.subjects[0] === 'General'
                        ) {
                          nextSubjects = ['English'];
                        }
                        return {
                          ...prev,
                          roleTitle: nextRole,
                          assignedForm: nextAssignedForm,
                          subjects: nextSubjects,
                        };
                      });
                    }}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                  >
                    {TEACHER_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {getRoleDisplayLabel(r)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 px-3.5 py-2 text-[11px] text-slate-600 dark:text-slate-300">
                  <strong>Role Permissions:</strong> {getRoleAccessSummary(tForm.roleTitle)}
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={120}
                    value={tForm.fullName}
                    onChange={(e) => setTForm({ ...tForm, fullName: e.target.value })}
                    placeholder="e.g. Mrs. Grace Chirambo"
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Staff Portal Email (Google Sign-In)
                  </label>
                  <input
                    type="email"
                    maxLength={120}
                    value={tForm.staffEmail || ''}
                    onChange={(e) => setTForm({ ...tForm, staffEmail: e.target.value })}
                    placeholder="teacher@gmail.com (optional)"
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                  />
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    When set, this staff member can log in with Google and immediately receive a dashboard tailored to their role ({tForm.roleTitle}).
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Assigned Form / Office
                  </label>
                  <input
                    type="text"
                    maxLength={30}
                    value={tForm.assignedForm}
                    onChange={(e) => setTForm({ ...tForm, assignedForm: e.target.value })}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Status
                  </label>
                  <select
                    value={tForm.status}
                    onChange={(e) =>
                      setTForm({ ...tForm, status: e.target.value as 'Active' | 'On Leave' })
                    }
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                  >
                    <option value="Active">Active</option>
                    <option value="On Leave">On Leave (Access Suspended)</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    maxLength={30}
                    value={tForm.phone}
                    onChange={(e) => setTForm({ ...tForm, phone: e.target.value })}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm"
                  />
                </div>
              </div>

              {tForm.roleTitle === 'School Librarian' || tForm.roleTitle === 'School Bursar' ? (
                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 px-3.5 py-2.5 text-xs text-slate-600 dark:text-slate-400">
                  {tForm.roleTitle === 'School Librarian'
                    ? 'Library role manages school-wide textbook checkouts, returns, and usage analytics across all subjects.'
                    : 'Bursar role manages school-wide MWK fee billing, receipts, and guardian SMS alerts.'}
                </div>
              ) : (
                <div>
                  <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Subjects Taught (select up to 8)
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {selectableTeacherSubjects.map((subj) => {
                      const selected = tForm.subjects.includes(subj);
                      return (
                        <button
                          key={subj}
                          type="button"
                          onClick={() => toggleSubject(subj)}
                          className={`min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs text-left truncate cursor-pointer ${
                            selected
                              ? 'bg-emerald-700 text-white font-semibold'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {subj}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setTeacherModalOpen(false)}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingTeacher}
                  className="min-h-[42px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {savingTeacher ? 'Saving...' : editingTeacher ? 'Save Changes' : 'Save Staff'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Safe Delete Staff Modal */}
      <ConfirmDeleteModal
        open={!!confirmTeacher}
        title="Remove Staff Member"
        itemName={
          confirmTeacher
            ? `${confirmTeacher.fullName} · ${confirmTeacher.roleTitle} (${confirmTeacher.staffCode})`
            : ''
        }
        description="This removes the staff member from the school directory and permanently revokes their RBAC portal login access if linked."
        warningNote={
          confirmTeacher?.staffEmail
            ? `Linked Google account (${confirmTeacher.staffEmail}) will immediately lose access to ${school.name}.`
            : undefined
        }
        confirmLabel="Remove Staff"
        deleting={deletingTeacher}
        error={deleteTeacherError}
        onCancel={() => {
          if (!deletingTeacher) setConfirmTeacher(null);
        }}
        onConfirm={async () => {
          if (!confirmTeacher) return;
          setDeletingTeacher(true);
          setDeleteTeacherError('');
          try {
            await removeTeacher(school.id, confirmTeacher.id, confirmTeacher.staffEmail);
            setConfirmTeacher(null);
          } catch (err) {
            setDeleteTeacherError(
              err instanceof Error ? err.message : 'Unable to remove staff member.'
            );
          } finally {
            setDeletingTeacher(false);
          }
        }}
      />

      {/* Add / Edit Curriculum Subject Modal */}
      {subjectModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {editingSubject ? 'Edit Curriculum Subject' : 'Add School Subject'}
              </h2>
              <button
                type="button"
                onClick={() => setSubjectModalOpen(false)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSubject} className="mt-4 space-y-4">
              {subjectFormError && (
                <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                  {subjectFormError}
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Subject Name
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={60}
                    value={subForm.name}
                    onChange={(e) => setSubForm({ ...subForm, name: e.target.value })}
                    placeholder="e.g. Mathematics"
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Code
                  </label>
                  <input
                    type="text"
                    maxLength={16}
                    value={subForm.code}
                    onChange={(e) => setSubForm({ ...subForm, code: e.target.value.toUpperCase() })}
                    placeholder="MAT"
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm uppercase"
                  />
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Subject Classification
                </div>
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
                  <button
                    type="button"
                    onClick={() => setSubForm({ ...subForm, isCore: true })}
                    className={`min-h-[36px] rounded-lg text-xs font-semibold cursor-pointer ${
                      subForm.isCore
                        ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Core Subject
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubForm({ ...subForm, isCore: false })}
                    className={`min-h-[36px] rounded-lg text-xs font-semibold cursor-pointer ${
                      !subForm.isCore
                        ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Elective Subject
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Assign to Forms
                  </span>
                  <div className="flex items-center gap-2 text-[11px] font-medium">
                    <button
                      type="button"
                      onClick={() => setSubForm({ ...subForm, formLevels: [1, 2, 3, 4] })}
                      className="text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubForm({ ...subForm, formLevels: [1, 2] })}
                      className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 cursor-pointer"
                    >
                      JCE (1–2)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubForm({ ...subForm, formLevels: [3, 4] })}
                      className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 cursor-pointer"
                    >
                      MSCE (3–4)
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {FORM_LEVELS.map((lvl) => {
                    const active = subForm.formLevels.includes(lvl);
                    return (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => toggleSubFormLevel(lvl)}
                        className={`min-h-[40px] rounded-xl text-xs font-semibold cursor-pointer border transition-colors ${
                          active
                            ? 'bg-emerald-700 text-white border-emerald-700'
                            : 'bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        Form {lvl}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSubjectModalOpen(false)}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingSubject}
                  className="min-h-[42px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {savingSubject ? 'Saving...' : editingSubject ? 'Save Subject' : 'Add Subject'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Safe Delete Subject Modal */}
      <ConfirmDeleteModal
        open={!!confirmSubject}
        title="Remove Curriculum Subject"
        itemName={
          confirmSubject
            ? `${confirmSubject.name}${confirmSubject.code ? ` (${confirmSubject.code})` : ''}`
            : ''
        }
        description="This removes the subject from school form dropdowns in Exam Marks. Existing recorded student marks for this subject are preserved."
        confirmLabel="Remove Subject"
        deleting={deletingSubject}
        error={deleteSubjectError}
        onCancel={() => {
          if (!deletingSubject) setConfirmSubject(null);
        }}
        onConfirm={async () => {
          if (!confirmSubject) return;
          setDeletingSubject(true);
          setDeleteSubjectError('');
          try {
            await removeSchoolSubject(school.id, confirmSubject.id);
            setConfirmSubject(null);
          } catch (err) {
            setDeleteSubjectError(
              err instanceof Error ? err.message : 'Unable to remove subject.'
            );
          } finally {
            setDeletingSubject(false);
          }
        }}
      />
    </div>
  );
};
