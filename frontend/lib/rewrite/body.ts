// The request body as text, or null once it goes past `limit` bytes. Bytes are counted as they
// arrive, so neither multibyte characters nor a missing or false Content-Length change the bound.
export async function readBody(
  request: Request,
  limit: number,
): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // The reader left mid-body: what was read is not valid JSON, so the route answers 400
    return "";
  }
}
