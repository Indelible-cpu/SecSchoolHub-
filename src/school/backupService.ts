import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';
import { auth, db, handleFirestoreError, OperationType, storage } from '../firebase';
import {
  BACKUP_MIRROR_SUBCOLLECTIONS,
  BACKUP_SCHOOL_SUBCOLLECTIONS,
  buildSchoolSnapshotEnvelope,
  clampPreferredHourUtc,
  clampRetentionCount,
  computeNextScheduledBackupIso,
  computeSha256Hex,
  createSnapshotId,
  isValidBackupIdentifier,
  type SchoolSnapshotDocumentRecord,
  type SchoolSnapshotEnvelope,
} from './backupSnapshotUtils';
import type {
  BackupCadence,
  BackupSettings,
  BackupSnapshotLog,
  BackupStorageTarget,
  BackupTriggerType,
  School,
} from './types';

export interface ServerBucketStatus {
  configuredExternalBucket: boolean;
  providerLabel: string;
  bucketName: string;
  vaultAvailable: boolean;
  configError?: string;
}

export interface BackupProgressState {
  stepIndex: number;
  totalSteps: number;
  currentLabel: string;
  documentsCollected: number;
}

export interface SaveBackupSettingsInput {
  schoolId: string;
  ownerId: string;
  autoBackupEnabled: boolean;
  cadence: BackupCadence;
  preferredHourUTC: number;
  retentionCount: number;
  storageTarget: 'firebase-storage' | 'cloud-bucket';
  updatedByName: string;
  existingSettings?: BackupSettings | null;
}

export interface RunFullBackupResult {
  log: BackupSnapshotLog;
  envelope: SchoolSnapshotEnvelope;
  snapshotJson: string;
  fallbackNotice?: string;
}

async function getVerifiedAuthToken(): Promise<{ token: string; uid: string; name: string }> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('School Owner sign-in is required to perform database backups.');
  }
  const token = await user.getIdToken();
  return {
    token,
    uid: user.uid,
    name: (user.displayName || user.email || 'School Owner').trim().slice(0, 120),
  };
}

