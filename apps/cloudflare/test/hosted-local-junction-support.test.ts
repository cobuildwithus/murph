import { afterEach, describe, expect, it } from "vitest";

import {
  startHostedLocalJunctionStub,
  type HostedLocalJunctionStub,
} from "./helpers/hosted-local-junction-support.js";

let stub: HostedLocalJunctionStub | null = null;

afterEach(async () => {
  await stub?.stop();
  stub = null;
});

describe("hosted local Junction stub", () => {
  it.each([
    {
      body: undefined,
      clientUserId: "resolve-client",
      method: "GET",
      path: "/v2/user/resolve/resolve-client",
    },
    {
      body: JSON.stringify({ client_user_id: "create-client" }),
      clientUserId: "create-client",
      method: "POST",
      path: "/v2/user/",
    },
  ])("returns the current Junction user contract for $method", async ({
    body,
    clientUserId,
    method,
    path,
  }) => {
    stub = await startHostedLocalJunctionStub();

    const response = await fetch(`${stub.baseUrl}${path}`, {
      body,
      headers: body ? { "content-type": "application/json" } : undefined,
      method,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      client_user_id: clientUserId,
      connected_sources: [],
      created_on: "2026-01-01T00:00:00.000Z",
      team_id: "junction_team_local_stub_1",
      user_id: stub.junctionUserId,
    });
  });

  it("returns the current Junction Link token contract", async () => {
    stub = await startHostedLocalJunctionStub();

    const response = await fetch(`${stub.baseUrl}/v2/link/token`, {
      body: JSON.stringify({
        provider: "garmin",
        redirect_url: "https://example.test/junction/callback",
        user_id: stub.junctionUserId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      link_token: "hosted-local-junction-stub",
      link_web_url: "https://link.tryvital.io/?token=hosted-local-junction-stub",
    });
    expect(stub.linkTokenRequests).toEqual([{
      provider: "garmin",
      redirectUrl: "https://example.test/junction/callback",
      userId: stub.junctionUserId,
    }]);
  });
});
