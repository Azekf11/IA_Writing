// Input cap keeps API costs and latency predictable
export const MAX_CHARS = 5000;

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
