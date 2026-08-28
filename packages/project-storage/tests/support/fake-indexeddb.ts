type FailureKind = "open" | "get" | "put" | "delete";

interface DatabaseState {
  stores: Map<string, Map<string, unknown>>;
}

function namedError(name: string, message = name): Error {
  const error = new Error(message);
  Object.defineProperty(error, "name", { value: name, enumerable: true });
  return error;
}

function clone<T>(value: T): T {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T;
}

class FakeRequest<T = unknown> {
  result!: T;
  error: Error | null = null;
  transaction: FakeTransaction | null;
  onsuccess: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(transaction: FakeTransaction | null) {
    this.transaction = transaction;
  }

  succeed(value: T) {
    this.result = value;
    this.onsuccess?.(new Event("success"));
  }

  fail(error: Error) {
    this.error = error;
    const event = new Event("error", { cancelable: true });
    this.onerror?.(event);
    if (!event.defaultPrevented) this.transaction?.abort(error);
  }
}

class FakeTransaction {
  readonly database: FakeDatabase;
  readonly mode: IDBTransactionMode;
  pending = 0;
  done = false;
  error: Error | null = null;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor(readonly state: DatabaseState, database: FakeDatabase, mode: IDBTransactionMode) {
    this.database = database;
    this.mode = mode;
  }

  objectStore(name: string) {
    if (!this.state.stores.has(name)) throw namedError("NotFoundError", `Missing store ${name}`);
    return new FakeObjectStore(this, name);
  }

  request<T>(work: () => T): FakeRequest<T> {
    const request = new FakeRequest<T>(this);
    this.pending += 1;
    queueMicrotask(() => {
      if (this.done) return;
      try {
        request.succeed(work());
      } catch (error) {
        request.fail(error instanceof Error ? error : namedError("UnknownError"));
      } finally {
        this.pending -= 1;
        this.completeIfIdle();
      }
    });
    return request;
  }

  abort(error?: Error) {
    if (this.done) return;
    this.done = true;
    this.error = error ?? namedError("AbortError", "Transaction aborted");
    this.onerror?.();
    this.onabort?.();
  }

  private completeIfIdle() {
    if (!this.done && this.pending === 0) {
      this.done = true;
      queueMicrotask(() => this.oncomplete?.());
    }
  }
}

class FakeObjectStore {
  constructor(private readonly transaction: FakeTransaction, private readonly name: string) {}

  get(key: IDBValidKey) {
    return this.transaction.request(() => {
      const value = this.transaction.state.stores.get(this.name)?.get(String(key));
      if (value === undefined) return undefined;
      return clone(value);
    });
  }

  put(value: unknown) {
    return this.transaction.request(() => {
      const failure = this.transaction.database.factory.consumeFailure("put");
      if (failure) throw failure;
      if (!value || typeof value !== "object" || typeof (value as { namespaceKey?: unknown }).namespaceKey !== "string") {
        throw namedError("DataError", "A workspace record needs namespaceKey");
      }
      this.transaction.state.stores.get(this.name)?.set(String((value as { namespaceKey: string }).namespaceKey), clone(value));
      return (value as { namespaceKey: string }).namespaceKey;
    });
  }

  delete(key: IDBValidKey) {
    return this.transaction.request(() => {
      const failure = this.transaction.database.factory.consumeFailure("delete");
      if (failure) throw failure;
      this.transaction.state.stores.get(this.name)?.delete(String(key));
      return undefined;
    });
  }
}

class FakeDatabase {
  readonly objectStoreNames = {
    contains: (name: string) => this.state.stores.has(name),
  };

  constructor(
    private readonly state: DatabaseState,
    readonly factory: FakeIndexedDBFactory,
  ) {}

  createObjectStore(name: string) {
    if (!this.state.stores.has(name)) this.state.stores.set(name, new Map());
    return new FakeObjectStore(new FakeTransaction(this.state, this, "versionchange"), name);
  }

  transaction(name: string, mode: IDBTransactionMode) {
    const failure = this.factory.consumeFailure("get");
    if (failure && mode === "readonly") throw failure;
    return new FakeTransaction(this.state, this, mode);
  }

  close() {}
}

export class FakeIndexedDBFactory {
  private readonly databases = new Map<string, DatabaseState>();
  private readonly failures = new Map<FailureKind, Error>();

  open(name: string): IDBOpenDBRequest {
    const request = new FakeRequest<FakeDatabase>(null);
    queueMicrotask(() => {
      const openFailure = this.consumeFailure("open");
      if (openFailure) {
        request.fail(openFailure);
        return;
      }
      const state = this.databases.get(name) ?? { stores: new Map<string, Map<string, unknown>>() };
      const isNew = !this.databases.has(name);
      this.databases.set(name, state);
      const database = new FakeDatabase(state, this);
      request.result = database;
      if (isNew) {
        const event = new Event("upgradeneeded");
        (request as unknown as { onupgradeneeded?: (event: Event) => void }).onupgradeneeded?.(event);
      }
      (request as unknown as { onsuccess?: (event: Event) => void }).onsuccess?.(new Event("success"));
    });
    return request as unknown as IDBOpenDBRequest;
  }

  failNext(kind: FailureKind, name: string, message = name) {
    this.failures.set(kind, namedError(name, message));
  }

  consumeFailure(kind: FailureKind): Error | undefined {
    const failure = this.failures.get(kind);
    this.failures.delete(kind);
    return failure;
  }

  seed(dbName: string, storeName: string, key: string, value: unknown) {
    const state = this.databases.get(dbName) ?? { stores: new Map<string, Map<string, unknown>>() };
    this.databases.set(dbName, state);
    const store = state.stores.get(storeName) ?? new Map<string, unknown>();
    state.stores.set(storeName, store);
    store.set(key, clone(value));
  }
}
