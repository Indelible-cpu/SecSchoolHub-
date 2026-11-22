import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';

export interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export type FirebaseTokenVerifier = (idToken: string) => Promise<VerifiedFirebaseUser>;

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

const PLATFORM_ADMIN_EMAIL = 'dicksonpetroj1@gmail.com';

interface CertCache {
  certs: Record<string, string>;
  expiresAtMs: number;
}

let certCache: CertCache | null = null;
let customVerifierForTesting: FirebaseTokenVerifier | null = null;

function resolveFirebaseProjectId(): string {
  if (process.env.FIREBASE_PROJECT_ID?.trim()) {
    return process.env.FIREBASE_PROJECT_ID.trim();
  }
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { projectId?: string };
      if (parsed.projectId?.trim()) {
        return parsed.projectId.trim();
      }
    }
  } catch {
    // Ignore file read errors and use fallback projectId
  }
  return 'the-baton-j01dl';
}

export function setTokenVerifierForTesting(verifier: FirebaseTokenVerifier | null): void {
  customVerifierForTesting = verifier;
}

export function isPlatformAdminEmail(email?: string): boolean {
  return typeof email === 'string' && email.trim().toLowerCase() === PLATFORM_ADMIN_EMAIL;
}

function decodeBase64UrlJson<T>(segment: string): T {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as T;
}

function decodeBase64UrlBuffer(segment: string): Buffer {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

async function fetchGooglePublicCerts(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!forceRefresh && certCache && now < certCache.expiresAtMs) {
    return certCache.certs;
  }

  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    if (certCache) return certCache.certs;
    throw new Error(`Failed to fetch Google public keys (HTTP ${res.status}).`);
  }

  const certs = (await res.json()) as Record<string, string>;
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Math.max(60, Number(maxAgeMatch[1])) : 3600;
  certCache = {
    certs,
    expiresAtMs: now + maxAgeSec * 1000,
  };
  return certs;
}

interface FirebaseJwtHeader {
  alg?: string;
  kid?: string;
}

interface FirebaseJwtPayload {
  aud?: string;
  iss?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  auth_time?: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseUser> {
  if (customVerifierForTesting) {
    return customVerifierForTesting(idToken);
  }

  const token = (idToken || '').trim();
  const segments = token.split('.');
  if (segments.length !== 3) {
    throw new Error('Malformed bearer token.');
  }

  const [headerB64, payloadB64, signatureB64] = segments;
  const header = decodeBase64UrlJson<FirebaseJwtHeader>(headerB64);
  const payload = decodeBase64UrlJson<FirebaseJwtPayload>(payloadB64);

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Unsupported token algorithm or missing key ID.');
  }

  let certs = await fetchGooglePublicCerts(false);
  let pem = certs[header.kid];
  if (!pem) {
    certs = await fetchGooglePublicCerts(true);
    pem = certs[header.kid];
  }
  if (!pem) {
    throw new Error('Unknown Firebase signing key.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const signatureValid = verifier.verify(pem, decodeBase64UrlBuffer(signatureB64));
  if (!signatureValid) {
    throw new Error('Invalid Firebase token signature.');
  }

  const projectId = resolveFirebaseProjectId();
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  const nowSec = Math.floor(Date.now() / 1000);

  if (payload.aud !== projectId) {
    throw new Error('Token audience does not match this school application.');
  }
  if (payload.iss !== expectedIssuer) {
    throw new Error('Token issuer is invalid.');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('Authentication session expired. Please sign in again.');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new Error('Token issued-at timestamp is invalid.');
  }
  if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.length > 128) {
    throw new Error('Token subject is missing.');
  }
  if (!payload.email || payload.email_verified !== true) {
    throw new Error('Verified email authentication is required.');
  }

  return {
    uid: payload.sub,
    email: payload.email.trim().toLowerCase(),
    emailVerified: true,
    name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : payload.email,
  };
}

export interface AuthenticatedRequest extends Request {
  authUser?: VerifiedFirebaseUser;
}

export async function requireFirebaseAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    res.status(401).json({
      ok: false,
      code: 'AUTH_REQUIRED',
      error: 'Authorization Bearer token is required.',
    });
    return;
  }

  try {
    const verified = await verifyFirebaseIdToken(match[1]);
    req.authUser = verified;
    next();
  } catch (err) {
    res.status(401).json({
      ok: false,
      code: 'AUTH_INVALID',
      error: err instanceof Error ? err.message : 'Invalid or expired authentication token.',
    });
  }
}
