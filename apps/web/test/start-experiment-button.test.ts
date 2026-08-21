import {
  act,
  createContext,
  createElement,
  useContext,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MURPH_EXPERIMENT_TELEGRAM_URL } from "@/src/lib/experiments/start-experiment-contact";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  authButtonClicksEnabled: true,
}));

vi.mock("@/src/components/ui/auth-button", () => ({
  AuthButton(props: ButtonHTMLAttributes<HTMLButtonElement> & {
    connectLabel?: ReactNode;
    size?: unknown;
    variant?: unknown;
  }) {
    const { children, connectLabel, size, variant, ...buttonProps } = props;
    void connectLabel;
    void size;
    void variant;

    return createElement(
      "button",
      {
        ...buttonProps,
        "data-slot": "auth-button",
        disabled: !mocks.authButtonClicksEnabled,
        onClick(event: MouseEvent<HTMLButtonElement>) {
          if (!mocks.authButtonClicksEnabled) {
            event.preventDefault();
            return;
          }

          buttonProps.onClick?.(event);
        },
        type: "button",
      },
      children ?? connectLabel,
    );
  },
}));

const DialogOpenContext = createContext(false);

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog(props: { children: ReactNode; open?: boolean }) {
    return createElement(
      DialogOpenContext.Provider,
      { value: Boolean(props.open) },
      props.children,
    );
  },
  DialogContent(props: HTMLAttributes<HTMLDivElement>) {
    const open = useContext(DialogOpenContext);
    return open
      ? createElement("div", { ...props, "data-dialog-content": "shown" })
      : null;
  },
  DialogDescription(props: HTMLAttributes<HTMLParagraphElement>) {
    return createElement("p", props);
  },
  DialogHeader(props: HTMLAttributes<HTMLDivElement>) {
    return createElement("div", props);
  },
  DialogTitle(props: HTMLAttributes<HTMLHeadingElement>) {
    return createElement("h2", props);
  },
}));

let cleanupRender: (() => Promise<void>) | null = null;

