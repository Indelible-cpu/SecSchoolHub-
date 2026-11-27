import {
  BoardingStatus,
  FormLevel,
  Gender,
  School,
  Student,
  StudentStatus,
} from './types';
import {
  formatMalawiSmsPhone,
  inferStudentEntryYear,
  normalizeRegistrationCode,
  STUDENT_STATUSES,
} from './malawi';
import type { StudentPayload } from './firestoreService';

export type StudentSchemaFieldKey =
  | 'admissionNo'
  | 'fullName'
  | 'gender'
  | 'formLevel'
  | 'stream'
  | 'entryYear'
  | 'boardingStatus'
  | 'guardianName'
  | 'guardianPhone'
  | 'guardianSecondaryPhone'
  | 'guardianRelationship'
  | 'emergencyContactName'
  | 'emergencyContactPhone'
  | 'emergencyNotes'
  | 'studentEmail'
  | 'registrationCode'
  | 'status';

export interface StudentSchemaFieldMeta {
  key: StudentSchemaFieldKey;
  label: string;
  required: boolean;
  group: 'Identity & Class' | 'Guardian & Emergency' | 'Portal & Status';
  hint: string;
  aliases: string[];
}

export const STUDENT_SCHEMA_FIELDS: StudentSchemaFieldMeta[] = [
  {
    key: 'admissionNo',
    label: 'Admission No',
    required: true,
    group: 'Identity & Class',
    hint: 'Unique student ID (max 40 chars) or auto-generated',
    aliases: [
      'admissionno',
      'admissionnumber',
      'admno',
      'admnumber',
      'adm',
      'studentid',
      'idnumber',
      'rollno',
      'regno',
    ],
  },
  {
    key: 'fullName',
    label: 'Full Name',
    required: true,
    group: 'Identity & Class',
    hint: '2–120 characters (e.g. Chimwemwe Banda)',
    aliases: [
      'fullname',
      'studentname',
      'name',
      'learnername',
      'pupilname',
      'candidate',
    ],
  },
  {
    key: 'gender',
    label: 'Gender',
    required: false,
    group: 'Identity & Class',
    hint: 'Male or Female (also accepts M / F)',
    aliases: ['gender', 'sex'],
  },
  {
    key: 'formLevel',
    label: 'Form Level',
    required: false,
    group: 'Identity & Class',
    hint: '1–4, Form 1–4, or combined like Form 2A',
    aliases: ['form', 'formlevel', 'class', 'grade', 'level', 'yeargroup'],
  },
  {
    key: 'stream',
    label: 'Stream',
    required: false,
    group: 'Identity & Class',
    hint: 'A, B, C, North, South, etc. (max 20 chars)',
    aliases: ['stream', 'section', 'arm', 'classstream', 'room'],
  },
  {
    key: 'entryYear',
    label: 'Year of Entry',
    required: false,
    group: 'Identity & Class',
    hint: '4-digit intake year (2000–2100)',
    aliases: ['yearofentry', 'entryyear', 'intakeyear', 'admissionyear', 'cohort'],
  },
  {
    key: 'boardingStatus',
    label: 'Boarding Status',
    required: false,
    group: 'Identity & Class',
    hint: 'Day Scholar or Boarder',
    aliases: ['boarding', 'boardingstatus', 'residence', 'hostel', 'boarder'],
  },
  {
    key: 'guardianName',
    label: 'Guardian Name',
    required: true,
    group: 'Guardian & Emergency',
    hint: 'Parent or guardian full name (1–120 chars)',
    aliases: [
      'guardian',
      'guardianname',
      'parent',
      'parentname',
      'nextofkin',
      'parentguardian',
    ],
  },
  {
    key: 'guardianPhone',
    label: 'Primary Guardian Phone',
    required: false,
    group: 'Guardian & Emergency',
    hint: 'Malawi (+265...) or local number',
    aliases: [
      'primaryphone',
      'guardianphone',
      'phone',
      'phonenumber',
      'parentphone',
      'mobile',
      'tel',
      'telephone',
      'contactphone',
      'smsphone',
    ],
  },
  {
    key: 'guardianSecondaryPhone',
    label: 'Secondary Phone',
    required: false,
    group: 'Guardian & Emergency',
    hint: 'Alternate guardian phone (max 30 chars)',
    aliases: [
      'secondaryphone',
      'altphone',
      'alternatephone',
      'guardiansecondaryphone',
      'otherphone',
      'phone2',
    ],
  },
  {
    key: 'guardianRelationship',
    label: 'Guardian Relationship',
    required: false,
    group: 'Guardian & Emergency',
    hint: 'Mother, Father, Aunt / Uncle, Legal Guardian, etc.',
    aliases: ['relationship', 'guardianrelationship', 'relation'],
  },
  {
    key: 'emergencyContactName',
    label: 'Emergency Contact Name',
    required: false,
    group: 'Guardian & Emergency',
    hint: 'Backup contact person (max 120 chars)',
    aliases: ['emergencycontact', 'emergencycontactname', 'emergencyname'],
  },
  {
    key: 'emergencyContactPhone',
    label: 'Emergency Contact Phone',
    required: false,
    group: 'Guardian & Emergency',
    hint: 'Backup contact phone (max 30 chars)',
    aliases: ['emergencyphone', 'emergencycontactphone', 'emergencytel'],
  },
  {
    key: 'emergencyNotes',
    label: 'Emergency / Medical Notes',
    required: false,
    group: 'Guardian & Emergency',
    hint: 'Allergies, medical notes, pickup instructions (max 240 chars)',
    aliases: ['emergencynotes', 'medicalnotes', 'notes', 'healthnotes', 'remarks'],
  },
  {
    key: 'studentEmail',
    label: 'Student Email',
    required: false,
    group: 'Portal & Status',
    hint: 'Optional student email (max 160 chars)',
    aliases: ['studentemail', 'email', 'emailaddress'],
  },
  {
    key: 'registrationCode',
    label: 'Registration Code',
    required: false,
    group: 'Portal & Status',
    hint: 'Portal code (min 6 chars) or auto-generated',
    aliases: ['registrationcode', 'regcode', 'portalcode', 'accesscode'],
  },
  {
    key: 'status',
    label: 'Enrollment Status',
    required: false,
    group: 'Portal & Status',
    hint: 'Active, Transferred, Suspended, Rusticated, or Graduated',
    aliases: ['status', 'enrollmentstatus', 'studentstatus'],
  },
];

