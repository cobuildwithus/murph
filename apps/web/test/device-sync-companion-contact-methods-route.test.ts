import { beforeEach, expect, it, vi } from "vitest";

import { GET } from "../app/api/device-sync/companion/contact-methods/route";
import type { HostedAccountSettingsPageSnapshot } from "@/src/lib/hosted-onboarding/account-settings-snapshot";
import { MURPH_TELEGRAM_BOT_USERNAME } from "@/src/lib/murph-contact-routing";

const mocks = vi.hoisted(() => ({
  prisma: {},
  readSession: vi.fn(),
  readSnapshot: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@/src/lib/better-auth/config", () => ({ requireHostedBetterAuthConfig: () => ({}) }));
vi.mock("@/src/lib/better-auth/session", () => ({ readHostedAuthSession: mocks.readSession }));
vi.mock("@/src/lib/hosted-onboarding/account-settings-snapshot", () => ({
  readHostedAccountSettingsPageSnapshot: mocks.readSnapshot,
}));

const memberId = "synthetic-contact-member";
const verifiedAt = "2026-04-15T12:30:00.000Z";
const sessionToken = "x".repeat(32);
const authorization = `Bearer murph_auth_v1.${sessionToken}`;
const url = "https://example.com/api/device-sync/companion/contact-methods";

function linkedSnapshot(): HostedAccountSettingsPageSnapshot {
  return {
    account: {
      email: { address: "member@example.com", murphEmailAddress: "reply+demo@example.com", verifiedAt },
      phone: { number: "+12025550164", verifiedAt },
      referralIdentityKey: memberId,
      telegram: { telegramUserId: "synthetic-telegram-id", username: "sample_handle" },
    },
    routing: { linqRecipientPhone: "+12025550183", pendingLinqRecipientPhone: "+12025550192" },
    billingRef: null,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readSession.mockResolvedValue({
    session: { member: { id: memberId }, sessionId: "synthetic-session-id", proof: {} },
  });
});

async function readMethods(snapshot: HostedAccountSettingsPageSnapshot) {
  mocks.readSnapshot.mockResolvedValue(snapshot);
  const response = await GET(new Request(url, { headers: { authorization } }));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.readSnapshot).toHaveBeenCalledWith({ memberId, prisma: mocks.prisma });
  return response.json();
}

it.each([
  ["missing credentials", {}],
  ["a session cookie", { cookie: `__Host-murph-auth-session=${sessionToken}` }],
  ["mixed credentials", { authorization, cookie: `__Host-murph-auth-session=${sessionToken}` }],
] as const)("rejects %s before reading private state", async (_description, headers) => {
  const response = await GET(new Request(url, { headers: new Headers(Object.entries(headers)) }));
  expect(response.status).toBe(401);
  expect(mocks.readSession).not.toHaveBeenCalled();
  expect(mocks.readSnapshot).not.toHaveBeenCalled();
});

it("returns only the three settings rows and their copy and open targets", async () => {
  const body = await readMethods(linkedSnapshot());
  expect(body).toStrictEqual({
    schemaVersion: 1,
    methods: [
      { id: "text", you: "•••• 0164", murph: { label: "+1 (202) 555-0183", href: "sms:+12025550183" } },
      { id: "telegram", you: "@sample_handle", murph: {
        label: `@${MURPH_TELEGRAM_BOT_USERNAME}`, href: `https://t.me/${MURPH_TELEGRAM_BOT_USERNAME}`,
      } },
      { id: "email", you: "member@example.com", murph: {
        label: "reply+demo@example.com", href: "mailto:reply+demo@example.com",
      } },
    ],
  });
});

it("withholds unverified methods and unlinked Telegram even when contact hints exist", async () => {
  const snapshot = linkedSnapshot();
  snapshot.account.phone.verifiedAt = null;
  snapshot.account.email.verifiedAt = null;
  snapshot.account.telegram.telegramUserId = null;
  expect(await readMethods(snapshot)).toStrictEqual({
    schemaVersion: 1,
    methods: [
      { id: "text", you: null, murph: null },
      { id: "telegram", you: null, murph: null },
      { id: "email", you: null, murph: null },
    ],
  });
});

it("keeps linked values when the Murph number and personal reply address are missing", async () => {
  const snapshot = linkedSnapshot();
  snapshot.routing = null;
  snapshot.account.email.murphEmailAddress = null;
  delete snapshot.account.telegram.username;
  expect(await readMethods(snapshot)).toStrictEqual({
    schemaVersion: 1,
    methods: [
      { id: "text", you: "•••• 0164", murph: null },
      { id: "telegram", you: "Connected", murph: {
        label: `@${MURPH_TELEGRAM_BOT_USERNAME}`, href: `https://t.me/${MURPH_TELEGRAM_BOT_USERNAME}`,
      } },
      { id: "email", you: "member@example.com", murph: null },
    ],
  });
});

it("uses the pending Murph number when there is no current number", async () => {
  const snapshot = linkedSnapshot();
  snapshot.routing = { linqRecipientPhone: null, pendingLinqRecipientPhone: "+12025550192" };
  const body = await readMethods(snapshot);
  expect(body.methods[0]).toStrictEqual({
    id: "text", you: "•••• 0164", murph: { label: "+1 (202) 555-0192", href: "sms:+12025550192" },
  });
});
