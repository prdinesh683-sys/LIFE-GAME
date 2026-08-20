/**
 * One-way bridge: the sync store publishes the redacted Drive summary, and the
 * AI store reads it when assembling context. Only metadata crosses this line,
 * and only while the player has Drive context switched on.
 */
let current: string | null = null;

export function publishDriveContextForAi(text: string | null): void {
  current = text && text.trim() ? text : null;
}

export function readDriveContextForAi(): string | null {
  return current;
}
