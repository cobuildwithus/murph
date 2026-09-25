export type DurableObjectSqlValue = ArrayBuffer | string | number | null;

export interface DurableObjectSqlCursorLike<
  T extends Record<string, DurableObjectSqlValue>,
> extends Iterable<T> {
  next(): IteratorResult<T>;
  one(): T;
  raw<U extends DurableObjectSqlValue[]>(): IterableIterator<U>;
  readonly columnNames: string[];
  readonly rowsRead: number;
  readonly rowsWritten: number;
  toArray(): T[];
}

export interface DurableObjectSqlStorageLike {
  exec<T extends Record<string, DurableObjectSqlValue>>(
    query: string,
    ...bindings: unknown[]
  ): DurableObjectSqlCursorLike<T>;
}

export interface DurableObjectStorageLike {
  delete(key: string): Promise<boolean>;
  deleteAll?(): Promise<void>;
  deleteAlarm?(): Promise<void>;
  get<T>(key: string): Promise<T | undefined>;
  getAlarm(): Promise<number | null>;
  list?<T>(options?: { prefix?: string; limit?: number; startAfter?: string }): Promise<Map<string, T>>;
  put<T>(key: string, value: T): Promise<void>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  sql?: DurableObjectSqlStorageLike;
  transactionSync?<T>(callback: () => T): T;
}

export interface DurableObjectStateLike {
  id?: { toString(): string };
  storage: DurableObjectStorageLike;
  waitUntil(promise: Promise<unknown>): void;
}
