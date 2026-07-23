import { createHmac, timingSafeEqual } from 'node:crypto';
import type { InboundMessage } from './types.js';

/**
 * Verify the X-Hub-Signature-256 header on a Meta webhook using the app secret.
 * Compares over the RAW request body. Returns false on any mismatch/format error.
 */
export function verifySignature(
  rawBody: string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const provided = signatureHeader.slice('sha256='.length);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(provided, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Parse a Meta WhatsApp webhook payload into normalized inbound text messages.
 * Ignores status callbacks and non-text message types (returns [] for those).
 */
export function parseInboundWebhook(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = (payload as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return out;

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as { value?: any })?.value;
      if (!value) continue;
      const phoneNumberId: string | undefined = value.metadata?.phone_number_id;
      const messages = value.messages;
      if (!phoneNumberId || !Array.isArray(messages)) continue;
      for (const m of messages) {
        if (m?.type !== 'text' || !m.text?.body) continue;
        out.push({
          waMessageId: String(m.id),
          from: String(m.from),
          phoneNumberId,
          text: String(m.text.body),
          timestamp: Number(m.timestamp) || Math.floor(Date.now() / 1000),
        });
      }
    }
  }
  return out;
}

/** Handle the GET verification handshake. Returns the challenge if the token matches. */
export function verifyWebhookChallenge(
  params: { mode?: string; token?: string; challenge?: string },
  verifyToken: string,
): string | null {
  if (params.mode === 'subscribe' && params.token === verifyToken) {
    return params.challenge ?? '';
  }
  return null;
}
