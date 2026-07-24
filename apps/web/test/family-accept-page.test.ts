import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  readConfiguredMurphPhoneNumbers: vi.fn<() => string[]>(),
  readHostedFamilyInviteAcceptanceView: vi.fn(),
  signInButtonProps: null as {
    bindingLabel: string;
    description?: string;
    variant?: string;
  } | null,
  signInButtonRendered: false,
  webAcceptButtonProps: null as { inviteCode: string } | null,
}));

vi.mock("@/src/components/family/family-invite-accept-client", () => ({
  FamilyInviteSignInButton(props: {
    bindingLabel: string;
    description?: string;
    variant?: string;
  }) {
    mocks.signInButtonProps = props;
    mocks.signInButtonRendered = true;
    return createElement(
      "button",
      { "data-family-sign-in": props.variant ?? "primary" },
      props.variant === "link" ? "Prefer not to text?" : "Sign in to join",
    );
  },
  FamilyInviteWebAcceptButton(props: { inviteCode: string }) {
    mocks.webAcceptButtonProps = props;
    return createElement(
      "button",
      { "data-family-web-accept": props.inviteCode },
      "Accept invite",
    );
  },
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  buildHostedFamilyInviteMessagesHref: (input: {
    inviteCode: string;
    murphPhoneNumber: string;
  }) => `sms:${input.murphPhoneNumber}?body=Hi%20Murph%2C%20joining%20the%20family%20plan%20(code%20family_${input.inviteCode})`,
  readHostedFamilyInviteAcceptanceView: mocks.readHostedFamilyInviteAcceptanceView,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/lib/device-sync/messaging-return-destination", () => ({
  readConfiguredMurphPhoneNumbers: mocks.readConfiguredMurphPhoneNumbers,
}));

const BASE_VIEW = {
  groupActive: true,
  groupDisplayName: "Kim Family",
  inviteCode: "CODE",
  isEmailBound: false,
  isPhoneBound: false,
  isTelegramBound: false,
  messagesRecipientPhone: null,
  seatAvailable: true,
  status: "pending",
  targetLabel: "Pat",
  telegramInviteUrl: null,
  webAcceptable: false,
};

const EMAIL_BOUND_VIEW = {
  ...BASE_VIEW,
  inviteCode: "CODEMAIL",
  isEmailBound: true,
  webAcceptable: true,
};

const PHONE_BOUND_VIEW = {
  ...BASE_VIEW,
  inviteCode: "CODEPHONE",
  isPhoneBound: true,
  messagesRecipientPhone: "+15551230000",
  webAcceptable: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signInButtonProps = null;
  mocks.signInButtonRendered = false;
  mocks.webAcceptButtonProps = null;
  mocks.readConfiguredMurphPhoneNumbers.mockReturnValue([]);
  mocks.readHostedFamilyInviteAcceptanceView.mockResolvedValue(EMAIL_BOUND_VIEW);
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({ authenticated: false });
});

test("renders the web sign-in path for unauthenticated email-bound invites", async () => {
  const markup = await renderFamilyAcceptPage("CODEMAIL");

  expect(mocks.signInButtonRendered).toBe(true);
  expect(mocks.signInButtonProps).toEqual({ bindingLabel: "email address" });
  expect(markup).toContain("Sign in to join");
  expect(markup).toContain("Use the email address this invite was sent to.");
  expect(markup).not.toContain("Continue in Telegram");
  expect(markup).not.toContain("Continue in Messages");
});

test("renders the web accept path for authenticated email-bound invites", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({ authenticated: true });

  const markup = await renderFamilyAcceptPage("CODEMAIL");

  expect(mocks.webAcceptButtonProps).toEqual({ inviteCode: "CODEMAIL" });
  expect(markup).toContain("Accept invite");
  expect(markup).not.toContain("Continue in Telegram");
  expect(markup).not.toContain("Continue in Messages");
});

test("keeps Telegram available for authenticated unbound invites without Messages", async () => {
  mocks.readHostedFamilyInviteAcceptanceView.mockResolvedValue({
    ...BASE_VIEW,
    inviteCode: "CODETGWEB",
    telegramInviteUrl: "https://t.me/withmurph_bot?start=family_CODETGWEB",
    webAcceptable: true,
  });
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({ authenticated: true });

  const markup = await renderFamilyAcceptPage("CODETGWEB");

  expect(mocks.webAcceptButtonProps).toEqual({ inviteCode: "CODETGWEB" });
  expect(markup).toContain("Accept invite");
  expect(markup).toContain("Continue in Telegram");
  expect(markup).toContain("https://t.me/withmurph_bot?start=family_CODETGWEB");
  expect(markup).not.toContain("Continue in Messages");
});

