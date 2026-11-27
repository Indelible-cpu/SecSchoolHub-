import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { VerifiedFirebaseUser } from './firebaseAuth.ts';
import { isPlatformAdminEmail } from './firebaseAuth.ts';

const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export interface ExternalBucketConfig {
  configured: boolean;
  bucketName: string;
  endpointUrl: string;
  region: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  configError?: string;
}

export interface BackupBucketStatusResponse {
  ok: true;
  configuredExternalBucket: boolean;
  providerLabel: string;
  bucketName: string;
  vaultAvailable: boolean;
  configError?: string;
}

export interface BackupUploadResult {
  storageTarget: 'cloud-bucket' | 'server-vault';
  bucketName: string;
  objectPath: string;
  sizeBytes: number;
  checksumSha256: string;
}

const BLOCKED_METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata',
]);

export function validateExternalEndpointUrl(rawEndpoint: string): { ok: true; url: URL } | { ok: false; error: string } {
  const trimmed = rawEndpoint.trim();
  if (!trimmed) {
    return { ok: false, error: 'BACKUP_BUCKET_ENDPOINT is empty.' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'BACKUP_BUCKET_ENDPOINT is not a valid URL.' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_METADATA_HOSTS.has(hostname)) {
    return { ok: false, error: 'BACKUP_BUCKET_ENDPOINT points to a restricted metadata host.' };
  }

  const isLocalDev = hostname === 'localhost' || hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalDev)) {
    return { ok: false, error: 'BACKUP_BUCKET_ENDPOINT must use HTTPS.' };
  }

  return { ok: true, url: parsed };
}

export function getExternalBucketConfig(): ExternalBucketConfig {
  const bucketName = process.env.BACKUP_BUCKET_NAME?.trim() || '';
  const endpointUrl = process.env.BACKUP_BUCKET_ENDPOINT?.trim() || '';
  const region = process.env.BACKUP_BUCKET_REGION?.trim() || 'eu-west-2';
  const prefix = (process.env.BACKUP_BUCKET_PREFIX?.trim() || 'secschoolhub-backups').replace(/^\/+|\/+$/g, '');
  const accessKeyId = process.env.BACKUP_ACCESS_KEY_ID?.trim() || '';
  const secretAccessKey = process.env.BACKUP_SECRET_ACCESS_KEY?.trim() || '';

  const anySet = Boolean(bucketName || endpointUrl || accessKeyId || secretAccessKey);
  if (!anySet) {
    return {
      configured: false,
      bucketName: 'server-local-vault',
      endpointUrl: '',
      region,
      prefix,
      accessKeyId: '',
      secretAccessKey: '',
    };
  }

  if (!bucketName || !endpointUrl || !accessKeyId || !secretAccessKey) {
    return {
      configured: false,
      bucketName: bucketName || 'server-local-vault',
      endpointUrl,
      region,
      prefix,
      accessKeyId: '',
      secretAccessKey: '',
      configError:
        'Incomplete external bucket configuration. Set BACKUP_BUCKET_NAME, BACKUP_BUCKET_ENDPOINT, BACKUP_ACCESS_KEY_ID, and BACKUP_SECRET_ACCESS_KEY.',
    };
  }

  const endpointCheck = validateExternalEndpointUrl(endpointUrl);
  if (!endpointCheck.ok) {
    return {
      configured: false,
      bucketName,
      endpointUrl,
      region,
      prefix,
      accessKeyId: '',
      secretAccessKey: '',
      configError: endpointCheck.error,
    };
  }

  return {
    configured: true,
    bucketName,
    endpointUrl: endpointCheck.url.toString().replace(/\/+$/, ''),
    region,
    prefix,
    accessKeyId,
    secretAccessKey,
  };
}

export function getBackupBucketStatus(): BackupBucketStatusResponse {
  const cfg = getExternalBucketConfig();
  if (cfg.configured) {
    return {
      ok: true,
      configuredExternalBucket: true,
      providerLabel: `S3 / Cloud Bucket (${cfg.bucketName})`,
      bucketName: cfg.bucketName,
      vaultAvailable: true,
    };
  }
  return {
    ok: true,
    configuredExternalBucket: false,
    providerLabel: 'Secure Server Backup Vault',
    bucketName: 'server-local-vault',
    vaultAvailable: true,
    configError: cfg.configError,
  };
}

export function isCallerAuthorizedOwner(caller: VerifiedFirebaseUser, ownerId: string): boolean {
  if (!caller?.uid || !caller.emailVerified) return false;
  if (isPlatformAdminEmail(caller.email)) return true;
  return caller.uid === ownerId;
}

