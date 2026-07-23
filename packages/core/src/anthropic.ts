import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ZodType } from 'zod';
import { getConfig } from './env.js';

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!client) {
    // maxRetries: the SDK retries 429 / 5xx with backoff automatically.
    client = new Anthropic({ apiKey: getConfig().ANTHROPIC_API_KEY, maxRetries: 3 });
  }
  return client;
}

export type Effort = 'low' | 'medium' | 'high' | 'max';

export interface ParseStructuredOptions<T> {
  model: string;
  system: string;
  user: string;
  schema: ZodType<T>;
  maxTokens?: number;
  /** thinking depth / token spend. compliance -> 'high'; generation -> 'medium'. */
  effort?: Effort;
}

/**
 * Single structured-output call. Uses adaptive thinking (recommended for 4.6) and
 * validates the response against a Zod schema. Throws if the model returns no
 * structured output (e.g. a refusal) so callers never proceed on unvalidated data.
 */
export async function parseStructured<T>(opts: ParseStructuredOptions<T>): Promise<T> {
  const res = await getAnthropic().messages.parse({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 4096,
    thinking: { type: 'adaptive' },
    output_config: {
      format: zodOutputFormat(opts.schema),
      ...(opts.effort ? { effort: opts.effort } : {}),
    },
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  });

  if (res.stop_reason === 'refusal') {
    throw new Error('Claude refused to produce a response (safety refusal).');
  }
  if (res.parsed_output == null) {
    throw new Error(`No structured output returned (stop_reason=${res.stop_reason}).`);
  }
  return res.parsed_output as T;
}

export { Anthropic };
