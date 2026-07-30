export class MemoryEncryptedR2Bucket {
  readonly objects = new Map<string, string>();
  readonly deleted: string[] = [];
  readonly uploadedAt = new Map<string, Date>();

  async get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> {
    const value = this.objects.get(key);

    if (value === undefined) {
      return null;
    }

    return {
      async arrayBuffer(): Promise<ArrayBuffer> {
        const bytes = new TextEncoder().encode(value);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      },
    };
  }

  async head(key: string): Promise<{
    key: string;
    size: number;
    uploaded: Date;
  } | null> {
    const value = this.objects.get(key);
    const uploaded = this.uploadedAt.get(key);
    return value === undefined || !uploaded
      ? null
      : {
          key,
          size: new TextEncoder().encode(value).byteLength,
          uploaded,
        };
  }

  async put(key: string, value: string): Promise<void> {
    this.objects.set(key, value);
    this.uploadedAt.set(key, new Date());
  }

  async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key];
    for (const item of keys) {
      this.deleted.push(item);
      this.objects.delete(item);
      this.uploadedAt.delete(item);
    }
  }
}

export function createTestRootKey(seed = 11): Uint8Array {
  return new Uint8Array(Array.from({ length: 32 }, () => seed));
}
