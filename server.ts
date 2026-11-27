import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { requireFirebaseAuth, type AuthenticatedRequest } from './server/firebaseAuth.ts';
import {
  extractBookFromCoverImage,
  isValidIsbn,
  lookupBookByIsbn,
  normalizeIsbn,
} from './server/libraryScanner.ts';
import { TimebookEngine } from './server/timebookEngine.ts';
import {
  deleteSchoolSnapshotFromServerBucket,
  getBackupBucketStatus,
  isCallerAuthorizedOwner,
  readSchoolSnapshotFromServerBucket,
  uploadSchoolSnapshotToServerBucket,
} from './server/backupBucket.ts';

interface SmsGatewayStatus {
  configured: boolean;
  provider: 'africastalking' | 'twilio' | 'sandbox';
  providerLabel: string;
}

interface SmsSendBody {
  to?: string;
  message?: string;
  type?: string;
  studentId?: string;
  invoiceId?: string;
}

function getGatewayStatus(): SmsGatewayStatus {
  const atKey = process.env.AFRICASTALKING_API_KEY?.trim();
  const atUser = process.env.AFRICASTALKING_USERNAME?.trim();
  if (atKey && atUser) {
    return {
      configured: true,
      provider: 'africastalking',
      providerLabel: atUser === 'sandbox' ? "Africa's Talking (Sandbox)" : "Africa's Talking",
    };
  }

  const twSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const twToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const twFrom = process.env.TWILIO_FROM_NUMBER?.trim();
  if (twSid && twToken && twFrom) {
    return {
      configured: true,
      provider: 'twilio',
      providerLabel: 'Twilio SMS',
    };
  }

  return {
    configured: false,
    provider: 'sandbox',
    providerLabel: 'Preview Outbox (No Gateway Env Vars)',
  };
}

function isValidE164Phone(phone: string): boolean {
  return /^\+\d{8,15}$/.test(phone);
}

