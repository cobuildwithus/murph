import { describe, expect, it } from "vitest";

import { GET } from "../app/.well-known/apple-app-site-association/route";

function associationFor(url: string, host?: string) {
  return GET(new Request(url, host ? { headers: { host } } : undefined));
}

function claiming(path: string) {
  return {
    applinks: {
      details: [{
        appIDs: ["G9DJH2XUMK.ai.withmurph.app"],
        components: [{ "/": path }],
      }],
    },
  };
}

describe("Apple App Site Association", () => {
  it.each([
    ["www", "https://www.withmurph.ai/.well-known/apple-app-site-association", "www.withmurph.ai", "/recap/*"],
    ["apex", "https://withmurph.ai/.well-known/apple-app-site-association", "withmurph.ai", "/recap/*"],
    ["play", "https://play.withmurph.ai/.well-known/apple-app-site-association", "play.withmurph.ai", "/g/*"],
    ["play with a port and capitals", "http://localhost:3000/.well-known/apple-app-site-association", "Play.Example.test:3000", "/g/*"],
    ["play from the URL alone", "https://play.withmurph.ai/.well-known/apple-app-site-association", undefined, "/g/*"],
  ])("serves %s as public JSON without a session or redirect", async (_name, url, host, path) => {
    const response = associationFor(url, host);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.redirected).toBe(false);
    expect(await response.json()).toEqual(claiming(path));
  });
});
