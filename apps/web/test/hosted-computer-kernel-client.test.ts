import { beforeEach, describe, expect, it, vi } from "vitest";

const kernelSdkMocks = vi.hoisted(() => {
  const computer = {
    clickMouse: vi.fn(),
    dragMouse: vi.fn(),
    moveMouse: vi.fn(),
    pressKey: vi.fn(),
    scroll: vi.fn(),
    typeText: vi.fn(),
  };
  const kernelClient = {
    browsers: {
      computer,
      create: vi.fn(),
      deleteByID: vi.fn(),
      playwright: {
        execute: vi.fn(),
      },
    },
    profiles: {
      create: vi.fn(),
      delete: vi.fn(),
    },
  };

  const Kernel = vi.fn(function Kernel(_options?: unknown) {
    void _options;
    return kernelClient;
  });

  return {
    ConflictError: class ConflictError extends Error {},
    Kernel,
    NotFoundError: class NotFoundError extends Error {},
    computer,
  };
});

vi.mock("@onkernel/sdk", () => ({
  ConflictError: kernelSdkMocks.ConflictError,
  default: kernelSdkMocks.Kernel,
  NotFoundError: kernelSdkMocks.NotFoundError,
}));

import { KernelComputerClient } from "../src/lib/computer-use/kernel-client";

describe("KernelComputerClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps OS-control actions to the corresponding Kernel computer methods", async () => {
    const client = new KernelComputerClient({ apiKey: "test-kernel-key" });
    const sessionId = "kernel-session-1";

    await client.osControl({
      action: {
        action: "clickMouse",
        button: "right",
        clickType: "down",
        holdKeys: ["Shift"],
        numClicks: 2,
        x: 10,
        y: 20,
      },
      sessionId,
    });
    await client.osControl({
      action: {
        action: "moveMouse",
        durationMs: 250,
        holdKeys: ["Ctrl"],
        smooth: false,
        x: 30,
        y: 40,
      },
      sessionId,
    });
    await client.osControl({
      action: {
        action: "typeText",
        text: "safe fixture text",
      },
      sessionId,
    });
    await client.osControl({
      action: {
        action: "pressKey",
        durationMs: 100,
        keys: ["Tab", "Return"],
      },
      sessionId,
    });
    await client.osControl({
      action: {
        action: "scroll",
        deltaX: -5,
        deltaY: 600,
        holdKeys: ["Super"],
        x: 50,
        y: 60,
      },
      sessionId,
    });
    await client.osControl({
      action: {
        action: "dragMouse",
        button: "left",
        delayMs: 25,
        durationMs: 500,
        holdKeys: ["Shift"],
        path: [[1, 2], [3, 4]],
        smooth: false,
        stepDelayMs: 10,
        stepsPerSegment: 5,
      },
      sessionId,
    });

    expect(kernelSdkMocks.computer.clickMouse).toHaveBeenCalledWith(sessionId, {
      button: "right",
      click_type: "down",
      hold_keys: ["Shift"],
      num_clicks: 2,
      x: 10,
      y: 20,
    });
    expect(kernelSdkMocks.computer.moveMouse).toHaveBeenCalledWith(sessionId, {
      duration_ms: 250,
      hold_keys: ["Ctrl"],
      smooth: false,
      x: 30,
      y: 40,
    });
    expect(kernelSdkMocks.computer.typeText).toHaveBeenCalledWith(sessionId, {
      text: "safe fixture text",
    });
    expect(kernelSdkMocks.computer.pressKey).toHaveBeenCalledWith(sessionId, {
      duration: 100,
      keys: ["Tab", "Return"],
    });
    expect(kernelSdkMocks.computer.scroll).toHaveBeenCalledWith(sessionId, {
      delta_x: -5,
      delta_y: 600,
      hold_keys: ["Super"],
      x: 50,
      y: 60,
    });
    expect(kernelSdkMocks.computer.dragMouse).toHaveBeenCalledWith(sessionId, {
      button: "left",
      delay: 25,
      duration_ms: 500,
      hold_keys: ["Shift"],
      path: [[1, 2], [3, 4]],
      smooth: false,
      step_delay_ms: 10,
      steps_per_segment: 5,
    });
  });

  it("sanitizes OS-control SDK failures without retaining typed text", async () => {
    const client = new KernelComputerClient({ apiKey: "test-kernel-key" });
    kernelSdkMocks.computer.typeText.mockRejectedValueOnce(
      new Error("typed canary-sensitive-input into the browser"),
    );

    await expect(client.osControl({
      action: {
        action: "typeText",
        text: "canary-sensitive-input",
      },
      sessionId: "kernel-session-1",
    })).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_OS_CONTROL_FAILED",
      details: {
        computerOsControl: "typeText",
      },
      message: "Computer OS control failed.",
    });
  });
});
