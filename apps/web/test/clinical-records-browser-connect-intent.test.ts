import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hasStagedClinicalRecordsConnectIntentForCurrentPath,
  takeClinicalRecordsConnectIntentFromBrowser,
} from "@/src/lib/clinical-records/browser-connect-intent";

const CLAIM = `cr_${"a".repeat(32)}`;

describe("Clinical Records browser connect intent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scrubs the fragment while preserving unrelated URL and Next history state", () => {
    const browser = installBrowser(
      `https://join.example.test/records/connect#clinicalRecordsIntent=${CLAIM}&return=keep`,
      { __NA: true },
    );

    expect(takeClinicalRecordsConnectIntentFromBrowser({
      preserveForAuthReload: true,
    })).toBe(CLAIM);
    expect(browser.location.href).toBe(
      "https://join.example.test/records/connect#return=keep",
    );
    expect(browser.history.state).toMatchObject({ __NA: true });
    expect(hasStagedClinicalRecordsConnectIntentForCurrentPath()).toBe(true);

    expect(takeClinicalRecordsConnectIntentFromBrowser({
      preserveForAuthReload: false,
    })).toBe(CLAIM);
    expect(browser.history.state).toEqual({ __NA: true });
    expect(hasStagedClinicalRecordsConnectIntentForCurrentPath()).toBe(false);
  });

  it("scrubs malformed claims and clears an older staged bearer", () => {
    const browser = installBrowser(
      `https://join.example.test/records/connect#clinicalRecordsIntent=${CLAIM}`,
      {},
    );
    expect(takeClinicalRecordsConnectIntentFromBrowser({
      preserveForAuthReload: true,
    })).toBe(CLAIM);

    browser.setUrl(
      "https://join.example.test/records/connect#clinicalRecordsIntent=not-a-claim&return=keep",
    );

    expect(takeClinicalRecordsConnectIntentFromBrowser({
      preserveForAuthReload: true,
    })).toBeNull();
    expect(browser.location.href).toBe(
      "https://join.example.test/records/connect#return=keep",
    );
    expect(hasStagedClinicalRecordsConnectIntentForCurrentPath()).toBe(false);
  });

  it("never resumes the staged bearer from another path", () => {
    const browser = installBrowser(
      `https://join.example.test/records/connect#clinicalRecordsIntent=${CLAIM}`,
      {},
    );
    expect(takeClinicalRecordsConnectIntentFromBrowser({
      preserveForAuthReload: true,
    })).toBe(CLAIM);

    browser.setUrl("https://join.example.test/records");

    expect(hasStagedClinicalRecordsConnectIntentForCurrentPath()).toBe(false);
  });
});

function installBrowser(initialUrl: string, initialState: Record<string, unknown>) {
  let url = new URL(initialUrl);
  let state: unknown = initialState;
  const location = {} as Location;
  const syncLocation = () => {
    Object.assign(location, {
      hash: url.hash,
      href: url.toString(),
      origin: url.origin,
      pathname: url.pathname,
      search: url.search,
    });
  };
  syncLocation();

  const history = {
    get state() {
      return state;
    },
    replaceState(nextState: unknown, _unused: string, nextUrl?: string | URL | null) {
      state = nextState;
      if (nextUrl) {
        url = new URL(nextUrl, url);
        syncLocation();
      }
    },
  } as History;
  const browser = { history, location } as Window & typeof globalThis;
  vi.stubGlobal("window", browser);

  return {
    history,
    location,
    setUrl(nextUrl: string) {
      url = new URL(nextUrl);
      syncLocation();
    },
  };
}
