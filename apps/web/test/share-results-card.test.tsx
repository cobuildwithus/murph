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
