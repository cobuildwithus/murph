import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionEmailConversationMessageWake,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  readInputAuthority: vi.fn(),
  readInputWake: vi.fn(),
  requireActiveAccess: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
  requireHostedRuntimeActiveAccessForUpdateTx: mocks.requireActiveAccess,
}));
vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  readHostedMailboxConversationInputAuthorityByAssistantInputIdTx:
    mocks.readInputAuthority,
  readHostedMailboxConversationWakeByAssistantInputId: mocks.readInputWake,
}));

import {
  configureHostedSourceNoDataOutreach,
} from "@/src/lib/device-sync/source-no-data-outreach-preference";
import {
  readHostedSourceNoDataOutreachPolicy,
} from "@/src/lib/device-sync/source-no-data-outreach-policy";

const ASSISTANT_INPUT_ID = "ain_00000000000000000000000000000001";

function directLinqWake(threadIsDirect = true) {
  return {
    kind: "conversation.message",
    message: {
      channel: "linq",
      linqMessage: { threadIsDirect },
    },
  };
}

function telegramWake(threadIsDirect: boolean) {
  return {
    kind: "conversation.message",
    message: {
      channel: "telegram",
      telegramMessage: { threadIsDirect },
    },
  };
}

function directEmailWake(assistantStyleSettingsAuthorized: boolean) {
  return buildHostedExecutionEmailConversationMessageWake({
    assistantStyleSettingsAuthorized,
    eventId: "email-event-synthetic",
    identityId: "email-identity-synthetic",
    occurredAt: "2026-08-25T04:00:00.000Z",
    rawMessageKey: "email-raw-synthetic",
    threadIsDirect: true,
    userId: "member-synthetic",
  });
}

function createPreferenceStore(initial: number | null | undefined = undefined) {
  let row = initial === undefined ? null : { reminderAfterDays: initial };
  const preference = {
    deleteMany: vi.fn(async () => {
      const count = row ? 1 : 0;
      row = null;
      return { count };
    }),
    findUnique: vi.fn(async () => row),
    upsert: vi.fn(async (input: {
      create: { reminderAfterDays: number | null };
      update: { reminderAfterDays: number | null };
    }) => {
      row = {
        reminderAfterDays: row
          ? input.update.reminderAfterDays
          : input.create.reminderAfterDays,
      };
      return row;
    }),
  };
  const tx = { deviceSourceNoDataOutreachPreference: preference };
  return {
    preference,
    prisma: {
      $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    },
    read: () => row,
    tx,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readInputAuthority.mockResolvedValue({
    causalSeq: "7",
    occurredAt: "2026-08-25T04:00:00.000Z",
  });
  mocks.readInputWake.mockResolvedValue(directLinqWake());
  mocks.requireActiveAccess.mockResolvedValue(undefined);
});

