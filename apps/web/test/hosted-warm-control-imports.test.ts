import { expect, it, vi } from "vitest";

// These operations must remain usable without loading unrelated execution
// owners. Existing route tests separately exercise auth and update behavior.
vi.mock("@murphai/device-syncd/hosted-runtime", () => {
  throw new Error("Device-sync execution must not initialize for a control read.");
});
vi.mock("@/src/lib/hosted-mailbox/store", () => {
  throw new Error("Mailbox mutation must not initialize for a control read.");
});
vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: async () => "member_synthetic",
  requireHostedCloudflareCallbackJsonRequest: async (request: Request) => ({
    payload: await request.json(),
    userId: "member_synthetic",
  }),
}));
vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({
    hostedMember: { findUnique: async () => null },
  }),
}));

it("answers the consent read without loading device-sync execution", async () => {
  const { GET } = await import(
    "../app/api/internal/hosted-runtime/health-data-admission/route"
  );
  const response = await GET(new Request("https://example.test/admission"));
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    consentState: "missing",
    processingAllowed: false,
    userId: "member_synthetic",
  });
});

it("answers a configuration read without loading device sync or mailbox mutation", async () => {
  const { POST } = await import(
    "../app/api/internal/hosted-execution/assistant-configuration/tool/route"
  );
  const response = await POST(new Request("https://example.test/configuration", {
    method: "POST",
    body: JSON.stringify({ action: "read" }),
  }));
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    action: "read",
    result: { configurationAvailable: false, provider: "openai" },
  });
});