export async function fetchServerBackupBucketStatus(): Promise<ServerBucketStatus> {
  const { token } = await getVerifiedAuthToken();
  const res = await fetch('/api/backups/status', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await res.json().catch(() => ({}))) as Partial<ServerBucketStatus> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Unable to check server backup bucket status (HTTP ${res.status}).`);
  }
  return {
    configuredExternalBucket: Boolean(data.configuredExternalBucket),
    providerLabel: data.providerLabel || 'Secure Server Backup Vault',
    bucketName: data.bucketName || 'server-local-vault',
    vaultAvailable: data.vaultAvailable !== false,
    configError: data.configError,
  };
}

export async function saveBackupSettings(input: SaveBackupSettingsInput): Promise<void> {
  const { uid } = await getVerifiedAuthToken();
  const path = `schools/${input.schoolId}/backupSettings/default`;
  const settingsRef = doc(db, 'schools', input.schoolId, 'backupSettings', 'default');

  const preferredHourUTC = clampPreferredHourUtc(input.preferredHourUTC);
  const retentionCount = clampRetentionCount(input.retentionCount);
  const nextBackupDueIso = input.autoBackupEnabled
    ? computeNextScheduledBackupIso(input.cadence, preferredHourUTC, Date.now(), false)
    : '';
  const updatedByName = (input.updatedByName || 'School Owner').trim().slice(0, 120) || 'School Owner';

  try {
    const existingSnap = await getDoc(settingsRef);
    if (!existingSnap.exists()) {
      await setDoc(settingsRef, {
        ownerId: input.ownerId,
        schoolId: input.schoolId,
        autoBackupEnabled: Boolean(input.autoBackupEnabled),
        cadence: input.cadence,
        preferredHourUTC,
        retentionCount,
        storageTarget: input.storageTarget,
        lastBackupAtIso: input.existingSettings?.lastBackupAtIso || '',
        lastBackupId: input.existingSettings?.lastBackupId || '',
        lastBackupStatus: input.existingSettings?.lastBackupStatus || 'Never',
        nextBackupDueIso,
        updatedByUid: uid,
        updatedByName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(settingsRef, {
        autoBackupEnabled: Boolean(input.autoBackupEnabled),
        cadence: input.cadence,
        preferredHourUTC,
        retentionCount,
        storageTarget: input.storageTarget,
        nextBackupDueIso,
        updatedByUid: uid,
        updatedByName,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function collectSchoolFirestoreSnapshot(params: {
  school: School;
  triggerType: BackupTriggerType;
  triggeredByUid: string;
  triggeredByName: string;
  snapshotId: string;
  onProgress?: (progress: BackupProgressState) => void;
}): Promise<{
  envelope: SchoolSnapshotEnvelope;
  snapshotJson: string;
  checksumSha256: string;
  sizeBytes: number;
}> {
  const totalSteps =
    1 + BACKUP_SCHOOL_SUBCOLLECTIONS.length + BACKUP_MIRROR_SUBCOLLECTIONS.length;
  let stepIndex = 0;
  let documentsCollected = 0;

  const report = (label: string) => {
    params.onProgress?.({
      stepIndex,
      totalSteps,
      currentLabel: label,
      documentsCollected,
    });
  };

  report('School workspace profile');
  let schoolDoc: Record<string, unknown> | null = null;
  const schoolPath = `schools/${params.school.id}`;
  try {
    const snap = await getDoc(doc(db, 'schools', params.school.id));
    if (snap.exists()) {
      schoolDoc = snap.data() as Record<string, unknown>;
      documentsCollected += 1;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, schoolPath);
  }
  stepIndex += 1;

  const collections: Record<string, SchoolSnapshotDocumentRecord[]> = {};

  for (const subcol of BACKUP_SCHOOL_SUBCOLLECTIONS) {
    report(`schools/${params.school.id}/${subcol}`);
    const colPath = `schools/${params.school.id}/${subcol}`;
    try {
      const snap = await getDocs(
        query(
          collection(db, 'schools', params.school.id, subcol),
          where('ownerId', '==', params.school.ownerId)
        )
      );
      const records = snap.docs.map((d) => ({
        id: d.id,
        data: d.data() as Record<string, unknown>,
      }));
      collections[subcol] = records;
      documentsCollected += records.length;
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, colPath);
    }
    stepIndex += 1;
  }

  for (const mirrorSubcol of BACKUP_MIRROR_SUBCOLLECTIONS) {
    const mirrorKey = `studentLibraries_${mirrorSubcol}`;
    report(`studentLibraries/${params.school.id}/${mirrorSubcol}`);
    const mirrorPath = `studentLibraries/${params.school.id}/${mirrorSubcol}`;
    try {
      const snap = await getDocs(
        query(
          collection(db, 'studentLibraries', params.school.id, mirrorSubcol),
          where('schoolId', '==', params.school.id)
        )
      );
      const records = snap.docs.map((d) => ({
        id: d.id,
        data: d.data() as Record<string, unknown>,
      }));
      collections[mirrorKey] = records;
      documentsCollected += records.length;
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, mirrorPath);
    }
    stepIndex += 1;
  }

  report('Verifying SHA-256 snapshot integrity');

  const envelope = buildSchoolSnapshotEnvelope({
    snapshotId: params.snapshotId,
    exportedAtIso: new Date().toISOString(),
    triggerType: params.triggerType,
    schoolId: params.school.id,
    ownerId: params.school.ownerId,
    schoolName: params.school.name,
    triggeredByUid: params.triggeredByUid,
    triggeredByName: params.triggeredByName,
    schoolDoc,
    collections,
  });

  const snapshotJson = JSON.stringify(envelope, null, 2);
  const checksumSha256 = await computeSha256Hex(snapshotJson);
  const sizeBytes = new TextEncoder().encode(snapshotJson).byteLength;

  return { envelope, snapshotJson, checksumSha256, sizeBytes };
}

async function uploadToFirebaseStorageBucket(params: {
  schoolId: string;
  ownerId: string;
  snapshotId: string;
  snapshotJson: string;
  checksumSha256: string;
  totalDocuments: number;
  triggerType: BackupTriggerType;
}): Promise<{
  storageTarget: 'firebase-storage';
  bucketName: string;
  objectPath: string;
  downloadUrl: string;
}> {
  const objectPath = `backups/schools/${params.schoolId}/${params.snapshotId}.json`;
  const storageRef = ref(storage, objectPath);
  const blob = new Blob([params.snapshotJson], { type: 'application/json' });

  await uploadBytes(storageRef, blob, {
    contentType: 'application/json',
    customMetadata: {
      schoolId: params.schoolId,
      ownerId: params.ownerId,
      snapshotId: params.snapshotId,
      checksumSha256: params.checksumSha256,
      totalDocuments: String(params.totalDocuments),
      triggerType: params.triggerType,
    },
  });

  const downloadUrl = await getDownloadURL(storageRef);
  return {
    storageTarget: 'firebase-storage',
    bucketName: firebaseConfig.storageBucket || 'the-baton-j01dl.firebasestorage.app',
    objectPath,
    downloadUrl,
  };
}

async function uploadToServerBucketEndpoint(params: {
  token: string;
  schoolId: string;
  ownerId: string;
  snapshotId: string;
  snapshotJson: string;
  checksumSha256: string;
}): Promise<{
  storageTarget: 'cloud-bucket' | 'server-vault';
  bucketName: string;
  objectPath: string;
  downloadUrl: string;
}> {
  const res = await fetch('/api/backups/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.token}`,
    },
    body: JSON.stringify({
      schoolId: params.schoolId,
      ownerId: params.ownerId,
      snapshotId: params.snapshotId,
      snapshotJson: params.snapshotJson,
      checksumSha256: params.checksumSha256,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    storageTarget?: 'cloud-bucket' | 'server-vault';
    bucketName?: string;
    objectPath?: string;
  };

  if (!res.ok || !data.ok || !data.storageTarget || !data.bucketName || !data.objectPath) {
    throw new Error(data.error || `Backup upload failed (HTTP ${res.status}).`);
  }

  return {
    storageTarget: data.storageTarget,
    bucketName: data.bucketName,
    objectPath: data.objectPath,
    downloadUrl: `/api/backups/download/${encodeURIComponent(params.schoolId)}/${encodeURIComponent(params.snapshotId)}`,
  };
}

