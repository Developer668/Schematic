export class UpstreamBodyLimitError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Upstream response exceeds the ${maxBytes}-byte limit`);
    this.name = "UpstreamBodyLimitError";
  }
}

/** Read an untrusted upstream response without buffering past the declared cap. */
export async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (Number.isFinite(parsed) && parsed > maxBytes) throw new UpstreamBodyLimitError(maxBytes);
  }

  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("upstream response limit exceeded");
        throw new UpstreamBodyLimitError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
