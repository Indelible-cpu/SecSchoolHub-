import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStudentAttendanceHeatmap,
  getIsoWeekday,
  getMondayOfWeekIso,
} from '../src/school/attendanceHeatmapUtils';
import type { AttendanceRecord } from '../src/school/types';

function makeRecord(
  id: string,
  date: string,
  formLevel: 1 | 2 | 3 | 4,
  status: AttendanceRecord['status']
): AttendanceRecord {
  return {
    id,
    ownerId: 'owner_1',
    date,
    formLevel,
    stream: 'A',
    studentId: `stu_${id}`,
    studentName: `Student ${id}`,
    status,
    note: '',
  };
}

test('ISO weekday & Monday alignment remain timezone-invariant', () => {
  // 2026-11-23 is Monday
  assert.equal(getIsoWeekday('2026-11-23'), 1);
  assert.equal(getMondayOfWeekIso('2026-11-23'), '2026-11-23');
  // 2026-11-25 is Wednesday -> Monday is 2026-11-23
  assert.equal(getIsoWeekday('2026-11-25'), 3);
  assert.equal(getMondayOfWeekIso('2026-11-25'), '2026-11-23');
  // 2026-11-22 is Sunday -> Monday of that ISO week is 2026-11-16
  assert.equal(getIsoWeekday('2026-11-22'), 7);
  assert.equal(getMondayOfWeekIso('2026-11-22'), '2026-11-16');
});

test('buildStudentAttendanceHeatmap aggregates daily rates and respects Form filtering', () => {
  const attendance: AttendanceRecord[] = [
    // Monday 2026-11-23: 3/4 present+late = 75% overall; Form 1 = 2/2 (100%), Form 2 = 1/2 (50%)
    makeRecord('1', '2026-11-23', 1, 'Present'),
    makeRecord('2', '2026-11-23', 1, 'Late'),
    makeRecord('3', '2026-11-23', 2, 'Present'),
    makeRecord('4', '2026-11-23', 2, 'Absent'),
    // Previous Friday 2026-11-20: 1/2 present = 50% (1 Excused counts in total marked)
    makeRecord('5', '2026-11-20', 3, 'Present'),
    makeRecord('6', '2026-11-20', 3, 'Excused'),
    // Out-of-window record (>13 weeks earlier) should be excluded
    makeRecord('7', '2026-01-12', 1, 'Absent'),
  ];

  const allModel = buildStudentAttendanceHeatmap({
    attendance,
    todayIso: '2026-11-23',
    term: 'Term 1',
    formFilter: 'ALL',
    weeksCount: 13,
  });

  assert.equal(allModel.includeWeekends, false);
  assert.equal(allModel.dayRows.length, 5);
  assert.equal(allModel.cells.length, 13 * 5);
  assert.equal(allModel.summary.daysMarked, 2);
  assert.equal(allModel.summary.totalRecords, 6);
  assert.equal(allModel.summary.presentOrLateCount, 4);
  assert.equal(allModel.summary.excusedCount, 1);
  assert.equal(allModel.summary.absentCount, 1);
  assert.equal(allModel.summary.overallRate, 66.7);

  const monCell = allModel.cells.find((c) => c.date === '2026-11-23');
  assert.ok(monCell);
  assert.equal(monCell.isToday, true);
  assert.equal(monCell.attendanceRate, 75);

  const form1Model = buildStudentAttendanceHeatmap({
    attendance,
    todayIso: '2026-11-23',
    term: 'Term 1',
    formFilter: 1,
    weeksCount: 13,
  });

  assert.equal(form1Model.summary.daysMarked, 1);
  assert.equal(form1Model.summary.overallRate, 100);
});

test('buildStudentAttendanceHeatmap expands to 7 rows when weekend roll-call exists', () => {
  const attendance: AttendanceRecord[] = [
    makeRecord('w1', '2026-11-21', 4, 'Present'), // Saturday
  ];

  const model = buildStudentAttendanceHeatmap({
    attendance,
    todayIso: '2026-11-23',
    term: 'Term 1',
    weeksCount: 13,
  });

  assert.equal(model.includeWeekends, true);
  assert.equal(model.dayRows.length, 7);
  assert.equal(model.cells.length, 13 * 7);
});
