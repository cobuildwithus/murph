export class MemoryEncryptedR2Bucket {
  readonly objects = new Map<string, string>();
  readonly deleted: string[] = [];

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

  async put(key: string, value: string): Promise<void> {
    this.objects.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.deleted.push(key);
    this.objects.delete(key);
  }
}

export function createTestRootKey(seed = 11): Uint8Array {
  return new Uint8Array(Array.from({ length: 32 }, () => seed));
}
