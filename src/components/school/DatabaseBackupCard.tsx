import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CloudUpload,
  Database,
  Download,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import firebaseConfig from '../../../firebase-applet-config.json';
import type {
  BackupCadence,
  BackupSettings,
  BackupSnapshotLog,
  School,
} from '../../school/types';
import {
  collectSchoolFirestoreSnapshot,
  deleteBackupSnapshot,
  downloadStoredBackupSnapshot,
  fetchServerBackupBucketStatus,
  runFullSchoolBackup,
  saveBackupSettings,
  triggerSnapshotJsonDownload,
  type BackupProgressState,
  type ServerBucketStatus,
} from '../../school/backupService';
import {
  computeNextScheduledBackupIso,
  createSnapshotId,
  formatBackupBytes,
} from '../../school/backupSnapshotUtils';

interface DatabaseBackupCardProps {
  school: School;
  ownerDisplayName: string;
  backupSettings: BackupSettings | null;
  backupLogs: BackupSnapshotLog[];
  autoBackupInFlight?: boolean;
}

const RETENTION_OPTIONS = [5, 10, 20, 30] as const;

function formatUtcTimestamp(iso?: string): string {
  if (!iso) return '—';
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  return new Date(parsed).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export const DatabaseBackupCard: React.FC<DatabaseBackupCardProps> = ({
  school,
  ownerDisplayName,
  backupSettings,
  backupLogs,
  autoBackupInFlight = false,
}) => {
  const [serverStatus, setServerStatus] = useState<ServerBucketStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const [autoBackupEnabled, setAutoBackupEnabled] = useState<boolean>(
    backupSettings?.autoBackupEnabled ?? false
  );
  const [cadence, setCadence] = useState<BackupCadence>(backupSettings?.cadence ?? 'daily');
  const [preferredHourUTC, setPreferredHourUTC] = useState<number>(
    backupSettings?.preferredHourUTC ?? 2
  );
  const [retentionCount, setRetentionCount] = useState<number>(
    backupSettings?.retentionCount ?? 10
  );
  const [storageTarget, setStorageTarget] = useState<'firebase-storage' | 'cloud-bucket'>(
    backupSettings?.storageTarget ?? 'firebase-storage'
  );

  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policySavedFlash, setPolicySavedFlash] = useState(false);
  const [policyError, setPolicyError] = useState('');

  const [runningBackup, setRunningBackup] = useState(false);
  const [downloadingLocal, setDownloadingLocal] = useState(false);
  const [progress, setProgress] = useState<BackupProgressState | null>(null);
  const [actionNotice, setActionNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    setAutoBackupEnabled(backupSettings?.autoBackupEnabled ?? false);
    setCadence(backupSettings?.cadence ?? 'daily');
    setPreferredHourUTC(backupSettings?.preferredHourUTC ?? 2);
    setRetentionCount(backupSettings?.retentionCount ?? 10);
    setStorageTarget(backupSettings?.storageTarget ?? 'firebase-storage');
  }, [backupSettings]);

  useEffect(() => {
    let active = true;
    setStatusLoading(true);
    fetchServerBackupBucketStatus()
      .then((res) => {
        if (active) setServerStatus(res);
      })
      .catch(() => {
        if (active) setServerStatus(null);
      })
      .finally(() => {
        if (active) setStatusLoading(false);
      });
    return () => {
      active = false;
    };
  }, [school.id]);

  const sortedLogs = useMemo(() => {
    return [...backupLogs].sort((a, b) =>
      (b.completedAtIso || '').localeCompare(a.completedAtIso || '')
    );
  }, [backupLogs]);

  const completedLogs = useMemo(
    () => sortedLogs.filter((l) => l.status === 'Completed'),
    [sortedLogs]
  );

  const latestCompleted = completedLogs[0] || null;
  const firebaseBucketName =
    firebaseConfig.storageBucket || 'the-baton-j01dl.firebasestorage.app';

  const nextDuePreview = useMemo(() => {
    if (!autoBackupEnabled) return 'Paused (Manual Only)';
    if (
      backupSettings?.autoBackupEnabled &&
      backupSettings.cadence === cadence &&
      backupSettings.preferredHourUTC === preferredHourUTC &&
      backupSettings.nextBackupDueIso
    ) {
      return formatUtcTimestamp(backupSettings.nextBackupDueIso);
    }
    return formatUtcTimestamp(
      computeNextScheduledBackupIso(cadence, preferredHourUTC, Date.now(), false)
    );
  }, [autoBackupEnabled, backupSettings, cadence, preferredHourUTC]);

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingPolicy) return;
    setSavingPolicy(true);
    setPolicyError('');
    setPolicySavedFlash(false);
    try {
      await saveBackupSettings({
        schoolId: school.id,
        ownerId: school.ownerId,
        autoBackupEnabled,
        cadence,
        preferredHourUTC,
        retentionCount,
        storageTarget,
        updatedByName: ownerDisplayName,
        existingSettings: backupSettings,
      });
      setPolicySavedFlash(true);
      setTimeout(() => setPolicySavedFlash(false), 2500);
    } catch (err) {
      setPolicyError(
        err instanceof Error ? err.message : 'Unable to save automated backup schedule.'
      );
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleRunManualBackup = async () => {
    if (runningBackup || autoBackupInFlight) return;
    setRunningBackup(true);
    setActionError('');
    setActionNotice('');
    setProgress(null);

    try {
      const result = await runFullSchoolBackup({
        school,
        triggerType: 'manual',
        preferredTarget: storageTarget,
        existingSettings: backupSettings,
        existingLogs: sortedLogs,
        triggeredByName: ownerDisplayName,
        onProgress: setProgress,
      });

      const summary = `Snapshot ${result.log.snapshotId} exported (${result.log.totalDocuments} documents, ${formatBackupBytes(result.log.sizeBytes)}) to ${result.log.bucketName}.`;
      setActionNotice(
        result.fallbackNotice ? `${summary} ${result.fallbackNotice}` : summary
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to run Firestore snapshot.');
    } finally {
      setRunningBackup(false);
      setProgress(null);
    }
  };

  const handleDirectDownloadSnapshot = async () => {
    if (downloadingLocal || runningBackup) return;
    setDownloadingLocal(true);
    setActionError('');
    setActionNotice('');
    setProgress(null);

    try {
      const snapshotId = createSnapshotId();
      const { snapshotJson, envelope } = await collectSchoolFirestoreSnapshot({
        school,
        triggerType: 'manual',
        triggeredByUid: school.ownerId,
        triggeredByName: ownerDisplayName,
        snapshotId,
        onProgress: setProgress,
      });
      triggerSnapshotJsonDownload(snapshotJson, `${school.id}_${snapshotId}.json`);
      setActionNotice(
        `Downloaded local snapshot (${envelope.totalDocuments} documents across ${envelope.collectionCount} collections).`
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Unable to export local JSON snapshot.'
      );
    } finally {
      setDownloadingLocal(false);
      setProgress(null);
    }
  };

  const handleDownloadStoredLog = async (log: BackupSnapshotLog) => {
    if (downloadingId) return;
    setDownloadingId(log.id);
    setActionError('');
    try {
      await downloadStoredBackupSnapshot(log);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Unable to download stored snapshot archive.'
      );
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDeleteLog = async (log: BackupSnapshotLog) => {
    if (deletingId) return;
    setDeletingId(log.id);
    setActionError('');
    try {
      await deleteBackupSnapshot(log);
      setConfirmDeleteId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to delete snapshot record.');
    } finally {
      setDeletingId(null);
    }
  };

  const progressPercent =
    progress && progress.totalSteps > 0
      ? Math.min(100, Math.round((progress.stepIndex / progress.totalSteps) * 100))
      : 0;

  return (
    <div className="space-y-6">
      {/* Header & Primary Export Controls */}
      <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Firestore Database Backups &amp; Storage Bucket
              </h1>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Owner-only full snapshot export covering students, staff, marks, fees, attendance,
              library, and timebook records with SHA-256 verification.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={runningBackup || downloadingLocal || autoBackupInFlight}
              onClick={handleDirectDownloadSnapshot}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{downloadingLocal ? 'Preparing JSON...' : 'Download JSON Copy'}</span>
            </button>

            <button
              type="button"
              disabled={runningBackup || downloadingLocal || autoBackupInFlight}
              onClick={handleRunManualBackup}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {runningBackup || autoBackupInFlight ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <CloudUpload className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>
                {autoBackupInFlight
                  ? 'Running Scheduled Backup...'
                  : runningBackup
                  ? 'Exporting Snapshot...'
                  : 'Run Snapshot Backup Now'}
              </span>
            </button>
          </div>
        </div>

        {/* Live Collection Export Progress */}
        {(runningBackup || downloadingLocal) && progress && (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-emerald-900 dark:text-emerald-200 truncate">
                Collecting: <span className="font-mono">{progress.currentLabel}</span>
              </span>
              <span className="font-mono tabular-nums text-emerald-800 dark:text-emerald-300 shrink-0">
                {progress.documentsCollected} docs · {progressPercent}%
              </span>
            </div>
            <div className="h-1.5 w-full rounded-sm bg-emerald-200/70 dark:bg-emerald-950 overflow-hidden">
              <div
                className="h-full bg-emerald-700 dark:bg-emerald-500 transition-all duration-200"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {actionNotice && (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/80 dark:bg-emerald-950/35 px-4 py-2.5 text-xs text-emerald-900 dark:text-emerald-200">
            {actionNotice}
          </div>
        )}

        {actionError && (
          <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/45 px-4 py-2.5 text-xs text-rose-800 dark:text-rose-200">
            {actionError}
          </div>
        )}

        {/* Summary Metric Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-3.5">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Last Verified Snapshot
            </div>
            <div className="mt-1 font-mono tabular-nums text-xs font-semibold text-slate-900 dark:text-slate-100">
              {latestCompleted ? formatUtcTimestamp(latestCompleted.completedAtIso) : 'No backups yet'}
            </div>
            <div className="mt-0.5 font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
              {latestCompleted
                ? `${latestCompleted.totalDocuments} docs · ${formatBackupBytes(latestCompleted.sizeBytes)}`
                : 'Run an initial snapshot'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-3.5">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Next Scheduled Export
            </div>
            <div className="mt-1 font-mono tabular-nums text-xs font-semibold text-slate-900 dark:text-slate-100">
              {nextDuePreview}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {autoBackupEnabled
                ? `${cadence === 'daily' ? 'Daily' : 'Weekly'} · Retain last ${retentionCount}`
                : 'Automated schedule disabled'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-3.5">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Active Bucket Target
            </div>
            <div className="mt-1 text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
              {storageTarget === 'firebase-storage'
                ? firebaseBucketName
                : serverStatus?.bucketName || 'server-local-vault'}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {storageTarget === 'firebase-storage'
                ? 'Firebase Storage (Owner Metadata Lock)'
                : statusLoading
                ? 'Checking server bucket...'
                : serverStatus?.providerLabel || 'Secure Server Backup Vault'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-3.5">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Stored Snapshots / Integrity
            </div>
            <div className="mt-1 font-mono tabular-nums text-xs font-semibold text-slate-900 dark:text-slate-100">
              {completedLogs.length} Verified Archive{completedLogs.length === 1 ? '' : 's'}
            </div>
            <div className="mt-0.5 font-mono tabular-nums text-[11px] text-emerald-700 dark:text-emerald-400 truncate">
              {latestCompleted?.checksumSha256
                ? `SHA-256: ${latestCompleted.checksumSha256.slice(0, 16)}…`
                : 'SHA-256 verified on upload'}
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Automated Schedule & Bucket Policy */}
        <form
          onSubmit={handleSavePolicy}
          className="lg:col-span-5 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Automated Backup Policy
              </h2>
            </div>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Owner Only
            </span>
          </div>

          {policyError && (
            <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
              {policyError}
            </div>
          )}

          <label className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-3.5 cursor-pointer">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Enable Automated Snapshot Schedule
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Automatically exports a full Firestore snapshot when due during an active School
                Owner session.
              </div>
            </div>
            <input
              type="checkbox"
              checked={autoBackupEnabled}
              onChange={(e) => setAutoBackupEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-emerald-700 cursor-pointer shrink-0"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Frequency
              </label>
              <select
                value={cadence}
                onChange={(e) => setCadence(e.target.value as BackupCadence)}
                className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Schedule Window (UTC)
              </label>
              <select
                value={preferredHourUTC}
                onChange={(e) => setPreferredHourUTC(Number(e.target.value))}
                className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm"
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>
                    {String(hour).padStart(2, '0')}:00 UTC
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Destination Storage Bucket
            </label>
            <select
              value={storageTarget}
              onChange={(e) =>
                setStorageTarget(e.target.value as 'firebase-storage' | 'cloud-bucket')
              }
              className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm"
            >
              <option value="firebase-storage">
                Firebase Storage ({firebaseBucketName})
              </option>
              <option value="cloud-bucket">
                Server Bucket ({serverStatus?.configuredExternalBucket ? serverStatus.bucketName : 'Server Backup Vault / S3 Env'})
              </option>
            </select>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              If Firebase Storage is not provisioned on the project, snapshots fall back cleanly to{' '}
              <span className="font-mono">{serverStatus?.bucketName || 'server-local-vault'}</span>.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Snapshot Retention Limit
            </label>
            <select
              value={retentionCount}
              onChange={(e) => setRetentionCount(Number(e.target.value))}
              className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm"
            >
              {RETENTION_OPTIONS.map((count) => (
                <option key={count} value={count}>
                  Keep last {count} snapshots
                </option>
              ))}
            </select>
          </div>

          {serverStatus?.configError && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-200">
              {serverStatus.configError}
            </div>
          )}

          <button
            type="submit"
            disabled={savingPolicy}
            className="w-full inline-flex items-center justify-center gap-2 min-h-[44px] rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold hover:opacity-90 disabled:opacity-50 cursor-pointer"
          >
            {policySavedFlash ? (
              <>
                <Check className="w-4 h-4" aria-hidden="true" />
                <span>Backup Policy Saved</span>
              </>
            ) : (
              <span>{savingPolicy ? 'Saving Policy...' : 'Save Backup Policy'}</span>
            )}
          </button>
        </form>

        {/* Snapshot Export History */}
        <section className="lg:col-span-7 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-slate-600 dark:text-slate-300" aria-hidden="true" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Snapshot Export History ({sortedLogs.length})
              </h2>
            </div>
            <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              Retention: {retentionCount} max
            </span>
          </div>

          {sortedLogs.length === 0 ? (
            <div className="py-12 text-center space-y-1.5">
              <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                No database snapshots recorded yet
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Click &ldquo;Run Snapshot Backup Now&rdquo; above to archive all Firestore
                collections for {school.name}.
              </p>
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 pr-3">Snapshot &amp; Time</th>
                    <th className="py-2.5 pr-3">Bucket</th>
                    <th className="py-2.5 pr-3 text-right">Records / Size</th>
                    <th className="py-2.5 pr-3">Status</th>
                    <th className="py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                  {sortedLogs.map((log) => {
                    const isDeletingThis = deletingId === log.id;
                    const isConfirming = confirmDeleteId === log.id;
                    return (
                      <tr key={log.id} className="align-top">
                        <td className="py-3 pr-3">
                          <div className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                            {formatUtcTimestamp(log.completedAtIso)}
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            {log.triggerType === 'automated' ? 'Automated' : 'Manual'} ·{' '}
                            {log.snapshotId}
                          </div>
                          {log.checksumSha256 && (
                            <div className="mt-0.5 font-mono text-[11px] text-slate-400 dark:text-slate-500">
                              SHA-256: {log.checksumSha256.slice(0, 14)}…
                            </div>
                          )}
                        </td>

                        <td className="py-3 pr-3">
                          <div className="font-medium text-slate-800 dark:text-slate-200 break-all max-w-[180px]">
                            {log.bucketName}
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[180px]" title={log.objectPath}>
                            {log.objectPath}
                          </div>
                        </td>

                        <td className="py-3 pr-3 text-right font-mono tabular-nums">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {log.totalDocuments} docs
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                            {formatBackupBytes(log.sizeBytes)}
                          </div>
                        </td>

                        <td className="py-3 pr-3">
                          <span
                            className={`text-[11px] font-semibold ${
                              log.status === 'Completed'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {log.status}
                          </span>
                          {log.errorReason && (
                            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 max-w-[180px]">
                              {log.errorReason}
                            </div>
                          )}
                        </td>

                        <td className="py-3 text-right">
                          <div className="inline-flex items-center justify-end gap-1">
                            {log.status === 'Completed' && (
                              <button
                                type="button"
                                disabled={downloadingId === log.id}
                                onClick={() => handleDownloadStoredLog(log)}
                                title="Download JSON snapshot"
                                className="inline-flex items-center gap-1 min-h-[32px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                              >
                                <Download className="w-3 h-3" aria-hidden="true" />
                                <span>{downloadingId === log.id ? '...' : 'JSON'}</span>
                              </button>
                            )}

                            {isConfirming ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={isDeletingThis}
                                  onClick={() => handleDeleteLog(log)}
                                  className="min-h-[32px] px-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold cursor-pointer"
                                >
                                  {isDeletingThis ? '...' : 'Confirm'}
                                </button>
                                <button
                                  type="button"
                                  disabled={isDeletingThis}
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="min-h-[32px] px-2 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(log.id)}
                                aria-label={`Delete snapshot ${log.snapshotId}`}
                                className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
