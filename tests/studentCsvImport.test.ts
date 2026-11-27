import assert from 'node:assert/strict';
import test from 'node:test';
import {
  autoDetectStudentFieldMapping,
  buildStudentImportPreview,
  createEmptyStudentMapping,
  mergeMappedStudentPayloadForUpdate,
  parseCsvMatrix,
  STUDENT_CSV_SAMPLE_HEADERS,
  STUDENT_CSV_SAMPLE_ROWS,
  type StudentCsvImportDefaults,
} from '../src/school/studentCsvImport';
import type { Student } from '../src/school/types';

const DEFAULT_SETTINGS: StudentCsvImportDefaults = {
  formLevel: 1,
  stream: 'A',
  gender: 'Female',
  boardingStatus: 'Day Scholar',
  status: 'Active',
  autoGenerateAdmissionNo: false,
};

function makeExistingStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: 'stu-1',
    ownerId: 'owner-1',
    admissionNo: 'SCH/2026/001',
    fullName: 'Chimwemwe Banda',
    gender: 'Female',
    formLevel: 1,
    stream: 'A',
    entryYear: 2026,
    boardingStatus: 'Day Scholar',
    guardianName: 'Mary Banda',
    guardianPhone: '+265999112233',
    guardianSecondaryPhone: '+265888112233',
    guardianRelationship: 'Mother',
    emergencyContactName: 'John Banda',
    emergencyContactPhone: '+265888445566',
    emergencyNotes: 'Peanut allergy',
    studentEmail: 'chimwemwe@school.mw',
    registrationCode: 'CHIM2026',
    status: 'Active',
    ...overrides,
  };
}

test('parseCsvMatrix handles UTF-8 BOM, quoted commas, escaped quotes, and CRLF', () => {
  const csv =
    '\uFEFF"Admission No","Full Name","Emergency Notes"\r\n' +
    '"SCH/2026/001","Banda, Chimwemwe","Carry ""Ventolin"" inhaler, check daily"\r\n' +
    ',,\r\n' +
    'SCH/2026/002,Kondwani Phiri,None\n';

  const matrix = parseCsvMatrix(csv);
  assert.equal(matrix.length, 3);
  assert.deepEqual(matrix[0], ['Admission No', 'Full Name', 'Emergency Notes']);
  assert.deepEqual(matrix[1], [
    'SCH/2026/001',
    'Banda, Chimwemwe',
    'Carry "Ventolin" inhaler, check daily',
  ]);
  assert.deepEqual(matrix[2], ['SCH/2026/002', 'Kondwani Phiri', 'None']);
});

test('autoDetectStudentFieldMapping detects standard, alias, and missing admissionNo headers', () => {
  const aliasHeaders = [
    'Adm #',
    'Learner Name',
    'Sex',
    'Class',
    'Section',
    'Intake Year',
    'Hostel',
    'Parent Name',
    'Tel',
    'Alt Phone',
    'Relation',
    'Email',
  ];
  const detected = autoDetectStudentFieldMapping(aliasHeaders);
  assert.equal(detected.autoGenerateAdmissionNo, false);
  assert.equal(detected.mapping.admissionNo, 0);
  assert.equal(detected.mapping.fullName, 1);
  assert.equal(detected.mapping.gender, 2);
  assert.equal(detected.mapping.formLevel, 3);
  assert.equal(detected.mapping.stream, 4);
  assert.equal(detected.mapping.entryYear, 5);
  assert.equal(detected.mapping.boardingStatus, 6);
  assert.equal(detected.mapping.guardianName, 7);
  assert.equal(detected.mapping.guardianPhone, 8);
  assert.equal(detected.mapping.guardianSecondaryPhone, 9);
  assert.equal(detected.mapping.guardianRelationship, 10);
  assert.equal(detected.mapping.studentEmail, 11);

  const withoutAdm = autoDetectStudentFieldMapping(['Student Name', 'Parent Name']);
  assert.equal(withoutAdm.mapping.admissionNo, -1);
  assert.equal(withoutAdm.autoGenerateAdmissionNo, true);
  assert.equal(withoutAdm.mapping.fullName, 0);
  assert.equal(withoutAdm.mapping.guardianName, 1);
});

