import Kernel, { ConflictError, NotFoundError } from "@onkernel/sdk";
import type {
  HostedComputerOsControlRequest,
} from "@murphai/hosted-execution/computer-use";

import { computerUseError } from "./errors";

const KERNEL_REQUEST_TIMEOUT_MS = 30_000;

export interface KernelBrowserHandle {
  liveViewUrl: string;
  sessionId: string;
}

export interface KernelPlaywrightResult {
  result: unknown;
}

export interface ComputerKernelClient {
  createBrowser(input: {
    browserName: string;
    profileName: string;
    saveChanges: boolean;
    timeoutSeconds: number;
  }): Promise<KernelBrowserHandle>;
  deleteBrowserByIdOrName(idOrName: string): Promise<void>;
  deleteProfile(name: string): Promise<void>;
  ensureProfile(name: string): Promise<void>;
  executePlaywright(input: {
    code: string;
    sessionId: string;
    timeoutMs: number;
  }): Promise<KernelPlaywrightResult>;
  osControl(input: {
    action: HostedComputerOsControlRequest;
    sessionId: string;
  }): Promise<void>;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

export class KernelComputerClient implements ComputerKernelClient {
  private readonly kernel: Kernel;

  constructor(input: {
    apiKey?: string | null;
    env?: EnvSource;
  } = {}) {
    this.kernel = new Kernel({
      apiKey: input.apiKey ?? requireKernelApiKey(input.env ?? process.env),
      timeout: KERNEL_REQUEST_TIMEOUT_MS,
    });
  }

  async ensureProfile(name: string): Promise<void> {
    try {
      await this.kernel.profiles.create({ name });
    } catch (error) {
      if (error instanceof ConflictError) {
        return;
      }
      throw error;
    }
  }

  async createBrowser(input: {
    browserName: string;
    profileName: string;
    saveChanges: boolean;
    timeoutSeconds: number;
  }): Promise<KernelBrowserHandle> {
    const browser = await this.kernel.browsers.create({
      headless: false,
      name: input.browserName,
      profile: {
        name: input.profileName,
        save_changes: input.saveChanges,
      },
      stealth: true,
      timeout_seconds: input.timeoutSeconds,
    });
    const liveViewUrl = browser.browser_live_view_url;

    if (!liveViewUrl) {
      throw computerUseError({
        code: "HOSTED_COMPUTER_LIVE_VIEW_UNAVAILABLE",
        httpStatus: 502,
        message: "Kernel browser did not return a live-view URL.",
        retryable: true,
      });
    }

    return {
      liveViewUrl,
      sessionId: browser.session_id,
    };
  }

  async executePlaywright(input: {
    code: string;
    sessionId: string;
    timeoutMs: number;
  }): Promise<KernelPlaywrightResult> {
    const response = await this.kernel.browsers.playwright.execute(input.sessionId, {
      code: input.code,
      timeout_sec: Math.ceil(input.timeoutMs / 1000),
    });

    if (!response.success) {
      const details = buildKernelPlaywrightFailureDetails(response);
      throw computerUseError({
        code: "HOSTED_COMPUTER_EVAL_FAILED",
        details,
        httpStatus: 502,
        message: buildKernelPlaywrightFailureMessage(details),
        retryable: true,
      });
    }

    return {
      result: response.result,
    };
  }

  async osControl(input: {
    action: HostedComputerOsControlRequest;
    sessionId: string;
  }): Promise<void> {
    const { action, sessionId } = input;
    try {
      switch (action.action) {
        case "clickMouse":
          await this.kernel.browsers.computer.clickMouse(sessionId, {
            button: action.button,
            click_type: action.clickType,
            ...kernelHoldKeys(action.holdKeys),
            num_clicks: action.numClicks,
            x: action.x,
            y: action.y,
          });
          return;
        case "moveMouse":
          await this.kernel.browsers.computer.moveMouse(sessionId, {
            ...kernelDurationMs(action.durationMs),
            ...kernelHoldKeys(action.holdKeys),
            smooth: action.smooth,
            x: action.x,
            y: action.y,
          });
          return;
        case "typeText":
          await this.kernel.browsers.computer.typeText(sessionId, {
            text: action.text,
          });
          return;
        case "pressKey":
          await this.kernel.browsers.computer.pressKey(sessionId, {
            ...kernelDuration(action.durationMs),
            keys: [...action.keys],
          });
          return;
        case "scroll":
          await this.kernel.browsers.computer.scroll(sessionId, {
            delta_x: action.deltaX,
            delta_y: action.deltaY,
            ...kernelHoldKeys(action.holdKeys),
            x: action.x,
            y: action.y,
          });
          return;
        case "dragMouse":
          await this.kernel.browsers.computer.dragMouse(sessionId, {
            button: action.button,
            ...kernelDelay(action.delayMs),
            ...kernelDurationMs(action.durationMs),
            ...kernelHoldKeys(action.holdKeys),
            path: action.path.map(([x, y]) => [x, y]),
            smooth: action.smooth,
            step_delay_ms: action.stepDelayMs,
            steps_per_segment: action.stepsPerSegment,
          });
          return;
      }
    } catch {
      throw computerUseError({
        code: "HOSTED_COMPUTER_OS_CONTROL_FAILED",
        details: {
          computerOsControl: action.action,
        },
        httpStatus: 502,
        message: "Computer OS control failed.",
        retryable: true,
      });
    }
  }

  async deleteBrowserByIdOrName(idOrName: string): Promise<void> {
    try {
      await this.kernel.browsers.deleteByID(idOrName);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return;
      }
      throw error;
    }
  }

  async deleteProfile(name: string): Promise<void> {
    try {
      await this.kernel.profiles.delete(name);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return;
      }
      throw error;
    }
  }
}

function kernelHoldKeys(
  holdKeys: readonly string[],
): { hold_keys?: string[] } {
  return holdKeys.length > 0 ? { hold_keys: [...holdKeys] } : {};
}

function kernelDurationMs(durationMs: number): { duration_ms?: number } {
  return durationMs > 0 ? { duration_ms: durationMs } : {};
}

function kernelDuration(durationMs: number): { duration?: number } {
  return durationMs > 0 ? { duration: durationMs } : {};
}

function kernelDelay(delayMs: number): { delay?: number } {
  return delayMs > 0 ? { delay: delayMs } : {};
}

function buildKernelPlaywrightFailureDetails(response: {
  error?: unknown;
  stderr?: unknown;
  stdout?: unknown;
}): Record<string, unknown> {
  return {
    ...readKernelPlaywrightFailurePresenceField("kernelErrorPresent", response.error),
    ...readKernelPlaywrightFailurePresenceField("kernelStderrPresent", response.stderr),
    ...readKernelPlaywrightFailurePresenceField("kernelStdoutPresent", response.stdout),
  };
}

function readKernelPlaywrightFailurePresenceField(
  key: "kernelErrorPresent" | "kernelStderrPresent" | "kernelStdoutPresent",
  value: unknown,
): Record<string, boolean> {
  return typeof value === "string" && value.trim().length > 0
    ? { [key]: true }
    : {};
}

function buildKernelPlaywrightFailureMessage(_details: Record<string, unknown>): string {
  return "Computer browser evaluation failed.";
}

function requireKernelApiKey(source: EnvSource): string {
  const apiKey = source.KERNEL_API_KEY?.trim();

  if (!apiKey) {
    throw computerUseError({
      code: "HOSTED_COMPUTER_KERNEL_API_KEY_MISSING",
      httpStatus: 503,
      message: "Kernel computer use is not configured.",
      retryable: true,
    });
  }

  return apiKey;
}