describe("StartExperimentButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authButtonClicksEnabled = true;
  });

  afterEach(async () => {
    if (cleanupRender) {
      await cleanupRender();
      cleanupRender = null;
    }
  });

  it("opens a channel picker when multiple connected channels are available", async () => {
    const { StartExperimentButton } = await import(
      "@/src/components/experiments/experiment-detail/start-experiment-button"
    );
    const { button, cleanup, container, window } = await renderClientComponent(
      createElement(StartExperimentButton, {
        initialContactChannels: {
          email: true,
          telegram: true,
          text: true,
        },
        murphEmailAddress: "assistant+private@mail.example.test",
        murphPhoneNumber: "+15550100001",
        protocolDays: 14,
        protocolTitle: "Finnish Dry Sauna",
      }),
    );
    cleanupRender = cleanup;

    await act(async () => {
      button.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Choose an app");
    expect(container.textContent).toContain("Review the message, then send when you're ready.");
    expect(container.textContent).toContain("Finnish Dry Sauna");
    expect(container.textContent).toContain("Messages");
    expect(container.textContent).toContain("Telegram");
    expect(container.textContent).toContain("Email");

    const anchors = Array.from(container.querySelectorAll("a"));
    const links = anchors.map((anchor) => (anchor as HTMLAnchorElement).href);
    const emailHref = links.find((href) =>
      href.startsWith("mailto:assistant+private@mail.example.test"),
    ) ?? "";
    expect(links.some((href) => href.startsWith("sms:+15550100001?body="))).toBe(true);
    expect(links.some((href) => href.startsWith(`${MURPH_EXPERIMENT_TELEGRAM_URL}?text=`))).toBe(true);
    expect(links.some((href) =>
      href.startsWith("mailto:assistant+private@mail.example.test"),
    )).toBe(true);
    expect(decodeURIComponent(emailHref)).toContain(
      "I want to start the Finnish Dry Sauna experiment.",
    );
    expect(decodeURIComponent(emailHref)).not.toContain(
      "Please send me a private Murph reply.",
    );
    expect(decodeURIComponent(decodeURIComponent(links.join("\n"))))
      .toContain("I want to start the Finnish Dry Sauna experiment.");
    expect(links.join("\n")).not.toContain("sha256");
    const telegramAnchor = anchors.find((anchor) =>
      anchor.textContent?.includes("Telegram"),
    );
    expect(telegramAnchor?.getAttribute("target")).toBe("_blank");
    expect(telegramAnchor?.getAttribute("rel")).toBe("noreferrer");

    for (const anchor of anchors) {
      expect(anchor.className).toContain("focus-visible:border-ring");
      expect(anchor.className).toContain("focus-visible:ring-ring");
      expect(anchor.className).toContain("focus-visible:ring-offset-popover");
    }

    const renderedContactSurface = [
      container.textContent ?? "",
      ...links,
    ].join("\n");
    expect(renderedContactSurface).not.toContain("+14045550123");
    expect(renderedContactSurface).not.toContain("member@example.test");
    expect(renderedContactSurface).not.toContain("tg_user_123");
    expect(renderedContactSurface).not.toContain("member_handle");
  });

  it("keeps a synthetic Telegram fragment in the current document", async () => {
    const { StartExperimentChannelDialog } = await import(
      "@/src/components/experiments/experiment-detail/start-experiment-button"
    );
    const { cleanup, container } = await renderClientComponent(
      createElement(StartExperimentChannelDialog, {
        onOpenChange: vi.fn(),
        open: true,
        options: [
          {
            connected: true,
            description: "Preview a prepared Telegram draft.",
            href: "#experiment-start-channel-picker-study",
            kind: "telegram",
            label: "Telegram",
          },
        ],
        protocolDays: 14,
        protocolTitle: "Example Evening Routine",
      }),
      { requireButton: false },
    );
    cleanupRender = cleanup;

    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe(
      "#experiment-start-channel-picker-study",
    );
    expect(anchor?.hasAttribute("target")).toBe(false);
    expect(anchor?.hasAttribute("rel")).toBe(false);
  });

  it("does not run contact routing while the rendered button is disabled", async () => {
    mocks.authButtonClicksEnabled = false;
    const { StartExperimentButton } = await import(
      "@/src/components/experiments/experiment-detail/start-experiment-button"
    );
    const { assign, button, cleanup, container, window } = await renderClientComponent(
      createElement(StartExperimentButton, {
        protocolDays: 14,
        protocolTitle: "Norwegian 4x4",
      }),
    );
    cleanupRender = cleanup;

    expect(container.textContent).toContain("Start Experiment");
    expect(button.disabled).toBe(true);

    await act(async () => {
      button.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    expect(assign).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Choose an app");
  });

  it("uses initial channel flags without needing raw linked accounts in props", async () => {
    const { StartExperimentButton } = await import(
      "@/src/components/experiments/experiment-detail/start-experiment-button"
    );
    const { button, cleanup, container, window } = await renderClientComponent(
      createElement(StartExperimentButton, {
        initialContactChannels: {
          email: true,
          telegram: true,
          text: false,
        },
        protocolDays: 14,
        protocolTitle: "Finnish Dry Sauna",
      }),
    );
    cleanupRender = cleanup;

    await act(async () => {
      button.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    const links = Array.from(container.querySelectorAll("a"))
      .map((anchor) => (anchor as HTMLAnchorElement).href);
    expect(container.textContent).toContain("Choose an app");
    expect(container.textContent).not.toContain("member@example.test");
    expect(links).toEqual([
      expect.stringContaining(`${MURPH_EXPERIMENT_TELEGRAM_URL}?text=`),
      expect.stringMatching(/^mailto:mail@mail\.withmurph\.ai/u),
    ]);
    const emailHref = links.find((href) => href.startsWith("mailto:")) ?? "";
    expect(decodeURIComponent(emailHref)).toContain(
      "Please send me a private Murph reply.",
    );
    expect(decodeURIComponent(emailHref)).not.toContain(
      "I want to start the Finnish Dry Sauna experiment.",
    );
  });

  it("inherits layout contact defaults when rendered without explicit channel props", async () => {
    const { StartExperimentButton } = await import(
      "@/src/components/experiments/experiment-detail/start-experiment-button"
    );
    const { ExperimentStartContactProvider } = await import(
      "@/src/components/experiments/experiment-detail/start-experiment-contact-context"
    );
    const { assign, button, cleanup, window } = await renderClientComponent(
      createElement(
        ExperimentStartContactProvider,
        {
          initialContactChannels: {
            email: false,
            telegram: false,
            text: true,
          },
          murphPhoneNumber: "+15550100001",
        },
        createElement(StartExperimentButton, {
          protocolDays: 14,
          protocolTitle: "Finnish Dry Sauna",
        }),
      ),
    );
    cleanupRender = cleanup;

    await act(async () => {
      button.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    expect(assign).toHaveBeenCalledWith(expect.stringMatching(/^sms:\+15550100001\?body=/u));
  });

  it("opens a single connected Telegram channel directly", async () => {
    const { StartExperimentButton } = await import(
      "@/src/components/experiments/experiment-detail/start-experiment-button"
    );
    const { assign, button, cleanup, container, open, window } = await renderClientComponent(
      createElement(StartExperimentButton, {
        initialContactChannels: {
          telegram: true,
        },
        protocolDays: 14,
        protocolTitle: "Norwegian 4x4",
      }),
    );
    cleanupRender = cleanup;

    await act(async () => {
      button.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    expect(open).toHaveBeenCalledWith(
      expect.stringContaining(`${MURPH_EXPERIMENT_TELEGRAM_URL}?text=`),
      "_blank",
      "noreferrer",
    );
    expect(assign).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Choose an app");
  });

  it("falls back to Telegram when no connected channel is available", async () => {
    const { StartExperimentButton } = await import(
      "@/src/components/experiments/experiment-detail/start-experiment-button"
    );
    const { assign, button, cleanup, open, window } = await renderClientComponent(
      createElement(StartExperimentButton, {
        protocolDays: 14,
        protocolTitle: "Red Light Glasses Before Bed",
      }),
    );
    cleanupRender = cleanup;

    await act(async () => {
      button.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    expect(open).toHaveBeenCalledWith(
      expect.stringContaining(`${MURPH_EXPERIMENT_TELEGRAM_URL}?text=`),
      "_blank",
      "noreferrer",
    );
    expect(assign).not.toHaveBeenCalled();
  });
});