test("leads phone-bound invites with the Messages accept path, not Telegram", async () => {
  mocks.readHostedFamilyInviteAcceptanceView.mockResolvedValue(PHONE_BOUND_VIEW);

  const markup = await renderFamilyAcceptPage("CODEPHONE");

  expect(markup).toContain("Continue in Messages");
  expect(markup).toContain(
    "sms:+15551230000?body=Hi%20Murph%2C%20joining%20the%20family%20plan%20(code%20family_CODEPHONE)",
  );
  // The web sign-in is offered only as a compact secondary option.
  expect(mocks.signInButtonProps).toEqual({
    bindingLabel: "phone number",
    variant: "link",
  });
  expect(markup).not.toContain("Continue in Telegram");
});

test("falls back to a configured Murph line for a brand-new phone invitee", async () => {
  mocks.readHostedFamilyInviteAcceptanceView.mockResolvedValue({
    ...PHONE_BOUND_VIEW,
    messagesRecipientPhone: null,
  });
  mocks.readConfiguredMurphPhoneNumbers.mockReturnValue(["+15559990000"]);

  const markup = await renderFamilyAcceptPage("CODEPHONE");

  expect(markup).toContain(
    "sms:+15559990000?body=Hi%20Murph%2C%20joining%20the%20family%20plan%20(code%20family_CODEPHONE)",
  );
  expect(markup).toContain("Continue in Messages");
});

test("uses the one-tap web accept path for authenticated phone-bound invites", async () => {
  mocks.readHostedFamilyInviteAcceptanceView.mockResolvedValue(PHONE_BOUND_VIEW);
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({ authenticated: true });

  const markup = await renderFamilyAcceptPage("CODEPHONE");

  expect(mocks.webAcceptButtonProps).toEqual({ inviteCode: "CODEPHONE" });
  expect(markup).toContain("Accept invite");
  expect(markup).toContain("Continue in Messages");
  expect(markup).toContain(
    "sms:+15551230000?body=Hi%20Murph%2C%20joining%20the%20family%20plan%20(code%20family_CODEPHONE)",
  );
  expect(markup).toContain(
    "Joining by text works from the phone this invite was sent to.",
  );
});

test("continues in Telegram only for Telegram-bound invites", async () => {
  mocks.readHostedFamilyInviteAcceptanceView.mockResolvedValue({
    ...BASE_VIEW,
    inviteCode: "CODETG",
    isTelegramBound: true,
    telegramInviteUrl: "https://t.me/withmurph_bot?start=family_CODETG",
  });

  const markup = await renderFamilyAcceptPage("CODETG");

  expect(markup).toContain("Continue in Telegram");
  expect(markup).toContain("https://t.me/withmurph_bot?start=family_CODETG");
  expect(markup).not.toContain("Continue in Messages");
  expect(mocks.signInButtonRendered).toBe(false);
});

test("shows Messages, web sign-in, and Telegram options for a label-only invite", async () => {
  mocks.readHostedFamilyInviteAcceptanceView.mockResolvedValue({
    ...BASE_VIEW,
    inviteCode: "CODELABEL",
    telegramInviteUrl: "https://t.me/withmurph_bot?start=family_CODELABEL",
    webAcceptable: true,
  });
  mocks.readConfiguredMurphPhoneNumbers.mockReturnValue(["+15559990000"]);

  const markup = await renderFamilyAcceptPage("CODELABEL");

  expect(markup).toContain("Continue in Messages");
  expect(markup).toContain(
    "sms:+15559990000?body=Hi%20Murph%2C%20joining%20the%20family%20plan%20(code%20family_CODELABEL)",
  );
  expect(markup).toContain("Prefer not to text?");
  expect(markup).toContain("Continue in Telegram");
  expect(markup).toContain("https://t.me/withmurph_bot?start=family_CODELABEL");
  expect(mocks.signInButtonProps).toEqual({
    bindingLabel: "your phone number or email address",
    description: "Sign in with your own phone number or email address. We'll bring you back here.",
    variant: "link",
  });
  expect(markup).not.toContain("Open this invite from the chat where you received it");
});

