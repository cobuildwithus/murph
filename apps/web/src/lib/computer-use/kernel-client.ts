import Kernel, { ConflictError, NotFoundError } from "@onkernel/sdk";

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
    startUrl?: string | null;
    timeoutSeconds: number;
  }): Promise<KernelBrowserHandle>;
  deleteBrowser(sessionId: string): Promise<void>;
  deleteProfile(name: string): Promise<void>;
  ensureProfile(name: string): Promise<void>;
  executePlaywright(input: {
    code: string;
    sessionId: string;
    timeoutMs: number;
  }): Promise<KernelPlaywrightResult>;
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
    startUrl?: string | null;
    timeoutSeconds: number;
  }): Promise<KernelBrowserHandle> {
    const browser = await this.kernel.browsers.create({
      headless: false,
      name: input.browserName,
      profile: {
        name: input.profileName,
        save_changes: input.saveChanges,
      },
      ...(input.startUrl ? { start_url: input.startUrl } : {}),
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
      throw computerUseError({
        code: "HOSTED_COMPUTER_EVAL_FAILED",
        httpStatus: 502,
        message: "Computer browser evaluation failed.",
        retryable: true,
      });
    }

    return {
      result: response.result,
    };
  }

  async deleteBrowser(sessionId: string): Promise<void> {
    try {
      await this.kernel.browsers.deleteByID(sessionId);
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
