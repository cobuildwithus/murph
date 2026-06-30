import "server-only";

import { after } from "next/server";

import { formatHostedExecutionSafeLogErrorDetails } from "../hosted-execution/logging";
import { getPrisma } from "../prisma";
import { createComputerUseService } from "./service";
import {
  isMateriallyDifferentComputerHandoffViewportSize,
  normalizeComputerHandoffViewportSize,
  toComputerBrowserViewport,
  type ComputerHandoffViewportSize,
} from "./viewport";

type StoredComputerHandoffViewportObservation = ComputerHandoffViewportSize & {
  observedAt: Date | null;
};

export async function saveHostedWebSessionComputerHandoffViewportSize(input: {
  memberId: string;
  now?: Date;
  observedAt?: Date;
  sessionId: string;
  size: ComputerHandoffViewportSize;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const observedAt = input.observedAt ?? now;
  const size = normalizeComputerHandoffViewportSize(input.size);
  if (!size) {
    throw new TypeError("Computer handoff viewport size is invalid.");
  }

  const result = await getPrisma().hostedWebSession.updateMany({
    where: {
      expiresAt: { gt: now },
      id: input.sessionId,
      memberId: input.memberId,
      OR: [
        { computerHandoffViewportObservedAt: null },
        { computerHandoffViewportObservedAt: { lt: observedAt } },
      ],
      revokedAt: null,
    },
    data: {
      computerHandoffViewportHeight: size.height,
      computerHandoffViewportObservedAt: observedAt,
      computerHandoffViewportWidth: size.width,
      updatedAt: now,
    },
  });

  return result.count > 0;
}

export async function readHostedWebSessionComputerHandoffViewportSize(input: {
  memberId: string;
  now?: Date;
  sessionId: string;
}): Promise<ComputerHandoffViewportSize | null> {
  const observation = await readHostedWebSessionComputerHandoffViewportObservation(input);
  return observation
    ? { height: observation.height, width: observation.width }
    : null;
}

async function readHostedWebSessionComputerHandoffViewportObservation(input: {
  memberId: string;
  now?: Date;
  sessionId: string;
}): Promise<StoredComputerHandoffViewportObservation | null> {
  const now = input.now ?? new Date();
  const record = await getPrisma().hostedWebSession.findFirst({
    where: {
      expiresAt: { gt: now },
      id: input.sessionId,
      memberId: input.memberId,
      revokedAt: null,
    },
    select: {
      computerHandoffViewportHeight: true,
      computerHandoffViewportObservedAt: true,
      computerHandoffViewportWidth: true,
    },
  });

  const size = normalizeComputerHandoffViewportSize({
    height: record?.computerHandoffViewportHeight,
    width: record?.computerHandoffViewportWidth,
  });
  if (!size) {
    return null;
  }

  return {
    ...size,
    observedAt: record?.computerHandoffViewportObservedAt ?? null,
  };
}

export async function applyHostedWebSessionComputerHandoffViewport(input: {
  memberId: string;
  sessionId: string;
  token: string;
}): Promise<void> {
  const first = await readHostedWebSessionComputerHandoffViewportObservation({
    memberId: input.memberId,
    sessionId: input.sessionId,
  });

  if (!first) {
    return;
  }

  const service = createComputerUseService();
  await service.ensureHandoffViewport({
    memberId: input.memberId,
    token: input.token,
    viewport: toComputerBrowserViewport(toComputerHandoffViewportSize(first)),
  });

  const latest = await readHostedWebSessionComputerHandoffViewportObservation({
    memberId: input.memberId,
    sessionId: input.sessionId,
  });

  if (
    isNewerComputerHandoffViewportObservation(first, latest)
    && isMateriallyDifferentComputerHandoffViewportSize(first, latest)
  ) {
    await service.ensureHandoffViewport({
      memberId: input.memberId,
      token: input.token,
      viewport: toComputerBrowserViewport(toComputerHandoffViewportSize(latest)),
    });
  }
}

export function scheduleHostedWebSessionComputerHandoffViewportApply(input: {
  memberId: string;
  reason: "cached" | "measured";
  sessionId: string;
  token: string;
}): void {
  scheduleAfterResponseOrFireAndForget(async () => {
    try {
      await applyHostedWebSessionComputerHandoffViewport({
        memberId: input.memberId,
        sessionId: input.sessionId,
        token: input.token,
      });
    } catch (error) {
      console.warn(
        `[computer-handoff] ${input.reason} viewport resize failed`,
        formatHostedExecutionSafeLogErrorDetails(error, {
          code: "HOSTED_COMPUTER_HANDOFF_VIEWPORT_RESIZE_FAILED",
        }),
      );
    }
  });
}

function scheduleAfterResponseOrFireAndForget(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}

function isNewerComputerHandoffViewportObservation(
  applied: StoredComputerHandoffViewportObservation,
  latest: StoredComputerHandoffViewportObservation | null,
): latest is StoredComputerHandoffViewportObservation {
  if (!latest) {
    return false;
  }

  if (!applied.observedAt) {
    return latest.observedAt !== null;
  }

  return latest.observedAt !== null
    && latest.observedAt.getTime() > applied.observedAt.getTime();
}

function toComputerHandoffViewportSize(
  observation: StoredComputerHandoffViewportObservation,
): ComputerHandoffViewportSize {
  return {
    height: observation.height,
    width: observation.width,
  };
}
