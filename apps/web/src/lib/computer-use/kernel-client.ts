import Kernel, { ConflictError, NotFoundError } from "@onkernel/sdk";
import type {
  HostedComputerOsControlRequest,
} from "@murphai/hosted-execution/computer-use";

import { computerUseError } from "./errors";

const KERNEL_REQUEST_TIMEOUT_MS = 30_000;
const KERNEL_PLAYWRIGHT_DIAGNOSTIC_MAX_LENGTH = 4_000;

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
        message: buildKernelPlaywrightFailureMessage(),
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
  const kernelError = readKernelPlaywrightFailureText(response.error);
  const kernelStderr = readKernelPlaywrightFailureText(response.stderr);

  return {
    ...readKernelPlaywrightFailurePresenceField("kernelErrorPresent", response.error),
    ...readKernelPlaywrightFailurePresenceField("kernelStderrPresent", response.stderr),
    ...readKernelPlaywrightFailurePresenceField("kernelStdoutPresent", response.stdout),
    ...(kernelError ? { kernelError } : {}),
    ...(kernelStderr && kernelStderr !== kernelError ? { kernelStderr } : {}),
  };
}

function readKernelPlaywrightFailurePresenceField(
  key: "kernelErrorPresent" | "kernelStderrPresent" | "kernelStdoutPresent",
  value: unknown,
): Record<string, boolean> {
  return isKernelPlaywrightFailureValuePresent(value)
    ? { [key]: true }
    : {};
}

function isKernelPlaywrightFailureValuePresent(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (!value || typeof value !== "object") {
    return false;
  }

  return Object.entries(value).some(([key, entry]) =>
    isKernelPlaywrightDiagnosticObjectKey(key) &&
    typeof entry === "string" &&
    entry.trim().length > 0
  );
}

function isKernelPlaywrightDiagnosticObjectKey(
  key: string,
): key is "error" | "message" | "name" | "stack" {
  return key === "error" || key === "message" || key === "name" || key === "stack";
}

function readKernelPlaywrightFailureText(value: unknown): string | null {
  if (typeof value === "string") {
    return sanitizeKernelPlaywrightDiagnosticText(value);
  }
  if (!value || typeof value !== "object") {
    return null;
  }

  const entries = Object.entries(value);
  const fragments = [
    readKernelPlaywrightObjectDiagnosticFragment(entries, "name"),
    readKernelPlaywrightObjectDiagnosticFragment(entries, "message"),
    readKernelPlaywrightObjectDiagnosticFragment(entries, "stack"),
    readKernelPlaywrightObjectDiagnosticFragment(entries, "error"),
  ].filter((fragment): fragment is string => fragment !== null);

  if (fragments.length === 0) {
    return null;
  }

  return sanitizeKernelPlaywrightDiagnosticText(dedupeKernelPlaywrightDiagnosticFragments(fragments));
}

function readKernelPlaywrightObjectDiagnosticFragment(
  entries: readonly (readonly [string, unknown])[],
  key: "error" | "message" | "name" | "stack",
): string | null {
  return readKernelPlaywrightDiagnosticFragment(
    entries.find(([entryKey]) => entryKey === key)?.[1],
  );
}

function readKernelPlaywrightDiagnosticFragment(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function dedupeKernelPlaywrightDiagnosticFragments(fragments: readonly string[]): string {
  const lines: string[] = [];
  for (const fragment of fragments) {
    const trimmed = fragment.trim();
    if (!trimmed) {
      continue;
    }
    if (lines.some((line) => line === trimmed || line.includes(trimmed))) {
      continue;
    }
    lines.push(trimmed);
  }
  return lines.join("\n");
}

function sanitizeKernelPlaywrightDiagnosticText(value: string): string | null {
  const redacted = redactKernelPlaywrightDiagnosticText(value)
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/gu, " ").trimEnd())
    .join("\n")
    .replace(/\n{4,}/gu, "\n\n\n")
    .trim();

  if (!redacted) {
    return null;
  }

  if (redacted.length <= KERNEL_PLAYWRIGHT_DIAGNOSTIC_MAX_LENGTH) {
    return redacted;
  }

  return `${redacted.slice(0, KERNEL_PLAYWRIGHT_DIAGNOSTIC_MAX_LENGTH - 3).trimEnd()}...`;
}

function redactKernelPlaywrightDiagnosticText(value: string): string {
  return value
    .replace(/\bfile:\/\/[^\s)"']+/giu, "<REDACTED_PATH>")
    .replace(/(^|[\s("'])\/(?:Users|home|root|tmp|var|private|mnt|app)\/[^\s)"']+/gu, "$1<REDACTED_PATH>")
    .replace(/[A-Za-z]:\\[^\s)"']+/gu, "<REDACTED_PATH>")
    .replace(/\b(href|src|action)=("[^"]*"|'[^']*'|[^\s>]+)/giu, (_match, key: string) =>
      `${key}=<REDACTED_URL>`)
    .replace(/\bhttps?:\/\/[^\s)"'<>]+/giu, "<REDACTED_URL>")
    .replace(
      /\b(authorization)\b\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]+\b/giu,
      (_match, key: string) => `${key}=Bearer [redacted]`,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/giu, "Bearer [redacted]")
    .replace(
      /\b(authorization)\b\s*[:=]\s*(?!Bearer\b)(?:"[^"]+"|'[^']+'|\S+)/giu,
      (_match, key: string) => `${key}=[redacted]`,
    )
    .replace(
      /\b((?:[A-Z][A-Z0-9_]*_)?(?:token|secret|password|passcode|api[_-]?key|cookie|set-cookie))\b\s*[:=]\s*(?:"[^"]+"|'[^']+'|\S+)/giu,
      "$1=[redacted]",
    )
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted-token]")
    .replace(/(?:\+\d[\d().\s-]{7,}\d|\(\d{3}\)\s*\d{3}[-.\s]\d{4}\b|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b)/gu, "[redacted-phone]")
    .replace(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/gu, "[redacted-email]");
}

function buildKernelPlaywrightFailureMessage(): string {
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
