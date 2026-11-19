import type { Timestamp } from 'firebase/firestore';

export type SchoolSection =
  | 'overview'
  | 'students'
  | 'marks'
  | 'fees'
  | 'attendance'
  | 'library'
  | 'staff';

export type SchoolType =
  | 'Government Day'
  | 'Government Boarding'
  | 'Grant-Aided'
  | 'Private';

export type TermName = 'Term 1' | 'Term 2' | 'Term 3';
export type FormLevel = 1 | 2 | 3 | 4;
export type Gender = 'Male' | 'Female';
export type BoardingStatus = 'Day Scholar' | 'Boarder';
export type StudentStatus = 'Active' | 'Transferred' | 'Suspended' | 'Graduated';
export type TeacherRole =
  | 'Head Teacher'
  | 'Deputy Head'
  | 'Head of Department'
  | 'Form Master'
  | 'Subject Teacher'
  | 'School Librarian'
  | 'School Bursar';
export type PaymentMethod =
  | 'Cash (Bursar)'
  | 'Bank Deposit'
  | 'Airtel Money'
  | 'TNM Mpamba';
export type InvoiceStatus = 'Unpaid' | 'Partial' | 'Paid';
export type AttendanceStatus = 'Present' | 'Absent' | 'Late' | 'Excused';

