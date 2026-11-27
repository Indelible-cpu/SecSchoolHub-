import type { Timestamp } from 'firebase/firestore';

export type SchoolSection =
  | 'overview'
  | 'students'
  | 'marks'
  | 'fees'
  | 'library'
  | 'timebook'
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
export type StudentStatus = 'Active' | 'Transferred' | 'Suspended' | 'Rusticated' | 'Graduated';
export type TeacherRole =
  | 'Head Teacher'
  | 'Deputy Head'
  | 'Head of Department'
  | 'Form Teacher'
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
  logoDataUrl?: string;
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
  photoDataUrl?: string;
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
  logoDataUrl?: string;
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
  teacherComment?: string;
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
  logoDataUrl?: string;
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
  logoDataUrl?: string;
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
  canReadStaffAttendance: boolean;
  canWriteStaffAttendance: boolean;
  canAccessTimebook: boolean;
  canManageTimebook: boolean;
  canManageStudentCases: boolean;
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
  teacherComment?: string;
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

export interface StudentPortalFeeInvoice {
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

export type FeeSubmissionStatus = 'Pending' | 'Approved' | 'Rejected';
export type FeeSubmissionFileFormat = 'pdf' | 'image';

export interface StudentFeeSubmission {
  id: string;
  ownerId: string;
  schoolId: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  formLevel: FormLevel;
  stream: string;
  registrationCode: string;
  invoiceId: string;
  term: TermName;
  academicYear: string;
  amount: number;
  method: PaymentMethod;
  reference: string;
  notes: string;
  fileName: string;
  mimeType: string;
  fileFormat: FeeSubmissionFileFormat;
  fileSizeBytes: number;
  chunkCount: number;
  status: FeeSubmissionStatus;
  reviewNote: string;
  receiptNo: string;
  submittedDate: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
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

export interface LibraryBook {
  id: string;
  ownerId: string;
  isbn: string;
  title: string;
  author: string;
  subject: string;
  materialType: LibraryMaterialCategory;
  shelfCode: string;
  totalCopies: number;
  notes: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type LibraryTransactionAction =
  | 'Checked Out'
  | 'Returned'
  | 'Reopened'
  | 'Edited'
  | 'Deleted';

export interface LibraryTransaction {
  id: string;
  ownerId: string;
  loanId: string;
  action: LibraryTransactionAction;
  studentId: string;
  studentName: string;
  admissionNo: string;
  formLevel: FormLevel;
  stream: string;
  bookTitle: string;
  bookCode: string;
  subject: string;
  quantity: number;
  eventDate: string;
  dueDate: string;
  condition: LibraryItemCondition;
  actorUid: string;
  actorName: string;
  notes: string;
  createdAt?: Timestamp;
}

export type LibraryReservationStatus = 'Pending' | 'Ready' | 'Fulfilled' | 'Cancelled';

export interface LibraryReservation {
  id: string;
  ownerId: string;
  schoolId: string;
  bookId: string;
  isbn: string;
  bookTitle: string;
  subject: string;
  materialType: LibraryMaterialCategory;
  studentId: string;
  studentName: string;
  admissionNo: string;
  formLevel: FormLevel;
  stream: string;
  registrationCode: string;
  status: LibraryReservationStatus;
  requestedDate: string;
  notes: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface CatalogBookMirror {
  id: string;
  ownerId: string;
  schoolId: string;
  isbn: string;
  title: string;
  author: string;
  subject: string;
  materialType: LibraryMaterialCategory;
  shelfCode: string;
  totalCopies: number;
  checkedOutCopies: number;
  availableCopies: number;
  notes: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type DigitalResourceCategory =
  | 'Book'
  | 'Past Paper'
  | 'Revision Guide'
  | 'Set Book'
  | 'Teaching Resource'
  | 'Scheme of Work'
  | 'Lesson Plan';
export type DigitalResourceFormLevel = 'All' | 'Form 1' | 'Form 2' | 'Form 3' | 'Form 4';
export type DigitalStorageFormat = 'text' | 'pdf' | 'image';

export interface DigitalLibraryResource {
  id: string;
  ownerId: string;
  schoolId: string;
  title: string;
  author: string;
  subject: string;
  formLevel: DigitalResourceFormLevel;
  category: DigitalResourceCategory;
  examYear: string;
  summary: string;
  content: string;
  storageFormat?: DigitalStorageFormat;
  fileName?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  chunkCount?: number;
  allowOffline: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type AnnouncementAudience = 'Teachers' | 'Librarian' | 'Bursar' | 'Students';

export interface SchoolAnnouncement {
  id: string;
  ownerId: string;
  schoolId: string;
  title: string;
  message: string;
  targetAudiences: AnnouncementAudience[];
  publishedDate: string;
  authorName: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type LibraryReadingMode = 'online' | 'offline';

export interface LibraryReadingSession {
  id: string;
  ownerId: string;
  schoolId: string;
  resourceId: string;
  readerKey: string;
  registrationCode: string;
  mode: LibraryReadingMode;
  isReading: boolean;
  isRead: boolean;
  lastReadPage: number;
  lastReadAtMs: number;
  expiresAtMs: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type StaffAttendanceStatus = 'Present' | 'Absent' | 'Late' | 'On Leave';

export interface StaffAttendanceRecord {
  id: string;
  ownerId: string;
  schoolId: string;
  date: string;
  teacherId: string;
  staffCode: string;
  staffName: string;
  roleTitle: TeacherRole;
  status: StaffAttendanceStatus;
  note: string;
  recordedBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type StudentCaseType =
  | 'Suspension'
  | 'Rustication'
  | 'Warning'
  | 'Misconduct'
  | 'Truancy'
  | 'Other';

export type StudentCaseSeverity = 'Minor' | 'Moderate' | 'Severe';

export type StudentCaseStatus =
  | 'Open'
  | 'Under Review'
  | 'Serving Suspension'
  | 'Rusticated'
  | 'Resolved'
  | 'Appealed';

export interface StudentCase {
  id: string;
  ownerId: string;
  schoolId: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  formLevel: FormLevel;
  stream: string;
  caseType: StudentCaseType;
  severity: StudentCaseSeverity;
  status: StudentCaseStatus;
  title: string;
  description: string;
  actionTaken: string;
  incidentDate: string;
  suspensionEndDate: string;
  guardianNotified: boolean;
  recordedBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type TimebookEntryStatus =
  | 'Present'
  | 'Late'
  | 'Absent'
  | 'Pending Correction'
  | 'Administratively Recorded'
  | 'On Leave';

export type TimebookRecordingMethod = 'GPS Auto' | 'Admin Recorded';

export type TimebookGpsVerificationStatus =
  | 'Verified'
  | 'Outside Geofence'
  | 'Accuracy Insufficient'
  | 'Unavailable'
  | 'Admin Override';

export type TimebookCorrectionStatus = 'None' | 'Pending' | 'Approved' | 'Rejected';

export type TimebookUiStateCode =
  | 'A_LOCATION_NOT_VERIFIED'
  | 'B_OUTSIDE_PREMISES'
  | 'C_GPS_PERMISSION_DENIED'
  | 'D_GPS_ACCURACY_INSUFFICIENT'
  | 'E_LOCATION_VERIFIED'
  | 'F_ATTENDANCE_RECORDED'
  | 'G_WINDOW_CLOSED'
  | 'H_ALREADY_RECORDED';

export interface TimebookHoliday {
  date: string;
  name: string;
}

export interface TimebookSettings {
  id: string;
  ownerId: string;
  schoolId: string;
  enabled: boolean;
  locationConfigured: boolean;
  locationLabel: string;
  schoolLatitude: number;
  schoolLongitude: number;
  radiusMeters: number;
  maxAccuracyMeters: number;
  timezone: string;
  windowStartHHMM: string;
  defaultDeadlineHHMM: string;
  categoryDeadlines: Record<string, string>;
  workdays: number[];
  holidays: TimebookHoliday[];
  reminderSlots: string[];
  remindersEnabled: boolean;
  updatedBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface StaffTimebookEntry {
  id: string;
  ownerId: string;
  schoolId: string;
  date: string;
  teacherId: string;
  staffUid: string;
  staffCode: string;
  staffName: string;
  roleTitle: TeacherRole;
  status: TimebookEntryStatus;
  recordingMethod: TimebookRecordingMethod;
  timeInServer?: Timestamp | null;
  timeInDisplay: string;
  gpsVerificationStatus: TimebookGpsVerificationStatus;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  accuracyMeters: number;
  deadlineHHMM: string;
  isSuspicious: boolean;
  spoofingFlags: string[];
  correctionStatus: TimebookCorrectionStatus;
  correctionReason: string;
  authorizedByUid: string;
  authorizedByName: string;
  serverReceiptSignature: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type TimebookCorrectionRequestStatus = 'Pending' | 'Approved' | 'Rejected';

export interface TimebookCorrectionRequest {
  id: string;
  ownerId: string;
  schoolId: string;
  date: string;
  teacherId: string;
  staffUid: string;
  staffCode: string;
  staffName: string;
  roleTitle: TeacherRole;
  currentStatus: string;
  requestedStatus: 'Present' | 'Late' | 'On Leave';
  explanation: string;
  status: TimebookCorrectionRequestStatus;
  adminNote: string;
  reviewedByUid: string;
  reviewedByName: string;
  reviewedAtIso: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface TimebookAuditLog {
  id: string;
  ownerId: string;
  schoolId: string;
  entryId: string;
  teacherId: string;
  staffCode: string;
  staffName: string;
  attendanceDate: string;
  originalStatus: string;
  correctedStatus: string;
  previousValues: string;
  updatedValues: string;
  explanation: string;
  authorizedByUid: string;
  authorizedByName: string;
  createdAt?: Timestamp;
}

export interface TimebookSuspiciousLog {
  id: string;
  ownerId: string;
  schoolId: string;
  date: string;
  teacherId: string;
  staffUid: string;
  staffName: string;
  roleTitle: TeacherRole;
  reasonCode: string;
  detail: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  accuracyMeters: number;
  clientTimestampIso: string;
  serverTimeIso: string;
  createdAt?: Timestamp;
}

export interface TimebookNotification {
  id: string;
  ownerId: string;
  schoolId: string;
  date: string;
  teacherId: string;
  staffUid: string;
  staffEmail: string;
  slot: string;
  title: string;
  message: string;
  urgency: 'info' | 'warning' | 'urgent' | 'closed';
  readAtMs: number;
  createdAtMs: number;
  createdAt?: Timestamp;
}

export type BackupCadence = 'daily' | 'weekly';
export type BackupStorageTarget = 'firebase-storage' | 'cloud-bucket' | 'server-vault';
export type BackupTriggerType = 'manual' | 'automated';
export type BackupRunStatus = 'Completed' | 'Failed';

export interface BackupSettings {
  id: string;
  ownerId: string;
  schoolId: string;
  autoBackupEnabled: boolean;
  cadence: BackupCadence;
  preferredHourUTC: number;
  retentionCount: number;
  storageTarget: 'firebase-storage' | 'cloud-bucket';
  lastBackupAtIso: string;
  lastBackupId: string;
  lastBackupStatus: 'Never' | BackupRunStatus;
  nextBackupDueIso: string;
  updatedByUid: string;
  updatedByName: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface BackupSnapshotLog {
  id: string;
  ownerId: string;
  schoolId: string;
  snapshotId: string;
  triggerType: BackupTriggerType;
  storageTarget: BackupStorageTarget;
  bucketName: string;
  objectPath: string;
  status: BackupRunStatus;
  totalDocuments: number;
  collectionCount: number;
  sizeBytes: number;
  checksumSha256: string;
  downloadUrl: string;
  triggeredByUid: string;
  triggeredByName: string;
  completedAtIso: string;
  errorReason: string;
  createdAt?: Timestamp;
}

export interface StudentReportRemark {
  id: string;
  ownerId: string;
  schoolId: string;
  registrationCode?: string;
  studentId: string;
  studentName: string;
  formLevel: FormLevel;
  stream: string;
  term: TermName;
  academicYear: string;
  formTeacherRemark: string;
  headTeacherRemark: string;
  nextTermOpens: string;
  formTeacherName?: string;
  headTeacherName?: string;
  updatedByName?: string;
  updatedByRole?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}
