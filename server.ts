import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';

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

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const port = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '64kb' }));

  app.get('/api/sms/status', (_req, res) => {
    res.json(getGatewayStatus());
  });

  app.post('/api/sms/send', async (req, res) => {
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

  if (process.env.NODE_ENV !== 'production') {
    if (!process.env.DISABLE_HMR) {
      process.env.DISABLE_HMR = 'true';
    }
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
    const distDir = path.resolve(process.cwd(), 'dist');
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

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`MalawiSec server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
