// Themis raises plain UserError messages; this normalises them for display.
export function classifyError(err: unknown): { message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const match = raw.match(/UserError\(message='([^']+)'\)/);
  if (match) return { message: match[1] };
  const prefixed = raw.match(/(EXPECTED|EXTERNAL|LLM_ERROR):\s*(.+)/);
  if (prefixed) return { message: prefixed[2].trim() };
  return { message: raw };
}
