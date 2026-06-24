export const COMPUTER_BROWSER_VIEWPORTS = {
  mobile: { width: 390, height: 844, refresh_rate: 60 },
  tablet: { width: 768, height: 1024, refresh_rate: 60 },
  desktop: { width: 1280, height: 800, refresh_rate: 60 },
} as const;

export type ComputerBrowserViewportPreset = keyof typeof COMPUTER_BROWSER_VIEWPORTS;

export function isComputerBrowserViewportPreset(
  value: unknown,
): value is ComputerBrowserViewportPreset {
  return value === "mobile" || value === "tablet" || value === "desktop";
}

export function resolveComputerBrowserViewportPreset(
  width: number | null | undefined,
): ComputerBrowserViewportPreset {
  if (typeof width !== "number" || !Number.isFinite(width) || width < 768) {
    return "mobile";
  }
  if (width < 1024) {
    return "tablet";
  }
  return "desktop";
}
