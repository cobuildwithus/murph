import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test } from "vitest";

import { ExpertCard } from "@/src/components/experiments/experiment-detail/expert-card";

const activeCleanups = new Set<() => Promise<void> | void>();
const requireFromExpertCardTest = createRequire(import.meta.url);
const { parseHTML } = loadLinkedom();

afterEach(async () => {
  for (const cleanup of [...activeCleanups].reverse()) {
    await cleanup();
  }
  activeCleanups.clear();
});

test("omits the secondary label when the expert field is empty", () => {
  const markup = renderToStaticMarkup(
    createElement(ExpertCard, {
      field: "",
      initials: "BJ",
      name: "Bryan Johnson",
      profileImageUrl: "/source-people/bryan-johnson/twitter-avatar.jpg",
      quote:
        "Founder of Blueprint and Don't Die. Trying to live forever.",
    }),
  );

  expect(markup).toContain("Bryan Johnson");
  expect(markup).not.toContain("Source Person");
  expect(markup).toContain('src="/source-people/bryan-johnson/twitter-avatar.jpg"');
  expect(markup).toContain(
    "Founder of Blueprint and Don&#x27;t Die. Trying to live forever.",
  );
  expect(markup).not.toContain("“");
  expect(markup).not.toContain("”");
});

test("falls back to initials when the profile image fails to load", async () => {
  const view = await renderExpertCard({
    field: "",
    initials: "BJ",
    name: "Bryan Johnson",
    profileImageUrl: "https://example.com/broken-avatar.jpg",
    quote: "Founder of Blueprint and Don't Die. Trying to live forever.",
  });

  const image = view.container.querySelector("img");
  assert.ok(image);

  await act(async () => {
    image.dispatchEvent(new view.window.Event("error"));
  });

  expect(view.container.querySelector("img")).toBeNull();
  expect(view.container.textContent).toContain("BJ");

  await view.cleanup();
});

async function renderExpertCard(input: {
  field: string;
  initials: string;
  name: string;
  profileImageUrl?: string;
  quote: string;
}) {
  const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
  const cleanupGlobals = installGlobals(window, document);
  activeCleanups.add(cleanupGlobals);
  const container = document.getElementById("root");
  assert.ok(container);

  let root: Root | null = createRoot(container);

  await act(async () => {
    root?.render(createElement(ExpertCard, input));
  });

  return {
    cleanup: async () => {
      await act(async () => {
        root?.unmount();
        root = null;
      });
      cleanupGlobals();
      activeCleanups.delete(cleanupGlobals);
    },
    container,
    window,
  };
}

function installGlobals(
  window: Window & typeof globalThis,
  document: Document,
) {
  const restoreEntries = [
    setGlobal("window", window),
    setGlobal("self", window),
    setGlobal("document", document),
    setGlobal("navigator", window.navigator),
    setGlobal("HTMLElement", window.HTMLElement),
    setGlobal("Node", window.Node),
    setGlobal("Event", window.Event),
    setGlobal("MutationObserver", window.MutationObserver),
    setGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }),
    setGlobal("cancelAnimationFrame", () => {}),
    setGlobal("IS_REACT_ACT_ENVIRONMENT", true),
  ];

  return () => {
    for (const restore of restoreEntries.reverse()) {
      restore();
    }
  };
}

function setGlobal(key: string, value: unknown) {
  const hadOwnProperty = Object.prototype.hasOwnProperty.call(globalThis, key);
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, key);

  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });

  return () => {
    if (hadOwnProperty) {
      assert.ok(previousDescriptor);
      Object.defineProperty(globalThis, key, previousDescriptor);
      return;
    }

    Reflect.deleteProperty(globalThis, key);
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
      const resolvedEntry = requireFromExpertCardTest.resolve("linkedom", {
        paths: [resolvePath],
      });
      return requireFromExpertCardTest(resolvedEntry) as {
        parseHTML: (html: string) => { document: Document; window: Window & typeof globalThis };
      };
    } catch {
      // Try the next resolution root.
    }
  }

  throw new Error("Unable to resolve linkedom for expert-card tests.");
}
