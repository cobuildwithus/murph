import {
  act,
  createElement,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ImgHTMLAttributes,
  type ReactNode,
} from "react";
import { afterEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  onOpenChange: undefined as ((open: boolean) => void) | undefined,
}));

vi.mock("next/image", () => ({
  default: (props: ImgHTMLAttributes<HTMLImageElement>) =>
    createElement("img", props),
}));

vi.mock("@/src/components/ui/button", () => ({
  Button: ({
    children,
    size,
    variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    children?: ReactNode;
    size?: string;
    variant?: string;
  }) => {
    void size;
    return createElement(
      "button",
      { ...props, "data-variant": variant },
      children,
    );
  },
  buttonVariants: () => "button-variant",
}));

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog: ({
    children,
    onOpenChange,
    open,
  }: {
    children?: ReactNode;
    onOpenChange?: (open: boolean) => void;
    open?: boolean;
  }) => {
    mocks.onOpenChange = onOpenChange;
    return open
      ? createElement("div", { "data-dialog": "open" }, children)
      : null;
  },
  DialogContent: ({
    children,
    showCloseButton,
    ...props
  }: HTMLAttributes<HTMLDivElement> & {
    children?: ReactNode;
    showCloseButton?: boolean;
  }) => {
    void showCloseButton;
    return createElement("div", props, children);
  },
  DialogFooter: (props: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props),
  DialogHeader: (props: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props),
}));

import {
  isMurphCardHash,
  MURPH_IOS_APP_STORE_URL,
  MurphCardHandoffGate,
} from "@/src/components/homepage/murph-card-handoff-dialog";

afterEach(() => {
  mocks.onOpenChange = undefined;
  vi.unstubAllGlobals();
});

test("recognizes only non-empty Murph card fragments", () => {
  expect(isMurphCardHash("#murph-card=opaque-envelope")).toBe(true);
  expect(isMurphCardHash("#murph-card=")).toBe(false);
  expect(isMurphCardHash("#other-card=opaque-envelope")).toBe(false);
  expect(isMurphCardHash("murph-card=opaque-envelope")).toBe(false);
});

test("opens the App Store handoff without exposing the opaque card value", async () => {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  const rendered = await renderClientComponent(
    createElement(MurphCardHandoffGate),
    {
      location: {
        hash: "#murph-card=opaque-test-envelope",
        href: "https://example.test/#murph-card=opaque-test-envelope",
        origin: "https://example.test",
        pathname: "/",
        search: "",
      },
      requireButton: false,
    },
  );

  try {
    expect(rendered.container.querySelector('[data-dialog="open"]')).not.toBeNull();
    expect(rendered.container.textContent).toContain("Continue on iPhone");
    expect(rendered.container.textContent).toContain(
      "Install or open Murph from the App Store. Then return to Messages and tap the card again.",
    );
    const title = rendered.container.querySelector(`#murph-card-handoff-title`);
    expect(title?.className).toContain("text-3xl/9");
    expect(title?.className).toContain("font-semibold");
    expect(rendered.container.textContent).not.toContain("Shared from Messages");
    expect(rendered.container.innerHTML).not.toContain("opaque-test-envelope");
    expect(fetchMock).not.toHaveBeenCalled();

    const appStoreLink = rendered.container.querySelector(
      `a[href="${MURPH_IOS_APP_STORE_URL}"]`,
    );
    expect(appStoreLink?.textContent).toContain("Open App Store");
    expect(appStoreLink?.getAttribute("aria-label")).toBe(
      "Open App Store (opens in a new tab)",
    );
    expect(appStoreLink?.getAttribute("target")).toBe("_blank");
    expect(appStoreLink?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(
      rendered.container.querySelector('button[aria-label="Close"]'),
    ).not.toBeNull();
    expect(rendered.container.querySelectorAll("button")).toHaveLength(2);

    const dismissButton = [...rendered.container.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Cancel");
    expect(dismissButton).not.toBeNull();
    expect(dismissButton?.getAttribute("data-variant")).toBe("ghost");
    await act(async () => {
      dismissButton?.click();
    });

    expect(rendered.container.querySelector('[data-dialog="open"]')).toBeNull();
    expect(rendered.window.location.hash).toBe(
      "#murph-card=opaque-test-envelope",
    );
  } finally {
    await rendered.cleanup();
  }
});

test("keeps ordinary homepage fragments quiet and follows later hash changes", async () => {
  const rendered = await renderClientComponent(
    createElement(MurphCardHandoffGate),
    {
      location: {
        hash: "#pricing",
        href: "https://example.test/#pricing",
        origin: "https://example.test",
        pathname: "/",
        search: "",
      },
      requireButton: false,
    },
  );

  try {
    expect(rendered.container.querySelector('[data-dialog="open"]')).toBeNull();

    rendered.window.location.hash = "#murph-card=later-envelope";
    await act(async () => {
      rendered.window.dispatchEvent(new rendered.window.Event("hashchange"));
    });
    expect(rendered.container.querySelector('[data-dialog="open"]')).not.toBeNull();

    rendered.window.location.hash = "#faq";
    await act(async () => {
      rendered.window.dispatchEvent(new rendered.window.Event("hashchange"));
    });
    expect(rendered.container.querySelector('[data-dialog="open"]')).toBeNull();
  } finally {
    await rendered.cleanup();
  }
});
