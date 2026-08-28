/** Hashes bytes with the browser Web Crypto API. ChatGPT Sites are HTTPS. */
export async function sha256Hex(input: Uint8Array | string): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error("Web Crypto SHA-256 is unavailable in this browser runtime");
  }

  // Copying gives Web Crypto an owned ArrayBuffer rather than a potentially
  // shared/sliced buffer, and keeps this code compatible with strict TS DOM
  // definitions across Node and browser builds.
  const owned = new Uint8Array(bytes);
  const digest = await cryptoApi.subtle.digest("SHA-256", owned.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function cloneBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}