async function dispatchSms(to: string, message: string) {
  const status = getGatewayStatus();

  if (status.provider === 'africastalking') {
    const username = process.env.AFRICASTALKING_USERNAME!.trim();
    const apiKey = process.env.AFRICASTALKING_API_KEY!.trim();
    const senderId = process.env.AFRICASTALKING_SENDER_ID?.trim();
    const endpoint =
      username === 'sandbox'
        ? 'https://api.sandbox.africastalking.com/version1/messaging'
        : 'https://api.africastalking.com/version1/messaging';

    const params = new URLSearchParams();
    params.set('username', username);
    params.set('to', to);
    params.set('message', message);
    if (senderId) {
      params.set('from', senderId);
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        apiKey,
      },
      body: params.toString(),
    });

    const data = (await res.json().catch(() => ({}))) as {
      SMSMessageData?: {
        Message?: string;
        Recipients?: Array<{ status?: string; messageId?: string; statusCode?: number }>;
      };
    };

    const recipient = data.SMSMessageData?.Recipients?.[0];
    const ok = res.ok && !!recipient && (recipient.statusCode === 101 || recipient.status === 'Success');
    return {
      ok,
      status: ok ? ('Sent' as const) : ('Failed' as const),
      provider: status.providerLabel,
      providerRef: recipient?.messageId || '',
      errorReason: ok ? '' : (recipient?.status || data.SMSMessageData?.Message || `HTTP ${res.status}`),
    };
  }

  if (status.provider === 'twilio') {
    const sid = process.env.TWILIO_ACCOUNT_SID!.trim();
    const token = process.env.TWILIO_AUTH_TOKEN!.trim();
    const from = process.env.TWILIO_FROM_NUMBER!.trim();
    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;

    const params = new URLSearchParams();
    params.set('To', to);
    params.set('From', from);
    params.set('Body', message);

    const authHeader = Buffer.from(`${sid}:${token}`).toString('base64');
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    return {
      ok: res.ok && !!data.sid,
      status: res.ok && !!data.sid ? ('Sent' as const) : ('Failed' as const),
      provider: status.providerLabel,
      providerRef: data.sid || '',
      errorReason: res.ok ? '' : (data.message || `HTTP ${res.status}`),
    };
  }

  return {
    ok: true,
    status: 'Simulated' as const,
    provider: 'Preview Outbox',
    providerRef: `sim_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    errorReason: '',
  };
}

function resolveServerPort(): number {
  const envPort = Number.parseInt((process.env.PORT || '').trim(), 10);
  if (Number.isInteger(envPort) && envPort > 0 && envPort <= 65535) {
    return envPort;
  }

  for (let i = 0; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === '--port' || arg === '-p') {
      const cliPort = Number.parseInt(process.argv[i + 1] || '', 10);
      if (Number.isInteger(cliPort) && cliPort > 0 && cliPort <= 65535) {
        return cliPort;
      }
    } else if (arg.startsWith('--port=')) {
      const cliPort = Number.parseInt(arg.slice('--port='.length), 10);
      if (Number.isInteger(cliPort) && cliPort > 0 && cliPort <= 65535) {
        return cliPort;
      }
    }
  }

  return 3000;
}

function resolveServerHost(): string {
  const envHost = process.env.HOST?.trim();
  if (envHost) {
    return envHost;
  }
  return '0.0.0.0';
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const port = resolveServerPort();
  const host = resolveServerHost();

  app.get(['/healthz', '/api/health'], (_req, res) => {
    res.status(200).json({ ok: true, port });
  });

  // Parse up to 4MB specifically for camera book-cover scan photos
  app.post(
    '/api/library/scan-book',
    express.json({ limit: '4mb' }),
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res) => {
      const body = (req.body || {}) as {
        imageBase64?: string;
        mimeType?: string;
        allowedSubjects?: unknown;
      };
      const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : '';
      const mimeType = typeof body.mimeType === 'string' ? body.mimeType : 'image/jpeg';
      const allowedSubjects = Array.isArray(body.allowedSubjects)
        ? body.allowedSubjects
            .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
            .map((s) => s.trim())
            .slice(0, 30)
        : [];

      if (!imageBase64) {
        res.status(400).json({ ok: false, error: 'Book image payload is required.' });
        return;
      }

      try {
        const book = await extractBookFromCoverImage({
          imageBase64,
          mimeType,
          allowedSubjects,
        });
        res.json({ ok: true, book });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to scan book details from image.';
        const status = msg.includes('GEMINI_API_KEY') ? 503 : 422;
        res.status(status).json({ ok: false, error: msg });
      }
    }
  );

  // Parse up to 25MB specifically for full Firestore snapshot JSON exports to the backup bucket
  app.post(
    '/api/backups/upload',
    express.json({ limit: '25mb' }),
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res) => {
      const body = (req.body || {}) as {
        schoolId?: string;
        ownerId?: string;
        snapshotId?: string;
        snapshotJson?: string;
        checksumSha256?: string;
      };

      const schoolId = typeof body.schoolId === 'string' ? body.schoolId.trim() : '';
      const ownerId = typeof body.ownerId === 'string' ? body.ownerId.trim() : '';
      const snapshotId = typeof body.snapshotId === 'string' ? body.snapshotId.trim() : '';
      const snapshotJson = typeof body.snapshotJson === 'string' ? body.snapshotJson : '';
      const checksumSha256 =
        typeof body.checksumSha256 === 'string' ? body.checksumSha256.trim() : undefined;

      if (!schoolId || !ownerId || !snapshotId || !snapshotJson) {
        res.status(400).json({
          ok: false,
          error: 'schoolId, ownerId, snapshotId, and snapshotJson are required.',
        });
        return;
      }

      if (!isCallerAuthorizedOwner(req.authUser!, ownerId)) {
        res.status(403).json({
          ok: false,
          error: 'Only the verified School Owner can export database snapshots.',
        });
        return;
      }

      try {
        const result = await uploadSchoolSnapshotToServerBucket({
          caller: req.authUser!,
          schoolId,
          ownerId,
          snapshotId,
          snapshotJson,
          expectedSha256: checksumSha256,
        });
        res.json({ ok: true, ...result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to store snapshot archive.';
        const status = msg.includes('Only the verified School Owner') ? 403 : 400;
        res.status(status).json({ ok: false, error: msg });
      }
    }
  );

  app.use(express.json({ limit: '64kb' }));

  app.get('/api/library/isbn/:isbn', requireFirebaseAuth, async (req, res) => {
    const clean = normalizeIsbn(req.params.isbn || '');
    if (!isValidIsbn(clean)) {
      res.status(400).json({ ok: false, error: 'Enter a valid 10-digit or 13-digit ISBN.' });
      return;
    }
    const rawSubjects = typeof req.query.subjects === 'string' ? req.query.subjects : '';
    const allowedSubjects = rawSubjects
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 30);

    try {
      const result = await lookupBookByIsbn(clean, allowedSubjects);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'ISBN lookup failed.',
      });
    }
  });

  app.get('/api/sms/status', (_req, res) => {
    res.json(getGatewayStatus());
  });

  app.get('/api/backups/status', requireFirebaseAuth, (_req, res) => {
    res.json(getBackupBucketStatus());
  });

  app.get(
    '/api/backups/download/:schoolId/:snapshotId',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { buffer, fileName } = await readSchoolSnapshotFromServerBucket({
          caller: req.authUser!,
          schoolId: String(req.params.schoolId || '').trim(),
          snapshotId: String(req.params.snapshotId || '').trim(),
        });
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(buffer);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to download snapshot archive.';
        const status = msg.includes('Owner') || msg.includes('permission') ? 403 : 404;
        res.status(status).json({ ok: false, error: msg });
      }
    }
  );

  app.delete('/api/backups/object', requireFirebaseAuth, async (req: AuthenticatedRequest, res) => {
    const body = (req.body || {}) as {
      schoolId?: string;
      ownerId?: string;
      snapshotId?: string;
    };
    const schoolId = typeof body.schoolId === 'string' ? body.schoolId.trim() : '';
    const ownerId = typeof body.ownerId === 'string' ? body.ownerId.trim() : '';
    const snapshotId = typeof body.snapshotId === 'string' ? body.snapshotId.trim() : '';
    if (!schoolId || !ownerId || !snapshotId) {
      res.status(400).json({ ok: false, error: 'schoolId, ownerId, and snapshotId are required.' });
      return;
    }
    try {
      await deleteSchoolSnapshotFromServerBucket({
        caller: req.authUser!,
        schoolId,
        ownerId,
        snapshotId,
      });
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to prune backup archive.';
      const status = msg.includes('Owner') ? 403 : 400;
      res.status(status).json({ ok: false, error: msg });
    }
  });

  app.post('/api/sms/send', requireFirebaseAuth, async (req, res) => {
    const body = (req.body || {}) as SmsSendBody;
    const to = typeof body.to === 'string' ? body.to.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';

    if (!isValidE164Phone(to)) {
      res.status(400).json({
        ok: false,
        status: 'Failed',
        provider: getGatewayStatus().providerLabel,
        providerRef: '',
        errorReason: 'Invalid E.164 recipient phone number.',
      });
      return;
    }

    if (!message || message.length > 320) {
      res.status(400).json({
        ok: false,
        status: 'Failed',
        provider: getGatewayStatus().providerLabel,
        providerRef: '',
        errorReason: 'SMS message must be between 1 and 320 characters.',
      });
      return;
    }

    try {
      const result = await dispatchSms(to, message);
      res.json(result);
    } catch (err) {
      res.status(502).json({
        ok: false,
        status: 'Failed',
        provider: getGatewayStatus().providerLabel,
        providerRef: '',
        errorReason: err instanceof Error ? err.message.slice(0, 150) : 'Gateway dispatch failed.',
      });
    }
  });

  const timebookEngine = new TimebookEngine();

  const applyTimebookRateLimit = (
    req: AuthenticatedRequest,
    res: express.Response
  ): boolean => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const uid = req.authUser?.uid || 'anon';
    const limitRes = timebookEngine.enforceRateLimit(`${uid}:${ip}`);
    if (!limitRes.allowed) {
      res.setHeader('Retry-After', String(limitRes.retryAfterSec));
      res.status(429).json({
        ok: false,
        code: 'RATE_LIMITED',
        error: `Too many requests. Please wait ${limitRes.retryAfterSec}s before retrying.`,
      });
      return false;
    }
    return true;
  };

  app.get('/api/timebook/server-time', (req, res) => {
    const tz = typeof req.query.tz === 'string' ? req.query.tz : undefined;
    res.json({
      ok: true,
      ...timebookEngine.getAuthoritativeClock(tz),
    });
  });

  app.get('/api/timebook/vapid-public-key', requireFirebaseAuth, (_req, res) => {
    res.json({
      ok: true,
      publicKey: timebookEngine.getVapidPublicKey(),
    });
  });

  app.post('/api/timebook/sync-policy', requireFirebaseAuth, (req: AuthenticatedRequest, res) => {
    if (!applyTimebookRateLimit(req, res)) return;
    const body = (req.body || {}) as {
      schoolId?: string;
      schoolName?: string;
      ownerId?: string;
      settings?: Record<string, unknown>;
      staffRoster?: Array<{
        teacherId: string;
        staffCode: string;
        fullName: string;
        roleTitle: string;
        staffEmail: string;
        status: 'Active' | 'On Leave';
      }>;
    };

    const result = timebookEngine.syncSchoolPolicyAndRoster({
      caller: req.authUser!,
      schoolId: body.schoolId || '',
      schoolName: body.schoolName,
      ownerId: body.ownerId,
      settings: body.settings as never,
      staffRoster: body.staffRoster as never,
    });

    if (!result.ok) {
      res.status(result.error.status).json({ ok: false, ...result.error });
      return;
    }

    res.json({
      ok: true,
      policy: result.school.settings,
      rosterCount: result.school.staffRoster.length,
    });
  });

  app.get('/api/timebook/state', requireFirebaseAuth, (req: AuthenticatedRequest, res) => {
    if (!applyTimebookRateLimit(req, res)) return;
    const schoolId = typeof req.query.schoolId === 'string' ? req.query.schoolId.trim() : '';
    if (!schoolId) {
      res.status(400).json({ ok: false, code: 'SCHOOL_ID_REQUIRED', error: 'schoolId is required.' });
      return;
    }
    res.json(
      timebookEngine.getStaffTimebookState({
        caller: req.authUser!,
        schoolId,
      })
    );
  });

  app.post('/api/timebook/challenge', requireFirebaseAuth, (req: AuthenticatedRequest, res) => {
    if (!applyTimebookRateLimit(req, res)) return;
    const body = (req.body || {}) as { schoolId?: string };
    const result = timebookEngine.issueChallenge({
      caller: req.authUser!,
      schoolId: body.schoolId || '',
    });
    if (!result.ok) {
      res.status(result.error.status).json({ ok: false, ...result.error });
      return;
    }
    res.json(result);
  });

  app.post('/api/timebook/verify-checkin', requireFirebaseAuth, (req: AuthenticatedRequest, res) => {
    if (!applyTimebookRateLimit(req, res)) return;
    const body = (req.body || {}) as {
      schoolId?: string;
      nonce?: string;
      latitude?: number;
      longitude?: number;
      accuracyMeters?: number;
      clientTimestampMs?: number;
      requestedDate?: string;
      targetTeacherId?: string;
    };

    const result = timebookEngine.verifyAndRecordCheckIn({
      caller: req.authUser!,
      schoolId: body.schoolId || '',
      nonce: body.nonce || '',
      latitude: Number(body.latitude),
      longitude: Number(body.longitude),
      accuracyMeters: Number(body.accuracyMeters),
      clientTimestampMs:
        typeof body.clientTimestampMs === 'number' ? body.clientTimestampMs : undefined,
      requestedDate: typeof body.requestedDate === 'string' ? body.requestedDate : undefined,
      targetTeacherId: typeof body.targetTeacherId === 'string' ? body.targetTeacherId : undefined,
    });

    if (!result.ok) {
      res.status(result.error.status).json({ ok: false, ...result.error });
      return;
    }
    res.json(result);
  });

  app.post('/api/timebook/admin-sync-entry', requireFirebaseAuth, (req: AuthenticatedRequest, res) => {
    if (!applyTimebookRateLimit(req, res)) return;
    const body = (req.body || {}) as {
      schoolId?: string;
      date?: string;
      teacherId?: string;
      status?: string;
      timeInDisplay?: string;
    };

    const result = timebookEngine.adminSyncEntry({
      caller: req.authUser!,
      schoolId: body.schoolId || '',
      date: body.date || '',
      teacherId: body.teacherId || '',
      status: body.status as never,
      timeInDisplay: body.timeInDisplay,
    });

    if (!result.ok) {
      res.status(result.error.status).json({ ok: false, ...result.error });
      return;
    }
    res.json({ ok: true });
  });

  app.get('/api/timebook/notifications', requireFirebaseAuth, (req: AuthenticatedRequest, res) => {
    const schoolId = typeof req.query.schoolId === 'string' ? req.query.schoolId.trim() : '';
    if (!schoolId) {
      res.status(400).json({ ok: false, code: 'SCHOOL_ID_REQUIRED', error: 'schoolId is required.' });
      return;
    }
    const items = timebookEngine.getNotificationsForUser(req.authUser!, schoolId);
    res.json({ ok: true, notifications: items });
  });

  app.post('/api/timebook/notifications/read', requireFirebaseAuth, (req: AuthenticatedRequest, res) => {
    const body = (req.body || {}) as { schoolId?: string; notificationIds?: string[] };
    const updated = timebookEngine.markNotificationsRead(
      req.authUser!,
      body.schoolId || '',
      Array.isArray(body.notificationIds) ? body.notificationIds : undefined
    );
    res.json({ ok: true, updated });
  });

  app.get('/api/timebook/suspicious-logs', requireFirebaseAuth, (req: AuthenticatedRequest, res) => {
    const schoolId = typeof req.query.schoolId === 'string' ? req.query.schoolId.trim() : '';
    if (!schoolId) {
      res.status(400).json({ ok: false, code: 'SCHOOL_ID_REQUIRED', error: 'schoolId is required.' });
      return;
    }
    const events = timebookEngine.getSuspiciousEvents(req.authUser!, schoolId);
    res.json({ ok: true, events });
  });

  app.post('/api/timebook/push/subscribe', requireFirebaseAuth, (req: AuthenticatedRequest, res) => {
    const body = (req.body || {}) as {
      schoolId?: string;
      subscription?: { endpoint: string; keys: { p256dh: string; auth: string } };
    };
    const result = timebookEngine.savePushSubscription({
      caller: req.authUser!,
      schoolId: body.schoolId || '',
      subscription: body.subscription!,
      userAgent: req.headers['user-agent'] || '',
    });
    if (!result.ok) {
      res.status(result.error.status).json({ ok: false, ...result.error });
      return;
    }
    res.json(result);
  });

  app.post('/api/timebook/push/unsubscribe', requireFirebaseAuth, (req: AuthenticatedRequest, res) => {
    const body = (req.body || {}) as { endpoint?: string };
    timebookEngine.removePushSubscription(req.authUser!, body.endpoint);
    res.json({ ok: true });
  });

  // Automated background Staff Timebook reminder job (runs independently of open browser tabs)
  const reminderInterval = setInterval(() => {
    timebookEngine.runReminderTick().catch(() => {
      // Prevent unhandled interval error
    });
  }, 20_000);
  reminderInterval.unref();

  const distDir = path.resolve(process.cwd(), 'dist');
  const hasBuiltDist = fs.existsSync(path.join(distDir, 'index.html'));
  const isDevLifecycle =
    process.env.npm_lifecycle_event === 'dev' || process.env.NODE_ENV === 'development';
  const useProductionStatic =
    process.env.NODE_ENV === 'production' ||
    process.env.npm_lifecycle_event === 'start' ||
    (!isDevLifecycle && hasBuiltDist);

  if (!useProductionStatic) {
    if (!process.env.DISABLE_HMR) {
      process.env.DISABLE_HMR = 'true';
    }
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: false,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Not built yet.');
      }
    });
  }

  httpServer.on('error', (err) => {
    console.error(`SecSchoolHub server failed to bind on ${host}:${port}:`, err);
    process.exit(1);
  });

  httpServer.listen(port, host, () => {
    console.log(
      `SecSchoolHub server listening on http://${host}:${port} (${useProductionStatic ? 'production' : 'development'})`
    );
  });
}

startServer().catch((err) => {
  console.error('SecSchoolHub server startup error:', err);
  process.exit(1);
});
