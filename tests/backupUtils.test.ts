import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  buildSchoolSnapshotEnvelope,
  computeNextScheduledBackupIso,
  computeSha256Hex,
  formatBackupBytes,
  isScheduledBackupDue,
  isValidBackupIdentifier,
  serializeFirestoreValue,
} from '../src/school/backupSnapshotUtils.ts';
import {
  buildBucketObjectKey,
  deleteSchoolSnapshotFromServerBucket,
  isCallerAuthorizedOwner,
  readSchoolSnapshotFromServerBucket,
  resolveVaultBackupPaths,
  uploadSchoolSnapshotToServerBucket,
  validateExternalEndpointUrl,
} from '../server/backupBucket.ts';
import type { VerifiedFirebaseUser } from '../server/firebaseAuth.ts';

test('serializeFirestoreValue converts Timestamps, Dates, and nested objects deterministically', () => {
  const input = {
    b: 2,
    a: {
      seconds: 1700000000,
      nanoseconds: 500000000,
      toDate: () => new Date(1700000000500),
    },
    created: new Date('2026-11-25T10:00:00.000Z'),
  };

  const out = serializeFirestoreValue(input) as Record<string, unknown>;
  assert.deepEqual(Object.keys(out), ['a', 'b', 'created']);
  assert.deepEqual(out.a, {
    __type: 'timestamp',
    iso: '2023-11-14T22:13:20.500Z',
    seconds: 1700000000,
    nanoseconds: 500000000,
  });
  assert.deepEqual(out.created, {
    __type: 'date',
    iso: '2026-11-25T10:00:00.000Z',
  });
});

test('buildSchoolSnapshotEnvelope and computeSha256Hex produce accurate counts and digest', async () => {
  const envelope = buildSchoolSnapshotEnvelope({
    snapshotId: 'snap_20261125_abc12',
    exportedAtIso: '2026-11-25T12:00:00.000Z',
    triggerType: 'manual',
    schoolId: 'sch_test_01',
    ownerId: 'owner_uid_1',
    schoolName: 'Lilongwe Girls Secondary',
    triggeredByUid: 'owner_uid_1',
    triggeredByName: 'School Owner',
    schoolDoc: { ownerId: 'owner_uid_1', name: 'Lilongwe Girls Secondary' },
    collections: {
      students: [
        { id: 'stu_2', data: { fullName: 'Banda Chimwemwe' } },
        { id: 'stu_1', data: { fullName: 'Phiri Kondwani' } },
      ],
      teachers: [{ id: 'tch_1', data: { fullName: 'Mr. Mwale' } }],
    },
  });

  assert.equal(envelope.totalDocuments, 4);
  assert.equal(envelope.collectionCount, 3);
  assert.deepEqual(envelope.collectionCounts, { students: 2, teachers: 1 });
  assert.deepEqual(
    envelope.collections.students.map((d) => d.id),
    ['stu_1', 'stu_2']
  );

  const hash = await computeSha256Hex(JSON.stringify(envelope));
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(formatBackupBytes(2048), '2.0 KB');
});

test('automated backup scheduler calculates next UTC slot and detects overdue schedules', () => {
  const now = Date.parse('2026-11-25T05:30:00.000Z');
  const nextDaily = computeNextScheduledBackupIso('daily', 2, now, false);
  assert.equal(nextDaily, '2026-11-26T02:00:00.000Z');

  const nextWeekly = computeNextScheduledBackupIso('weekly', 3, now, true);
  assert.equal(nextWeekly, '2026-12-02T03:00:00.000Z');

  assert.equal(
    isScheduledBackupDue(
      {
        autoBackupEnabled: true,
        cadence: 'daily',
        lastBackupAtIso: '2026-11-24T02:00:00.000Z',
        nextBackupDueIso: '2026-11-25T02:00:00.000Z',
      },
      now
    ),
    true
  );

  assert.equal(
    isScheduledBackupDue(
      {
        autoBackupEnabled: false,
        cadence: 'daily',
        lastBackupAtIso: '',
        nextBackupDueIso: '2026-11-25T02:00:00.000Z',
      },
      now
    ),
    false
  );
});

