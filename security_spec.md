# Security Specification — Malawi Secondary School Management System

## 1. Data Invariants
1. **Strict Ownership, Multi-Role RBAC & Master Gate**: Every school (`/schools/{schoolId}`) has an immutable `ownerId` matching the authenticated, email-verified owner (`request.auth.uid`). School owners can assign staff roles via `/schools/{schoolId}/teachers`, `/staffLinks`, and `/schools/{schoolId}/staffAccess/{staffKey}`:
   - **School Owner / Head Teacher**: Full read/write access across school profile, students, teachers, marks, fees, and attendance.
   - **Deputy Head**: Read/write access to students, assessments, and attendance; read access to school profile and teachers; cannot modify staff role bindings or school billing ownership.
   - **Head of Department / Form Master / Subject Teacher**: Read access to school profile and student roster; read/write access strictly to academic `assessments` and daily `attendance`; zero access to `feeInvoices`, `feePayments`, or `staffAccess` mutations.
   - **School Bursar**: Read access to school profile and student roster; read/write access strictly to `feeInvoices`, `feePayments`, `smsSettings`, and `smsLogs` (MWK billing, receipts, and parent SMS notifications); zero access to `assessments`, `attendance`, or `teachers`.
2. **PII Isolation & Student Read-Only Access**: Student guardian phone numbers, SMS logs, teacher records, and fee ledgers are isolated by role. Verified students (`email_verified == true`) can ONLY read their own `/studentLinks` enrollment header and their own `/schools/{schoolId}/assessments` where `studentEmail == request.auth.token.email.lower()`, with zero write permissions.
3. **Email Verification Enforcement**: Every create, update, and delete operation requires `request.auth.token.email_verified == true`.
4. **Immutable Fields & Temporal Integrity**: `ownerId` and `createdAt` cannot be modified after creation. `createdAt == request.time` on create and `updatedAt == request.time` on update. Staff cannot self-assign or escalate roles (`staffAccess`, `teachers`, and `staffLinks` are writable strictly by `isSchoolOwner(schoolId)`). `smsLogs` are immutable once created (`update: false`) and enforce valid `studentId` and `invoiceId` existence.
5. **Relational & Atomic Integrity**:
   - Assessments, Fee Invoices, and SMS Logs validate `exists(/databases/$(database)/documents/schools/$(schoolId)/students/$(incoming().studentId))`.
   - Fee Payments are immutable receipts that enforce atomic synchronization with the parent `feeInvoices/{invoiceId}` document via `getAfter()` so a payment cannot exist without incrementing the invoice's `totalPaid`.
6. **Strict Schema & Bounds**: Every string has `.size() <= MAX`, every number has valid range checks (`formLevel in [1,2,3,4]`, `ca1Raw <= ca1Max <= 1000`, `ca1Score <= 20`, `ca2Raw <= ca2Max <= 1000`, `ca2Score <= 20`, `caScore >= 0 && caScore <= 40`, `examRaw <= examMax <= 1000`, `examScore >= 0 && examScore <= 60`, `amount > 0`, `message.size() <= 320`), and every `create`/`update` enforces `keys().hasAll(...) && keys().hasOnly(...)` / `affectedKeys().hasOnly(...)`.

## 2. The "Dirty Dozen" Payloads (Must All Return PERMISSION_DENIED)
1. **Unauthenticated Read**: `get(/schools/sch1/students/stu1)` with `auth = null`.
2. **Unverified Email Write**: `create /schools/sch1` with `auth.token.email_verified = false`.
3. **Identity Spoofing on Create**: `create /schools/sch1/students/stu1` with `ownerId: "victim-uid"` when `auth.uid = "attacker-uid"`.
4. **Privilege Escalation**: `create /admins/attacker-uid` with `{ email: "attacker@example.com" }`.
5. **Shadow / Ghost Field Injection**: `create /schools/sch1/students/stu1` including unexpected field `isScholarship: true`.
6. **Oversized ID Poisoning**: `create /schools/sch1/students/<200-char-string>` or invalid characters `stu$1`.
7. **Oversized String DoW**: `create /schools/sch1/students/stu1` with `fullName` of 500 characters (`> 120`).
8. **Cross-Tenant List Scraping**: `list /schools/sch1/students` without filtering `ownerId == auth.uid` (or querying another user's `ownerId`).
9. **Immutable Owner Tampering**: `update /schools/sch1/students/stu1` changing `ownerId` or `createdAt`.
10. **Client-Forged Timestamp**: `create /schools/sch1` with `createdAt: Timestamp(2020-01-01)` instead of `request.time`.
11. **Orphaned Fee Payment (Sync Bypass)**: `create /schools/sch1/feePayments/pay1` without atomically updating `feeInvoices/{invoiceId}.totalPaid` in the same batch.
12. **Score Range Overflow**: `create /schools/sch1/assessments/a1` with `caScore: 95` (`> 40`) or `totalScore: 150` (`> 100`).