export interface School {
  id: string;
  ownerId: string;
  name: string;
  district: string;
  schoolType: SchoolType;
  motto: string;
  academicYear: string;
  currentTerm: TermName;
  defaultTuitionMWK: number;
  defaultGpfMWK: number;
  defaultExamFeeMWK: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Student {
  id: string;
  ownerId: string;
  admissionNo: string;
  fullName: string;
  gender: Gender;
  formLevel: FormLevel;
  stream: string;
  entryYear?: number;
  boardingStatus: BoardingStatus;
  guardianName: string;
  guardianPhone: string;
  guardianSecondaryPhone?: string;
  guardianRelationship?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyNotes?: string;
  studentEmail?: string;
  registrationCode?: string;
  status: StudentStatus;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface StudentPortal {
  id: string;
  ownerId: string;
  schoolId: string;
  schoolName: string;
  schoolDistrict: string;
  schoolType: SchoolType;
  motto: string;
  academicYear: string;
  currentTerm: TermName;
  studentId: string;
  studentName: string;
  admissionNo: string;
  formLevel: FormLevel;
  stream: string;
  boardingStatus: BoardingStatus;
  registrationCode: string;
  status: StudentStatus;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface StudentPortalResult {
  id: string;
  ownerId: string;
  schoolId: string;
  registrationCode: string;
  studentId: string;
  studentName: string;
  formLevel: FormLevel;
  stream: string;
  term: TermName;
  academicYear: string;
  subject: string;
  ca1Raw?: number;
  ca1Max?: number;
  ca1Score?: number;
  ca2Raw?: number;
  ca2Max?: number;
  ca2Score?: number;
  caScore: number;
  examRaw?: number;
  examMax?: number;
  examScore: number;
  totalScore: number;
  grade: string;
  gradePoint: number;
  remark: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface StudentLink {
  id: string;
  ownerId: string;
  schoolId: string;
  schoolName: string;
  schoolDistrict: string;
  schoolType: SchoolType;
  motto: string;
  academicYear: string;
  currentTerm: TermName;
  studentId: string;
  studentName: string;
  admissionNo: string;
  formLevel: FormLevel;
  stream: string;
  boardingStatus: BoardingStatus;
  studentEmail: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Teacher {
  id: string;
  ownerId: string;
  staffCode: string;
  fullName: string;
  roleTitle: TeacherRole;
  subjects: string[];
  assignedForm: string;
  phone: string;
  staffEmail?: string;
  status: 'Active' | 'On Leave';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface StaffLink {
  id: string;
  ownerId: string;
  schoolId: string;
  schoolName: string;
  schoolDistrict: string;
  schoolType: SchoolType;
  academicYear: string;
  currentTerm: TermName;
  teacherId: string;
  staffName: string;
  staffCode: string;
  roleTitle: TeacherRole;
  subjects: string[];
  assignedForm: string;
  staffEmail: string;
  status: 'Active' | 'On Leave';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type WorkspaceRole = 'Owner' | TeacherRole;

export interface RolePermissions {
  role: WorkspaceRole;
  roleLabel: string;
  homeTitle: string;
  allowedSections: SchoolSection[];
  canManageSchool: boolean;
  canManageStaff: boolean;
  canManageStudents: boolean;
  canReadMarks: boolean;
  canWriteMarks: boolean;
  canReadFees: boolean;
  canWriteFees: boolean;
  canReadAttendance: boolean;
  canWriteAttendance: boolean;
  canReadLibrary: boolean;
  canWriteLibrary: boolean;
  canReadTeachers: boolean;
}

export type AssessmentType = 'ca1' | 'ca2' | 'exam';

export interface Assessment {
  id: string;
  ownerId: string;
  studentId: string;
  studentName: string;
  studentEmail?: string;
  formLevel: FormLevel;
  stream: string;
  term: TermName;
  academicYear: string;
  subject: string;
  ca1Raw?: number;
  ca1Max?: number;
  ca1Score?: number;
  ca2Raw?: number;
  ca2Max?: number;
  ca2Score?: number;
  caScore: number;
  examRaw?: number;
  examMax?: number;
  examScore: number;
  totalScore: number;
  grade: string;
  gradePoint: number;
  remark: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface FeeInvoice {
  id: string;
  ownerId: string;
  studentId: string;
  studentName: string;
  formLevel: FormLevel;
  stream: string;
  term: TermName;
  academicYear: string;
  tuitionFee: number;
  gpfFee: number;
  examFee: number;
  otherFee: number;
  totalBilled: number;
  totalPaid: number;
  status: InvoiceStatus;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface FeePayment {
  id: string;
  ownerId: string;
  invoiceId: string;
  studentId: string;
  studentName: string;
  receiptNo: string;
  amount: number;
  method: PaymentMethod;
  reference: string;
  term: TermName;
  createdAt?: Timestamp;
}

export interface AttendanceRecord {
  id: string;
  ownerId: string;
  date: string;
  formLevel: FormLevel;
  stream: string;
  studentId: string;
  studentName: string;
  status: AttendanceStatus;
  note: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type SmsNotificationType = 'Payment Confirmation' | 'Low Balance Alert';
export type SmsDeliveryStatus = 'Sent' | 'Simulated' | 'Failed' | 'Skipped';

export interface SmsConfig {
  id: string;
  ownerId: string;
  autoPaymentSms: boolean;
  autoLowBalanceSms: boolean;
  lowBalanceThresholdMWK: number;
  senderLabel: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface SmsLog {
  id: string;
  ownerId: string;
  invoiceId: string;
  studentId: string;
  studentName: string;
  guardianName: string;
  guardianPhone: string;
  type: SmsNotificationType;
  message: string;
  amountMWK: number;
  balanceAfterMWK: number;
  status: SmsDeliveryStatus;
  provider: string;
  providerRef: string;
  errorReason: string;
  term: TermName;
  createdAt?: Timestamp;
}

export interface SchoolSubject {
  id: string;
  ownerId: string;
  name: string;
  code: string;
  formLevels: FormLevel[];
  isCore: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type LibraryMaterialCategory =
  | 'Textbook'
  | 'Set Book'
  | 'Reference Book'
  | 'Past Papers'
  | 'Reader / Novel'
  | 'Science Manual';

export type LibraryLoanStatus = 'Checked Out' | 'Returned';
export type LibraryItemCondition = 'Good' | 'Fair' | 'Damaged' | 'Lost';

export interface LibraryLoan {
  id: string;
  ownerId: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  formLevel: FormLevel;
  stream: string;
  bookTitle: string;
  materialType: LibraryMaterialCategory;
  subject: string;
  bookCode: string;
  quantity: number;
  checkoutDate: string;
  dueDate: string;
  returnedDate: string;
  status: LibraryLoanStatus;
  conditionOnReturn: LibraryItemCondition;
  notes: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}
