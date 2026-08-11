interface TemporalMailboxSignalFaultIdentity {
  mailboxItemId: string;
  userId: string;
}

interface PendingTemporalMailboxSignalFaultConsumer {
  resolve(consume: boolean): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface TemporalMailboxSignalFaultLifecycle {
  mailboxItemId: string;
  state: "armed" | "consumed";
}

const lifecycleByUser = new Map<string, TemporalMailboxSignalFaultLifecycle>();
const pendingConsumersByIdentity = new Map<
  string,
  Set<PendingTemporalMailboxSignalFaultConsumer>
>();

export function armTemporalMailboxSignalFaultForTest(
  identity: TemporalMailboxSignalFaultIdentity,
): {
  armed: true;
  deliveredToPendingConsumer: boolean;
} {
  const userId = requireNonEmpty(identity.userId, "userId");
  const mailboxItemId = requireNonEmpty(identity.mailboxItemId, "mailboxItemId");
  const existingLifecycle = lifecycleByUser.get(userId);
  if (
    existingLifecycle !== undefined
    && (
      existingLifecycle.mailboxItemId !== mailboxItemId
      || existingLifecycle.state === "consumed"
    )
  ) {
    throw new Error(
      `A Temporal mailbox signal fault lifecycle already exists for ${userId}.`,
    );
  }

  const identityKey = buildTemporalMailboxSignalFaultIdentityKey({
    mailboxItemId,
    userId,
  });
  const pendingConsumers = pendingConsumersByIdentity.get(identityKey);
  const pendingConsumer = pendingConsumers?.values().next().value;
  if (pendingConsumer) {
    pendingConsumersByIdentity.delete(identityKey);
    lifecycleByUser.set(userId, {
      mailboxItemId,
      state: "consumed",
    });
    let first = true;
    for (const consumer of pendingConsumers ?? []) {
      clearTimeout(consumer.timeout);
      consumer.resolve(first);
      first = false;
    }
    return {
      armed: true,
      deliveredToPendingConsumer: true,
    };
  }

  lifecycleByUser.set(userId, {
    mailboxItemId,
    state: "armed",
  });
  return {
    armed: true,
    deliveredToPendingConsumer: false,
  };
}

export async function consumeTemporalMailboxSignalFaultForTest(
  identity: TemporalMailboxSignalFaultIdentity,
  timeoutMs: number,
): Promise<boolean> {
  const userId = requireNonEmpty(identity.userId, "userId");
  const mailboxItemId = requireNonEmpty(identity.mailboxItemId, "mailboxItemId");
  const lifecycle = lifecycleByUser.get(userId);
  if (lifecycle !== undefined) {
    if (lifecycle.mailboxItemId !== mailboxItemId) {
      return false;
    }
    if (lifecycle.state === "consumed") {
      return false;
    }
    lifecycleByUser.set(userId, {
      mailboxItemId,
      state: "consumed",
    });
    return true;
  }

  const normalizedTimeoutMs = Number.isFinite(timeoutMs)
    ? Math.max(0, Math.floor(timeoutMs))
    : 0;
  if (normalizedTimeoutMs === 0) {
    return false;
  }

  const identityKey = buildTemporalMailboxSignalFaultIdentityKey({
    mailboxItemId,
    userId,
  });
  return await new Promise<boolean>((resolve) => {
    const pendingConsumer: PendingTemporalMailboxSignalFaultConsumer = {
      resolve,
      timeout: setTimeout(() => {
        const pendingConsumers = pendingConsumersByIdentity.get(identityKey);
        pendingConsumers?.delete(pendingConsumer);
        if (pendingConsumers?.size === 0) {
          pendingConsumersByIdentity.delete(identityKey);
        }
        resolve(false);
      }, normalizedTimeoutMs),
    };
    const pendingConsumers = pendingConsumersByIdentity.get(identityKey)
      ?? new Set<PendingTemporalMailboxSignalFaultConsumer>();
    pendingConsumers.add(pendingConsumer);
    pendingConsumersByIdentity.set(identityKey, pendingConsumers);
  });
}

export function clearTemporalMailboxSignalFaultForTest(userIdInput: string): {
  cleared: boolean;
} {
  const userId = requireNonEmpty(userIdInput, "userId");
  const clearedLifecycle = lifecycleByUser.delete(userId);
  let clearedPendingConsumer = false;

  for (const [identityKey, pendingConsumers] of pendingConsumersByIdentity) {
    if (!identityKey.startsWith(`${userId}\u0000`)) {
      continue;
    }
    pendingConsumersByIdentity.delete(identityKey);
    for (const pendingConsumer of pendingConsumers) {
      clearTimeout(pendingConsumer.timeout);
      pendingConsumer.resolve(false);
      clearedPendingConsumer = true;
    }
  }

  return {
    cleared: clearedLifecycle || clearedPendingConsumer,
  };
}

function buildTemporalMailboxSignalFaultIdentityKey(
  identity: TemporalMailboxSignalFaultIdentity,
): string {
  return `${identity.userId}\u0000${identity.mailboxItemId}`;
}

function requireNonEmpty(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${fieldName} is required.`);
  }
  return normalized;
}
