import type { ArtifactProvenance, IntelHexArtifact } from "./types";
import { sha256Hex } from "./hash";

export interface IntelHexSegment {
  address: number;
  data: Uint8Array;
}

export interface IntelHexImage {
  segments: readonly IntelHexSegment[];
  dataBytes: number;
  minAddress: number;
  maxAddressExclusive: number;
}

export class IntelHexError extends Error {
  readonly lineNumber?: number;

  constructor(message: string, lineNumber?: number) {
    super(lineNumber ? `Intel HEX line ${lineNumber}: ${message}` : message);
    this.name = "IntelHexError";
    this.lineNumber = lineNumber;
  }
}

function parseByte(pair: string, lineNumber: number): number {
  const value = Number.parseInt(pair, 16);
  if (!Number.isInteger(value)) {
    throw new IntelHexError(`invalid hexadecimal byte ${pair}`, lineNumber);
  }
  return value;
}

/**
 * Parses Intel HEX while checking record shape, checksums, EOF ordering,
 * address bounds, and overlapping data records. No bytes are silently
 * coerced; a compiler artifact that fails validation is rejected.
 */
export function parseIntelHex(
  text: string,
  options: { maxAddressExclusive?: number } = {},
): IntelHexImage {
  if (!text.trim()) throw new IntelHexError("the artifact is empty");

  const maxAddressExclusive = options.maxAddressExclusive ?? 0x1000000;
  if (!Number.isSafeInteger(maxAddressExclusive) || maxAddressExclusive <= 0) {
    throw new IntelHexError("invalid maximum address");
  }

  const segments: IntelHexSegment[] = [];
  const occupied = new Set<number>();
  let addressBase = 0;
  let sawEof = false;
  let dataBytes = 0;
  let minAddress = Number.POSITIVE_INFINITY;
  let maxAddress = 0;

  const lines = text.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line) return;
    if (sawEof) throw new IntelHexError("records appear after EOF", lineNumber);
    if (!line.startsWith(":")) throw new IntelHexError("record must start with ':'", lineNumber);
    if (line.length < 11 || (line.length - 1) % 2 !== 0) {
      throw new IntelHexError("record has an invalid length", lineNumber);
    }

    const byteCount = parseByte(line.slice(1, 3), lineNumber);
    const expectedLength = 11 + byteCount * 2;
    if (line.length !== expectedLength) {
      throw new IntelHexError(`expected ${expectedLength} characters, got ${line.length}`, lineNumber);
    }

    const recordBytes: number[] = [];
    for (let offset = 1; offset < line.length; offset += 2) {
      recordBytes.push(parseByte(line.slice(offset, offset + 2), lineNumber));
    }
    if (recordBytes.reduce((sum, value) => (sum + value) & 0xff, 0) !== 0) {
      throw new IntelHexError("checksum mismatch", lineNumber);
    }

    const address = (recordBytes[1] << 8) | recordBytes[2];
    const recordType = recordBytes[3];
    const data = Uint8Array.from(recordBytes.slice(4, 4 + byteCount));

    switch (recordType) {
      case 0x00: {
        const absoluteAddress = addressBase + address;
        const endAddress = absoluteAddress + data.length;
        if (absoluteAddress < 0 || endAddress > maxAddressExclusive) {
          throw new IntelHexError("data record exceeds the target address space", lineNumber);
        }
        for (let offset = 0; offset < data.length; offset += 1) {
          const byteAddress = absoluteAddress + offset;
          if (occupied.has(byteAddress)) {
            throw new IntelHexError(`overlapping data at address 0x${byteAddress.toString(16)}`, lineNumber);
          }
          occupied.add(byteAddress);
        }
        if (data.length > 0) {
          segments.push({ address: absoluteAddress, data });
          dataBytes += data.length;
          minAddress = Math.min(minAddress, absoluteAddress);
          maxAddress = Math.max(maxAddress, endAddress);
        }
        break;
      }
      case 0x01:
        if (byteCount !== 0 || address !== 0) {
          throw new IntelHexError("EOF record must have zero length and address", lineNumber);
        }
        sawEof = true;
        break;
      case 0x02:
        if (byteCount !== 2 || address !== 0) {
          throw new IntelHexError("extended segment address record is malformed", lineNumber);
        }
        addressBase = ((data[0] << 8) | data[1]) << 4;
        break;
      case 0x04:
        if (byteCount !== 2 || address !== 0) {
          throw new IntelHexError("extended linear address record is malformed", lineNumber);
        }
        addressBase = ((data[0] << 8) | data[1]) << 16;
        break;
      case 0x03:
        if (byteCount !== 4 || address !== 0) {
          throw new IntelHexError("start segment address record is malformed", lineNumber);
        }
        break;
      case 0x05:
        if (byteCount !== 4 || address !== 0) {
          throw new IntelHexError("start linear address record is malformed", lineNumber);
        }
        break;
      default:
        throw new IntelHexError(`unsupported record type 0x${recordType.toString(16)}`, lineNumber);
    }
  });

  if (!sawEof) throw new IntelHexError("missing EOF record");
  return {
    segments,
    dataBytes,
    minAddress: Number.isFinite(minAddress) ? minAddress : 0,
    maxAddressExclusive: maxAddress,
  };
}

export async function createIntelHexArtifact(
  text: string,
  options: {
    fileName?: string;
    targetFqbn: string;
    targetFlashBytes?: number;
    provenance: ArtifactProvenance;
  },
): Promise<IntelHexArtifact> {
  const image = parseIntelHex(text, { maxAddressExclusive: options.targetFlashBytes });
  const bytes = new TextEncoder().encode(text);
  return {
    format: "intel-hex",
    fileName: options.fileName ?? "firmware.hex",
    text,
    bytes,
    sha256: await sha256Hex(bytes),
    flashBytes: image.dataBytes,
    provenance: options.provenance,
  };
}

export async function verifyIntelHexArtifact(artifact: IntelHexArtifact): Promise<void> {
  const actualHash = await sha256Hex(artifact.bytes);
  if (actualHash !== artifact.sha256) {
    throw new Error(`artifact hash mismatch: expected ${artifact.sha256}, got ${actualHash}`);
  }
  const textBytes = new TextEncoder().encode(artifact.text);
  if (textBytes.length !== artifact.bytes.length || textBytes.some((value, index) => value !== artifact.bytes[index])) {
    throw new Error("artifact bytes do not match the exact HEX text");
  }
  parseIntelHex(artifact.text);
}