export function resolveVaultBackupPaths(schoolId: string, snapshotId: string): {
  schoolDir: string;
  jsonFilePath: string;
  metaFilePath: string;
} {
  if (!SAFE_ID_REGEX.test(schoolId) || !SAFE_ID_REGEX.test(snapshotId)) {
    throw new Error('Invalid schoolId or snapshotId format.');
  }

  const vaultRoot = path.resolve(process.cwd(), '.data', 'backups');
  const schoolDir = path.resolve(vaultRoot, schoolId);
  if (!schoolDir.startsWith(vaultRoot + path.sep)) {
    throw new Error('Backup directory escaped allowed root.');
  }

  const jsonFilePath = path.resolve(schoolDir, `${snapshotId}.json`);
  const metaFilePath = path.resolve(schoolDir, `${snapshotId}.meta.json`);
  if (
    !jsonFilePath.startsWith(schoolDir + path.sep) ||
    !metaFilePath.startsWith(schoolDir + path.sep)
  ) {
    throw new Error('Backup filename escaped school vault directory.');
  }

  return { schoolDir, jsonFilePath, metaFilePath };
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function buildAwsSigV4Headers(params: {
  method: 'PUT' | 'GET' | 'DELETE';
  targetUrl: URL;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  payload: Buffer;
  contentType?: string;
}): Record<string, string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(params.payload);

  const encodedPath = params.targetUrl.pathname
    .split('/')
    .map((seg) => encodeURIComponent(decodeURIComponent(seg)))
    .join('/');

  const canonicalHeadersMap: Record<string, string> = {
    host: params.targetUrl.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (params.contentType) {
    canonicalHeadersMap['content-type'] = params.contentType;
  }

  const sortedHeaderKeys = Object.keys(canonicalHeadersMap).sort();
  const canonicalHeaders = sortedHeaderKeys
    .map((k) => `${k}:${canonicalHeadersMap[k].trim()}\n`)
    .join('');
  const signedHeaders = sortedHeaderKeys.join(';');

  const canonicalRequest = [
    params.method,
    encodedPath || '/',
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${params.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmacSha256(`AWS4${params.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, params.region);
  const kService = hmacSha256(kRegion, 's3');
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const headers: Record<string, string> = {
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (params.contentType) {
    headers['Content-Type'] = params.contentType;
  }
  return headers;
}

export function buildBucketObjectKey(prefix: string, schoolId: string, snapshotId: string): string {
  if (!SAFE_ID_REGEX.test(schoolId) || !SAFE_ID_REGEX.test(snapshotId)) {
    throw new Error('Invalid schoolId or snapshotId.');
  }
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, '');
  return cleanPrefix
    ? `${cleanPrefix}/schools/${schoolId}/${snapshotId}.json`
    : `schools/${schoolId}/${snapshotId}.json`;
}

export async function uploadSchoolSnapshotToServerBucket(params: {
  caller: VerifiedFirebaseUser;
  schoolId: string;
  ownerId: string;
  snapshotId: string;
  snapshotJson: string;
  expectedSha256?: string;
}): Promise<BackupUploadResult> {
  if (!SAFE_ID_REGEX.test(params.schoolId) || !SAFE_ID_REGEX.test(params.snapshotId)) {
    throw new Error('Invalid schoolId or snapshotId.');
  }
  if (!SAFE_ID_REGEX.test(params.ownerId)) {
    throw new Error('Invalid school owner identifier.');
  }
  if (!isCallerAuthorizedOwner(params.caller, params.ownerId)) {
    throw new Error('Only the verified School Owner can export database snapshots.');
  }

  // Verify snapshot JSON matches declared owner and schoolId to prevent cross-tenant spoofing
  let parsedEnvelope: { schoolId?: unknown; ownerId?: unknown };
  try {
    parsedEnvelope = JSON.parse(params.snapshotJson) as { schoolId?: unknown; ownerId?: unknown };
  } catch {
    throw new Error('Snapshot payload is not valid JSON.');
  }
  if (parsedEnvelope.schoolId !== params.schoolId || parsedEnvelope.ownerId !== params.ownerId) {
    throw new Error('Snapshot envelope schoolId/ownerId mismatch.');
  }

  const buffer = Buffer.from(params.snapshotJson, 'utf8');
  const computedSha256 = sha256Hex(buffer);
  if (
    params.expectedSha256 &&
    params.expectedSha256.toLowerCase() !== computedSha256.toLowerCase()
  ) {
    throw new Error('Snapshot SHA-256 integrity verification failed.');
  }

  const cfg = getExternalBucketConfig();
  if (cfg.configured) {
    const objectKey = buildBucketObjectKey(cfg.prefix, params.schoolId, params.snapshotId);
    const targetUrl = new URL(`${cfg.endpointUrl}/${encodeURIComponent(cfg.bucketName)}/${objectKey}`);
    const headers = buildAwsSigV4Headers({
      method: 'PUT',
      targetUrl,
      region: cfg.region,
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      payload: buffer,
      contentType: 'application/json; charset=utf-8',
    });

    const response = await fetch(targetUrl.toString(), {
      method: 'PUT',
      headers,
      body: buffer,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(
        `Cloud bucket upload rejected (HTTP ${response.status})${errText ? `: ${errText.slice(0, 140)}` : ''}`
      );
    }

    return {
      storageTarget: 'cloud-bucket',
      bucketName: cfg.bucketName,
      objectPath: objectKey,
      sizeBytes: buffer.byteLength,
      checksumSha256: computedSha256,
    };
  }

  // Fallback to hardened, path-confined server backup vault when external bucket credentials aren't configured
  const { schoolDir, jsonFilePath, metaFilePath } = resolveVaultBackupPaths(
    params.schoolId,
    params.snapshotId
  );
  fs.mkdirSync(schoolDir, { recursive: true });
  fs.writeFileSync(jsonFilePath, buffer);
  fs.writeFileSync(
    metaFilePath,
    JSON.stringify(
      {
        schoolId: params.schoolId,
        ownerId: params.ownerId,
        snapshotId: params.snapshotId,
        checksumSha256: computedSha256,
        sizeBytes: buffer.byteLength,
        storedAtIso: new Date().toISOString(),
        uploadedByUid: params.caller.uid,
      },
      null,
      2
    ),
    'utf8'
  );

  return {
    storageTarget: 'server-vault',
    bucketName: 'server-local-vault',
    objectPath: `backups/schools/${params.schoolId}/${params.snapshotId}.json`,
    sizeBytes: buffer.byteLength,
    checksumSha256: computedSha256,
  };
}

export async function readSchoolSnapshotFromServerBucket(params: {
  caller: VerifiedFirebaseUser;
  schoolId: string;
  snapshotId: string;
}): Promise<{ buffer: Buffer; fileName: string }> {
  if (!SAFE_ID_REGEX.test(params.schoolId) || !SAFE_ID_REGEX.test(params.snapshotId)) {
    throw new Error('Invalid schoolId or snapshotId.');
  }

  const cfg = getExternalBucketConfig();
  if (cfg.configured) {
    const objectKey = buildBucketObjectKey(cfg.prefix, params.schoolId, params.snapshotId);
    const targetUrl = new URL(`${cfg.endpointUrl}/${encodeURIComponent(cfg.bucketName)}/${objectKey}`);
    const headers = buildAwsSigV4Headers({
      method: 'GET',
      targetUrl,
      region: cfg.region,
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      payload: Buffer.alloc(0),
    });

    const response = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers,
    });
    if (response.ok) {
      const arrayBuf = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      const parsed = JSON.parse(buffer.toString('utf8')) as { ownerId?: string };
      if (!parsed.ownerId || !isCallerAuthorizedOwner(params.caller, parsed.ownerId)) {
        throw new Error('You do not have permission to download this school backup.');
      }
      return {
        buffer,
        fileName: `${params.schoolId}_${params.snapshotId}.json`,
      };
    }
  }

  const { jsonFilePath, metaFilePath } = resolveVaultBackupPaths(params.schoolId, params.snapshotId);
  if (!fs.existsSync(jsonFilePath)) {
    throw new Error('Snapshot archive not found on server storage.');
  }

  let ownerId = '';
  if (fs.existsSync(metaFilePath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaFilePath, 'utf8')) as { ownerId?: string };
      ownerId = meta.ownerId || '';
    } catch {
      ownerId = '';
    }
  }

  const buffer = fs.readFileSync(jsonFilePath);
  if (!ownerId) {
    try {
      const parsed = JSON.parse(buffer.toString('utf8')) as { ownerId?: string };
      ownerId = parsed.ownerId || '';
    } catch {
      ownerId = '';
    }
  }

  if (!ownerId || !isCallerAuthorizedOwner(params.caller, ownerId)) {
    throw new Error('Only the verified School Owner can download this backup.');
  }

  return {
    buffer,
    fileName: `${params.schoolId}_${params.snapshotId}.json`,
  };
}

export async function deleteSchoolSnapshotFromServerBucket(params: {
  caller: VerifiedFirebaseUser;
  schoolId: string;
  ownerId: string;
  snapshotId: string;
}): Promise<void> {
  if (!SAFE_ID_REGEX.test(params.schoolId) || !SAFE_ID_REGEX.test(params.snapshotId)) {
    throw new Error('Invalid schoolId or snapshotId.');
  }
  if (!isCallerAuthorizedOwner(params.caller, params.ownerId)) {
    throw new Error('Only the verified School Owner can prune backup archives.');
  }

  const cfg = getExternalBucketConfig();
  if (cfg.configured) {
    const objectKey = buildBucketObjectKey(cfg.prefix, params.schoolId, params.snapshotId);
    const targetUrl = new URL(`${cfg.endpointUrl}/${encodeURIComponent(cfg.bucketName)}/${objectKey}`);
    const headers = buildAwsSigV4Headers({
      method: 'DELETE',
      targetUrl,
      region: cfg.region,
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      payload: Buffer.alloc(0),
    });
    await fetch(targetUrl.toString(), { method: 'DELETE', headers }).catch(() => undefined);
  }

  const { jsonFilePath, metaFilePath } = resolveVaultBackupPaths(params.schoolId, params.snapshotId);
  if (fs.existsSync(jsonFilePath)) fs.unlinkSync(jsonFilePath);
  if (fs.existsSync(metaFilePath)) fs.unlinkSync(metaFilePath);
}
