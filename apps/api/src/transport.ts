import { CloudApiTransport, MockTransport, type Transport } from '@apex/whatsapp';
import { logger, type SupabaseClient } from '@apex/core';

/**
 * Resolve the WhatsApp transport for a workspace.
 *
 * Production: build a CloudApiTransport from the workspace's stored credentials
 * (token retrieved from Supabase Vault). Until Meta business verification + Vault
 * wiring land, fall back to a MockTransport in dev when WHATSAPP_DEV_TOKEN is unset,
 * so inbound processing is exercisable without sending real messages.
 */
export async function resolveTransport(
  _db: SupabaseClient,
  workspaceId: string,
  phoneNumberId: string,
): Promise<Transport> {
  const devToken = process.env.WHATSAPP_DEV_TOKEN;
  if (devToken) {
    return new CloudApiTransport({ phoneNumberId, accessToken: devToken });
  }
  logger.warn('whatsapp.transport.mock_fallback', {
    workspaceId,
    reason: 'no WHATSAPP_DEV_TOKEN / per-workspace Vault token wired yet',
  });
  return new MockTransport();
}
