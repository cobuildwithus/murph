import Kernel, { ConflictError } from "@onkernel/sdk";

import { computerUseError } from "./errors";

export interface KernelBrowserHandle {
  cdpWsUrl: string;
  liveViewUrl: string;
  sessionId: string;
}

export interface KernelPlaywrightResult {
  result: unknown;
}

export interface ComputerKernelClient {
  createBrowser(input: {
    profileName: string;
    saveChanges: boolean;
    startUrl?: string | null;
  }): Promise<KernelBrowserHandle>;
  deleteBrowser(sessionId: string): Promise<void>;
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
      timeout: 60_000,
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
    profileName: string;
    saveChanges: boolean;
    startUrl?: string | null;
  }): Promise<KernelBrowserHandle> {
    const browser = await this.kernel.browsers.create({
      headless: false,
      profile: {
        name: input.profileName,
        save_changes: input.saveChanges,
      },
      ...(input.startUrl ? { start_url: input.startUrl } : {}),
      stealth: true,
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
      cdpWsUrl: browser.cdp_ws_url,
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
    await this.kernel.browsers.deleteByID(sessionId);
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