async function updateBackupSettingsAfterRun(params: {
  schoolId: string;
  ownerId: string;
  uid: string;
  name: string;
  existingSettings?: BackupSettings | null;
  snapshotId: string;
  completedAtIso: string;
  status: 'Completed' | 'Failed';
  preferredTarget: 'firebase-storage' | 'cloud-bucket';
}): Promise<void> {
  const settingsRef = doc(db, 'schools', params.schoolId, 'backupSettings', 'default');
  const settingsPath = `schools/${params.schoolId}/backupSettings/default`;
  const existing = params.existingSettings;
  const autoBackupEnabled = existing?.autoBackupEnabled ?? false;
  const cadence = existing?.cadence ?? 'daily';
  const preferredHourUTC = clampPreferredHourUtc(existing?.preferredHourUTC ?? 2);
  const retentionCount = clampRetentionCount(existing?.retentionCount ?? 10);
  const storageTarget = existing?.storageTarget ?? params.preferredTarget;
  const nextBackupDueIso = autoBackupEnabled
    ? computeNextScheduledBackupIso(
        cadence,
        preferredHourUTC,
        Date.now(),
        params.status === 'Completed'
      )
    : '';

  try {
    const snap = await getDoc(settingsRef);
    if (!snap.exists()) {
      await setDoc(settingsRef, {
        ownerId: params.ownerId,
        schoolId: params.schoolId,
        autoBackupEnabled,
        cadence,
        preferredHourUTC,
        retentionCount,
        storageTarget,
        lastBackupAtIso: params.completedAtIso,
        lastBackupId: params.snapshotId,
        lastBackupStatus: params.status,
        nextBackupDueIso,
        updatedByUid: params.uid,
        updatedByName: params.name,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(settingsRef, {
        lastBackupAtIso: params.completedAtIso,
        lastBackupId: params.snapshotId,
        lastBackupStatus: params.status,
        nextBackupDueIso,
        updatedByUid: params.uid,
        updatedByName: params.name,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, settingsPath);
  }
}

async function enforceRetentionPolicy(params: {
  token: string;
  schoolId: string;
  ownerId: string;
  retentionCount: number;
  existingLogs: BackupSnapshotLog[];
}): Promise<void> {
  const limit = clampRetentionCount(params.retentionCount);
  const completedLogs = params.existingLogs
    .filter((entry) => entry.status === 'Completed')
    .sort((a, b) => (b.completedAtIso || '').localeCompare(a.completedAtIso || ''));

  if (completedLogs.length <= limit) return;
  const stale = completedLogs.slice(limit);

  for (const oldLog of stale) {
    try {
      if (oldLog.storageTarget === 'firebase-storage' && oldLog.objectPath) {
        await deleteObject(ref(storage, oldLog.objectPath)).catch(() => undefined);
      } else {
        await fetch('/api/backups/object', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${params.token}`,
          },
          body: JSON.stringify({
            schoolId: params.schoolId,
            ownerId: params.ownerId,
            snapshotId: oldLog.snapshotId,
          }),
        }).catch(() => undefined);
      }
      await deleteDoc(doc(db, 'schools', params.schoolId, 'backupLogs', oldLog.id));
    } catch {
      // Non-fatal retention cleanup failure
    }
  }
}

export async function runFullSchoolBackup(params: {
  school: School;
  triggerType: BackupTriggerType;
  preferredTarget?: 'firebase-storage' | 'cloud-bucket';
  existingSettings?: BackupSettings | null;
  existingLogs?: BackupSnapshotLog[];
  triggeredByName?: string;
  onProgress?: (progress: BackupProgressState) => void;
}): Promise<RunFullBackupResult> {
  const { token, uid, name } = await getVerifiedAuthToken();
  const actorName = (params.triggeredByName || name || 'School Owner').trim().slice(0, 120);
  const snapshotId = createSnapshotId();
  const preferredTarget =
    params.preferredTarget || params.existingSettings?.storageTarget || 'firebase-storage';

  try {
    const { envelope, snapshotJson, checksumSha256, sizeBytes } =
      await collectSchoolFirestoreSnapshot({
        school: params.school,
        triggerType: params.triggerType,
        triggeredByUid: uid,
        triggeredByName: actorName,
        snapshotId,
        onProgress: params.onProgress,
      });

    let storageTarget: BackupStorageTarget;
    let bucketName = '';
    let objectPath = '';
    let downloadUrl = '';
    let fallbackNotice: string | undefined;

    if (preferredTarget === 'firebase-storage') {
      try {
        const fbRes = await uploadToFirebaseStorageBucket({
          schoolId: params.school.id,
          ownerId: params.school.ownerId,
          snapshotId,
          snapshotJson,
          checksumSha256,
          totalDocuments: envelope.totalDocuments,
          triggerType: params.triggerType,
        });
        storageTarget = fbRes.storageTarget;
        bucketName = fbRes.bucketName;
        objectPath = fbRes.objectPath;
        downloadUrl = fbRes.downloadUrl;
      } catch (fbErr) {
        const reason = fbErr instanceof Error ? fbErr.message : 'Firebase Storage bucket unavailable';
        const serverRes = await uploadToServerBucketEndpoint({
          token,
          schoolId: params.school.id,
          ownerId: params.school.ownerId,
          snapshotId,
          snapshotJson,
          checksumSha256,
        });
        storageTarget = serverRes.storageTarget;
        bucketName = serverRes.bucketName;
        objectPath = serverRes.objectPath;
        downloadUrl = serverRes.downloadUrl;
        fallbackNotice = `Firebase Storage upload was unavailable (${reason.slice(0, 110)}); snapshot was safely stored in ${serverRes.bucketName}.`;
      }
    } else {
      const serverRes = await uploadToServerBucketEndpoint({
        token,
        schoolId: params.school.id,
        ownerId: params.school.ownerId,
        snapshotId,
        snapshotJson,
        checksumSha256,
      });
      storageTarget = serverRes.storageTarget;
      bucketName = serverRes.bucketName;
      objectPath = serverRes.objectPath;
      downloadUrl = serverRes.downloadUrl;
    }

    const completedAtIso = new Date().toISOString();
    const logPayload = {
      ownerId: params.school.ownerId,
      schoolId: params.school.id,
      snapshotId,
      triggerType: params.triggerType,
      storageTarget,
      bucketName: bucketName.slice(0, 160),
      objectPath: objectPath.slice(0, 320),
      status: 'Completed' as const,
      totalDocuments: envelope.totalDocuments,
      collectionCount: envelope.collectionCount,
      sizeBytes,
      checksumSha256,
      downloadUrl: downloadUrl.slice(0, 1024),
      triggeredByUid: uid,
      triggeredByName: actorName,
      completedAtIso,
      errorReason: fallbackNotice ? fallbackNotice.slice(0, 400) : '',
      createdAt: serverTimestamp(),
    };

    const logPath = `schools/${params.school.id}/backupLogs/${snapshotId}`;
    try {
      await setDoc(doc(db, 'schools', params.school.id, 'backupLogs', snapshotId), logPayload);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, logPath);
    }

    await updateBackupSettingsAfterRun({
      schoolId: params.school.id,
      ownerId: params.school.ownerId,
      uid,
      name: actorName,
      existingSettings: params.existingSettings,
      snapshotId,
      completedAtIso,
      status: 'Completed',
      preferredTarget,
    });

    const createdLog: BackupSnapshotLog = {
      id: snapshotId,
      ...logPayload,
      createdAt: undefined,
    };

    if (params.existingLogs) {
      await enforceRetentionPolicy({
        token,
        schoolId: params.school.id,
        ownerId: params.school.ownerId,
        retentionCount: params.existingSettings?.retentionCount ?? 10,
        existingLogs: [createdLog, ...params.existingLogs],
      });
    }

    return {
      log: createdLog,
      envelope,
      snapshotJson,
      fallbackNotice,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Database backup snapshot failed.';
    const completedAtIso = new Date().toISOString();
    try {
      await setDoc(doc(db, 'schools', params.school.id, 'backupLogs', snapshotId), {
        ownerId: params.school.ownerId,
        schoolId: params.school.id,
        snapshotId,
        triggerType: params.triggerType,
        storageTarget: preferredTarget,
        bucketName:
          preferredTarget === 'firebase-storage'
            ? firebaseConfig.storageBucket || 'the-baton-j01dl.firebasestorage.app'
            : 'server-local-vault',
        objectPath: `backups/schools/${params.school.id}/${snapshotId}.json`,
        status: 'Failed',
        totalDocuments: 0,
        collectionCount: 0,
        sizeBytes: 0,
        checksumSha256: '',
        downloadUrl: '',
        triggeredByUid: uid,
        triggeredByName: actorName,
        completedAtIso,
        errorReason: errorMessage.slice(0, 400),
        createdAt: serverTimestamp(),
      });
      await updateBackupSettingsAfterRun({
        schoolId: params.school.id,
        ownerId: params.school.ownerId,
        uid,
        name: actorName,
        existingSettings: params.existingSettings,
        snapshotId,
        completedAtIso,
        status: 'Failed',
        preferredTarget,
      });
    } catch {
      // Ignore secondary logging failure when reporting original error
    }
    throw err;
  }
}

export function triggerSnapshotJsonDownload(snapshotJson: string, fileName: string): void {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const blob = new Blob([snapshotJson], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadStoredBackupSnapshot(log: BackupSnapshotLog): Promise<void> {
  if (!isValidBackupIdentifier(log.schoolId) || !isValidBackupIdentifier(log.snapshotId)) {
    throw new Error('Invalid backup snapshot identifier.');
  }
  const fileName = `${log.schoolId}_${log.snapshotId}.json`;

  if (log.storageTarget === 'firebase-storage') {
    const url = log.downloadUrl || (await getDownloadURL(ref(storage, log.objectPath)));
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Unable to fetch archive from Firebase Storage (HTTP ${res.status}).`);
    }
    const text = await res.text();
    triggerSnapshotJsonDownload(text, fileName);
    return;
  }

  const { token } = await getVerifiedAuthToken();
  const res = await fetch(
    `/api/backups/download/${encodeURIComponent(log.schoolId)}/${encodeURIComponent(log.snapshotId)}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || `Unable to download snapshot archive (HTTP ${res.status}).`);
  }
  const text = await res.text();
  triggerSnapshotJsonDownload(text, fileName);
}

export async function deleteBackupSnapshot(log: BackupSnapshotLog): Promise<void> {
  const { token } = await getVerifiedAuthToken();
  if (log.storageTarget === 'firebase-storage' && log.objectPath) {
    await deleteObject(ref(storage, log.objectPath)).catch(() => undefined);
  } else {
    await fetch('/api/backups/object', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        schoolId: log.schoolId,
        ownerId: log.ownerId,
        snapshotId: log.snapshotId,
      }),
    }).catch(() => undefined);
  }

  const logPath = `schools/${log.schoolId}/backupLogs/${log.id}`;
  try {
    await deleteDoc(doc(db, 'schools', log.schoolId, 'backupLogs', log.id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, logPath);
  }
}