test('buildStudentImportPreview normalizes combined Form+Stream, Malawi phones, entryYear, and sample template', () => {
  const csvMatrix = [
    STUDENT_CSV_SAMPLE_HEADERS,
    ...STUDENT_CSV_SAMPLE_ROWS.map((r) => r.map(String)),
  ];
  const { mapping } = autoDetectStudentFieldMapping(csvMatrix[0]);
  const preview = buildStudentImportPreview({
    matrix: csvMatrix,
    mapping,
    defaults: DEFAULT_SETTINGS,
    existingStudents: [],
    school: { academicYear: '2026' },
  });

  assert.equal(preview.mappingError, '');
  assert.equal(preview.rows.length, 3);
  for (const row of preview.rows) {
    assert.deepEqual(row.errors, []);
  }
  assert.equal(preview.rows[1].payload.guardianPhone, '+265888234567');
  assert.equal(preview.rows[2].payload.formLevel, 4);
  assert.equal(preview.rows[2].payload.stream, 'North');

  // Test custom manual field mapping and combined "Form 3B" parsing + auto-generated admission numbers
  const customMatrix = [
    ['Col A', 'Col B', 'Col C', 'Col D'],
    ['Tadala Mwale', 'F', 'Form 3B', 'Peter Mwale'],
    ['Chisomo Lungu', 'M', '2-South', 'Agnes Lungu'],
  ];
  const customMapping = createEmptyStudentMapping();
  customMapping.fullName = 0;
  customMapping.gender = 1;
  customMapping.formLevel = 2;
  customMapping.guardianName = 3;

  const customPreview = buildStudentImportPreview({
    matrix: customMatrix,
    mapping: customMapping,
    defaults: { ...DEFAULT_SETTINGS, autoGenerateAdmissionNo: true },
    existingStudents: [makeExistingStudent()],
    school: { academicYear: '2026' },
  });

  assert.equal(customPreview.mappingError, '');
  assert.equal(customPreview.rows.length, 2);
  assert.deepEqual(customPreview.rows[0].errors, []);
  assert.equal(customPreview.rows[0].payload.formLevel, 3);
  assert.equal(customPreview.rows[0].payload.stream, 'B');
  assert.equal(customPreview.rows[0].payload.gender, 'Female');
  assert.equal(customPreview.rows[0].payload.entryYear, 2024);
  assert.equal(customPreview.rows[0].payload.admissionNo, 'SCH/2024/002');

  assert.deepEqual(customPreview.rows[1].errors, []);
  assert.equal(customPreview.rows[1].payload.formLevel, 2);
  assert.equal(customPreview.rows[1].payload.stream, 'South');
  assert.equal(customPreview.rows[1].payload.gender, 'Male');
  assert.equal(customPreview.rows[1].payload.entryYear, 2025);
  assert.equal(customPreview.rows[1].payload.admissionNo, 'SCH/2025/003');
});

