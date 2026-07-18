import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  initializeVault: vi.fn(),
  listGoals: vi.fn(),
  listHistoryEvents: vi.fn(),
  readMemoryDocument: vi.fn(),
  readAssistantOnboardingState: vi.fn(),
  redactAssistantStateString: vi.fn(),
  sendAssistantMessage: vi.fn(),
  stopWarmCodexAppServer: vi.fn(),
  waitForWarmCodexBackgroundWork: vi.fn(),
  walkVaultFiles: vi.fn(),
}));

vi.mock("@murphai/core", () => ({
  initializeVault: runtime.initializeVault,
  listGoals: runtime.listGoals,
  listHistoryEvents: runtime.listHistoryEvents,
  readMemoryDocument: runtime.readMemoryDocument,
  VAULT_LAYOUT: {
    allergiesDirectory: "allergies",
    automationsDirectory: "automations",
    conditionsDirectory: "conditions",
    experimentsDirectory: "experiments",
    goalsDirectory: "goals",
    protocolsDirectory: "protocols",
    regimensDirectory: "regimens",
  },
  walkVaultFiles: runtime.walkVaultFiles,
}));

vi.mock("@murphai/assistant-engine/assistant-state", () => ({
  readAssistantOnboardingState: runtime.readAssistantOnboardingState,
}));

vi.mock("@murphai/assistant-engine/assistant-runtime", () => ({
  redactAssistantStateString: runtime.redactAssistantStateString,
}));

vi.mock("@murphai/assistant-engine/assistant-service", () => ({
  sendAssistantMessage: runtime.sendAssistantMessage,
}));

vi.mock("@murphai/assistant-engine/assistant-codex", () => ({
  stopWarmCodexAppServer: runtime.stopWarmCodexAppServer,
  waitForWarmCodexBackgroundWork: runtime.waitForWarmCodexBackgroundWork,
}));

import {
  currentMurphOnboardingTarget,
  onboardingScenarios,
} from "../src/onboarding.js";

const anchorScenario = (() => {
  const scenario = onboardingScenarios.find(
    (candidate) => candidate.id === "onboarding.anchor-not-authorization",
  );
  if (scenario === undefined) {
    throw new Error("Anchor onboarding scenario is missing.");
  }
  return scenario;
})();

let activeVault: string | null;
let stopObservedExistingRoot: boolean;

beforeEach(() => {
  vi.resetAllMocks();
  activeVault = null;
  stopObservedExistingRoot = false;

  runtime.initializeVault.mockImplementation(
    async ({ vaultRoot }: { readonly vaultRoot: string }) => {
      activeVault = vaultRoot;
      await mkdir(vaultRoot, { recursive: true });
    },
  );
  runtime.readAssistantOnboardingState.mockResolvedValue({
    completedAt: null,
    completedReason: null,
    createdAt: null,
    schemaVersion: "murph.assistant-onboarding.v1",
    status: "open",
    updatedAt: null,
  });
  runtime.readMemoryDocument.mockResolvedValue({ exists: false, records: [] });
  runtime.walkVaultFiles.mockResolvedValue([]);
  runtime.listGoals.mockResolvedValue([]);
  runtime.listHistoryEvents.mockResolvedValue([]);
  runtime.redactAssistantStateString.mockImplementation(
    (value: string) => value,
  );
  runtime.sendAssistantMessage.mockResolvedValue({
    response: "Synthetic response",
    session: { sessionId: "synthetic-session" },
  });
  runtime.stopWarmCodexAppServer.mockImplementation(async () => {
    await access(path.dirname(requireActiveVault()));
    stopObservedExistingRoot = true;
  });
  runtime.waitForWarmCodexBackgroundWork.mockResolvedValue(undefined);
});

describe("current onboarding eval target lifecycle", () => {
  it("waits for background work before final and canonical evidence", async () => {
    const waitStarted = deferred();
    const releaseWait = deferred();
    runtime.waitForWarmCodexBackgroundWork.mockImplementationOnce(async () => {
      waitStarted.resolve();
      await releaseWait.promise;
    });
    runtime.walkVaultFiles.mockImplementation(
      async (vault: string, directory: string) =>
        directory === "goals" &&
        (await exists(path.join(vault, ".background-goal")))
          ? ["goals/synthetic.md"]
          : [],
    );
    runtime.listGoals.mockImplementation(async (vault: string) =>
      (await exists(path.join(vault, ".background-goal")))
        ? [{ entity: { title: "Build strength for hiking" } }]
        : [],
    );

    const abortController = new AbortController();
    const execution = executeAnchor(abortController.signal);
    await waitStarted.promise;

    const vault = requireActiveVault();
    const caseRoot = path.dirname(vault);
    expect(runtime.readAssistantOnboardingState).toHaveBeenCalledTimes(
      anchorScenario.input.turns.length,
    );
    expect(runtime.listGoals).not.toHaveBeenCalled();
    expect(runtime.stopWarmCodexAppServer).not.toHaveBeenCalled();
    await access(caseRoot);

    await writeFile(path.join(vault, ".background-goal"), "settled", {
      mode: 0o600,
    });
    expect(runtime.listGoals).not.toHaveBeenCalled();

    releaseWait.resolve();
    const result = await execution;

    expect(
      result.observation.transcript.map(
        (turn) => turn.stateAfter.effects.goals,
      ),
    ).toEqual([0, 0, 0]);
    expect(result.observation.finalState.effects.goals).toBe(1);
    expect(result.observation.deterministicChecks).toContainEqual(
      expect.objectContaining({ id: "required-goal-context", passed: true }),
    );
    expect(
      runtime.waitForWarmCodexBackgroundWork,
    ).toHaveBeenCalledExactlyOnceWith({ signal: abortController.signal });
    expect(runtime.readAssistantOnboardingState).toHaveBeenCalledTimes(
      anchorScenario.input.turns.length + 1,
    );
    expect(runtime.listGoals).toHaveBeenCalledTimes(1);
    expect(runtime.stopWarmCodexAppServer).toHaveBeenCalledExactlyOnceWith(
      "assistant-eval-case-completed",
    );
    expect(stopObservedExistingRoot).toBe(true);
    await expect(access(caseRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("still stops the runtime and removes the case root when waiting fails", async () => {
    const backgroundError = new Error("synthetic background failure");
    runtime.waitForWarmCodexBackgroundWork.mockRejectedValueOnce(
      backgroundError,
    );

    await expect(
      executeAnchor(new AbortController().signal),
    ).rejects.toBe(backgroundError);

    const caseRoot = path.dirname(requireActiveVault());
    expect(runtime.readAssistantOnboardingState).toHaveBeenCalledTimes(
      anchorScenario.input.turns.length,
    );
    expect(runtime.listGoals).not.toHaveBeenCalled();
    expect(runtime.stopWarmCodexAppServer).toHaveBeenCalledExactlyOnceWith(
      "assistant-eval-case-completed",
    );
    expect(stopObservedExistingRoot).toBe(true);
    await expect(access(caseRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

function executeAnchor(signal: AbortSignal) {
  return currentMurphOnboardingTarget.execute({
    caseId: "synthetic-case",
    runId: "synthetic-run",
    scenario: anchorScenario,
    signal,
    trial: 1,
  });
}

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function requireActiveVault(): string {
  if (activeVault === null) {
    throw new Error("The synthetic vault was not initialized.");
  }
  return activeVault;
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}