test('server backup bucket rejects path traversal, SSRF endpoints, and unauthorized callers', () => {
  assert.equal(isValidBackupIdentifier('../etc/passwd'), false);
  assert.equal(isValidBackupIdentifier('sch_test_01'), true);

  assert.throws(() => resolveVaultBackupPaths('../escape', 'snap_1'));
  assert.throws(() => resolveVaultBackupPaths('sch_1', 'snap/../../evil'));
  assert.equal(buildBucketObjectKey('/prefix/', 'sch_1', 'snap_1'), 'prefix/schools/sch_1/snap_1.json');

  assert.equal(validateExternalEndpointUrl('http://169.254.169.254/latest').ok, false);
  assert.equal(validateExternalEndpointUrl('http://s3.amazonaws.com').ok, false);
  assert.equal(validateExternalEndpointUrl('https://storage.googleapis.com').ok, true);

  const ownerUser: VerifiedFirebaseUser = {
    uid: 'owner_uid_1',
    email: 'owner@school.mw',
    emailVerified: true,
    name: 'School Owner',
  };
  const otherTeacher: VerifiedFirebaseUser = {
    uid: 'teacher_uid_2',
    email: 'teacher@school.mw',
    emailVerified: true,
    name: 'Teacher',
  };

  assert.equal(isCallerAuthorizedOwner(ownerUser, 'owner_uid_1'), true);
  assert.equal(isCallerAuthorizedOwner(otherTeacher, 'owner_uid_1'), false);
});

test('server backup vault round-trips SHA-256 verified upload, owner download, and deletion', async () => {
  const schoolId = 'sch_unit_test_vault';
  const ownerId = 'owner_uid_vault';
  const snapshotId = 'snap_unit_test_001';
  const ownerUser: VerifiedFirebaseUser = {
    uid: ownerId,
    email: 'owner@school.mw',
    emailVerified: true,
    name: 'School Owner',
  };
  const attackerUser: VerifiedFirebaseUser = {
    uid: 'attacker_uid',
    email: 'attacker@school.mw',
    emailVerified: true,
    name: 'Attacker',
  };

  const payload = JSON.stringify({
    schemaVersion: 1,
    snapshotId,
    schoolId,
    ownerId,
    totalDocuments: 2,
    collections: { students: [] },
  });
  const sha = await computeSha256Hex(payload);

  // Checksum tamper should fail
  await assert.rejects(() =>
    uploadSchoolSnapshotToServerBucket({
      caller: ownerUser,
      schoolId,
      ownerId,
      snapshotId,
      snapshotJson: payload,
      expectedSha256: '0'.repeat(64),
    })
  );

  // Valid upload should store in vault
  const uploaded = await uploadSchoolSnapshotToServerBucket({
    caller: ownerUser,
    schoolId,
    ownerId,
    snapshotId,
    snapshotJson: payload,
    expectedSha256: sha,
  });
  assert.equal(uploaded.storageTarget, 'server-vault');
  assert.equal(uploaded.checksumSha256, sha);

  // Non-owner download must be rejected
  await assert.rejects(() =>
    readSchoolSnapshotFromServerBucket({
      caller: attackerUser,
      schoolId,
      snapshotId,
    })
  );

  // Owner download succeeds with exact content
  const downloaded = await readSchoolSnapshotFromServerBucket({
    caller: ownerUser,
    schoolId,
    snapshotId,
  });
  assert.equal(downloaded.buffer.toString('utf8'), payload);

  // Clean up test vault files
  await deleteSchoolSnapshotFromServerBucket({
    caller: ownerUser,
    schoolId,
    ownerId,
    snapshotId,
  });
  const schoolVaultDir = path.resolve(process.cwd(), '.data', 'backups', schoolId);
  if (fs.existsSync(schoolVaultDir)) {
    fs.rmSync(schoolVaultDir, { recursive: true, force: true });
  }
});
