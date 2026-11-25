import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveEpicClient } from "@/src/lib/clinical-records/epic-import-config";
import { resolveClinicalProviderDirectoryEntry } from "@/src/lib/clinical-records/provider-directory-store";

const provider = resolveClinicalProviderDirectoryEntry("epic-sandbox")!;
const prefix = "EPIC_SMART_NON_PRODUCTION_";

function setBasic(clientId: string) {
  vi.stubEnv("EPIC_SMART_PERSISTENT_CREDENTIALS", JSON.stringify({
    [provider.id]: { clientId, clientSecret: "synthetic-secret" },
  }));
}

describe("Epic client registrations", () => {
  beforeEach(() => {
    vi.stubEnv(prefix + "CLIENT_ID", "public");
    vi.stubEnv(prefix + "ASYMMETRIC_CLIENT_ID", undefined);
    vi.stubEnv(prefix + "PUBLIC_CLIENT_ID", undefined);
    vi.stubEnv("EPIC_SMART_HOSPITAL_APPROVED_PROVIDER_IDS", "");
    vi.stubEnv("EPIC_SMART_HOSPITAL_APPROVED_NON_PRODUCTION_CLIENT_ID", "hospital");
    vi.stubEnv("EPIC_SMART_PERSISTENT_CREDENTIALS", undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    // Approved, hospital ID, Basic map ID, selected ID, authentication method
    [false, "",         "",          "public",   "public"],
    [false, "hospital", "",          "public",   "public"],
    [false, "public",   "",          "public",   "public"],
    [false, "hospital", "org",       "org",      "basic"],
    [false, "hospital", "public",    "public",   "basic"],
    [false, "hospital", "hospital",  "hospital", "basic"],
    [false, "public",   "org",       "org",      "basic"],
    [false, "public",   "public",    "public",   "basic"],
    [true,  "hospital", "",          "hospital", "public"],
    [true,  "hospital", "org",       "hospital", "public"],
    [true,  "hospital", "public",    "hospital", "public"],
    [true,  "hospital", "hospital",  "hospital", "public"],
    [true,  "hospital", "malformed", "hospital", "public"],
  ] as const)("preserves legacy selection (approved=%s, hospital=%s, Basic=%s)", (approved, hospital, basic, clientId, method) => {
    vi.stubEnv("EPIC_SMART_HOSPITAL_APPROVED_PROVIDER_IDS", approved ? provider.id : "");
    vi.stubEnv("EPIC_SMART_HOSPITAL_APPROVED_NON_PRODUCTION_CLIENT_ID", hospital);
    if (basic === "malformed") vi.stubEnv("EPIC_SMART_PERSISTENT_CREDENTIALS", "{");
    else if (basic) setBasic(basic);

    const expected = { auth: { method, clientId }, hospitalApprovedImports: approved };
    expect(resolveEpicClient(provider)).toMatchObject(expected);
    expect(resolveEpicClient(provider, { grant: "callback", clientId })).toMatchObject(expected);
    if (method === "basic") {
      expect(resolveEpicClient(provider, { grant: "refresh", clientId })).toMatchObject(expected);
    }
  });

  it.each(["public", "org"])("preserves %s starts while only the asymmetric ID is staged", clientId => {
    vi.stubEnv(prefix + "ASYMMETRIC_CLIENT_ID", "signed");
    if (clientId === "org") setBasic(clientId);
    expect(resolveEpicClient(provider).auth).toMatchObject({ clientId, method: clientId === "org" ? "basic" : "public" });
    expect(resolveEpicClient(provider, { grant: "callback", clientId: "public" }).auth)
      .toEqual({ clientId: "public", method: "public" });
  });

  it("requires a distinct public pin when switching starts to the asymmetric ID", () => {
    vi.stubEnv(prefix + "CLIENT_ID", "signed");
    vi.stubEnv(prefix + "ASYMMETRIC_CLIENT_ID", "signed");
    expect(() => resolveEpicClient(provider)).toThrow(/PUBLIC_CLIENT_ID.*distinct existing public ID/);
  });

  it("rejects switching away from the public pin before staging the asymmetric ID", () => {
    vi.stubEnv(prefix + "PUBLIC_CLIENT_ID", "public");
    vi.stubEnv(prefix + "CLIENT_ID", "signed");
    expect(() => resolveEpicClient(provider)).toThrow(/must match the pinned public or asymmetric client ID/);
  });

  it.each(["basic", "hospital"])("rejects an asymmetric ID shared with the %s registration before signing", kind => {
    vi.stubEnv(prefix + "ASYMMETRIC_CLIENT_ID", "signed");
    if (kind === "basic") setBasic("signed");
    else {
      vi.stubEnv("EPIC_SMART_HOSPITAL_APPROVED_NON_PRODUCTION_CLIENT_ID", "signed");
      vi.stubEnv("EPIC_SMART_HOSPITAL_APPROVED_PROVIDER_IDS", provider.id);
    }
    expect(() => resolveEpicClient(provider)).toThrow(/asymmetric Epic client ID must be distinct/);
    expect(() => resolveEpicClient(provider, { clientId: "signed", grant: "callback" }))
      .toThrow(/asymmetric Epic client ID must be distinct/);
    expect(() => resolveEpicClient(provider, { clientId: "signed", grant: "refresh" }))
      .toThrow(/asymmetric Epic client ID must be distinct/);
  });
});
