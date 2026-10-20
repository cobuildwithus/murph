import { act } from "react";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { renderClientComponent } from "./render-client-component";

// Only the Next router is supplied by the test. No study, auth, credential,
// Telegram, settings, code-form or input component is replaced.
const router = vi.hoisted(() => ({ refresh: vi.fn(), useRouter: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: router.useRouter.mockImplementation(() => ({ refresh: router.refresh })),
}));

test("the real auth study hydrates all previews without mounting credential controllers or contacting APIs/providers", async () => {
  // Base UI must be imported after the harness installs its DOM globals.
  const bootstrap = await renderClientComponent(<div />, { requireButton: false });
  const { BetterAuthAdoptionStudy } = await import("../app/design/better-auth-adoption-study");
  await bootstrap.cleanup();

  const requests: string[] = [];
  const scripts: string[] = [];
  const blockedFetch = vi.fn<typeof fetch>(async (input, init) => {
    requests.push(`${init?.method ?? "GET"} ${typeof input === "string" ? input : input instanceof URL ? input.href : input.url}`);
    throw new Error("Network is forbidden in a presentation study");
  });
  vi.stubGlobal("fetch", blockedFetch);
  router.useRouter.mockClear();
  const onRecoverableError = vi.fn();
  const rendered = await renderClientComponent(<BetterAuthAdoptionStudy />, {
    requireButton: false,
    innerWidth: 1024,
    matchMedia: (query) => ({
      matches: false, media: query, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    }),
    hydrateFrom: {
      markup: renderToString(<BetterAuthAdoptionStudy />),
      onRecoverableError,
      prepareDom(container) {
        const doc = container.ownerDocument;
        // Observe and block external SDK insertion before effects can run.
        const appendChild = doc.head.appendChild.bind(doc.head);
        vi.spyOn(doc.head, "appendChild").mockImplementation(<T extends Node>(node: T): T => {
          if (node instanceof Element && node.tagName === "SCRIPT") {
            scripts.push(node.getAttribute("src") ?? "");
            node.dispatchEvent(new Event("error"));
            return node;
          }
          return appendChild(node);
        });
        // Linkedom keeps JSX attribute casing; browsers lowercase it. Match the
        // existing input-otp hydration test while leaving the real input intact.
        for (const input of container.querySelectorAll("input")) {
          for (const attribute of [...input.attributes]) {
            const name = attribute.name.toLowerCase();
            if (name !== attribute.name) {
              input.removeAttribute(attribute.name);
              input.setAttribute(name, attribute.value);
            }
          }
          const getAttribute = input.getAttribute.bind(input);
          const hasAttribute = input.hasAttribute.bind(input);
          input.getAttribute = (name) => getAttribute(name) ?? getAttribute(name.toLowerCase());
          input.hasAttribute = (name) => hasAttribute(name) || hasAttribute(name.toLowerCase());
        }
      },
    },
  });
  try {
    // Flush async mount continuations, not just server markup or the first paint.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 75)); });
    expect(requests).toEqual([]);
    expect(scripts).toEqual([]);
    const study = rendered.container.querySelector("#better-auth-adoption");
    expect(study?.hasAttribute("inert")).toBe(true);
    for (const state of ["phone", "email", "connections", "unconnected", "compact-code", "signing-in", "initial-passkey", "messaging", "code-email", "recovery"]) {
      expect(study?.querySelector(`[data-auth-study="${state}"]`), state).not.toBeNull();
    }
    expect(study?.querySelector('[data-auth-study="phone"] input[type="tel"]')).not.toBeNull();
    expect(study?.querySelector('[data-auth-study="email"] input[type="email"]')).not.toBeNull();
    for (const state of ["phone", "email"]) {
      const panel = study!.querySelector(`[data-auth-study="${state}"]`)!;
      expect([...panel.querySelectorAll("button")].some((button) => button.textContent === "Telegram")).toBe(true);
      expect(panel.textContent).toContain("By continuing, you agree");
    }
    expect(study?.querySelector('[data-auth-study="messaging"] input[type="tel"]')).not.toBeNull();
    expect(study?.querySelector('[data-auth-study="messaging"]')?.textContent).toContain("Connect Telegram");
    expect(study?.querySelector('[data-auth-study="recovery"]')?.textContent).toContain("Recovery key");
    expect(rendered.container.querySelector('[role="dialog"]')).toBeNull();
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(rendered.container.ownerDocument.querySelector("script[src]")).toBeNull();
    expect(blockedFetch).not.toHaveBeenCalled();
    // Both real credential editors call useRouter on mount, even before fetch
    // settles. Closed synthetic settings must not reach those controllers.
    expect(router.useRouter).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
});
