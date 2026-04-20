interface SerializedLockSlot {
  get(): Promise<void> | null;
  set(value: Promise<void> | null): void;
}

export async function withSerializedLock<T>(
  slot: SerializedLockSlot,
  run: () => Promise<T>,
): Promise<T> {
  const previous = slot.get() ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.catch(() => {}).then(() => current);
  slot.set(chain);
  await previous.catch(() => {});

  try {
    return await run();
  } finally {
    release();
    if (slot.get() === chain) {
      slot.set(null);
    }
  }
}
