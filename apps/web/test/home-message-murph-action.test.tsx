import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  authenticated: true,
  getHostedPageAuthSnapshot: vi.fn(),
  openAuthDialog: vi.fn(),
  resolveContact: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/src/components/murph/hosted-murph-contact-action", () => ({
  resolveHostedMurphContactOption: mocks.resolveContact,
}));
vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));
vi.mock("@/src/components/hosted-onboarding/auth-dialog-provider", () => ({
  useAuth: () => ({
    authenticated: mocks.authenticated,
    openAuthDialog: mocks.openAuthDialog,
  }),
}));

import { MessageMurphContactAction } from "@/src/components/home/message-murph-action";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticated = true;
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({ authenticated: true });
  mocks.resolveContact.mockResolvedValue(null);
});

test.each([
  { kind: "text", label: "Messages", href: "sms:+15550100001" },
  { kind: "email", label: "Email", href: "mailto:murph@example.test" },
  { kind: "telegram", label: "Telegram", href: "https://t.me/withmurph_bot" },
] as const)("Home Message opens the resolved $kind destination", async (option) => {
  mocks.resolveContact.mockResolvedValue(option);
  const markup = renderToStaticMarkup(await MessageMurphContactAction());
  expect(markup).toContain(`href="${option.href}"`);
  expect(markup).toContain(`aria-label="Message Murph in ${option.label}"`);
  expect(mocks.getHostedPageAuthSnapshot).not.toHaveBeenCalled();
});

test("Home Message gives signed-in members without a route a working Settings link", async () => {
  const rendered = await renderClientComponent(await MessageMurphContactAction(), {
    requireButton: false,
  });
  try {
    const link = rendered.container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/settings");
    expect(link?.getAttribute("aria-label")).toBe("Set up a way to message Murph");
    expect(rendered.container.querySelector("button")).toBeNull();
  } finally {
    await rendered.cleanup();
  }
});

test("Home Message still opens sign-in for guests without a route", async () => {
  mocks.authenticated = false;
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({ authenticated: false });
  const rendered = await renderClientComponent(await MessageMurphContactAction());
  try {
    expect(rendered.container.querySelector("a")).toBeNull();
    await act(async () => { rendered.button.click(); });
    expect(mocks.openAuthDialog).toHaveBeenCalledOnce();
  } finally {
    await rendered.cleanup();
  }
});
