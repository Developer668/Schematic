export interface IntelHexSegment {
  address: number;
  data: Uint8Array;
}

export interface IntelHexImage {
  segments: readonly IntelHexSegment[];
  dataBytes: number;
  maxAddressExclusive: number;
}

export class AvrIntelHexError extends Error {
  readonly lineNumber?: number;

  constructor(message: string, lineNumber?: number) {
    super(lineNumber ? `Intel HEX line ${lineNumber}: ${message}` : message);
    this.name = "AvrIntelHexError";
    this.lineNumber = lineNumber;
  }
}

function byteAt(line: string, offset: number, lineNumber: number): number {
  const value = Number.parseInt(line.slice(offset, offset + 2), 16);
  if (!Number.isInteger(value)) throw new AvrIntelHexError("invalid hexadecimal byte", lineNumber);
  return value;
}

export function parseIntelHex(text: string, maxAddressExclusive = 32 * 1024): IntelHexImage {
  if (!text.trim()) throw new AvrIntelHexError("artifact is empty");
  if (!Number.isSafeInteger(maxAddressExclusive) || maxAddressExclusive <= 0) throw new AvrIntelHexError("invalid flash size");

  const segments: IntelHexSegment[] = [];
  const occupied = new Set<number>();
  let base = 0;
  let eof = false;
  let dataBytes = 0;
  let maxAddress = 0;

  text.split(/\r?\n/).forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = raw.trim();
    if (!line) return;
    if (eof) throw new AvrIntelHexError("record appears after EOF", lineNumber);
    if (!line.startsWith(":")) throw new AvrIntelHexError("record must start with ':'", lineNumber);
    if (line.length < 11 || (line.length - 1) % 2 !== 0) throw new AvrIntelHexError("invalid record length", lineNumber);

    const byteCount = byteAt(line, 1, lineNumber);
    const expectedLength = 11 + byteCount * 2;
    if (line.length !== expectedLength) throw new AvrIntelHexError(`expected ${expectedLength} characters, got ${line.length}`, lineNumber);

    let checksum = 0;
    for (let offset = 1; offset < line.length; offset += 2) checksum = (checksum + byteAt(line, offset, lineNumber)) & 0xff;
    if (checksum !== 0) throw new AvrIntelHexError("checksum mismatch", lineNumber);

    const address = (byteAt(line, 3, lineNumber) << 8) | byteAt(line, 5, lineNumber);
    const type = byteAt(line, 7, lineNumber);
    const data = new Uint8Array(byteCount);
    for (let offset = 0; offset < byteCount; offset += 1) data[offset] = byteAt(line, 9 + offset * 2, lineNumber);

    switch (type) {
      case 0x00: {
        const absolute = base + address;
        const end = absolute + data.byteLength;
        if (absolute < 0 || end > maxAddressExclusive) throw new AvrIntelHexError("data exceeds the ATmega328P flash address space", lineNumber);
        for (let offset = 0; offset < data.byteLength; offset += 1) {
          const byteAddress = absolute + offset;
          if (occupied.has(byteAddress)) throw new AvrIntelHexError(`overlapping data at address 0x${byteAddress.toString(16)}`, lineNumber);
          occupied.add(byteAddress);
        }
        if (data.byteLength > 0) {
          segments.push({ address: absolute, data });
          dataBytes += data.byteLength;
          maxAddress = Math.max(maxAddress, end);
        }
        break;
      }
      case 0x01:
        if (byteCount !== 0 || address !== 0) throw new AvrIntelHexError("malformed EOF record", lineNumber);
        eof = true;
        break;
      case 0x02:
        if (byteCount !== 2 || address !== 0) throw new AvrIntelHexError("malformed extended segment address record", lineNumber);
        base = ((data[0] << 8) | data[1]) << 4;
        break;
      case 0x04:
        if (byteCount !== 2 || address !== 0) throw new AvrIntelHexError("malformed extended linear address record", lineNumber);
        base = ((data[0] << 8) | data[1]) << 16;
        break;
      case 0x03:
        if (byteCount !== 4 || address !== 0) throw new AvrIntelHexError("malformed start segment address record", lineNumber);
        break;
      case 0x05:
        if (byteCount !== 4 || address !== 0) throw new AvrIntelHexError("malformed start linear address record", lineNumber);
        break;
      default:
        throw new AvrIntelHexError(`unsupported record type 0x${type.toString(16)}`, lineNumber);
    }
  });

  if (!eof) throw new AvrIntelHexError("missing EOF record");
  return { segments, dataBytes, maxAddressExclusive: maxAddress };
}

export function imageToProgram(image: IntelHexImage, flashBytes = 32 * 1024): Uint16Array {
  if (!Number.isSafeInteger(flashBytes) || flashBytes <= 0 || flashBytes % 2 !== 0) throw new AvrIntelHexError("flash size must be a positive even integer");
  const program = new Uint16Array(flashBytes / 2);
  for (const segment of image.segments) {
    for (let offset = 0; offset < segment.data.byteLength; offset += 1) {
      const address = segment.address + offset;
      const word = address >> 1;
      if ((address & 1) === 0) program[word] = (program[word] & 0xff00) | segment.data[offset];
      else program[word] = (program[word] & 0x00ff) | (segment.data[offset] << 8);
    }
  }
  return program;
}
