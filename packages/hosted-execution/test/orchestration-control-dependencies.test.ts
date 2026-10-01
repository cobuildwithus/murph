import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  HOSTED_RUNTIME_PROCESSING_MODES,
  isHostedMailboxLane,
} from "../src/orchestration-control.ts";
import {
  HOSTED_MAILBOX_LANES,
  HOSTED_WORKSPACE_INVOCATION_PROCESSING_MODES,
  isHostedMailboxLane as runtimeIsMailboxLane,
} from "../src/runtime-control.ts";

describe("orchestration runtime dependency boundary", () => {
  it("preserves the execution exports and lane validation behavior", () => {
    expect(HOSTED_RUNTIME_PROCESSING_MODES).toBe(HOSTED_WORKSPACE_INVOCATION_PROCESSING_MODES);
    expect(isHostedMailboxLane).toBe(runtimeIsMailboxLane);
    expect(HOSTED_MAILBOX_LANES).toEqual(["system", "conversation"]);
    expect(HOSTED_RUNTIME_PROCESSING_MODES).toEqual(["default", "inbox_media_retention", "system_mailbox"]);
    for (const lane of HOSTED_MAILBOX_LANES) expect(isHostedMailboxLane(lane)).toBe(true);
    for (const lane of ["", "SYSTEM", "unknown", "conversation "]) expect(isHostedMailboxLane(lane)).toBe(false);
  });

  it("loads the orchestration entrypoint without runtime execution or external schemas", () => {
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", String.raw`
      import { registerHooks } from "node:module";
      const forbidden = /(?:\/node_modules\/|\/(?:runtime-control|vault-share|contracts)\.ts$)/;
      registerHooks({
        load(url, context, nextLoad) {
          if (forbidden.test(url)) throw new Error("Orchestration loaded an execution/schema dependency");
          return nextLoad(url, context);
        },
      });
      const control = await import("./orchestration-control.ts");
      if (!control.isHostedMailboxLane("conversation")) throw new Error("Mailbox contract unavailable");
      if (control.classifyHostedSystemMailboxExecutionClass({ kind: "device-sync.wake", dedupeKey: null }) !== "model_free") {
        throw new Error("Orchestration classification changed");
      }
    `], {
      cwd: fileURLToPath(new URL("../src", import.meta.url)),
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  });
});
