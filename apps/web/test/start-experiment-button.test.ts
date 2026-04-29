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
  authButtonState: {
    authenticated: true,
    ready: true,
  },
  useUser: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  useUser: mocks.useUser,
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

    const isAuthenticated = mocks.authButtonState.ready && mocks.authButtonState.authenticated;
    const content = isAuthenticated || !connectLabel ? children : connectLabel;

    return createElement(
      "button",
      {
        ...buttonProps,
        "aria-busy": !mocks.authButtonState.ready,
        "data-slot": "auth-button",
        disabled: !mocks.authButtonState.ready,
        onClick(event: MouseEvent<HTMLButtonElement>) {
          if (!isAuthenticated) {
            event.preventDefault();
            return;
          }

          buttonProps.onClick?.(event);
        },
        type: "button",
      },
      content,
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
    mocks.authButtonState.authenticated = true;
    mocks.authButtonState.ready = true;
    mocks.useUser.mockReturnValue({
      user: {
        linkedAccounts: [],
      },
    });
  });

  afterEach(async () => {
    if (cleanupRender) {
      await cleanupRender();
      cleanupRender = null;
    }
  });

  it("opens a channel picker when multiple connected channels are available", async () => {
    mocks.useUser.mockReturnValue({
      user: {
        linkedAccounts: [
          {
            latest_verified_at: 1771977600,
            phone_number: "+14045550123",
            type: "phone",
          },
          {
            id: "tg_user_123",
            type: "telegram",
            username: "member_handle",
          },
          {
            address: "member@example.test",
            latest_verified_at: 1771977600,
            type: "email",
          },
        ],
      },
    });
    const { StartExperimentButton } = await import(
      "@/src/components/experiments/experiment-detail/start-experiment-button"
    );
    const { button, cleanup, container, window } = await renderClientComponent(
      createElement(StartExperimentButton, {
        murphPhoneNumber: "+15550100001",
        protocolDays: 14,
        protocolTitle: "Finnish Dry Sauna",
      }),
    );
    cleanupRender = cleanup;

    await act(async () => {
      button.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Start from your connected channel");
    expect(container.textContent).toContain("Text");
    expect(container.textContent).toContain("Telegram");
    expect(container.textContent).toContain("Email");

    const links = Array.from(container.querySelectorAll("a"))
      .map((anchor) => (anchor as HTMLAnchorElement).href);
    expect(links.some((href) => href.startsWith("sms:+15550100001?body="))).toBe(true);
    expect(links).toContain(MURPH_EXPERIMENT_TELEGRAM_URL);
    expect(links.some((href) => href.startsWith("mailto:murph@mail.withmurph.ai"))).toBe(true);

    const renderedContactSurface = [
      container.textContent ?? "",
      ...links,
    ].join("\n");
    expect(renderedContactSurface).not.toContain("+14045550123");
    expect(renderedContactSurface).not.toContain("member@example.test");
    expect(renderedContactSurface).not.toContain("tg_user_123");
    expect(renderedContactSurface).not.toContain("member_handle");
  });

  it("lets AuthButton gate unauthenticated clicks before contact routing runs", async () => {
    mocks.authButtonState.authenticated = false;
    mocks.useUser.mockReturnValue({
      user: {
        linkedAccounts: [
          {
            id: "tg_user_123",
            type: "telegram",
            username: "member_handle",
          },
        ],
      },
    });
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

    expect(container.textContent).toContain("Sign in to start");

    await act(async () => {
      button.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    expect(assign).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Start from your connected channel");
  });

  it("uses initial channel flags without needing raw linked accounts in props", async () => {
    mocks.useUser.mockReturnValue({
      user: null,
    });
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
    expect(container.textContent).toContain("Start from your connected channel");
    expect(container.textContent).not.toContain("member@example.test");
    expect(links).toEqual([
      MURPH_EXPERIMENT_TELEGRAM_URL,
      expect.stringMatching(/^mailto:murph@mail\.withmurph\.ai/u),
    ]);
  });

  it("inherits layout contact defaults when rendered without explicit channel props", async () => {
    mocks.useUser.mockReturnValue({
      user: null,
    });
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
    mocks.useUser.mockReturnValue({
      user: {
        linkedAccounts: [
          {
            id: "tg_user_123",
            type: "telegram",
            username: "member_handle",
          },
        ],
      },
    });
    const { StartExperimentButton } = await import(
      "@/src/components/experiments/experiment-detail/start-experiment-button"
    );
    const { assign, button, cleanup, container, open, window } = await renderClientComponent(
      createElement(StartExperimentButton, {
        protocolDays: 14,
        protocolTitle: "Norwegian 4x4",
      }),
    );
    cleanupRender = cleanup;

    await act(async () => {
      button.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    expect(open).toHaveBeenCalledWith(MURPH_EXPERIMENT_TELEGRAM_URL, "_blank", "noreferrer");
    expect(assign).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Start from your connected channel");
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

    expect(open).toHaveBeenCalledWith(MURPH_EXPERIMENT_TELEGRAM_URL, "_blank", "noreferrer");
    expect(assign).not.toHaveBeenCalled();
  });
});
