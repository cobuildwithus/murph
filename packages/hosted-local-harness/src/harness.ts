import process from "node:process";

import type { HostedLocalDevStack } from "./dev-hosted-local/stack.ts";
import {
  applyHostedLocalProfile,
  type HostedLocalProfile,
} from "./profiles.ts";
import {
  applyHostedLocalStateEnv,
  createHostedLocalHarnessState,
  type HostedLocalHarnessState,
  type HostedLocalHarnessStateStatus,
  updateHostedLocalHarnessState,
} from "./state.ts";

export interface StartHostedLocalHarnessInput {
  command?: readonly string[];
  env?: NodeJS.ProcessEnv;
  pipeOutput?: boolean;
  profileName?: string | null;
  runIdSuffix?: string | null;
  startStatus?: HostedLocalHarnessStateStatus;
  stderrTarget?: NodeJS.WritableStream;
  stdoutTarget?: NodeJS.WritableStream;
}

export interface HostedLocalHarness {
  readonly env: NodeJS.ProcessEnv;
  readonly profile: HostedLocalProfile;
  readonly ready: Promise<HostedLocalHarnessState>;
  readonly stack: HostedLocalDevStack;
  readonly state: HostedLocalHarnessState;
  readonly statePath: string;
  stop(signal?: NodeJS.Signals): Promise<void>;
  updateState(
    patch: Partial<
      Pick<
        HostedLocalHarnessState,
        "status" | "webBaseUrl" | "workerBaseUrl"
      >
    >,
  ): Promise<HostedLocalHarnessState>;
}

/**
 * Canonical programmatic API for the hosted-local stack.
 *
 * The CLI, compatibility wrappers, and future E2E helpers should all converge on
 * this function so that every local reproduction has a profile and a redacted
 * state file under `.artifacts/hosted-local`.
 */
export async function startHostedLocalHarness(
  input: StartHostedLocalHarnessInput = {},
): Promise<HostedLocalHarness> {
  const { startHostedLocalDevStack } = await import(
    "./dev-hosted-local/stack.ts"
  );
  const profiled = applyHostedLocalProfile({
    env: input.env ?? process.env,
    profileName: input.profileName,
  });

  let state = await createHostedLocalHarnessState({
    command: input.command ?? ["hosted-local", "up"],
    env: profiled.env,
    profile: profiled.profile,
    runIdSuffix: input.runIdSuffix,
    status: input.startStatus ?? "starting",
  });

  const runtimeEnv = applyHostedLocalStateEnv({
    env: profiled.env,
    state,
  });

  let stack: HostedLocalDevStack;
  try {
    stack = await startHostedLocalDevStack({
      env: runtimeEnv,
      pipeOutput: input.pipeOutput,
      stderrTarget: input.stderrTarget,
      stdoutTarget: input.stdoutTarget,
    });
  } catch (error) {
    await updateHostedLocalHarnessState(state, { status: "failed" });
    throw error;
  }

  const updateState = async (
    patch: Partial<
      Pick<
        HostedLocalHarnessState,
        "status" | "webBaseUrl" | "workerBaseUrl"
      >
    >,
  ): Promise<HostedLocalHarnessState> => {
    state = await updateHostedLocalHarnessState(state, patch);
    return state;
  };

  const ready = stack.ready
    .then(async () => {
      return await updateState({
        status: "ready",
        webBaseUrl: stack.webBaseUrl,
        workerBaseUrl: stack.workerBaseUrl,
      });
    })
    .catch(async (error: unknown) => {
      await updateState({ status: "failed" }).catch(() => {});
      throw error;
    });

  return {
    env: runtimeEnv,
    get state() {
      return state;
    },
    get statePath() {
      return state.statePath;
    },
    profile: profiled.profile,
    ready,
    stack,
    stop: async (signal: NodeJS.Signals = "SIGTERM"): Promise<void> => {
      try {
        await stack.stop(signal);
      } finally {
        await updateState({ status: "stopped" }).catch(() => {});
      }
    },
    updateState,
  };
}
