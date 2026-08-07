import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearClinicalRecordsConnectIntentFromBrowser,
  hasStagedClinicalRecordsConnectIntentForCurrentPath,
  isClinicalRecordsConnectLauncherForCurrentPath,
  stageClinicalRecordsConnectIntentInBrowser,
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

  it("keeps an authenticated reload resumable until SMART authorization starts", () => {
    const browser = installBrowser(
      `https://join.example.test/records/connect#clinicalRecordsIntent=${CLAIM}`,
      { __NA: true },
    );

    expect(takeClinicalRecordsConnectIntentFromBrowser({
      preserveForAuthReload: true,
    })).toBe(CLAIM);
    browser.setUrl("https://join.example.test/records/connect");
    expect(takeClinicalRecordsConnectIntentFromBrowser({
      preserveForAuthReload: true,
    })).toBe(CLAIM);

    clearClinicalRecordsConnectIntentFromBrowser();
    expect(hasStagedClinicalRecordsConnectIntentForCurrentPath()).toBe(false);
    expect(browser.history.state).toEqual({ __NA: true });
  });

  it("stages a newly created launcher claim without exposing it or replacing history state", () => {
    const browser = installBrowser(
      "https://join.example.test/records/connect?launch=clinical-records#return=keep",
      { __NA: true },
    );

    expect(isClinicalRecordsConnectLauncherForCurrentPath()).toBe(true);
    stageClinicalRecordsConnectIntentInBrowser(CLAIM);

    expect(browser.location.href).toBe(
      "https://join.example.test/records/connect?launch=clinical-records#return=keep",
    );
    expect(browser.history.state).toMatchObject({
      __NA: true,
      __murphClinicalRecordsConnectIntent: CLAIM,
    });
    expect(hasStagedClinicalRecordsConnectIntentForCurrentPath()).toBe(true);
  });

  it("recognizes only the exact generic Clinical Records launcher", () => {
    const browser = installBrowser(
      "https://join.example.test/records/connect?launch=clinical-records",
      {},
    );
    expect(isClinicalRecordsConnectLauncherForCurrentPath()).toBe(true);

    browser.setUrl(
      "https://join.example.test/records/connect?launch=clinical-records&extra=1",
    );
    expect(isClinicalRecordsConnectLauncherForCurrentPath()).toBe(false);
    browser.setUrl("https://join.example.test/records/connect?launch=other");
    expect(isClinicalRecordsConnectLauncherForCurrentPath()).toBe(false);
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
