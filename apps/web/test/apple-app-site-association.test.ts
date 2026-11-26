import { describe, expect, it } from "vitest";

import { GET } from "../app/.well-known/apple-app-site-association/route";

describe("Apple App Site Association", () => {
  it("serves production recap, invite, connect-source and win universal links without a session or redirect", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.redirected).toBe(false);
    expect(await response.json()).toEqual({
      applinks: {
        details: [{
          appIDs: ["G9DJH2XUMK.ai.withmurph.app"],
          // "?*" is at least one character: the website's own /connect page is not claimed.
          components: [{ "/": "/recap/*" }, { "/": "/g/*" }, { "/": "/connect/?*" }, { "/": "/wins/*" }],
        }],
      },
    });
  });
});
