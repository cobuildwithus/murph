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

test("runtime rechecks serialize six queued IDs behind one tracked recovery batch", async () => {
  const firstBatchUserIds = [
    "hbm_test_alpha",
    "hbm_test_bravo",
    "hbm_test_charlie",
  ];
  const queuedUserIds = [
    "hbm_test_delta",
    "hbm_test_echo",
    "hbm_test_foxtrot",
  ];
  const firstBatchWitnesses = firstBatchUserIds.map(recoveryWitness);
  const secondTrackedWitness = recoveryWitness("hbm_test_delta");
  let recheckRequestCount = 0;
  let verificationRequestCount = 0;
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = readRequestBody(init);

    if (body.operation === "recheck-runtimes") {
      recheckRequestCount += 1;
      if (recheckRequestCount === 1) {
        return jsonResponse({
          generatedAt: "2026-08-31T15:01:00.000Z",
          requestedCount: 3,
          results: firstBatchUserIds.map((userId, index) => ({
            status: "signaled",
            userId,
            witness: firstBatchWitnesses[index],
          })),
        });
      }
      if (recheckRequestCount === 2) {
        return jsonResponse({
          generatedAt: "2026-08-31T15:07:00.000Z",
          requestedCount: 3,
          results: queuedUserIds.map((userId) => ({
            errorMessage: "The runtime did not acknowledge the signal.",
            errorName: "TimeoutError",
            status: "failed",
            userId,
          })),
        });
      }
      return jsonResponse({
        generatedAt: "2026-08-31T15:08:00.000Z",
        requestedCount: 3,
        results: [{
          status: "signaled",
          userId: "hbm_test_delta",
          witness: secondTrackedWitness,
        }, ...queuedUserIds.slice(1).map((userId) => ({
          errorMessage: "The runtime did not acknowledge the signal.",
          errorName: "TimeoutError",
          status: "failed" as const,
          userId,
        }))],
      });
    }

    if (body.operation === "verify-runtime-rechecks") {
      verificationRequestCount += 1;
      if (verificationRequestCount > 1) {
        throw new Error("Verification temporarily unavailable.");
      }
      return jsonResponse({
        generatedAt: "2026-08-31T15:06:00.000Z",
        results: firstBatchUserIds.map((userId) => ({
          explanation: "Canonical consumption reached the fixed captured prefix with a newer checkpoint.",
          status: "recovered",
          userId,
        })),
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
          userId: "hbm_test_echo",
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
    await setTextareaValue(rendered, [...firstBatchUserIds, ...queuedUserIds].join("\n"));
    await clickButton(rendered, "Recheck next 3");

    expect(rendered.container.textContent).toContain("hbm_test_alpha");
    expect(rendered.container.textContent).toContain("Verify progress");
    expect(rendered.container.textContent).toContain("Stop tracking this batch and continue");
    assert.equal(runtimeRecheckTextarea(rendered).value, queuedUserIds.join("\n"));
    expect(operationCalls(fetchMock, "verify-runtime-rechecks")).toHaveLength(0);

    const blockedRecheckButton = findButton(rendered, "Recheck next 3");
    assert.equal(blockedRecheckButton.disabled, true);
    await clickButton(rendered, "Recheck next 3");
    expect(operationCalls(fetchMock, "recheck-runtimes")).toHaveLength(1);
    expect(rendered.container.textContent).toContain("hbm_test_alpha");
    expect(rendered.container.textContent).not.toContain("3 failed");

    await clickButton(rendered, "Verify progress");

    const verificationCalls = operationCalls(fetchMock, "verify-runtime-rechecks");
    expect(verificationCalls).toHaveLength(1);
    expect(readRequestBody(verificationCalls[0]?.[1])).toEqual({
      baselines: firstBatchWitnesses,
      operation: "verify-runtime-rechecks",
    });
    expect(rendered.container.textContent).toContain("Recovered");
    expect(rendered.container.textContent).not.toContain("Stop tracking this batch and continue");
    assert.equal(findButton(rendered, "Recheck next 3").disabled, false);

    await clickButton(rendered, "Recheck next 3");

    expect(operationCalls(fetchMock, "recheck-runtimes")).toHaveLength(2);
    expect(rendered.container.textContent).toContain("3 failed");
    expect(rendered.container.textContent).not.toContain("hbm_test_alpha");
    expect(rendered.container.textContent).not.toContain("Stop tracking this batch and continue");
    assert.equal(runtimeRecheckTextarea(rendered).value, queuedUserIds.join("\n"));
    assert.equal(findButton(rendered, "Recheck next 3").disabled, false);

    await clickButton(rendered, "Recheck next 3");

    expect(operationCalls(fetchMock, "recheck-runtimes")).toHaveLength(3);
    expect(rendered.container.textContent).toContain("hbm_test_delta");
    expect(rendered.container.textContent).toContain("Stop tracking this batch and continue");
    assert.equal(runtimeRecheckTextarea(rendered).value, queuedUserIds.slice(1).join("\n"));

    await clickButton(rendered, "Verify progress");

    expect(rendered.container.textContent).toContain("Verification temporarily unavailable.");
    expect(rendered.container.textContent).toContain("Stop tracking this batch and continue");
    assert.equal(findButton(rendered, "Recheck next 2").disabled, true);

    await clickButton(rendered, "Stop tracking this batch and continue");

    expect(rendered.container.textContent).not.toContain("Recheck result");
    expect(rendered.container.textContent).not.toContain("Stop tracking this batch and continue");
    assert.equal(runtimeRecheckTextarea(rendered).value, queuedUserIds.slice(1).join("\n"));
    assert.equal(findButton(rendered, "Recheck next 2").disabled, false);
  } finally {
    await rendered.cleanup();
  }
});

async function clickButton(
  rendered: Awaited<ReturnType<typeof renderClientComponent>>,
  label: string,
): Promise<void> {
  const button = findButton(rendered, label);

  await act(async () => {
    button.click();
    await settleAsyncWork();
  });
}

function findButton(
  rendered: Awaited<ReturnType<typeof renderClientComponent>>,
  label: string,
): HTMLButtonElement {
  const button = Array.from(rendered.container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  assert.ok(
    button instanceof rendered.window.HTMLButtonElement,
    `Missing button: ${label}`,
  );
  return button;
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
    capturedHeadSequence: "6",
    userId,
    workspaceVersion: "24",
  };
}