export type StudentFieldMapping = Record<StudentSchemaFieldKey, number>;

export interface StudentCsvImportDefaults {
  formLevel: FormLevel;
  stream: string;
  gender: Gender;
  boardingStatus: BoardingStatus;
  status: StudentStatus;
  autoGenerateAdmissionNo: boolean;
}

export interface ParsedStudentCsvRow {
  rowNumber: number;
  payload: StudentPayload;
  mappedKeys: Set<StudentSchemaFieldKey>;
  errors: string[];
  existingMatch: Student | null;
  matchReason: 'admissionNo' | 'registrationCode' | null;
}

export function createEmptyStudentMapping(): StudentFieldMapping {
  return {
    admissionNo: -1,
    fullName: -1,
    gender: -1,
    formLevel: -1,
    stream: -1,
    entryYear: -1,
    boardingStatus: -1,
    guardianName: -1,
    guardianPhone: -1,
    guardianSecondaryPhone: -1,
    guardianRelationship: -1,
    emergencyContactName: -1,
    emergencyContactPhone: -1,
    emergencyNotes: -1,
    studentEmail: -1,
    registrationCode: -1,
    status: -1,
  };
}

export function normalizeCsvHeaderKey(raw: string): string {
  return String(raw ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function parseCsvMatrix(text: string): string[][] {
  const normalized = String(text ?? '').replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    const next = normalized[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentCell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentCell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if (ch === '\r' && next === '\n') {
      currentRow.push(currentCell.trim());
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      currentRow.push(currentCell.trim());
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += ch;
    }
  }

  currentRow.push(currentCell.trim());
  if (currentRow.some((cell) => cell.length > 0)) {
    rows.push(currentRow);
  }

  return rows;
}

export function autoDetectStudentFieldMapping(headers: string[]): {
  mapping: StudentFieldMapping;
  autoGenerateAdmissionNo: boolean;
} {
  const mapping = createEmptyStudentMapping();
  const normalizedHeaders = headers.map(normalizeCsvHeaderKey);
  const usedCols = new Set<number>();

  // Pass 1: exact alias match
  for (const field of STUDENT_SCHEMA_FIELDS) {
    const idx = normalizedHeaders.findIndex(
      (h, colIdx) => !usedCols.has(colIdx) && field.aliases.includes(h)
    );
    if (idx !== -1) {
      mapping[field.key] = idx;
      usedCols.add(idx);
    }
  }

  // Pass 2: fuzzy substring match for unmapped fields
  for (const field of STUDENT_SCHEMA_FIELDS) {
    if (mapping[field.key] !== -1) continue;
    const idx = normalizedHeaders.findIndex(
      (h, colIdx) =>
        !usedCols.has(colIdx) &&
        h.length >= 3 &&
        field.aliases.some((alias) => alias.length >= 4 && (h.includes(alias) || alias.includes(h)))
    );
    if (idx !== -1) {
      mapping[field.key] = idx;
      usedCols.add(idx);
    }
  }

  return {
    mapping,
    autoGenerateAdmissionNo: mapping.admissionNo === -1,
  };
}

export function normalizeGenderValue(
  raw: string,
  fallback: Gender
): { value: Gender; error?: string } {
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return { value: fallback };
  if (cleaned === 'm' || cleaned === 'male' || cleaned === 'boy' || cleaned === 'boys') {
    return { value: 'Male' };
  }
  if (cleaned === 'f' || cleaned === 'female' || cleaned === 'girl' || cleaned === 'girls') {
    return { value: 'Female' };
  }
  return { value: fallback, error: `Invalid gender "${raw.trim()}" (expected Male/Female)` };
}

export function normalizeFormAndStreamValues(
  rawForm: string,
  rawStream: string,
  defaultFormLevel: FormLevel,
  defaultStream: string
): { formLevel: FormLevel; stream: string; error?: string } {
  const cleanedForm = rawForm.trim();
  const cleanedStream = rawStream.trim().slice(0, 20);

  if (!cleanedForm) {
    return {
      formLevel: defaultFormLevel,
      stream: cleanedStream || defaultStream.trim().slice(0, 20) || 'A',
    };
  }

  // Match patterns like "Form 2", "F2", "2", "Form 3A", "F4 North", "2-B"
  const match = cleanedForm.match(/^(?:form|f)?\s*([1-4])(?:\s*[-/]?\s*([a-z0-9]+(?:\s+[a-z0-9]+)?))?$/i);
  if (!match) {
    return {
      formLevel: defaultFormLevel,
      stream: cleanedStream || defaultStream.trim().slice(0, 20) || 'A',
      error: `Invalid form "${cleanedForm}" (expected Form 1–4)`,
    };
  }

  const parsedLevel = Number(match[1]) as FormLevel;
  const embeddedStream = (match[2] || '').trim().slice(0, 20);
  const finalStream = cleanedStream || embeddedStream || defaultStream.trim().slice(0, 20) || 'A';

  return {
    formLevel: parsedLevel,
    stream: finalStream,
  };
}

export function normalizeBoardingStatusValue(
  raw: string,
  fallback: BoardingStatus
): { value: BoardingStatus; error?: string } {
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return { value: fallback };
  if (
    cleaned === 'boarder' ||
    cleaned === 'boarding' ||
    cleaned === 'hostel' ||
    cleaned === 'yes' ||
    cleaned === 'b'
  ) {
    return { value: 'Boarder' };
  }
  if (
    cleaned === 'day' ||
    cleaned === 'day scholar' ||
    cleaned === 'dayscholar' ||
    cleaned === 'no' ||
    cleaned === 'd'
  ) {
    return { value: 'Day Scholar' };
  }
  return {
    value: fallback,
    error: `Invalid boarding "${raw.trim()}" (expected Day Scholar/Boarder)`,
  };
}

export function normalizeStudentStatusValue(
  raw: string,
  fallback: StudentStatus
): { value: StudentStatus; error?: string } {
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return { value: fallback };
  const exact = STUDENT_STATUSES.find((s) => s.toLowerCase() === cleaned);
  if (exact) return { value: exact };
  if (cleaned === 'active' || cleaned === 'enrolled') return { value: 'Active' };
  if (cleaned.startsWith('transfer')) return { value: 'Transferred' };
  if (cleaned.startsWith('suspend')) return { value: 'Suspended' };
  if (cleaned.startsWith('rusticat') || cleaned.startsWith('expel')) return { value: 'Rusticated' };
  if (cleaned.startsWith('graduat') || cleaned.startsWith('alumni')) return { value: 'Graduated' };
  return {
    value: fallback,
    error: `Invalid status "${raw.trim()}"`,
  };
}

export function normalizeCsvPhoneValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const malawi = formatMalawiSmsPhone(trimmed);
  if (malawi) return malawi.slice(0, 30);
  return trimmed.slice(0, 30);
}

export function buildStudentImportPreview(params: {
  matrix: string[][];
  mapping: StudentFieldMapping;
  defaults: StudentCsvImportDefaults;
  existingStudents: Student[];
  school: Pick<School, 'academicYear'>;
}): {
  rows: ParsedStudentCsvRow[];
  mappingError: string;
} {
  const { matrix, mapping, defaults, existingStudents, school } = params;

  if (matrix.length < 2) {
    return {
      rows: [],
      mappingError: 'CSV must contain a header row and at least one student row.',
    };
  }

  const missingMappings: string[] = [];
  if (mapping.fullName < 0) missingMappings.push('Full Name');
  if (mapping.guardianName < 0) missingMappings.push('Guardian Name');
  if (!defaults.autoGenerateAdmissionNo && mapping.admissionNo < 0) {
    missingMappings.push('Admission No (or enable auto-generate)');
  }

  if (missingMappings.length > 0) {
    return {
      rows: [],
      mappingError: `Map required student fields before importing: ${missingMappings.join(', ')}.`,
    };
  }

  const existingByAdm = new Map<string, Student>();
  const existingByRegCode = new Map<string, Student>();
  for (const stu of existingStudents) {
    const admKey = stu.admissionNo.trim().toLowerCase();
    if (admKey) existingByAdm.set(admKey, stu);
    const regKey = normalizeRegistrationCode(stu.registrationCode);
    if (regKey.length >= 6) existingByRegCode.set(regKey, stu);
  }

  const mappedKeys = new Set<StudentSchemaFieldKey>();
  for (const field of STUDENT_SCHEMA_FIELDS) {
    if (mapping[field.key] >= 0) {
      mappedKeys.add(field.key);
    }
  }
  if (defaults.autoGenerateAdmissionNo) {
    mappedKeys.add('admissionNo');
  }

  const seenBatchAdms = new Set<string>();
  const seenBatchRegCodes = new Set<string>();
  const defaultYearBase = inferStudentEntryYear(
    { formLevel: defaults.formLevel },
    school.academicYear
  );
  let autoAdmSeq = existingStudents.length + 1;

  const rows: ParsedStudentCsvRow[] = [];

  for (let i = 1; i < matrix.length; i += 1) {
    const rawRow = matrix[i];
    const getCell = (key: StudentSchemaFieldKey): string => {
      const idx = mapping[key];
      return idx >= 0 ? (rawRow[idx] || '').trim() : '';
    };

    const errors: string[] = [];
    const fullNameRaw = getCell('fullName');
    const guardianNameRaw = getCell('guardianName');

    if (fullNameRaw.length < 2) {
      errors.push('Full Name min 2 chars');
    } else if (fullNameRaw.length > 120) {
      errors.push('Full Name max 120 chars');
    }

    if (guardianNameRaw.length < 1) {
      errors.push('Guardian Name required');
    } else if (guardianNameRaw.length > 120) {
      errors.push('Guardian Name max 120 chars');
    }

    const genderRes = normalizeGenderValue(getCell('gender'), defaults.gender);
    if (genderRes.error) errors.push(genderRes.error);

    const formStreamRes = normalizeFormAndStreamValues(
      getCell('formLevel'),
      getCell('stream'),
      defaults.formLevel,
      defaults.stream
    );
    if (formStreamRes.error) errors.push(formStreamRes.error);

    const boardingRes = normalizeBoardingStatusValue(
      getCell('boardingStatus'),
      defaults.boardingStatus
    );
    if (boardingRes.error) errors.push(boardingRes.error);

    const statusRes = normalizeStudentStatusValue(getCell('status'), defaults.status);
    if (statusRes.error) errors.push(statusRes.error);

    let cleanEntryYear: number;
    const rawEntryYear = getCell('entryYear');
    if (rawEntryYear) {
      const parsedYear = Number(rawEntryYear);
      if (!Number.isInteger(parsedYear) || parsedYear < 2000 || parsedYear > 2100) {
        errors.push('Entry year must be 2000–2100');
        cleanEntryYear = defaultYearBase;
      } else {
        cleanEntryYear = parsedYear;
      }
    } else {
      cleanEntryYear = inferStudentEntryYear(
        {
          admissionNo: getCell('admissionNo'),
          formLevel: formStreamRes.formLevel,
        },
        school.academicYear
      );
    }

    let admissionNo = getCell('admissionNo').slice(0, 40);
    if (!admissionNo && defaults.autoGenerateAdmissionNo) {
      let candidate = `SCH/${cleanEntryYear}/${String(autoAdmSeq).padStart(3, '0')}`;
      while (
        existingByAdm.has(candidate.toLowerCase()) ||
        seenBatchAdms.has(candidate.toLowerCase())
      ) {
        autoAdmSeq += 1;
        candidate = `SCH/${cleanEntryYear}/${String(autoAdmSeq).padStart(3, '0')}`;
      }
      autoAdmSeq += 1;
      admissionNo = candidate.slice(0, 40);
    } else if (admissionNo.length < 1) {
      errors.push('Admission No required');
    }

    const rawRegCode = getCell('registrationCode');
    const cleanRegCode = rawRegCode ? normalizeRegistrationCode(rawRegCode) : '';
    if (rawRegCode && cleanRegCode.length < 6) {
      errors.push('Reg code min 6 chars');
    }

    const cleanEmail = getCell('studentEmail').toLowerCase().slice(0, 160);
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      errors.push('Invalid student email');
    }

    const admKey = admissionNo.trim().toLowerCase();
    if (admKey) {
      if (seenBatchAdms.has(admKey)) {
        errors.push(`Duplicate Admission No "${admissionNo}" in CSV`);
      } else {
        seenBatchAdms.add(admKey);
      }
    }

    if (cleanRegCode.length >= 6) {
      if (seenBatchRegCodes.has(cleanRegCode)) {
        errors.push(`Duplicate Reg Code "${cleanRegCode}" in CSV`);
      } else {
        seenBatchRegCodes.add(cleanRegCode);
      }
    }

    const matchedByAdm = admKey ? existingByAdm.get(admKey) || null : null;
    const matchedByCode =
      cleanRegCode.length >= 6 ? existingByRegCode.get(cleanRegCode) || null : null;

    if (matchedByCode && matchedByAdm && matchedByCode.id !== matchedByAdm.id) {
      errors.push(
        `Reg Code ${cleanRegCode} belongs to ${matchedByCode.fullName} (${matchedByCode.admissionNo})`
      );
    } else if (matchedByCode && !matchedByAdm) {
      errors.push(
        `Reg Code ${cleanRegCode} already assigned to ${matchedByCode.fullName}`
      );
    }

    const existingMatch = matchedByAdm || null;
    const matchReason = matchedByAdm ? 'admissionNo' : null;

    const payload: StudentPayload = {
      admissionNo,
      fullName: fullNameRaw.slice(0, 120),
      gender: genderRes.value,
      formLevel: formStreamRes.formLevel,
      stream: formStreamRes.stream,
      entryYear: cleanEntryYear,
      boardingStatus: boardingRes.value,
      guardianName: guardianNameRaw.slice(0, 120),
      guardianPhone: normalizeCsvPhoneValue(getCell('guardianPhone')),
      guardianSecondaryPhone: normalizeCsvPhoneValue(getCell('guardianSecondaryPhone')),
      guardianRelationship: getCell('guardianRelationship').slice(0, 40),
      emergencyContactName: getCell('emergencyContactName').slice(0, 120),
      emergencyContactPhone: normalizeCsvPhoneValue(getCell('emergencyContactPhone')),
      emergencyNotes: getCell('emergencyNotes').slice(0, 240),
      studentEmail: cleanEmail,
      registrationCode: cleanRegCode,
      autoGeneratedCode: cleanRegCode.length === 0,
      status: statusRes.value,
    };

    rows.push({
      rowNumber: i + 1,
      payload,
      mappedKeys,
      errors,
      existingMatch,
      matchReason,
    });
  }

  return { rows, mappingError: '' };
}

