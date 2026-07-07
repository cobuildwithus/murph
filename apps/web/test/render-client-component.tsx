import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";

const requireFromRenderClientComponentTest = createRequire(import.meta.url);

type RenderClientComponentResult<TButton extends HTMLButtonElement | null> = {
  assign: ReturnType<typeof vi.fn>;
  button: TButton;
  cleanup: () => Promise<void>;
  container: HTMLElement;
  open: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  replaceState: ReturnType<typeof vi.fn>;
  window: Window & typeof globalThis;
};

type RenderClientComponentOptions = {
  location?: Record<string, string>;
};

export async function renderClientComponent(
  element: ReactElement,
): Promise<RenderClientComponentResult<HTMLButtonElement>>;
export async function renderClientComponent(
  element: ReactElement,
  options: RenderClientComponentOptions & { requireButton?: true },
): Promise<RenderClientComponentResult<HTMLButtonElement>>;
export async function renderClientComponent(
  element: ReactElement,
  options: RenderClientComponentOptions & { requireButton: false },
): Promise<RenderClientComponentResult<HTMLButtonElement | null>>;
export async function renderClientComponent(
  element: ReactElement,
  options: RenderClientComponentOptions & { requireButton?: boolean } = {},
): Promise<RenderClientComponentResult<HTMLButtonElement | null>> {
  const { document, window } = loadLinkedom().parseHTML(
    "<html><body><div id='root'></div></body></html>",
  );
  installGlobals(window, document);
  const assign = vi.fn();
  const open = vi.fn();
  const reload = vi.fn();
  const replaceState = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      assign,
      reload,
      ...(options.location ?? {}),
    },
  });
  const history = Object.create(window.history ?? null) as History;
  Object.defineProperty(history, "replaceState", {
    configurable: true,
    value: replaceState,
  });
  Object.defineProperty(window, "history", {
    configurable: true,
    value: history,
  });
  Object.defineProperty(window, "open", {
    configurable: true,
    value: open,
  });

  const container = document.getElementById("root");
  assert.ok(container);
  const root: Root = createRoot(container);

  await act(async () => {
    root.render(element);
  });

  const button = container.querySelector("button");
  if (options.requireButton !== false) {
    assert.ok(button instanceof window.HTMLButtonElement);
  }

  return {
    assign,
    button: button instanceof window.HTMLButtonElement ? button : null,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
    },
    container,
    open,
    reload,
    replaceState,
    window,
  };
}

function loadLinkedom(): {
  parseHTML: (html: string) => { document: Document; window: Window & typeof globalThis };
} {
  const resolvePaths = [
    path.resolve(process.cwd(), "node_modules"),
    path.resolve(process.cwd(), "node_modules/.pnpm/node_modules"),
  ];

  for (const resolvePath of resolvePaths) {
    try {
      const resolvedEntry = requireFromRenderClientComponentTest.resolve("linkedom", {
        paths: [resolvePath],
      });
      return requireFromRenderClientComponentTest(resolvedEntry) as {
        parseHTML: (html: string) => { document: Document; window: Window & typeof globalThis };
      };
    } catch {
      // Try the next resolution root.
    }
  }

  throw new Error("Unable to resolve linkedom for client component tests.");
}

function installGlobals(
  window: Window & typeof globalThis,
  document: Document,
) {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Node", window.Node);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("MouseEvent", window.MouseEvent);
  vi.stubGlobal("MutationObserver", window.MutationObserver);
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
}
