import assert from "node:assert/strict";

import {
  act,
  createElement,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, expect, test, vi } from "vitest";

import type { ExperimentCardData } from "@/src/lib/experiments/share-card";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/experiments/sleep-test",
}));

vi.mock("@/src/components/ui/button", () => ({
  Button: ({
    children,
    nativeButton: _nativeButton,
    size,
    variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    nativeButton?: boolean;
    size?: string;
    variant?: string;
  }) => {
    void _nativeButton;
    return createElement(
      "button",
      { ...props, "data-size": size, "data-variant": variant },
      children,
    );
  },
}));

vi.mock("@/src/components/ui/spinner", () => ({
  Spinner: () => createElement("span", { "data-spinner": true }),
}));

vi.mock("@/src/components/ui/dialog", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const DialogContext = React.createContext<{
    onOpenChange: (open: boolean) => void;
    open: boolean;
  }>({
    onOpenChange: () => {},
    open: false,
  });

  return {
    Dialog: ({
      children,
      onOpenChange = () => {},
      open = false,
    }: {
      children?: ReactNode;
      onOpenChange?: (open: boolean) => void;
      open?: boolean;
    }) =>
      createElement(
        DialogContext.Provider,
        { value: { onOpenChange, open } },
        children,
      ),
    DialogContent: ({
      children,
      className,
    }: HTMLAttributes<HTMLDivElement>) => {
      const context = React.useContext(DialogContext);
      return context.open
        ? createElement("div", { className, role: "dialog" }, children)
        : null;
    },
    DialogDescription: (props: HTMLAttributes<HTMLParagraphElement>) =>
      createElement("p", props),
    DialogHeader: (props: HTMLAttributes<HTMLDivElement>) =>
      createElement("div", props),
    DialogTitle: (props: HTMLAttributes<HTMLHeadingElement>) =>
      createElement("h2", props),
    DialogTrigger: ({
      children,
      render,
    }: {
      children?: ReactNode;
      render: ReactElement<{ onClick?: () => void }>;
    }) => {
      const context = React.useContext(DialogContext);
      return React.cloneElement(
        render,
        { onClick: () => context.onOpenChange(true) },
        children,
      );
    },
  };
});

const cardData: ExperimentCardData = {
  title: "Sleep test",
  signals: [
    {
      delta: "+4",
      direction: "up",
      label: "Sleep score",
      value: "82",
    },
  ],
};

async function waitForPreparedPreview(container: HTMLElement): Promise<void> {
  await act(async () => {
    await vi.waitFor(() => {
      expect(container.querySelector('[role="dialog"] img')).not.toBeNull();
    });
  });
}