export function mergeMappedStudentPayloadForUpdate(
  existing: Student,
  incoming: StudentPayload,
  mappedKeys: ReadonlySet<string>,
  academicYear?: string
): StudentPayload {
  const formLevel = mappedKeys.has('formLevel') ? incoming.formLevel : existing.formLevel;
  const stream = mappedKeys.has('stream') ? incoming.stream : existing.stream;
  const entryYear = mappedKeys.has('entryYear')
    ? incoming.entryYear
    : existing.entryYear ??
      inferStudentEntryYear(
        {
          admissionNo: mappedKeys.has('admissionNo') ? incoming.admissionNo : existing.admissionNo,
          formLevel,
        },
        academicYear
      );

  const incomingRegCode = normalizeRegistrationCode(incoming.registrationCode);
  const existingRegCode = normalizeRegistrationCode(existing.registrationCode);
  const registrationCode =
    mappedKeys.has('registrationCode') && incomingRegCode.length >= 6
      ? incomingRegCode
      : existingRegCode;

  return {
    admissionNo: mappedKeys.has('admissionNo') ? incoming.admissionNo : existing.admissionNo,
    fullName: mappedKeys.has('fullName') ? incoming.fullName : existing.fullName,
    gender: mappedKeys.has('gender') ? incoming.gender : existing.gender,
    formLevel,
    stream,
    entryYear,
    boardingStatus: mappedKeys.has('boardingStatus')
      ? incoming.boardingStatus
      : existing.boardingStatus,
    guardianName: mappedKeys.has('guardianName') ? incoming.guardianName : existing.guardianName,
    guardianPhone: mappedKeys.has('guardianPhone')
      ? incoming.guardianPhone
      : existing.guardianPhone,
    guardianSecondaryPhone: mappedKeys.has('guardianSecondaryPhone')
      ? incoming.guardianSecondaryPhone || ''
      : existing.guardianSecondaryPhone || '',
    guardianRelationship: mappedKeys.has('guardianRelationship')
      ? incoming.guardianRelationship || ''
      : existing.guardianRelationship || '',
    emergencyContactName: mappedKeys.has('emergencyContactName')
      ? incoming.emergencyContactName || ''
      : existing.emergencyContactName || '',
    emergencyContactPhone: mappedKeys.has('emergencyContactPhone')
      ? incoming.emergencyContactPhone || ''
      : existing.emergencyContactPhone || '',
    emergencyNotes: mappedKeys.has('emergencyNotes')
      ? incoming.emergencyNotes || ''
      : existing.emergencyNotes || '',
    studentEmail: mappedKeys.has('studentEmail')
      ? incoming.studentEmail || ''
      : existing.studentEmail || '',
    registrationCode,
    autoGeneratedCode: registrationCode.length === 0,
    status: mappedKeys.has('status') ? incoming.status : existing.status,
  };
}