test('buildStudentImportPreview flags validation errors, intra-CSV duplicates, and existing student matches', () => {
  const existing = makeExistingStudent({
    id: 'stu-1',
    admissionNo: 'SCH/2026/001',
    registrationCode: 'CHIM2026',
  });
  const otherExisting = makeExistingStudent({
    id: 'stu-2',
    admissionNo: 'SCH/2026/099',
    fullName: 'Other Student',
    registrationCode: 'TAKEN99',
  });

  const matrix = [
    ['Admission No', 'Full Name', 'Gender', 'Form', 'Guardian', 'Email', 'Reg Code'],
    ['SCH/2026/001', 'Chimwemwe Banda Updated', 'Female', 'Form 1', 'Mary Banda', 'ok@school.mw', ''],
    ['SCH/2026/001', 'Duplicate Adm', 'Male', 'Form 1', 'Parent', '', ''],
    ['SCH/2026/003', 'A', 'Unknown', 'Form 9', '', 'not-an-email', 'SHORT'],
    ['SCH/2026/004', 'Code Conflict', 'Male', 'Form 2', 'Parent', '', 'TAKEN99'],
  ];

  const { mapping } = autoDetectStudentFieldMapping(matrix[0]);
  const preview = buildStudentImportPreview({
    matrix,
    mapping,
    defaults: DEFAULT_SETTINGS,
    existingStudents: [existing, otherExisting],
    school: { academicYear: '2026' },
  });

  assert.equal(preview.mappingError, '');
  assert.equal(preview.rows.length, 4);

  // Row 1 matches existing student cleanly
  assert.deepEqual(preview.rows[0].errors, []);
  assert.equal(preview.rows[0].existingMatch?.id, 'stu-1');
  assert.equal(preview.rows[0].matchReason, 'admissionNo');

  // Row 2 flags intra-CSV duplicate admission number
  assert.ok(preview.rows[1].errors.some((e) => e.includes('Duplicate Admission No')));

  // Row 3 flags name length, gender, form, guardian, email, and reg code rules
  assert.ok(preview.rows[2].errors.some((e) => e.includes('Full Name min 2 chars')));
  assert.ok(preview.rows[2].errors.some((e) => e.includes('Invalid gender')));
  assert.ok(preview.rows[2].errors.some((e) => e.includes('Invalid form')));
  assert.ok(preview.rows[2].errors.some((e) => e.includes('Guardian Name required')));
  assert.ok(preview.rows[2].errors.some((e) => e.includes('Invalid student email')));
  assert.ok(preview.rows[2].errors.some((e) => e.includes('Reg code min 6 chars')));

  // Row 4 flags reg code belonging to another student
  assert.ok(preview.rows[3].errors.some((e) => e.includes('already assigned')));
});

test('mergeMappedStudentPayloadForUpdate preserves unmapped fields and existing registrationCode', () => {
  const existing = makeExistingStudent();
  const mappedKeys = new Set(['admissionNo', 'fullName', 'formLevel', 'stream', 'guardianName']);

  const merged = mergeMappedStudentPayloadForUpdate(
    existing,
    {
      admissionNo: 'SCH/2026/001',
      fullName: 'Chimwemwe B. Phiri',
      gender: 'Male', // unmapped fallback should NOT overwrite existing Female
      formLevel: 2,
      stream: 'B',
      entryYear: 2025, // unmapped should NOT overwrite existing 2026
      boardingStatus: 'Boarder', // unmapped should NOT overwrite Day Scholar
      guardianName: 'Mary Phiri',
      guardianPhone: '',
      guardianSecondaryPhone: '',
      guardianRelationship: '',
      emergencyContactName: '',
      emergencyContactPhone: '',
      emergencyNotes: '',
      studentEmail: '',
      registrationCode: '',
      autoGeneratedCode: true,
      status: 'Suspended', // unmapped should NOT overwrite Active
    },
    mappedKeys,
    '2026'
  );

  assert.equal(merged.fullName, 'Chimwemwe B. Phiri');
  assert.equal(merged.formLevel, 2);
  assert.equal(merged.stream, 'B');
  assert.equal(merged.guardianName, 'Mary Phiri');
  assert.equal(merged.gender, 'Female');
  assert.equal(merged.entryYear, 2026);
  assert.equal(merged.boardingStatus, 'Day Scholar');
  assert.equal(merged.guardianPhone, '+265999112233');
  assert.equal(merged.emergencyNotes, 'Peanut allergy');
  assert.equal(merged.studentEmail, 'chimwemwe@school.mw');
  assert.equal(merged.registrationCode, 'CHIM2026');
  assert.equal(merged.autoGeneratedCode, false);
  assert.equal(merged.status, 'Active');
});