function installNativeFileShare(input: {
  canShare: (data?: ShareData) => boolean;
  navigator: Navigator;
  share: (data?: ShareData) => Promise<void>;
}): void {
  for (const target of new Set([globalThis.navigator, input.navigator])) {
    Object.defineProperties(target, {
      canShare: { configurable: true, value: input.canShare },
      share: { configurable: true, value: input.share },
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockResolvedValue(
    new Response(new Blob(["png"], { type: "image/png" }), {
      headers: { "Content-Type": "image/png" },
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", mocks.fetch);
});

test("posts private card data only after the member opens the share dialog", async () => {
  const { ShareResultsCard } = await import(
    "@/src/components/experiments/experiment-detail/share-results-card"
  );
  const rendered = await renderClientComponent(
    createElement(ShareResultsCard, { cardData }),
  );

  try {
    expect(mocks.fetch).not.toHaveBeenCalled();

    await act(async () => {
      rendered.button.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const call = mocks.fetch.mock.calls[0];
    assert.ok(call);
    assert.equal(call[0], "/experiments/sleep-test/card");
    const { signal, ...requestOptions } = call[1] as RequestInit;
    assert.equal(signal?.aborted, false);
    assert.deepEqual(requestOptions, {
      body: JSON.stringify(cardData),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    assert.match(rendered.container.textContent ?? "", /Share your results/u);
  } finally {
    await rendered.cleanup();
  }
});

test("aborts an in-flight private card request when the experiment data changes", async () => {
  const { ShareResultsCard } = await import(
    "@/src/components/experiments/experiment-detail/share-results-card"
  );
  mocks.fetch.mockImplementationOnce(() => new Promise<Response>(() => {}));
  const rendered = await renderClientComponent(
    createElement(ShareResultsCard, { cardData }),
  );

  try {
    await act(async () => {
      rendered.button.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
      await Promise.resolve();
    });
    const pendingSignal =
      (mocks.fetch.mock.calls[0]?.[1] as RequestInit | undefined)?.signal ?? null;
    assert.ok(pendingSignal);
    expect(pendingSignal.aborted).toBe(false);

    await rendered.rerender(createElement(ShareResultsCard, {
      cardData: {
        ...cardData,
        title: "Updated sleep test",
      },
    }));

    expect(pendingSignal.aborted).toBe(true);
    expect(rendered.container.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  } finally {
    await rendered.cleanup();
  }
});

test("keeps native Share hidden when the prepared PNG is not file-shareable", async () => {
  const { ShareResultsCard } = await import(
    "@/src/components/experiments/experiment-detail/share-results-card"
  );
  const rendered = await renderClientComponent(
    createElement(ShareResultsCard, { cardData }),
  );
  const nativeShare = vi.fn();
  const canShare = vi.fn(() => false);
  installNativeFileShare({
    canShare,
    navigator: rendered.window.navigator,
    share: nativeShare,
  });

  try {
    await act(async () => {
      rendered.button.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
      await Promise.resolve();
    });
    await waitForPreparedPreview(rendered.container);

    const dialog = rendered.container.querySelector('[role="dialog"]');
    assert.ok(dialog);
    expect(Array.from(dialog.querySelectorAll("button")).map(
      (button) => button.textContent?.trim(),
    )).not.toContain("Share");
    expect(dialog.textContent).toMatch(/Download image/u);
    expect(dialog.querySelector('[role="status"]')?.textContent).toMatch(
      /Private preview ready.*Download is available/u,
    );
    expect(canShare).toHaveBeenCalledOnce();
    expect(nativeShare).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});

test("announces a private preview failure and recovers through retry", async () => {
  const { ShareResultsCard } = await import(
    "@/src/components/experiments/experiment-detail/share-results-card"
  );
  mocks.fetch.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
  const rendered = await renderClientComponent(
    createElement(ShareResultsCard, { cardData }),
  );
  installNativeFileShare({
    canShare: vi.fn(() => true),
    navigator: rendered.window.navigator,
    share: vi.fn(),
  });

  try {
    await act(async () => {
      rendered.button.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const dialog = rendered.container.querySelector('[role="dialog"]');
    assert.ok(dialog);
    expect(dialog.querySelector('[role="status"]')?.textContent).toMatch(
      /Preview unavailable/u,
    );
    expect(Array.from(dialog.querySelectorAll("button")).map(
      (button) => button.textContent?.trim(),
    )).not.toContain("Share");

    const retryButton = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Try again",
    );
    assert.ok(retryButton);
    await act(async () => {
      retryButton.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
      await Promise.resolve();
    });
    await waitForPreparedPreview(rendered.container);

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(dialog.querySelector('[role="status"]')?.textContent).toMatch(
      /Private preview ready.*Share and download actions are available/u,
    );
    expect(Array.from(dialog.querySelectorAll("button")).map(
      (button) => button.textContent?.trim(),
    )).toContain("Share");
  } finally {
    await rendered.cleanup();
  }
});

test("shows recovery when native file sharing fails for a non-dismissal error", async () => {
  const { ShareResultsCard } = await import(
    "@/src/components/experiments/experiment-detail/share-results-card"
  );
  const rendered = await renderClientComponent(
    createElement(ShareResultsCard, { cardData }),
  );
  const nativeShare = vi.fn().mockRejectedValue(new Error("share transport failed"));
  installNativeFileShare({
    canShare: vi.fn(() => true),
    navigator: rendered.window.navigator,
    share: nativeShare,
  });

  try {
    await act(async () => {
      rendered.button.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
      await Promise.resolve();
    });
    await waitForPreparedPreview(rendered.container);
    const dialog = rendered.container.querySelector('[role="dialog"]');
    assert.ok(dialog);
    const shareButton = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Share",
    );
    assert.ok(shareButton);

    await act(async () => {
      shareButton.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(nativeShare).toHaveBeenCalledOnce();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toMatch(
      /Sharing couldn't open/u,
    );
    expect(dialog.textContent).toMatch(/download the image/u);
  } finally {
    await rendered.cleanup();
  }
});

test("keeps native share dismissal quiet while download remains available", async () => {
  const { ShareResultsCard } = await import(
    "@/src/components/experiments/experiment-detail/share-results-card"
  );
  const rendered = await renderClientComponent(
    createElement(ShareResultsCard, { cardData }),
  );
  const nativeShare = vi.fn().mockRejectedValue(
    new DOMException("Share dismissed.", "AbortError"),
  );
  installNativeFileShare({
    canShare: vi.fn(() => true),
    navigator: rendered.window.navigator,
    share: nativeShare,
  });

  try {
    await act(async () => {
      rendered.button.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
      await Promise.resolve();
    });
    await waitForPreparedPreview(rendered.container);
    const dialog = rendered.container.querySelector('[role="dialog"]');
    assert.ok(dialog);
    const shareButton = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Share",
    );
    assert.ok(shareButton);

    await act(async () => {
      shareButton.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(nativeShare).toHaveBeenCalledOnce();
    expect(dialog.querySelector('[role="alert"]')).toBeNull();
    expect(dialog.textContent).toMatch(/Download image/u);
  } finally {
    await rendered.cleanup();
  }
});
