import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

import {
  act,
  startTransition,
  type ErrorInfo,
  type ReactElement,
} from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { vi } from "vitest";

const requireFromRenderClientComponentTest = createRequire(import.meta.url);

type RenderClientComponentResult<TButton extends HTMLButtonElement | null> = {
  assign: ReturnType<typeof vi.fn>;
  button: TButton;
  cleanup: () => Promise<void>;
  container: HTMLElement;
  open: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  replaceLocation: ReturnType<typeof vi.fn>;
  replaceState: ReturnType<typeof vi.fn>;
  rerender: (element: ReactElement) => Promise<void>;
  rerenderInTransition: (element: ReactElement) => Promise<void>;
  window: Window & typeof globalThis;
};

type RenderClientComponentOptions = {
  hydrateFrom?: {
    markup: string;
    onRecoverableError?: (error: unknown, errorInfo: ErrorInfo) => void;
    prepareDom?: (container: HTMLElement) => void;
  };
  historyState?: unknown;
  innerWidth?: number;
  location?: Record<string, string>;
  matchMedia?: typeof window.matchMedia;
  sessionStorage?: Storage;
  visibilityState?: DocumentVisibilityState;
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
    `<html><body><div id='root'>${options.hydrateFrom?.markup ?? ""}</div></body></html>`,
  );
  installGlobals(window, document);
  if (options.innerWidth !== undefined) {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: options.innerWidth,
    });
  }
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: options.visibilityState ?? "visible",
  });
  const assign = vi.fn();
  const open = vi.fn();
  const reload = vi.fn();
  const replaceLocation = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      assign,
      reload,
      replace: replaceLocation,
      ...(options.location ?? {}),
    },
  });
  const history = Object.create(window.history ?? null) as History;
  let currentHistoryState = options.historyState ?? history.state;
  Object.defineProperty(history, "state", {
    configurable: true,
    get: () => currentHistoryState,
  });
  const replaceState = vi.fn((
    state: unknown,
    title: string,
    url?: string | URL | null,
  ) => {
    void title;
    currentHistoryState = state;
    if (url === undefined || url === null) {
      return;
    }
    const nextUrl = new URL(url.toString(), window.location.href);
    Object.assign(window.location, {
      hash: nextUrl.hash,
      href: nextUrl.toString(),
      origin: nextUrl.origin,
      pathname: nextUrl.pathname,
      search: nextUrl.search,
    });
  });
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
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: options.sessionStorage ?? createMemoryStorage(),
  });
  if (options.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: options.matchMedia,
    });
  }

  const container = document.getElementById("root");
  assert.ok(container);
  options.hydrateFrom?.prepareDom?.(container);
  let root: Root | undefined;

  await act(async () => {
    if (options.hydrateFrom) {
      root = hydrateRoot(container, element, {
        onRecoverableError: options.hydrateFrom.onRecoverableError,
      });
    } else {
      root = createRoot(container);
      root.render(element);
    }
  });
  assert.ok(root);
  const renderedRoot = root;

  const button = container.querySelector("button");
  if (options.requireButton !== false) {
    assert.ok(button instanceof window.HTMLButtonElement);
  }

  return {
    assign,
    button: button instanceof window.HTMLButtonElement ? button : null,
    cleanup: async () => {
      await act(async () => {
        renderedRoot.unmount();
      });
    },
    container,
    open,
    reload,
    replaceLocation,
    replaceState,
    rerender: async (nextElement: ReactElement) => {
      await act(async () => {
        renderedRoot.render(nextElement);
      });
    },
    rerenderInTransition: async (nextElement: ReactElement) => {
      const previousActEnvironment: unknown = Reflect.get(
        globalThis,
        "IS_REACT_ACT_ENVIRONMENT",
      );
      Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
      try {
        startTransition(() => {
          renderedRoot.render(nextElement);
        });
        await new Promise((resolve) => setTimeout(resolve, 25));
      } finally {
        Reflect.set(
          globalThis,
          "IS_REACT_ACT_ENVIRONMENT",
          previousActEnvironment,
        );
      }
    },
    window,
  };
}

export function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    get length() {
      return values.size;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
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
  class PointerEventMock extends window.Event {}

  vi.stubGlobal("window", window);
  // next/link schedules prefetching through `self`, so mounting a Link in a
  // client test needs it defined alongside `window`.
  vi.stubGlobal("self", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("Element", window.Element);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Node", window.Node);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("MouseEvent", window.MouseEvent);
  vi.stubGlobal("PointerEvent", PointerEventMock);
  vi.stubGlobal("MutationObserver", window.MutationObserver);
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
}
