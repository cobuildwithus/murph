export type InAppBrowserApp =
  | "Facebook"
  | "Google"
  | "Instagram"
  | "Line"
  | "LinkedIn"
  | "Snapchat"
  | "TikTok"
  | "Twitter";

export type InAppBrowserDetection = {
  app: InAppBrowserApp | null;
  inAppBrowser: boolean;
  isIos: boolean;
};

const IN_APP_BROWSER_TOKENS: ReadonlyArray<{
  app: InAppBrowserApp;
  pattern: RegExp;
}> = [
  { app: "Instagram", pattern: /\bInstagram\b/iu },
  { app: "Facebook", pattern: /\b(?:FBAN|FBAV|FB_IAB)\b/iu },
  { app: "TikTok", pattern: /musical_ly|Bytedance/iu },
  { app: "LinkedIn", pattern: /\bLinkedInApp\b/iu },
  { app: "Snapchat", pattern: /\bSnapchat\b/iu },
  { app: "Line", pattern: /\bLine\b/iu },
  { app: "Twitter", pattern: /\bTwitter\b/iu },
  { app: "Google", pattern: /\bGSA\b/iu },
];

export function detectInAppBrowser(userAgent: string): InAppBrowserDetection {
  const isIos = /iPhone|iPad|iPod/iu.test(userAgent);
  const app = IN_APP_BROWSER_TOKENS.find(({ pattern }) => pattern.test(userAgent))
    ?.app ?? null;

  return {
    app,
    inAppBrowser: app !== null || (isIos && !/Safari\//iu.test(userAgent)),
    isIos,
  };
}
