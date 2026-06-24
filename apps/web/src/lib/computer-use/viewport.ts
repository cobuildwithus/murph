export const COMPUTER_BROWSER_VIEWPORTS = {
  mobile: { width: 390, height: 844, refresh_rate: 60 },
  desktop: { width: 1280, height: 800, refresh_rate: 60 },
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
