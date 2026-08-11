import { beforeEach, describe, expect, it, vi } from "vitest";
import type KernelSdkClient from "@onkernel/sdk";

const kernelSdkMocks = vi.hoisted(() => {
  const computer = {
    clickMouse: vi.fn<KernelSdkClient["browsers"]["computer"]["clickMouse"]>(),
    dragMouse: vi.fn<KernelSdkClient["browsers"]["computer"]["dragMouse"]>(),
    moveMouse: vi.fn<KernelSdkClient["browsers"]["computer"]["moveMouse"]>(),
    pressKey: vi.fn<KernelSdkClient["browsers"]["computer"]["pressKey"]>(),
    scroll: vi.fn<KernelSdkClient["browsers"]["computer"]["scroll"]>(),
    typeText: vi.fn<KernelSdkClient["browsers"]["computer"]["typeText"]>(),
  };
  const connections = {
    create: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    login: vi.fn(),
    update: vi.fn(),
  };
  const kernelClient = {
    auth: {
      connections,
    },
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
    browserCreate: kernelClient.browsers.create,
    ConflictError: class ConflictError extends Error {},
    Kernel,
    NotFoundError: class NotFoundError extends Error {},
    computer,
    connections,
    playwrightExecute: kernelClient.browsers.playwright.execute,
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

  it("creates browsers without overriding the kernel viewport default", async () => {
    kernelSdkMocks.browserCreate.mockResolvedValueOnce({
      browser_live_view_url: "https://proxy.test-browser.onkernel.com:8443/live/1",
      session_id: "kernel-session-1",
    });
    const client = new KernelComputerClient({ apiKey: "test-kernel-key" });

    await expect(client.createBrowser({
      browserName: "browser-1",
      profileName: "profile-1",
      saveChanges: true,
      timeoutSeconds: 3600,
    })).resolves.toEqual({
      liveViewUrl: "https://proxy.test-browser.onkernel.com:8443/live/1",
      sessionId: "kernel-session-1",
    });

    expect(kernelSdkMocks.browserCreate).toHaveBeenCalledWith({
      headless: false,
      kiosk_mode: true,
      name: "browser-1",
      profile: {
        name: "profile-1",
        save_changes: true,
      },
      stealth: true,
      timeout_seconds: 3600,
    });
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

  it("returns redacted Playwright evaluation diagnostics for failed browser code", async () => {
    const client = new KernelComputerClient({ apiKey: "test-kernel-key" });
    kernelSdkMocks.playwrightExecute.mockResolvedValueOnce({
      error: [
        "Error: strict mode violation: getByRole('button', { name: 'Place order' }) resolved to 2 elements",
        "    at locator.click (/tmp/project/test.ts:10:5)",
        "See https://shop.example.test/account?debug=redaction-canary-value",
      ].join("\n"),
      stderr: "TimeoutError: page.waitForLoadState timed out\n    at /app/runner.js:20:1",
      stdout: "model-controlled console output should stay hidden",
      success: false,
    });

    let thrown: unknown;
    try {
      await client.executePlaywright({
        code: "await page.getByRole('button', { name: 'Place order' }).click();",
        sessionId: "kernel-session-1",
        timeoutMs: 15000,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "HOSTED_COMPUTER_EVAL_FAILED",
      details: {
        kernelError: expect.stringContaining("strict mode violation"),
        kernelErrorPresent: true,
        kernelStderr: expect.stringContaining("TimeoutError"),
        kernelStderrPresent: true,
        kernelStdoutPresent: true,
      },
      message: "Computer browser evaluation failed.",
      retryable: true,
    });
    const details = readErrorDetails(thrown);
    const serializedDetails = JSON.stringify(details);
    expect(serializedDetails).not.toContain("redaction-canary-value");
    expect(serializedDetails).not.toContain("/tmp/project");
    expect(serializedDetails).not.toContain("/app/");
    expect(serializedDetails).not.toContain("https://shop.example.test");
    expect(serializedDetails).not.toContain("model-controlled console output");
  });

  it("creates durable managed auth connections with explicit policy", async () => {
    const client = new KernelComputerClient({ apiKey: "test-kernel-key" });
    kernelSdkMocks.connections.list.mockResolvedValueOnce({ items: [] });
    kernelSdkMocks.connections.create.mockResolvedValueOnce({
      domain: "www.amazon.com",
      id: "managed-auth-1",
      profile_name: "murph-test-profile",
      record_session: false,
      save_credentials: true,
      status: "NEEDS_AUTH",
    });
    kernelSdkMocks.connections.update.mockResolvedValueOnce({
      auto_reauth: true,
      domain: "www.amazon.com",
      health_checks: true,
      id: "managed-auth-1",
      profile_name: "murph-test-profile",
      record_session: false,
      save_credentials: true,
      status: "NEEDS_AUTH",
    });

    await expect(client.ensureManagedAuthConnection({
      domain: "www.amazon.com",
      profileName: "murph-test-profile",
    })).resolves.toMatchObject({
      domain: "www.amazon.com",
      id: "managed-auth-1",
      profileName: "murph-test-profile",
      status: "NEEDS_AUTH",
    });

    expect(kernelSdkMocks.connections.create).toHaveBeenCalledWith({
      auto_reauth: true,
      domain: "www.amazon.com",
      health_checks: true,
      profile_name: "murph-test-profile",
      record_session: false,
      save_credentials: true,
    });
    expect(kernelSdkMocks.connections.update).toHaveBeenCalledWith(
      "managed-auth-1",
      {
        auto_reauth: true,
        health_checks: true,
        record_session: false,
        save_credentials: true,
      },
    );
  });

  it("starts managed auth without exposing Kernel handoff capabilities", async () => {
    const client = new KernelComputerClient({ apiKey: "test-kernel-key" });
    kernelSdkMocks.connections.login.mockResolvedValueOnce({
      flow_expires_at: "2026-06-17T12:20:00.000Z",
      handoff_code: "must-not-escape",
      hosted_url: "https://auth.onkernel.com/login/test",
      live_view_url: "https://private.onkernel.com/live",
    });

    await expect(client.startManagedAuthLogin("managed-auth-1")).resolves.toEqual({
      flowExpiresAt: new Date("2026-06-17T12:20:00.000Z"),
      hostedUrl: "https://auth.onkernel.com/login/test",
    });
    expect(kernelSdkMocks.connections.login).toHaveBeenCalledWith(
      "managed-auth-1",
      { record_session: false },
    );
  });

  it("rejects managed auth Hosted UI URLs outside Kernel", async () => {
    const client = new KernelComputerClient({ apiKey: "test-kernel-key" });
    kernelSdkMocks.connections.login.mockResolvedValueOnce({
      flow_expires_at: "2026-06-17T12:20:00.000Z",
      hosted_url: "https://attacker.example/login",
    });

    await expect(client.startManagedAuthLogin("managed-auth-1")).rejects.toMatchObject({
      code: "HOSTED_COMPUTER_MANAGED_AUTH_INVALID",
      retryable: true,
    });
  });

  it("bounds long Playwright evaluation diagnostics", async () => {
    const client = new KernelComputerClient({ apiKey: "test-kernel-key" });
    kernelSdkMocks.playwrightExecute.mockResolvedValueOnce({
      error: `Error: strict mode violation\n${"x".repeat(5000)}`,
      success: false,
    });

    let thrown: unknown;
    try {
      await client.executePlaywright({
        code: "await page.getByRole('button').click();",
        sessionId: "kernel-session-1",
        timeoutMs: 15000,
      });
    } catch (error) {
      thrown = error;
    }

    const details = readErrorDetails(thrown);
    expect(details.kernelError).toEqual(expect.any(String));
    const kernelError = details.kernelError as string;
    expect(kernelError.length).toBeLessThanOrEqual(4000);
    expect(kernelError).toContain("strict mode violation");
    expect(kernelError).toMatch(/\.\.\.$/u);
  });
});

function readErrorDetails(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object" || !("details" in error)) {
    throw new Error("Expected error details.");
  }
  const details = error.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    throw new Error("Expected object error details.");
  }
  return Object.fromEntries(Object.entries(details));
}
