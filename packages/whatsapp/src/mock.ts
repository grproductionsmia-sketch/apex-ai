import type { Transport, SendResult } from './types.js';

export interface SentRecord {
  to: string;
  body: string;
  templateName?: string;
  waMessageId: string;
}

// In-memory transport for dev and tests. Records everything it "sends".
export class MockTransport implements Transport {
  public readonly sent: SentRecord[] = [];
  private seq = 0;

  private nextId(): string {
    this.seq += 1;
    return `mock-wamid-${this.seq}`;
  }

  async sendText(to: string, body: string): Promise<SendResult> {
    const waMessageId = this.nextId();
    this.sent.push({ to, body, waMessageId });
    return { waMessageId };
  }

  async sendTemplate(to: string, templateName: string, _params: string[]): Promise<SendResult> {
    const waMessageId = this.nextId();
    this.sent.push({ to, body: `[template:${templateName}]`, templateName, waMessageId });
    return { waMessageId };
  }
}
