import React, { useMemo, useState } from 'react';
import { CheckCheck } from 'lucide-react';
import {
  AttendanceRecord,
  AttendanceStatus,
  FormLevel,
  School,
  Student,
} from '../../school/types';
import { FORM_LEVELS } from '../../school/malawi';
import { saveAttendanceEntry } from '../../school/firestoreService';

interface AttendanceRegisterProps {
  school: School;
  ownerId: string;
  students: Student[];
  attendance: AttendanceRecord[];
}

const STATUS_OPTIONS: AttendanceStatus[] = ['Present', 'Absent', 'Late', 'Excused'];

export const AttendanceRegister: React.FC<AttendanceRegisterProps> = ({
  school,
  ownerId,
  students,
  attendance,
}) => {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formFilter, setFormFilter] = useState<FormLevel>(4);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const formStudents = useMemo(
    () =>
      students
        .filter((s) => s.status === 'Active' && s.formLevel === formFilter)
        .sort((a, b) => a.stream.localeCompare(b.stream) || a.fullName.localeCompare(b.fullName)),
    [formFilter, students]
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

  const counts = useMemo(() => {
    let present = 0;
    let absent = 0;
    let late = 0;
    let excused = 0;
    for (const s of formStudents) {
      const rec = recordsByStudent.get(s.id);
      if (!rec) continue;
      if (rec.status === 'Present') present++;
      else if (rec.status === 'Absent') absent++;
      else if (rec.status === 'Late') late++;
      else if (rec.status === 'Excused') excused++;
    }
    return { present, absent, late, excused };
  }, [formStudents, recordsByStudent]);

  const handleMark = async (student: Student, status: AttendanceStatus) => {
    const existing = recordsByStudent.get(student.id);
    setSavingId(student.id);
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
    } finally {
      setSavingId(null);
    }
  };

  const handleMarkAllPresent = async () => {
    setBulkBusy(true);
    try {
      for (const s of formStudents) {
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
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Daily Roll Call Register
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Present: {counts.present} · Late: {counts.late} · Absent: {counts.absent} · Excused: {counts.excused}
            </p>
          </div>
          <button
            type="button"
            onClick={handleMarkAllPresent}
            disabled={bulkBusy || formStudents.length === 0}
            className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold cursor-pointer"
          >
            <CheckCheck className="w-4 h-4" aria-hidden="true" />
            <span>{bulkBusy ? 'Marking...' : `Mark Form ${formFilter} All Present`}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="date"
            aria-label="Attendance date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-xs font-medium"
          />

          <div className="flex items-center gap-1.5">
            {FORM_LEVELS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFormFilter(f)}
                className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  formFilter === f
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                Form {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
        {formStudents.length === 0 ? (
          <div className="py-12 px-6 text-center text-sm text-slate-500 dark:text-slate-400">
            No active students in Form {formFilter}.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {formStudents.map((s) => {
              const rec = recordsByStudent.get(s.id);
              const busy = savingId === s.id;
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
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-1.5 sm:w-auto w-full">
                    {STATUS_OPTIONS.map((st) => {
                      const active = rec?.status === st;
                      return (
                        <button
                          key={st}
                          type="button"
                          disabled={busy}
                          onClick={() => handleMark(s, st)}
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
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
