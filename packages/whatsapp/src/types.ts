// Normalized inbound message (transport-agnostic).
export interface InboundMessage {
  waMessageId: string;
  from: string; // sender's WhatsApp id / phone (E.164 without +)
  phoneNumberId: string; // OUR receiving number id — routes to a workspace
  text: string;
  timestamp: number; // unix seconds
}

export interface SendResult {
  waMessageId: string;
}

// Abstraction over the WhatsApp send API. Real = Cloud API; Mock = in-memory (dev/tests).
// The Agente 1 logic depends only on this interface, never on Meta directly.
export interface Transport {
  sendText(to: string, body: string): Promise<SendResult>;
  /** Send a pre-approved template (for messages outside the 24h window). */
  sendTemplate?(to: string, templateName: string, params: string[]): Promise<SendResult>;
}
