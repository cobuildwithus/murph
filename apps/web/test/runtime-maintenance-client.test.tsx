import assert from "node:assert/strict";

import { act, createElement, type ComponentProps } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { RuntimeMaintenanceClient } from "../app/(dashboard)/ops/runtime-maintenance/runtime-maintenance-client";
import { renderClientComponent } from "./render-client-component";

vi.mock("@/src/components/ui/textarea", () => ({
  Textarea: ({ onChange, ...props }: ComponentProps<"textarea">) =>
    createElement("textarea", { ...props, onInput: onChange }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

test("runtime recheck evidence survives queue edits and a later ambiguous request", async () => {
  const witness = recoveryWitness("hbm_test_alpha");
  let recheckRequestCount = 0;
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = readRequestBody(init);

    if (body.operation === "recheck-runtimes") {
      recheckRequestCount += 1;
      if (recheckRequestCount === 2) {
        throw new Error("Request deadline reached.");
      }
      return jsonResponse({
        generatedAt: "2026-08-31T15:01:00.000Z",
        requestedCount: 1,
        results: [{
          status: "signaled",
          userId: "hbm_test_alpha",
          witness,
        }],
      });
    }

    if (body.operation === "verify-runtime-rechecks") {
      return jsonResponse({
        generatedAt: "2026-08-31T15:06:00.000Z",
        results: [{
          explanation: "The submitted witness could not be matched.",
          status: "unknown",
          userId: null,
        }],
      });
    }

    throw new Error(`Unexpected runtime maintenance request: ${String(body.operation)}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createElement(RuntimeMaintenanceClient, {
      initialOverview: {
        candidates: [],
        generatedAt: "2026-08-31T15:00:00.000Z",
        limit: 20,
        nextCursor: null,
        totalCandidateCount: 0,
      },
      initialStalledRecheckOverview: {
        candidates: [{
          pendingItemCount: "8",
          stalledSince: "2026-08-31T14:20:00.000Z",
          userId: "hbm_test_bravo",
        }],
        generatedAt: "2026-08-31T15:00:00.000Z",
        limit: 100,
        scanTruncated: false,
        totalCandidateCount: 1,
      },
    }),
    { requireButton: false },
  );

  try {
    await setTextareaValue(rendered, "hbm_test_alpha");
    await clickButton(rendered, "Recheck next 1");

    expect(rendered.container.textContent).toContain("hbm_test_alpha");
    expect(rendered.container.textContent).toContain("Verify progress");
    assert.equal(runtimeRecheckTextarea(rendered).value, "");
    expect(operationCalls(fetchMock, "verify-runtime-rechecks")).toHaveLength(0);

    await clickButton(rendered, "Use detected candidates");

    assert.equal(runtimeRecheckTextarea(rendered).value, "hbm_test_bravo");
    expect(rendered.container.textContent).toContain("hbm_test_alpha");
    expect(rendered.container.textContent).toContain("Verify progress");
    expect(operationCalls(fetchMock, "verify-runtime-rechecks")).toHaveLength(0);

    await clickButton(rendered, "Recheck next 1");

    assert.equal(runtimeRecheckTextarea(rendered).value, "hbm_test_bravo");
    expect(rendered.container.textContent).toContain("Request deadline reached.");
    expect(rendered.container.textContent).toContain("hbm_test_alpha");
    expect(rendered.container.textContent).toContain("Verify progress");
    expect(operationCalls(fetchMock, "verify-runtime-rechecks")).toHaveLength(0);

    await clickButton(rendered, "Verify progress");

    const verificationCalls = operationCalls(fetchMock, "verify-runtime-rechecks");
    expect(verificationCalls).toHaveLength(1);
    expect(readRequestBody(verificationCalls[0]?.[1])).toEqual({
      baselines: [witness],
      operation: "verify-runtime-rechecks",
    });
    expect(rendered.container.textContent).toContain("Unknown");
    expect(rendered.container.textContent).toContain(
      "Verification returned no matching result for this captured witness.",
    );
    assert.equal(runtimeRecheckTextarea(rendered).value, "hbm_test_bravo");
  } finally {
    await rendered.cleanup();
  }
});

async function clickButton(
  rendered: Awaited<ReturnType<typeof renderClientComponent>>,
  label: string,
): Promise<void> {
  const button = Array.from(rendered.container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  assert.ok(
    button instanceof rendered.window.HTMLButtonElement,
    `Missing button: ${label}`,
  );

  await act(async () => {
    button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    await settleAsyncWork();
  });
}

async function setTextareaValue(
  rendered: Awaited<ReturnType<typeof renderClientComponent>>,
  value: string,
): Promise<void> {
  const textarea = runtimeRecheckTextarea(rendered);
  const descriptor = Object.getOwnPropertyDescriptor(
    rendered.window.HTMLTextAreaElement.prototype,
    "value",
  );

  await act(async () => {
    if (descriptor?.set) {
      descriptor.set.call(textarea, value);
    } else {
      textarea.value = value;
    }
    textarea.dispatchEvent(new rendered.window.Event("input", { bubbles: true }));
    textarea.dispatchEvent(new rendered.window.Event("change", { bubbles: true }));
    await settleAsyncWork();
  });
}

function runtimeRecheckTextarea(
  rendered: Awaited<ReturnType<typeof renderClientComponent>>,
): HTMLTextAreaElement {
  const textarea = rendered.container.querySelector("#runtime-recheck-user-ids");
  assert.ok(textarea instanceof rendered.window.HTMLTextAreaElement);
  return textarea;
}

function operationCalls(
  fetchMock: ReturnType<typeof vi.fn>,
  operation: string,
): Array<[RequestInfo | URL, RequestInit | undefined]> {
  return fetchMock.mock.calls.filter((call) => (
    readRequestBody(call[1] as RequestInit | undefined).operation === operation
  )) as Array<[RequestInfo | URL, RequestInit | undefined]>;
}

function readRequestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== "string") {
    return {};
  }
  return JSON.parse(init.body) as Record<string, unknown>;
}

function jsonResponse(payload: unknown): {
  json: () => Promise<unknown>;
  ok: true;
} {
  return {
    json: async () => payload,
    ok: true,
  };
}

async function settleAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function recoveryWitness(userId: string) {
  return {
    allocatedSystemHighWater: "18",
    canonicalSystemConsumed: "5",
    checkpointedAt: "2026-08-31T14:00:00.000Z",
    importedSystemSequence: "13",
    integrity: "synthetic_test_witness_not_a_live_request_123",
    observedAt: "2026-08-31T15:01:00.000Z",
    pendingHead: {
      createdAt: "2026-08-31T14:15:00.000Z",
      expiresAt: null,
      kind: "device-sync.wake",
      sequence: "6",
    },
    userId,
    workspaceVersion: "24",
  };
}
