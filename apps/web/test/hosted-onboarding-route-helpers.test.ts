import { expect, it, vi } from "vitest";

import { jsonOk, withJsonError } from "../src/lib/hosted-onboarding/http";
import { requireHostedInviteCodeFromRequest } from "../src/lib/hosted-onboarding/route-helpers";
import { createJsonPostRequest } from "./route-test-helpers";

vi.mock("server-only", () => ({}));

const route = withJsonError(async (request: Request) =>
  jsonOk(await requireHostedInviteCodeFromRequest(request)),
);

it.each([{}, { inviteCode: null }, { inviteCode: 12 }, { inviteCode: "" }])(
  "rejects a missing or malformed caller invite code %#",
  async (body) => {
    const response = await route(createJsonPostRequest("https://example.test/enroll", body));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: { code: "INVALID_REQUEST", message: "Invalid request." },
    });
  },
);

it("preserves the invite code and body for the enrollment service", async () => {
  const body = { inviteCode: "invite_opaque", plan: "pulse" };
  const response = await route(createJsonPostRequest("https://example.test/enroll", body));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ inviteCode: "invite_opaque", body });
});

it("does not translate a request stream failure into an invite rejection", async () => {
  const request = new Request("https://example.test/enroll", {
    method: "POST",
    body: new ReadableStream({
      start(controller) { controller.error(new TypeError("Synthetic stream failure.")); },
    }),
    duplex: "half",
  } as RequestInit);
  const response = await route(request);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: { code: "INTERNAL_ERROR", message: "Internal error." },
  });
});
