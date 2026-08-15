import assert from "node:assert/strict";

import {
  cloneElement,
  createElement,
  isValidElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    getHostedPageAuthSnapshot: vi.fn(),
    getHostedMurphContactContext: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));

vi.mock("@/src/components/ui/auth-button", () => ({
  AuthButton(props: {
    "aria-label"?: string;
    children?: ReactNode;
    className?: string;
    disabled?: boolean;
    render?: ReactNode;
  }) {
    if (isValidElement<{
      children?: ReactNode;
      className?: string;
      "data-slot"?: string;
    }>(props.render)) {
      return cloneElement(
        props.render,
        {
          className: props.className,
          "data-slot": "auth-button",
        },
        props.children,
      );
    }

    return createElement(
      "button",
      {
        "aria-label": props["aria-label"],
        className: props.className,
        "data-slot": "auth-button",
        disabled: props.disabled,
        type: "button",
      },
      props.children,
    );
  },
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
  getHostedDashboardPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-contact-context", () => ({
  getHostedMurphContactContext: mocks.getHostedMurphContactContext,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
    authenticatedMember: null,
    linkedAccounts: [],
    session: null,
  });
  mocks.getHostedMurphContactContext.mockResolvedValue({
    initialContactChannels: {
      email: false,
      telegram: false,
      text: false,
    },
    murphEmailAddress: null,
    murphPhoneNumber: null,
  });
});

test("SidebarChatWithMurphAction opens a contact picker when multiple channels are connected", async () => {
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
    session: null,
  });
  mocks.getHostedMurphContactContext.mockResolvedValue({
    initialContactChannels: {
      email: true,
      telegram: false,
      text: true,
    },
    murphEmailAddress: "murph+alias123@mail.withmurph.ai",
    murphPhoneNumber: "+15550100001",
  });

  const { SidebarChatWithMurphAction } = await import(
    "@/src/components/dashboard/sidebar-chat-action"
  );
  const markup = await renderSidebarMarkup(await SidebarChatWithMurphAction());

  assert.match(markup, /data-slot="sidebar-menu-button"[^>]*aria-label="Chat with Murph"/);
  assert.doesNotMatch(markup, /href="sms:/);
  assert.doesNotMatch(markup, /href="mailto:/);
  assert.doesNotMatch(markup, /\+14045550123/);
  assert.doesNotMatch(markup, /member@example\.test/);
  assert.equal(mocks.getHostedMurphContactContext.mock.calls.length, 1);
  assert.equal(mocks.getHostedPageAuthSnapshot.mock.calls.length, 0);
});

test("SidebarChatWithMurphAction routes signed-in members without a chat channel to settings", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      id: "member_no_channel",
    },
    linkedAccounts: [],
    session: null,
  });
  const { SidebarChatWithMurphAction } = await import(
    "@/src/components/dashboard/sidebar-chat-action"
  );
  const markup = await renderSidebarMarkup(await SidebarChatWithMurphAction());

  assert.match(markup, /data-slot="sidebar-menu-button"/);
  assert.doesNotMatch(markup, /disabled=""/);
  assert.match(markup, /href="\/settings"/);
  assert.match(markup, /aria-label="Link a contact method to chat with Murph"/);
});

test("SidebarChatWithMurphAction does not synthesize an email chat channel", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      id: "member_checkout_email",
    },
    linkedAccounts: [],
    session: null,
  });
  mocks.getHostedMurphContactContext.mockResolvedValue({
    initialContactChannels: {
      email: false,
      telegram: false,
      text: false,
    },
    murphEmailAddress: null,
    murphPhoneNumber: null,
  });

  const { SidebarChatWithMurphAction } = await import(
    "@/src/components/dashboard/sidebar-chat-action"
  );
  const markup = await renderSidebarMarkup(await SidebarChatWithMurphAction());

  assert.match(markup, /href="\/settings"/);
  assert.doesNotMatch(markup, /href="mailto:/);
});

test("SidebarChatWithMurphAction skips verified email without a reply alias", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      id: "member_email_without_alias",
    },
    linkedAccounts: [],
    session: null,
  });
  mocks.getHostedMurphContactContext.mockResolvedValue({
    initialContactChannels: {
      email: false,
      telegram: false,
      text: true,
    },
    murphEmailAddress: null,
    murphPhoneNumber: "+15550100001",
  });

  const { SidebarChatWithMurphAction } = await import(
    "@/src/components/dashboard/sidebar-chat-action"
  );
  const markup = await renderSidebarMarkup(await SidebarChatWithMurphAction());

  assert.match(markup, /href="sms:\+15550100001"[^>]*data-slot="sidebar-menu-button"/);
  assert.doesNotMatch(markup, /href="mailto:/);
  assert.doesNotMatch(markup, /member@example\.test/);
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
    session: null,
  });
  mocks.getHostedMurphContactContext.mockResolvedValue({
    initialContactChannels: {
      email: true,
      telegram: false,
      text: false,
    },
    murphEmailAddress: "murph+alias123@mail.withmurph.ai",
    murphPhoneNumber: "+15550100001",
  });

  const { SidebarChatWithMurphAction } = await import(
    "@/src/components/dashboard/sidebar-chat-action"
  );
  const markup = await renderSidebarMarkup(await SidebarChatWithMurphAction());

  assert.match(markup, /href="mailto:murph\+alias123@mail\.withmurph\.ai\?subject=Hey%20Murph"/);
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
    session: null,
  });
  mocks.getHostedMurphContactContext.mockResolvedValue({
    initialContactChannels: {
      email: false,
      telegram: true,
      text: false,
    },
    murphEmailAddress: null,
    murphPhoneNumber: null,
  });

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
