import { act, createElement, type AnchorHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

import { DeviceSyncCompletionDialog } from "../app/(dashboard)/home/device-sync-completion-dialog";
import type { DeviceSyncCompletionDialogModel } from "@/src/lib/device-sync/connect-completion-types";

const mocks = vi.hoisted(() => ({
  routerRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mocks.routerRefresh,
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children?: ReactNode;
    href: string;
  }) => createElement("a", { href, ...props }, children),
}));

vi.mock("@/src/components/ui/button", () => ({
  Button: ({
    children,
    className,
    size,
    variant,
    ...props
  }: HTMLAttributes<HTMLButtonElement> & {
    children?: ReactNode;
    size?: string;
    variant?: string;
  }) => {
    void size;
    return createElement("button", {
      ...props,
      className: [className, variant ? `variant-${variant}` : null]
        .filter(Boolean)
        .join(" "),
    }, children);
  },
  buttonVariants: ({
    className,
    variant,
  }: {
    className?: string;
    variant?: string;
  } = {}) => [className, variant ? `variant-${variant}` : null].filter(Boolean).join(" "),
}));

vi.mock("@/src/components/ui/dialog", () => {
  let activeOnOpenChange: ((open: boolean) => void) | undefined;

  return {
    Dialog: ({
      children,
      onOpenChange,
      open,
    }: {
      children?: ReactNode;
      onOpenChange?: (open: boolean) => void;
      open?: boolean;
    }) => {
      if (!open) {
        return null;
      }
      activeOnOpenChange = onOpenChange;
      return createElement("div", { "data-dialog": "open" }, children);
    },
    DialogContent: (
      props: HTMLAttributes<HTMLDivElement> & {
        children?: ReactNode;
        showCloseButton?: boolean;
      },
    ) => {
      const { children, showCloseButton, ...rest } = props;
      return createElement(
        "div",
        rest,
        children,
        showCloseButton
          ? createElement(
              "button",
              {
                "aria-label": "Close",
                onClick: () => activeOnOpenChange?.(false),
                type: "button",
              },
              "Close",
            )
          : null,
      );
    },
    DialogDescription: ({
      children,
      ...props
    }: HTMLAttributes<HTMLParagraphElement> & { children?: ReactNode }) =>
      createElement("p", props, children),
    DialogHeader: ({
      children,
      ...props
    }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) =>
      createElement("div", props, children),
    DialogTitle: ({
      children,
      ...props
    }: HTMLAttributes<HTMLHeadingElement> & { children?: ReactNode }) =>
      createElement("h2", props, children),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

test("DeviceSyncCompletionDialog refreshes an unverified completion once before stripping params", async () => {
  // Vitest gives this file its own module graph, so the dialog module's
  // retry guard starts fresh here and is shared across the remount below.
  const unverifiedModel = buildCompletionDialogModel({ unverified: true });
  const firstRender = await renderDeviceSyncCompletionDialog(unverifiedModel);
  await act(async () => {});

  expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  expect(firstRender.replaceState).not.toHaveBeenCalled();

  await firstRender.cleanup();

  const remount = await renderDeviceSyncCompletionDialog(unverifiedModel);
  await act(async () => {});

  expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  expect(remount.replaceState).toHaveBeenCalledWith(
    {},
    "",
    "/home?keep=1#source",
  );

  await remount.cleanup();
});

test("DeviceSyncCompletionDialog refreshes plain Home after the result closes", async () => {
  const render = await renderDeviceSyncCompletionDialog(
    buildCompletionDialogModel(),
  );
  await act(async () => {});

  expect(render.replaceState).toHaveBeenCalledWith(
    {},
    "",
    "/home?keep=1#source",
  );
  expect(mocks.routerRefresh).not.toHaveBeenCalled();
  const continueButton = [...render.container.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === "Continue exploring");
  expect(continueButton).not.toBeNull();

  await act(async () => {
    continueButton?.dispatchEvent(new render.window.Event("click", {
      bubbles: true,
    }));
  });

  expect(render.container.querySelector('[data-dialog="open"]')).toBeNull();
  expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  await render.cleanup();
});

test("DeviceSyncCompletionDialog opens the WHOOP setup guide from the summary view", async () => {
  const model = buildCompletionDialogModel({
    contactAction: {
      ariaLabel: "Text Murph in Telegram",
      href: "https://t.me/example_bot?text=whoop",
      kind: "telegram",
      label: "Text Murph",
      rel: "noopener noreferrer",
      target: "_blank",
    },
    detail:
      "Heads up: WHOOP doesn't share all of your data automatically. Syncing through Apple Health gives Murph the complete picture.",
    setupGuide: {
      actionAriaLabel: "See how to sync all of your WHOOP data",
      actionLabel: "Get full sync",
      detail: "Two quick steps and Murph sees everything WHOOP tracks.",
      downloadAction: {
        ariaLabel: "Download App to sync WHOOP through Apple Health",
        href: "https://apps.apple.com/us/app/murph-ai/id6786145859",
        label: "Download App",
        rel: "noopener noreferrer",
        target: "_blank",
      },
      steps: [
        {
          detail: "Get the Murph app on your iPhone and connect Apple Health when it asks.",
          title: "Download Murph and sign in",
        },
        {
          detail:
            "In WHOOP, go to More, App Settings, Integrations, then Apple Health. Turn on all categories and tap Allow.",
          title: "Turn on Apple Health in WHOOP",
        },
      ],
      title: "Get your full sync",
      voiceMemoSrc: "/audio/whoop-sync-memos/grandpa.mp3",
    },
    title: "WHOOP is connected",
  });
  const render = await renderDeviceSyncCompletionDialog(model);
  await act(async () => {});

  expect(render.container.innerHTML).toContain("Get full sync");
  expect(render.container.innerHTML).not.toContain("Download Murph and sign in");
  expect(render.container.innerHTML).not.toContain("apps.apple.com");
  expect(render.container.querySelector("audio")).toBeNull();

  const guideButton = render.container.querySelector(
    'button[aria-label="See how to sync all of your WHOOP data"]',
  );
  expect(guideButton).not.toBeNull();
  await act(async () => {
    guideButton?.dispatchEvent(new render.window.Event("click", { bubbles: true }));
  });

  expect(render.container.innerHTML).toContain("Get your full sync");
  expect(render.container.innerHTML).toContain("Download Murph and sign in");
  expect(render.container.innerHTML).toContain("Turn on Apple Health in WHOOP");
  const setupDialogContent = render.container.querySelector('[data-dialog="open"] > div');
  expect(setupDialogContent?.classList.contains("max-h-[calc(100dvh-2rem)]")).toBe(true);
  expect(setupDialogContent?.classList.contains("max-w-[calc(100%-2rem)]")).toBe(true);
  expect(setupDialogContent?.classList.contains("overflow-y-auto")).toBe(true);
  expect(setupDialogContent?.classList.contains("sm:max-w-md")).toBe(true);
  expect(render.container.innerHTML).toContain(
    "https://apps.apple.com/us/app/murph-ai/id6786145859",
  );
  const downloadLink = render.container.querySelector(
    'a[href="https://apps.apple.com/us/app/murph-ai/id6786145859"]',
  );
  expect(downloadLink?.textContent).toContain("Download App");
  expect(downloadLink?.getAttribute("aria-label")?.startsWith("Download App")).toBe(true);
  expect(render.container.textContent).toContain("Download App");
  const continueLink = render.container.querySelector(
    'a[aria-label="Continue with Murph in Telegram (opens in a new tab)"]',
  );
  expect(continueLink).not.toBeNull();
  expect(continueLink?.classList.contains("variant-outline")).toBe(true);
  expect(continueLink?.getAttribute("href")).toBe(
    "https://t.me/example_bot?text=whoop",
  );
  expect(continueLink?.getAttribute("rel")).toBe("noopener noreferrer");
  expect(continueLink?.getAttribute("target")).toBe("_blank");
  expect(continueLink?.textContent).toContain("Continue with Murph");
  expect(render.container.innerHTML).not.toContain("Continue exploring");
  expect(
    render.container.querySelector("audio[src='/audio/whoop-sync-memos/grandpa.mp3']"),
  ).not.toBeNull();
  expect(
    render.container.querySelector("button[aria-label='Play voice memo']"),
  ).not.toBeNull();

  continueLink?.addEventListener("click", (event) => event.preventDefault());
  await act(async () => {
    continueLink?.dispatchEvent(new render.window.Event("click", {
      bubbles: true,
      cancelable: true,
    }));
  });
  expect(render.container.querySelector('[data-dialog="open"]')).toBeNull();

  await render.cleanup();

  const messagesRender = await renderDeviceSyncCompletionDialog({
    ...model,
    contactAction: {
      href: "sms:+15550100002?body=I%20just%20connected%20my%20WHOOP",
      kind: "imessage",
      label: "Text Murph",
    },
  });
  await act(async () => {});
  const messagesGuideButton = messagesRender.container.querySelector(
    'button[aria-label="See how to sync all of your WHOOP data"]',
  );
  await act(async () => {
    messagesGuideButton?.dispatchEvent(
      new messagesRender.window.Event("click", { bubbles: true }),
    );
  });
  const messagesLink = messagesRender.container.querySelector(
    'a[aria-label="Continue with Murph in Messages"]',
  );
  expect(messagesLink).not.toBeNull();
  expect(messagesLink?.classList.contains("variant-outline")).toBe(true);
  expect(messagesLink?.getAttribute("href")).toBe(
    "sms:+15550100002?body=I%20just%20connected%20my%20WHOOP",
  );
  expect(messagesLink?.getAttribute("rel")).toBeNull();
  expect(messagesLink?.getAttribute("target")).toBeNull();
  messagesLink?.addEventListener("click", (event) => event.preventDefault());
  await act(async () => {
    messagesLink?.dispatchEvent(new messagesRender.window.Event("click", {
      bubbles: true,
      cancelable: true,
    }));
  });
  expect(messagesRender.container.querySelector('[data-dialog="open"]')).toBeNull();
  await messagesRender.cleanup();

  const noContactRender = await renderDeviceSyncCompletionDialog({
    ...model,
    contactAction: null,
  });
  await act(async () => {});
  const noContactGuideButton = noContactRender.container.querySelector(
    'button[aria-label="See how to sync all of your WHOOP data"]',
  );
  await act(async () => {
    noContactGuideButton?.dispatchEvent(
      new noContactRender.window.Event("click", { bubbles: true }),
    );
  });
  const noContactButton = noContactRender.container.querySelector(
    "button.variant-outline",
  );
  expect(noContactButton).toBeNull();
  expect(
    noContactRender.container.querySelector('a[aria-label^="Continue with Murph in"]'),
  ).toBeNull();
  const noContactCloseButton = noContactRender.container.querySelector(
    'button[aria-label="Close"]',
  );
  expect(noContactCloseButton).not.toBeNull();
  await act(async () => {
    noContactCloseButton?.dispatchEvent(
      new noContactRender.window.Event("click", { bubbles: true }),
    );
  });
  expect(noContactRender.container.querySelector('[data-dialog="open"]')).toBeNull();
  await noContactRender.cleanup();
});

function buildCompletionDialogModel(
  overrides: Partial<DeviceSyncCompletionDialogModel> = {},
): DeviceSyncCompletionDialogModel {
  return {
    contactAction: null,
    detail: "Open Murph to confirm your connected sources.",
    failed: false,
    kind: "device-sync",
    retryHref: null,
    title: "Device connection complete",
    unverified: false,
    ...overrides,
  };
}

async function renderDeviceSyncCompletionDialog(
  model: DeviceSyncCompletionDialogModel,
) {
  return renderClientComponent(
    createElement(DeviceSyncCompletionDialog, { model }),
    {
      location: {
        hash: "#source",
        href: "https://app.example.test/home?deviceSyncCompletion=1&deviceSyncStatus=connected&deviceSyncProvider=whoop&keep=1#source",
        pathname: "/home",
        search: "?deviceSyncCompletion=1&deviceSyncStatus=connected&deviceSyncProvider=whoop&keep=1",
      },
    },
  );
}
