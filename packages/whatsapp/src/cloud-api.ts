import type { Transport, SendResult } from './types.js';

export interface CloudApiConfig {
  phoneNumberId: string;
  accessToken: string;
  apiVersion?: string; // default v21.0
}

// Real WhatsApp Business Cloud API transport (Meta Graph API).
// Per-workspace credentials come from workspace_integrations (token via Supabase Vault).
// Not runtime-verified yet (pending Meta business verification); the interface + shape
// follow the documented Graph API.
export class CloudApiTransport implements Transport {
  private readonly base: string;
  private readonly token: string;

  constructor(cfg: CloudApiConfig) {
    const version = cfg.apiVersion ?? 'v21.0';
    this.base = `https://graph.facebook.com/${version}/${cfg.phoneNumberId}/messages`;
    this.token = cfg.accessToken;
  }

  private async post(body: unknown): Promise<SendResult> {
    const res = await fetch(this.base, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`WhatsApp Cloud API ${res.status}: ${detail}`);
    }
    const json = (await res.json()) as { messages?: { id: string }[] };
    const id = json.messages?.[0]?.id;
    if (!id) throw new Error('WhatsApp Cloud API: no message id in response');
    return { waMessageId: id };
  }

  async sendText(to: string, body: string): Promise<SendResult> {
    return this.post({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { preview_url: false, body },
    });
  }

  async sendTemplate(to: string, templateName: string, params: string[]): Promise<SendResult> {
    return this.post({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'es' },
        components: params.length
          ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }]
          : [],
      },
    });
  }
}