export const STUDENT_CSV_SAMPLE_HEADERS = [
  'Admission No',
  'Full Name',
  'Gender',
  'Form',
  'Stream',
  'Year of Entry',
  'Boarding',
  'Guardian',
  'Relationship',
  'Primary Phone',
  'Secondary Phone',
  'Emergency Contact',
  'Emergency Phone',
  'Emergency Notes',
  'Student Email',
  'Registration Code',
  'Status',
];

export const STUDENT_CSV_SAMPLE_ROWS: (string | number)[][] = [
  [
    'SCH/2026/001',
    'Chimwemwe Banda',
    'Female',
    'Form 1',
    'A',
    2026,
    'Day Scholar',
    'Mary Banda',
    'Mother',
    '+265999112233',
    '',
    'John Banda',
    '+265888445566',
    '',
    '',
    '',
    'Active',
  ],
  [
    'SCH/2025/014',
    'Kondwani Phiri',
    'Male',
    'Form 2',
    'B',
    2025,
    'Boarder',
    'Grace Phiri',
    'Aunt / Uncle',
    '0888234567',
    '+265999765432',
    'Grace Phiri',
    '+265888234567',
    'Asthma inhaler carried',
    'kondwani.phiri@school.mw',
    '',
    'Active',
  ],
  [
    'SCH/2023/042',
    'Tadala Mwale',
    'Female',
    'Form 4',
    'North',
    2023,
    'Boarder',
    'Peter Mwale',
    'Father',
    '+265991554433',
    '',
    'Esther Mwale',
    '+265991554434',
    '',
    '',
    '',
    'Active',
  ],
];