test("shows web sign-in and Telegram for an unbound invite without a Messages line", async () => {
  mocks.readHostedFamilyInviteAcceptanceView.mockResolvedValue({
    ...BASE_VIEW,
    inviteCode: "CODEUNBOUND",
    telegramInviteUrl: "https://t.me/withmurph_bot?start=family_CODEUNBOUND",
    webAcceptable: true,
  });

  const markup = await renderFamilyAcceptPage("CODEUNBOUND");

  expect(markup).toContain("Sign in to join");
  expect(markup).toContain("Continue in Telegram");
  expect(markup).toContain("https://t.me/withmurph_bot?start=family_CODEUNBOUND");
  expect(markup).not.toContain("Continue in Messages");
  expect(mocks.signInButtonProps).toEqual({
    bindingLabel: "your phone number or email address",
    description: "Sign in with your own phone number or email address. We'll bring you back here.",
  });
});

test.each([
  {
    action: null,
    excludedCopy: [
      "This invite has expired",
      "This invite was canceled",
      "This invite was already used",
      "This family plan isn&#x27;t active yet",
      "This family plan is full",
    ],
    expectedCopy: [
      "Link no longer works",
      "This invite isn&#x27;t valid",
      "This family invite is no longer available. Ask the person who invited you to send a new one.",
    ],
    name: "invalid link",
    view: null,
  },
  {
    action: null,
    excludedCopy: [
      "This family plan isn&#x27;t active yet",
      "This family plan is full",
    ],
    expectedCopy: [
      "Link no longer works",
      "This invite has expired",
      "Ask the plan owner to send you a fresh family invite.",
    ],
    name: "expired invite before lower-priority plan state",
    view: {
      ...BASE_VIEW,
      groupActive: false,
      seatAvailable: false,
      status: "expired",
    },
  },
  {
    action: null,
    excludedCopy: [
      "This family plan isn&#x27;t active yet",
      "This family plan is full",
    ],
    expectedCopy: [
      "Link no longer works",
      "This invite was canceled",
      "Ask the plan owner for a new invite.",
    ],
    name: "revoked invite before lower-priority plan state",
    view: {
      ...BASE_VIEW,
      groupActive: false,
      seatAvailable: false,
      status: "revoked",
    },
  },
  {
    action: "Open Murph",
    excludedCopy: [
      "This family plan isn&#x27;t active yet",
      "This family plan is full",
    ],
    expectedCopy: [
      "Murph Family",
      "This invite was already used",
      "If that was you, open Murph to continue.",
    ],
    name: "accepted invite before lower-priority plan state",
    view: {
      ...BASE_VIEW,
      groupActive: false,
      seatAvailable: false,
      status: "accepted",
    },
  },
  {
    action: null,
    excludedCopy: ["This family plan is full"],
    expectedCopy: [
      "Almost ready",
      "This family plan isn&#x27;t active yet",
      "Ask the plan owner to finish setting up billing, then open this invite again.",
    ],
    name: "inactive plan before seat availability",
    view: {
      ...BASE_VIEW,
      groupActive: false,
      seatAvailable: false,
    },
  },
  {
    action: null,
    excludedCopy: [],
    expectedCopy: [
      "Family is full",
      "This family plan is full",
      "The plan has no open paid seats. Ask the owner to add a Family seat.",
    ],
    name: "full family plan",
    view: {
      ...BASE_VIEW,
      seatAvailable: false,
    },
  },
])("renders the $name terminal branch without join controls", async ({
  action,
  excludedCopy,
  expectedCopy,
  view,
}) => {
  mocks.readHostedFamilyInviteAcceptanceView.mockResolvedValue(view);

  const markup = await renderFamilyAcceptPage("CODE");

  for (const copy of expectedCopy) {
    expect(markup).toContain(copy);
  }
  for (const copy of excludedCopy) {
    expect(markup).not.toContain(copy);
  }
  if (action) {
    expect(markup).toContain(action);
  } else {
    expect(markup).not.toContain("Open Murph");
  }
  expect(markup).not.toContain("Continue in Messages");
  expect(markup).not.toContain("Continue in Telegram");
  expect(markup).not.toContain("Sign in to join");
  expect(markup).not.toContain("Accept invite");
  expect(mocks.signInButtonRendered).toBe(false);
  expect(mocks.webAcceptButtonProps).toBeNull();
});

async function renderFamilyAcceptPage(inviteCode: string): Promise<string> {
  const { default: FamilyAcceptPage } = await import("../app/family/accept/[inviteCode]/page");

  return renderToStaticMarkup(
    await FamilyAcceptPage({
      params: Promise.resolve({ inviteCode }),
    }),
  );
}
