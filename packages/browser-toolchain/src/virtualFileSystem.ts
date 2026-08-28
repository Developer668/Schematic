export type VirtualFileContents = string | Uint8Array;

export interface VirtualFileSystem {
  writeFile(path: string, contents: VirtualFileContents): void;
  readFile(path: string): Uint8Array;
  readText(path: string): string;
  exists(path: string): boolean;
  remove(path: string): void;
  mkdir(path: string): void;
  listFiles(prefix?: string): readonly string[];
  clear(): void;
}

export class VirtualFileSystemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VirtualFileSystemError";
  }
}

export function normalizeVirtualPath(path: string): string {
  if (typeof path !== "string" || path.length === 0) {
    throw new VirtualFileSystemError("virtual path must be a non-empty string");
  }
  const parts = path.split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") throw new VirtualFileSystemError("virtual path traversal is not allowed");
    normalized.push(part);
  }
  return `/${normalized.join("/")}`;
}

function toBytes(contents: VirtualFileContents): Uint8Array {
  return typeof contents === "string" ? new TextEncoder().encode(contents) : new Uint8Array(contents);
}

export class MemoryVirtualFileSystem implements VirtualFileSystem {
  private readonly files = new Map<string, Uint8Array>();
  private readonly directories = new Set<string>(["/"]);

  writeFile(path: string, contents: VirtualFileContents): void {
    const normalized = normalizeVirtualPath(path);
    this.ensureParentDirectories(normalized);
    this.files.set(normalized, toBytes(contents));
  }

  readFile(path: string): Uint8Array {
    const normalized = normalizeVirtualPath(path);
    const contents = this.files.get(normalized);
    if (!contents) throw new VirtualFileSystemError(`file not found: ${normalized}`);
    return new Uint8Array(contents);
  }

  readText(path: string): string {
    return new TextDecoder().decode(this.readFile(path));
  }

  exists(path: string): boolean {
    const normalized = normalizeVirtualPath(path);
    return this.files.has(normalized) || this.directories.has(normalized);
  }

  remove(path: string): void {
    const normalized = normalizeVirtualPath(path);
    this.files.delete(normalized);
    if (normalized !== "/") {
      for (const file of this.files.keys()) {
        if (file.startsWith(`${normalized}/`)) this.files.delete(file);
      }
      for (const directory of this.directories) {
        if (directory.startsWith(`${normalized}/`)) this.directories.delete(directory);
      }
      this.directories.delete(normalized);
    }
  }

  mkdir(path: string): void {
    const normalized = normalizeVirtualPath(path);
    this.ensureParentDirectories(normalized);
    this.directories.add(normalized);
  }

  listFiles(prefix = "/"): readonly string[] {
    const normalized = normalizeVirtualPath(prefix);
    const withPrefix = normalized === "/" ? "/" : `${normalized}/`;
    return Array.from(this.files.keys())
      .filter((file) => normalized === "/" || file === normalized || file.startsWith(withPrefix))
      .sort();
  }

  clear(): void {
    this.files.clear();
    this.directories.clear();
    this.directories.add("/");
  }

  private ensureParentDirectories(filePath: string): void {
    const parts = filePath.split("/").filter(Boolean);
    parts.pop();
    let current = "";
    for (const part of parts) {
      current += `/${part}`;
      this.directories.add(current);
    }
  }
}
