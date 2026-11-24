import React, { useMemo, useState } from 'react';
import { CheckCheck, Search } from 'lucide-react';
import {
  AttendanceRecord,
  AttendanceStatus,
  FormLevel,
  School,
  Student,
} from '../../school/types';
import { FORM_LEVELS } from '../../school/malawi';
import { saveAttendanceEntry } from '../../school/firestoreService';

const STUDENT_STATUS_OPTIONS: AttendanceStatus[] = ['Present', 'Absent', 'Late', 'Excused'];

interface StudentAttendancePanelProps {
  school: School;
  ownerId: string;
  students: Student[];
  attendance: AttendanceRecord[];
  canWriteAttendance?: boolean;
}

export const StudentAttendancePanel: React.FC<StudentAttendancePanelProps> = ({
  school,
  ownerId,
  students,
  attendance,
  canWriteAttendance = false,
}) => {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formFilter, setFormFilter] = useState<'all' | FormLevel>(canWriteAttendance ? 4 : 'all');
  const [studentStatusFilter, setStudentStatusFilter] = useState<'all' | AttendanceStatus | 'Unmarked'>('all');
  const [studentSearch, setStudentSearch] = useState('');
  const [savingStudentId, setSavingStudentId] = useState<string | null>(null);
  const [bulkStudentBusy, setBulkStudentBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const activeStudents = useMemo(
    () =>
      students
        .filter((s) => s.status === 'Active')
        .sort(
          (a, b) =>
            a.formLevel - b.formLevel ||
            a.stream.localeCompare(b.stream) ||
            a.fullName.localeCompare(b.fullName)
        ),
    [students]
  );

  const recordsByStudent = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const r of attendance) {
      if (r.date === date) {
        map.set(r.studentId, r);
      }
    }
    return map;
  }, [attendance, date]);

  const formScopedStudents = useMemo(() => {
    if (formFilter === 'all') return activeStudents;
    return activeStudents.filter((s) => s.formLevel === formFilter);
  }, [activeStudents, formFilter]);

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    return formScopedStudents.filter((s) => {
      const rec = recordsByStudent.get(s.id);
      const statusLabel = rec?.status || 'Unmarked';
      if (studentStatusFilter !== 'all' && statusLabel !== studentStatusFilter) return false;
      if (q) {
        return (
          s.fullName.toLowerCase().includes(q) ||
          s.admissionNo.toLowerCase().includes(q) ||
          `form ${s.formLevel}${s.stream}`.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [formScopedStudents, recordsByStudent, studentSearch, studentStatusFilter]);

  const studentCounts = useMemo(() => {
    let present = 0;
    let absent = 0;
    let late = 0;
    let excused = 0;
    let unmarked = 0;
    for (const s of formScopedStudents) {
      const rec = recordsByStudent.get(s.id);
      if (!rec) {
        unmarked += 1;
        continue;
      }
      if (rec.status === 'Present') present += 1;
      else if (rec.status === 'Absent') absent += 1;
      else if (rec.status === 'Late') late += 1;
      else if (rec.status === 'Excused') excused += 1;
    }
    const marked = present + absent + late + excused;
    const turnoutRate = marked > 0 ? Math.round(((present + late) / marked) * 100) : null;
    return { present, absent, late, excused, unmarked, marked, turnoutRate };
  }, [formScopedStudents, recordsByStudent]);

  const handleMarkStudent = async (student: Student, status: AttendanceStatus) => {
    if (!canWriteAttendance) return;
    setActionError('');
    const existing = recordsByStudent.get(student.id);
    setSavingStudentId(student.id);
    try {
      await saveAttendanceEntry(school.id, ownerId, {
        date,
        formLevel: student.formLevel,
        stream: student.stream,
        studentId: student.id,
        studentName: student.fullName,
        status,
        note: existing?.note || '',
        existingId: existing?.id,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to save student attendance.');
    } finally {
      setSavingStudentId(null);
    }
  };

  const handleMarkAllStudentsPresent = async () => {
    if (!canWriteAttendance || formFilter === 'all') return;
    setActionError('');
    setBulkStudentBusy(true);
    try {
      for (const s of formScopedStudents) {
        const existing = recordsByStudent.get(s.id);
        if (!existing || existing.status !== 'Present') {
          await saveAttendanceEntry(school.id, ownerId, {
            date,
            formLevel: s.formLevel,
            stream: s.stream,
            studentId: s.id,
            studentName: s.fullName,
            status: 'Present',
            note: existing?.note || '',
            existingId: existing?.id,
          });
        }
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to mark class present.');
    } finally {
      setBulkStudentBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {canWriteAttendance ? 'Student Daily Roll Call & Turnout' : 'Student Turnout'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
              Present: {studentCounts.present} · Late: {studentCounts.late} · Absent: {studentCounts.absent} · Excused: {studentCounts.excused} · Unmarked: {studentCounts.unmarked}
              {studentCounts.turnoutRate !== null ? ` · Turnout: ${studentCounts.turnoutRate}%` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              aria-label="Student turnout date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-xs font-medium tabular-nums"
            />
            {canWriteAttendance && (
              <button
                type="button"
                onClick={handleMarkAllStudentsPresent}
                disabled={bulkStudentBusy || formFilter === 'all' || formScopedStudents.length === 0}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                <CheckCheck className="w-4 h-4" aria-hidden="true" />
                <span>
                  {bulkStudentBusy
                    ? 'Marking...'
                    : formFilter === 'all'
                    ? 'Select a Form to Mark All'
                    : `Mark Form ${formFilter} All Present`}
                </span>
              </button>
            )}
          </div>
        </div>

        {actionError && (
          <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
            {actionError}
          </div>
        )}

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {!canWriteAttendance && (
              <button
                type="button"
                onClick={() => setFormFilter('all')}
                className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap ${
                  formFilter === 'all'
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                All Forms
              </button>
            )}
            {FORM_LEVELS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFormFilter(f)}
                className={`min-h-[36px] px-3.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap ${
                  formFilter === f
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                Form {f}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter by attendance status"
              value={studentStatusFilter}
              onChange={(e) =>
                setStudentStatusFilter(e.target.value as 'all' | AttendanceStatus | 'Unmarked')
              }
              className="min-h-[38px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium"
            >
              <option value="all">All Statuses</option>
              <option value="Present">Present</option>
              <option value="Late">Late</option>
              <option value="Absent">Absent</option>
              <option value="Excused">Excused</option>
              <option value="Unmarked">Unmarked</option>
            </select>

            <div className="relative flex-1 sm:w-60">
              <Search
                className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="search"
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                placeholder="Search student or adm no..."
                className="w-full min-h-[38px] pl-8 pr-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
        {filteredStudents.length === 0 ? (
          <div className="py-12 px-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {formScopedStudents.length === 0
              ? formFilter === 'all'
                ? 'No active students found.'
                : `No active students in Form ${formFilter}.`
              : 'No students match the selected attendance filter or search.'}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {filteredStudents.map((s) => {
              const rec = recordsByStudent.get(s.id);
              const busy = savingStudentId === s.id;
              return (
                <div
                  key={s.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div>
                    <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                      {s.fullName}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                      {s.admissionNo} · Form {s.formLevel}{s.stream}
                      {rec?.note ? ` · ${rec.note}` : ''}
                    </div>
                  </div>

                  {canWriteAttendance ? (
                    <div className="grid grid-cols-4 gap-1.5 sm:w-auto w-full">
                      {STUDENT_STATUS_OPTIONS.map((st) => {
                        const active = rec?.status === st;
                        return (
                          <button
                            key={st}
                            type="button"
                            disabled={busy}
                            onClick={() => handleMarkStudent(s, st)}
                            className={`min-h-[40px] px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                              active
                                ? st === 'Present'
                                  ? 'bg-emerald-700 text-white'
                                  : st === 'Absent'
                                  ? 'bg-rose-600 text-white'
                                  : st === 'Late'
                                  ? 'bg-amber-600 text-white'
                                  : 'bg-slate-700 text-white'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                            }`}
                          >
                            {st}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg border w-fit ${
                        rec?.status === 'Present'
                          ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
                          : rec?.status === 'Absent'
                          ? 'border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300'
                          : rec?.status === 'Late' || rec?.status === 'Excused'
                          ? 'border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {rec?.status || 'Unmarked'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