describe("hosted source no-data outreach policy", () => {
  it("resolves missing, custom, and disabled canonical preference state", async () => {
    const defaultStore = createPreferenceStore();
    await expect(readHostedSourceNoDataOutreachPolicy({
      memberId: "member-synthetic",
      prisma: defaultStore.tx,
      sourceProviderSlug: " GARMIN ",
    })).resolves.toEqual({
      afterDays: 5,
      enabled: true,
      setting: "default",
      silentHours: 120,
    });

    const customStore = createPreferenceStore(10);
    await expect(readHostedSourceNoDataOutreachPolicy({
      memberId: "member-synthetic",
      prisma: customStore.tx,
      sourceProviderSlug: "garmin",
    })).resolves.toEqual({
      afterDays: 10,
      enabled: true,
      setting: "custom",
      silentHours: 240,
    });

    const disabledStore = createPreferenceStore(null);
    await expect(readHostedSourceNoDataOutreachPolicy({
      memberId: "member-synthetic",
      prisma: disabledStore.tx,
      sourceProviderSlug: "garmin",
    })).resolves.toEqual({ enabled: false, setting: "off" });
  });

  it.each([
    { sourceProviderSlug: "garmin", defaultDays: 5 },
    { sourceProviderSlug: "apple_health_kit", defaultDays: 3 },
    { sourceProviderSlug: "whoop_v2", defaultDays: 5 },
  ])("saves, disables, and restores $sourceProviderSlug through one canonical row", async ({ sourceProviderSlug, defaultDays }) => {
    const store = createPreferenceStore();
    mocks.getPrisma.mockReturnValue(store.prisma);

    await expect(configureHostedSourceNoDataOutreach({
      memberId: "member-synthetic",
      request: {
        afterDays: 10,
        assistantInputId: ASSISTANT_INPUT_ID,
        mode: "after_days",
        sourceProviderSlug,
      },
    })).resolves.toMatchObject({
      effectiveAfterDays: 10,
      setting: "custom",
      status: "saved",
    });
    expect(store.read()).toEqual({ reminderAfterDays: 10 });

    await expect(configureHostedSourceNoDataOutreach({
      memberId: "member-synthetic",
      request: {
        assistantInputId: ASSISTANT_INPUT_ID,
        mode: "off",
        sourceProviderSlug,
      },
    })).resolves.toMatchObject({
      effectiveAfterDays: null,
      setting: "off",
      status: "saved",
    });
    expect(store.read()).toEqual({ reminderAfterDays: null });

    await expect(configureHostedSourceNoDataOutreach({
      memberId: "member-synthetic",
      request: {
        assistantInputId: ASSISTANT_INPUT_ID,
        mode: "default",
        sourceProviderSlug,
      },
    })).resolves.toMatchObject({
      effectiveAfterDays: defaultDays,
      setting: "default",
      status: "saved",
    });
    expect(store.read()).toBeNull();
  });

  it("rejects group or missing accepted-input authority before mutation", async () => {
    const store = createPreferenceStore(10);
    mocks.getPrisma.mockReturnValue(store.prisma);
    mocks.readInputWake.mockResolvedValue(directLinqWake(false));

    await expect(configureHostedSourceNoDataOutreach({
      memberId: "member-synthetic",
      request: {
        assistantInputId: ASSISTANT_INPUT_ID,
        mode: "off",
        sourceProviderSlug: "garmin",
      },
    })).rejects.toThrow("current private member input");
    expect(store.preference.upsert).not.toHaveBeenCalled();

    mocks.readInputWake.mockResolvedValue(telegramWake(false));
    await expect(configureHostedSourceNoDataOutreach({
      memberId: "member-synthetic",
      request: {
        assistantInputId: ASSISTANT_INPUT_ID,
        mode: "off",
        sourceProviderSlug: "garmin",
      },
    })).rejects.toThrow("current private member input");
    expect(store.preference.upsert).not.toHaveBeenCalled();

    mocks.readInputWake.mockResolvedValue(directLinqWake());
    mocks.readInputAuthority.mockResolvedValue(null);
    await expect(configureHostedSourceNoDataOutreach({
      memberId: "member-synthetic",
      request: {
        assistantInputId: ASSISTANT_INPUT_ID,
        mode: "off",
        sourceProviderSlug: "garmin",
      },
    })).rejects.toThrow("current private member input");
    expect(store.read()).toEqual({ reminderAfterDays: 10 });
  });

  it("requires authenticated direct email sender authority before mutation", async () => {
    const store = createPreferenceStore();
    mocks.getPrisma.mockReturnValue(store.prisma);
    mocks.readInputWake.mockResolvedValue(directEmailWake(false));

    const request = {
      assistantInputId: ASSISTANT_INPUT_ID,
      mode: "off" as const,
      sourceProviderSlug: "garmin",
    };
    await expect(configureHostedSourceNoDataOutreach({
      memberId: "member-synthetic",
      request,
    })).rejects.toThrow("current private member input");
    expect(store.preference.findUnique).not.toHaveBeenCalled();
    expect(store.preference.upsert).not.toHaveBeenCalled();

    mocks.readInputWake.mockResolvedValue(directEmailWake(true));
    await expect(configureHostedSourceNoDataOutreach({
      memberId: "member-synthetic",
      request,
    })).resolves.toMatchObject({
      effectiveAfterDays: null,
      setting: "off",
      status: "saved",
    });
    expect(store.preference.upsert).toHaveBeenCalledTimes(1);
  });
});
