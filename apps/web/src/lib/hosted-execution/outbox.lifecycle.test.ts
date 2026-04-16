import {
  ExecutionOutboxStatus,
  type PrismaClient,
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
}));

vi.mock("../prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

import {
  isExecutionLifecycleTerminal,
  readExecutionLifecycleState,
  readExecutionLifecycleStateFromOutbox,
} from "./outbox";

describe("hosted execution lifecycle readers", () => {
  it("reads canonical lifecycle state without consulting transport status", async () => {
    const executionOutbox = {
      findUnique: vi.fn(async () => {
        throw new Error("Execution lifecycle fallback rows should bypass Prisma reads.");
      }),
    };
    const prisma = {
      executionOutbox,
      outboxRows: [
        {
          dispatchState: "poisoned",
          eventId: "evt_123",
          status: ExecutionOutboxStatus.queued,
        },
      ],
    } as unknown as Pick<PrismaClient, "executionOutbox">;

    await expect(readExecutionLifecycleStateFromOutbox({
      eventId: "evt_123",
      prisma,
    })).resolves.toBe("poisoned");
    expect(executionOutbox.findUnique).not.toHaveBeenCalled();
  });

  it("normalizes invalid lifecycle values and preserves terminal checks", () => {
    expect(readExecutionLifecycleState("unknown-state")).toBe("queued");
    expect(isExecutionLifecycleTerminal("completed")).toBe(true);
    expect(isExecutionLifecycleTerminal("poisoned")).toBe(true);
    expect(isExecutionLifecycleTerminal("queued")).toBe(false);
    expect(isExecutionLifecycleTerminal("backpressured")).toBe(false);
  });
});
