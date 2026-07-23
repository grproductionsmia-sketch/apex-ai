import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '../../../.env') });

const { default: Fastify } = await import('fastify');
const { getServiceClient, logger } = await import('@apex/core');
const { runAgent1OnInbound, resolveWorkspaceByPhoneNumberId } = await import('@apex/agents');
const { parseInboundWebhook, verifySignature, verifyWebhookChallenge } = await import(
  '@apex/whatsapp'
);
const { resolveTransport } = await import('./transport.js');

const app = Fastify({ logger: false });

// Keep the raw body so we can verify Meta's X-Hub-Signature-256.
app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  (req as unknown as { rawBody: string }).rawBody = body as string;
  try {
    done(null, body ? JSON.parse(body as string) : {});
  } catch (err) {
    done(err as Error, undefined);
  }
});

app.get('/health', async () => ({ ok: true }));

// Meta webhook verification handshake
app.get('/webhooks/whatsapp', async (req, reply) => {
  const q = req.query as Record<string, string>;
  const challenge = verifyWebhookChallenge(
    { mode: q['hub.mode'], token: q['hub.verify_token'], challenge: q['hub.challenge'] },
    process.env.WHATSAPP_VERIFY_TOKEN ?? '',
  );
  if (challenge === null) return reply.code(403).send('forbidden');
  return reply.code(200).send(challenge);
});

// Meta inbound messages
app.post('/webhooks/whatsapp', async (req, reply) => {
  const appSecret = process.env.META_APP_SECRET;
  if (appSecret) {
    const sig = req.headers['x-hub-signature-256'] as string | undefined;
    const raw = (req as unknown as { rawBody?: string }).rawBody ?? '';
    if (!verifySignature(raw, sig, appSecret)) {
      return reply.code(401).send('bad signature');
    }
  } else {
    logger.warn('whatsapp.webhook.signature_check_skipped', { reason: 'META_APP_SECRET unset (dev)' });
  }

  const messages = parseInboundWebhook(req.body);
  const db = getServiceClient();

  // Ack fast, then process. (Production: enqueue to the BullMQ worker instead of inline.)
  reply.code(200).send({ received: messages.length });

  for (const m of messages) {
    try {
      const workspaceId = await resolveWorkspaceByPhoneNumberId(db, m.phoneNumberId);
      if (!workspaceId) {
        logger.warn('whatsapp.webhook.unmapped_phone_number', { phoneNumberId: m.phoneNumberId });
        continue;
      }
      const transport = await resolveTransport(db, workspaceId, m.phoneNumberId);
      await runAgent1OnInbound(m, transport, { workspaceId, db });
    } catch (err) {
      logger.error('agent1.webhook_error', { error: err instanceof Error ? err.message : String(err) });
    }
  }
});

const port = Number(process.env.API_PORT ?? 4000);
app
  .listen({ port, host: '0.0.0.0' })
  .then(() => logger.info('api.listening', { port }))
  .catch((err) => {
    logger.error('api.listen_failed', { error: String(err) });
    process.exit(1);
  });
