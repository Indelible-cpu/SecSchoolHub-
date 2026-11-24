import { initializeApp } from 'firebase/app';
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import { doc, getDocFromServer, initializeFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
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

export async function signInWithGoogle(): Promise<void> {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('Cross-Origin-Opener-Policy') ||
        error.message.includes('popup') ||
        (error as { code?: string }).code === 'auth/popup-blocked')
    ) {
      await signInWithRedirect(auth, googleProvider);
      return;
    }
    throw error;
  }
}

// Automatically resolve redirect credentials if returning from a COOP redirect flow
if (typeof window !== 'undefined') {
  getRedirectResult(auth).catch(() => {});
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}
