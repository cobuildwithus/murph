import { describe, expect, it } from "vitest";

import { detectInAppBrowser } from "@/src/lib/in-app-browser";

const IOS_SAFARI_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IOS_CHROME_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.108 Mobile/15E148 Safari/604.1";
const DESKTOP_CHROME_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const DESKTOP_SAFARI_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const X_IOS_WEBVIEW_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const INSTAGRAM_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 326.0.0.42.90 (iPhone15,4; iOS 17_4_1; en_US; en; scale=3.00; 1179x2556; IABMV/1)";
const FACEBOOK_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/456.0.0.45.101;FBDV/iPhone15,2;FBSV/17.4]";
const TIKTOK_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_30.7.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US WKWebView/1";
const LINKEDIN_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LinkedInApp/9.1.348";
const ANDROID_CHROME_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro Build/AP1A.240505.005) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const ANDROID_FACEBOOK_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro Build/AP1A.240505.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/466.0.0.55.109;]";

describe("detectInAppBrowser", () => {
  it.each([
    ["iOS Safari", IOS_SAFARI_USER_AGENT, true],
    ["Chrome on iOS", IOS_CHROME_USER_AGENT, true],
    ["desktop Chrome", DESKTOP_CHROME_USER_AGENT, false],
    ["desktop Safari", DESKTOP_SAFARI_USER_AGENT, false],
    ["Android Chrome", ANDROID_CHROME_USER_AGENT, false],
  ] as const)("does not flag %s", (_name, userAgent, isIos) => {
    expect(detectInAppBrowser(userAgent)).toEqual({
      app: null,
      inAppBrowser: false,
      isIos,
    });
  });

  it("flags an X/Twitter iOS webview without requiring an app token", () => {
    expect(detectInAppBrowser(X_IOS_WEBVIEW_USER_AGENT)).toEqual({
      app: null,
      inAppBrowser: true,
      isIos: true,
    });
  });

  it.each([
    ["Instagram", INSTAGRAM_USER_AGENT, "Instagram"],
    ["Facebook", FACEBOOK_USER_AGENT, "Facebook"],
    ["TikTok", TIKTOK_USER_AGENT, "TikTok"],
    [
      "TikTok Bytedance",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 BytedanceWebview/30.7.0",
      "TikTok",
    ],
    ["LinkedIn", LINKEDIN_USER_AGENT, "LinkedIn"],
    [
      "Snapchat",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/12.81.0.41",
      "Snapchat",
    ],
    [
      "Line",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/14.10.0",
      "Line",
    ],
    [
      "Twitter",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/9.59",
      "Twitter",
    ],
    [
      "Google app",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/317.0.656428447 Mobile/15E148 Safari/604.1",
      "Google",
    ],
  ] as const)("recognizes %s", (_name, userAgent, app) => {
    expect(detectInAppBrowser(userAgent)).toEqual({
      app,
      inAppBrowser: true,
      isIos: true,
    });
  });

  it("flags an Android Facebook webview through its app token", () => {
    expect(detectInAppBrowser(ANDROID_FACEBOOK_USER_AGENT)).toEqual({
      app: "Facebook",
      inAppBrowser: true,
      isIos: false,
    });
  });
});
