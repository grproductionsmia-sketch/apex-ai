// Minimal structured logger. Writes JSON to stderr so stdout stays clean for
// script output / piping. Replace with pino/OTel in a later phase if needed.
type Meta = Record<string, unknown>;

function emit(level: string, msg: string, meta?: Meta): void {
  const line = JSON.stringify({ level, msg, ...meta, t: new Date().toISOString() });
  // eslint-disable-next-line no-console
  console.error(line);
}

export const logger = {
  info: (msg: string, meta?: Meta) => emit('info', msg, meta),
  warn: (msg: string, meta?: Meta) => emit('warn', msg, meta),
  error: (msg: string, meta?: Meta) => emit('error', msg, meta),
};
