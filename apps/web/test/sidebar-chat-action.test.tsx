import assert from "node:assert/strict";

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const prisma = { prisma: true };

  return {
    getHostedPageAuthSnapshot: vi.fn(),
    getPrisma: vi.fn(() => prisma),
    prisma,
    readHostedMemberRoutingState: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
    authenticatedMember: null,
    linkedAccounts: [],
    memberLookup: null,
    session: null,
  });
  mocks.readHostedMemberRoutingState.mockResolvedValue(null);
});

test("SidebarChatWithMurphAction prefers the member assigned Murph text number", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      id: "member_123",
    },
    linkedAccounts: [
      {
        latest_verified_at: 1771977600,
        phone_number: "+14045550123",
        type: "phone",
      },
      {
        address: "member@example.test",
        latest_verified_at: 1771977600,
        type: "email",
      },
    ],
    memberLookup: null,
    session: null,
  });
  mocks.readHostedMemberRoutingState.mockResolvedValue({
    linqChatId: null,
    linqRecipientPhone: "+15550100001",
    memberId: "member_123",
    pendingLinqChatId: null,
    pendingLinqRecipientPhone: null,
    telegramThreadId: null,
    telegramUserId: null,
    telegramUserLookupKey: null,
  });

  const { SidebarChatWithMurphAction } = await import(
    "@/src/components/dashboard/sidebar-chat-action"
  );
  const markup = await renderSidebarMarkup(await SidebarChatWithMurphAction());

  assert.match(markup, /href="sms:\+15550100001"/);
  assert.match(markup, /aria-label="Chat with Murph in Messages"/);
  assert.doesNotMatch(markup, /\+14045550123/);
  assert.doesNotMatch(markup, /member@example\.test/);
  assert.equal(mocks.getHostedPageAuthSnapshot.mock.calls.length, 1);
  assert.equal(mocks.getPrisma.mock.calls.length, 1);
  assert.deepEqual(mocks.readHostedMemberRoutingState.mock.calls[0]?.[0], {
    memberId: "member_123",
    prisma: mocks.prisma,
  });
});

test("SidebarChatWithMurphAction stays disabled when no connected chat channel exists", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      id: "member_no_channel",
    },
    linkedAccounts: [],
    memberLookup: null,
    session: null,
  });
  mocks.readHostedMemberRoutingState.mockResolvedValue({
    linqChatId: null,
    linqRecipientPhone: null,
    memberId: "member_no_channel",
    pendingLinqChatId: null,
    pendingLinqRecipientPhone: null,
    telegramThreadId: null,
    telegramUserId: null,
    telegramUserLookupKey: null,
  });

  const { SidebarChatWithMurphAction } = await import(
    "@/src/components/dashboard/sidebar-chat-action"
  );
  const markup = await renderSidebarMarkup(await SidebarChatWithMurphAction());

  assert.match(markup, /disabled=""/);
  assert.match(markup, /aria-busy="true"/);
  assert.doesNotMatch(markup, /href=/);
});

test("SidebarChatWithMurphAction does not use assigned SMS without a connected phone channel", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      id: "member_no_phone",
    },
    linkedAccounts: [
      {
        address: "member@example.test",
        latest_verified_at: 1771977600,
        type: "email",
      },
    ],
    memberLookup: null,
    session: null,
  });
  mocks.readHostedMemberRoutingState.mockResolvedValue({
    linqChatId: null,
    linqRecipientPhone: "+15550100001",
    memberId: "member_no_phone",
    pendingLinqChatId: null,
    pendingLinqRecipientPhone: null,
    telegramThreadId: null,
    telegramUserId: null,
    telegramUserLookupKey: null,
  });

  const { SidebarChatWithMurphAction } = await import(
    "@/src/components/dashboard/sidebar-chat-action"
  );
  const markup = await renderSidebarMarkup(await SidebarChatWithMurphAction());

  assert.match(markup, /href="mailto:murph@mail\.withmurph\.ai\?subject=Hey%20Murph"/);
  assert.doesNotMatch(markup, /href="sms:\+15550100001"/);
  assert.doesNotMatch(markup, /member@example\.test/);
});

test("SidebarChatWithMurphFallback is layout-preserving but not a live contact route", async () => {
  const { SidebarChatWithMurphFallback } = await import(
    "@/src/components/dashboard/sidebar-chat-action"
  );
  const markup = await renderSidebarMarkup(<SidebarChatWithMurphFallback />);

  assert.match(markup, /disabled=""/);
  assert.match(markup, /aria-busy="true"/);
  assert.doesNotMatch(markup, /href=/);
});

test("SidebarChatWithMurphAction discloses Telegram new-tab behavior", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      id: "member_telegram",
    },
    linkedAccounts: [
      {
        id: "tg_user_123",
        type: "telegram",
        username: "member_handle",
      },
    ],
    memberLookup: null,
    session: null,
  });
  mocks.readHostedMemberRoutingState.mockResolvedValue(null);

  const { SidebarChatWithMurphAction } = await import(
    "@/src/components/dashboard/sidebar-chat-action"
  );
  const markup = await renderSidebarMarkup(await SidebarChatWithMurphAction());

  assert.match(markup, /href="https:\/\/t\.me\/withmurph_bot"/);
  assert.match(markup, /target="_blank"/);
  assert.match(markup, /rel="noopener noreferrer"/);
  assert.match(markup, /aria-label="Chat with Murph in Telegram \(opens in a new tab\)"/);
  assert.doesNotMatch(markup, /tg_user_123/);
  assert.doesNotMatch(markup, /member_handle/);
});

async function renderSidebarMarkup(element: ReactNode): Promise<string> {
  const { SidebarProvider } = await import("@/src/components/ui/sidebar");

  return renderToStaticMarkup(
    <SidebarProvider>{element}</SidebarProvider>,
  );
}
