export const COMPUTER_BROWSER_VIEWPORTS = {
  mobile: { width: 390, height: 844, refresh_rate: 60 },
  // Match Kernel's standard-image default so desktop handoffs do not shrink
  // browser sessions when the live view opens.
  desktop: { width: 1920, height: 1080, refresh_rate: 25 },
} as const;

export type ComputerBrowserViewportPreset = keyof typeof COMPUTER_BROWSER_VIEWPORTS;

const MOBILE_USER_AGENT_PATTERN = /Mobi/;

export function resolveComputerBrowserViewportPreset(
  userAgent: string | null | undefined,
): ComputerBrowserViewportPreset {
  return typeof userAgent === "string" && MOBILE_USER_AGENT_PATTERN.test(userAgent)
    ? "mobile"
    : "desktop";
}
