import { initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  UserCredential,
} from 'firebase/auth';
import { doc, getDocFromServer, initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

// Use same-origin auth domain when hosted on Firebase to prevent browser storage partitioning
const effectiveConfig = {
  ...firebaseConfig,
  authDomain:
    typeof window !== 'undefined' &&
    window.location.hostname &&
    !window.location.hostname.includes('localhost') &&
    !window.location.hostname.includes('127.0.0.1')
      ? window.location.hostname
      : firebaseConfig.authDomain,
};

const app = initializeApp(effectiveConfig);
const rawDbId = (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId?.trim();
const databaseId =
  rawDbId && rawDbId !== '(default)' && !rawDbId.startsWith('ai-studio-ledgercalc')
    ? rawDbId
    : undefined;

export const db = initializeFirestore(
  app,
  {
    experimentalForceLongPolling: true,
    ignoreUndefinedProperties: true,
  },
  databaseId
);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

let connectionCheckPromise: Promise<void> | null = null;

export function testConnection(): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return Promise.resolve();
  }
  if (connectionCheckPromise) {
    return connectionCheckPromise;
  }
  connectionCheckPromise = (async () => {
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
    } catch (error) {
      if (
        (typeof navigator === 'undefined' || navigator.onLine !== false) &&
        error instanceof Error &&
        error.message.includes('the client is offline')
      ) {
        console.error('Please check your Firebase configuration.');
      }
    } finally {
      connectionCheckPromise = null;
    }
  })();
  return connectionCheckPromise;
}

// Direct synchronous invocation inside click ticks guarantees the browser treats it as a trusted user gesture (no popup blocking)
export function signInWithGoogle(): Promise<UserCredential> {
  return signInWithPopup(auth, googleProvider);
}

// Standard email/password authentication (works everywhere, zero popups, zero redirects)
export function signInWithEmail(email: string, pass: string): Promise<UserCredential> {
  return signInWithEmailAndPassword(auth, email.trim(), pass);
}

export function registerWithEmail(email: string, pass: string): Promise<UserCredential> {
  return createUserWithEmailAndPassword(auth, email.trim(), pass);
}

export function resetUserPassword(email: string): Promise<void> {
  return sendPasswordResetEmail(auth, email.trim());
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}
