import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";

import {
  act,
  createElement,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

import {
  DEFAULT_MURPH_CONTACT_AVATAR_ID,
  findMurphContactAvatarOption,
  MURPH_CONTACT_AVATAR_OPTIONS,
  MurphContactAvatarArt,
  MurphContactAvatarGrid,
  MurphAddToContactsButton,
  MurphContactCardPreview,
  MurphContactCardPicker,
} from "@/src/components/murph/murph-contact-card-picker";

import { renderClientComponent } from "./render-client-component";

vi.mock("@/src/components/ui/drawer", () => ({
  Drawer: ({
    children,
    onOpenChange,
    open,
  }: {
    children?: ReactNode;
    onOpenChange?: (open: boolean) => void;
    open?: boolean;
  }) =>
    open
      ? createElement(
          "div",
          { "data-drawer-open": "true" },
          children,
          createElement(
            "button",
            {
              "data-dismiss-drawer": "true",
              onClick: () => onOpenChange?.(false),
              type: "button",
            },
            "Dismiss drawer",
          ),
        )
      : null,
  DrawerContent: ({ children, className }: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", { className, "data-drawer-content": "true" }, children),
  DrawerDescription: (props: HTMLAttributes<HTMLParagraphElement>) =>
    createElement("p", props),
  DrawerFooter: (props: HTMLAttributes<HTMLDivElement>) => createElement("div", props),
  DrawerHeader: (props: HTMLAttributes<HTMLDivElement>) => createElement("div", props),
  DrawerTitle: (props: HTMLAttributes<HTMLHeadingElement>) => createElement("h2", props),
}));

vi.mock("@/src/hooks/use-mobile", () => ({
  useIsMobile: () => true,
}));

test("avatar options have unique ids and headshots resolve to bundled assets", () => {
  const ids = MURPH_CONTACT_AVATAR_OPTIONS.map((option) => option.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toContain(DEFAULT_MURPH_CONTACT_AVATAR_ID);

  for (const option of MURPH_CONTACT_AVATAR_OPTIONS) {
    if (option.kind === "headshot") {
      expect(option.src).toMatch(/^\/murph-headshots\/murph-headshot-\d+-sm\.png$/);
    } else if (option.kind === "logo") {
      expect(option.src).toMatch(/^\/brand-logos\/murph-logo-avatar-(dark|light)\.png$/);
    } else {
      expect(option.src).toBeUndefined();
    }
  }

  const kinds = MURPH_CONTACT_AVATAR_OPTIONS.map((option) => option.kind);
  expect(kinds.filter((kind) => kind === "logo")).toHaveLength(2);
  expect(kinds).toContain("blank");
});

test("avatar assets exist for each declared option src", () => {
  for (const option of MURPH_CONTACT_AVATAR_OPTIONS) {
    if (!option.src) {
      continue;
    }

    const assetUrl = new URL(`../public${option.src}`, import.meta.url);
    expect(existsSync(assetUrl)).toBe(true);
    expect(statSync(assetUrl).isFile()).toBe(true);
  }
});

test("findMurphContactAvatarOption falls back to the default option", () => {
  expect(findMurphContactAvatarOption("gremlin").id).toBe("gremlin");
  expect(findMurphContactAvatarOption("does-not-exist").id).toBe(
    DEFAULT_MURPH_CONTACT_AVATAR_ID,
  );
});

test("avatar grid renders one native radio per option with the selection checked", () => {
  const markup = renderToStaticMarkup(
    <MurphContactAvatarGrid onChange={() => {}} value="gremlin" />,
  );

  expect(markup).toContain('role="radiogroup"');
  expect(markup.match(/type="radio"/g)?.length).toBe(
    MURPH_CONTACT_AVATAR_OPTIONS.length,
  );
  expect(markup.match(/checked=""/g)?.length).toBe(1);
  for (const option of MURPH_CONTACT_AVATAR_OPTIONS) {
    expect(markup).toContain(option.label);
    expect(markup).toContain(`value="${option.id}"`);
    if (option.src) {
      expect(markup).toContain(option.src);
    }
  }
});

test("avatar grid radios share one group name and check the selected option", () => {
  const markup = renderToStaticMarkup(
    <MurphContactAvatarGrid
      onChange={() => {}}
      value={DEFAULT_MURPH_CONTACT_AVATAR_ID}
    />,
  );

  const names = [...markup.matchAll(/name="([^"]+)"/g)].map((match) => match[1]);
  expect(names).toHaveLength(MURPH_CONTACT_AVATAR_OPTIONS.length);
  expect(new Set(names).size).toBe(1);

  const checkedInput = markup.match(/<input[^>]*checked=""[^>]*>/)?.[0];
  expect(checkedInput).toContain(`value="${DEFAULT_MURPH_CONTACT_AVATAR_ID}"`);
});

test("avatar art renders each kind", () => {
  const logo = renderToStaticMarkup(
    <MurphContactAvatarArt option={findMurphContactAvatarOption("logo-dark")} />,
  );
  expect(logo).toContain("murph-logo-avatar-dark.png");

  const blank = renderToStaticMarkup(
    <MurphContactAvatarArt option={findMurphContactAvatarOption("none")} />,
  );
  expect(blank).toContain(">M<");

  const headshot = renderToStaticMarkup(
    <MurphContactAvatarArt option={findMurphContactAvatarOption("hooded")} />,
  );
  expect(headshot).toContain("murph-headshot-01-sm.png");
});

test("contact card preview shows Murph with the selected avatar", () => {
  const markup = renderToStaticMarkup(
    <MurphContactCardPreview option={findMurphContactAvatarOption("referee")} />,
  );
  expect(markup).toContain("Murph");
  expect(markup).toContain("murph-headshot-04-sm.png");
});

test("contact card picker fills the mobile viewport and keeps safe-area actions", () => {
  const markup = renderToStaticMarkup(
    <MurphContactCardPicker
      onAddToContacts={() => {}}
      onOpenChange={() => {}}
      open
    />,
  );

  expect(markup).toContain('data-drawer-content="true"');
  expect(markup).toContain("h-dvh");
  expect(markup).toContain("max-h-dvh");
  expect(markup).not.toContain("92dvh");
  expect(markup).toContain("safe-area-inset-bottom");
});

test("contact card picker issues a bound handoff and keeps launch failures retryable", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({ claim: "claim.for.gremlin" }), {
      headers: { "content-type": "application/json" },
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const onAddToContacts = vi.fn();
  const onOpenChange = vi.fn();
  const props = {
    initialAvatarId: "gremlin",
    onAddToContacts,
    onOpenChange,
    open: true,
  };
  const rendered = await renderClientComponent(
    <MurphContactCardPicker {...props} />,
    {
      location: {
        host: "app.example.com",
        href: "https://app.example.com/onboarding",
        origin: "https://app.example.com",
      },
      requireButton: false,
    },
  );

  vi.stubGlobal("navigator", {
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  });
  rendered.assign.mockImplementationOnce(() => {
    throw new Error("Safari scheme launch failed.");
  });
  await rendered.rerender(<MurphContactCardPicker {...props} />);

  try {
    const button = findButton(
      rendered.container,
      "Open in Safari to add Murph",
    );
    assert.ok(button);
    expect(rendered.container.textContent).toContain(
      "You're in an in-app browser, which can't save contacts. This opens Safari instead.",
    );
    expect(rendered.container.textContent).toContain("Skip for now");

    await act(async () => {
      button.click();
      await flushPromises();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/murph-contact-card",
      expect.objectContaining({
        body: JSON.stringify({ avatar: "gremlin" }),
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(rendered.assign).toHaveBeenCalledWith(
      "x-safari-https://app.example.com/api/murph-contact-card?handoff=claim.for.gremlin",
    );
    expect(rendered.container.querySelector("[role='alert']")?.textContent)
      .toContain("Couldn't open Safari");
    expect(findButton(rendered.container, "Open in Safari to add Murph")?.disabled)
      .toBe(false);
    expect(onAddToContacts).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(rendered.container.querySelector("[data-drawer-open='true']"))
      .not.toBeNull();
  } finally {
    await rendered.cleanup();
  }
});

test("contact card picker keeps an issuance denial open and retryable", async () => {
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ claim: "retry.claim" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  const onAddToContacts = vi.fn();
  const onOpenChange = vi.fn();
  const onSkip = vi.fn();
  const props = {
    initialAvatarId: "gremlin",
    onAddToContacts,
    onOpenChange,
    onSkip,
    open: true,
  };
  const rendered = await renderClientComponent(
    <MurphContactCardPicker {...props} />,
    {
      location: {
        host: "app.example.com",
        href: "https://app.example.com/onboarding",
        origin: "https://app.example.com",
      },
      requireButton: false,
    },
  );

  vi.stubGlobal("navigator", {
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  });
  await rendered.rerender(<MurphContactCardPicker {...props} />);

  try {
    const firstAttempt = findButton(
      rendered.container,
      "Open in Safari to add Murph",
    );
    assert.ok(firstAttempt);

    await act(async () => {
      firstAttempt.click();
      await flushPromises();
    });

    expect(rendered.container.querySelector("[role='alert']")?.textContent)
      .toContain("Couldn't open Safari");
    expect(rendered.container.querySelector("[data-drawer-open='true']"))
      .not.toBeNull();
    expect(onAddToContacts).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(rendered.assign).not.toHaveBeenCalled();

    const retry = findButton(
      rendered.container,
      "Open in Safari to add Murph",
    );
    assert.ok(retry);
    expect(retry.disabled).toBe(false);

    await act(async () => {
      retry.click();
      await flushPromises();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rendered.assign).toHaveBeenCalledWith(
      "x-safari-https://app.example.com/api/murph-contact-card?handoff=retry.claim",
    );
    expect(onAddToContacts).toHaveBeenCalledWith(
      findMurphContactAvatarOption("gremlin"),
    );
    expect(onSkip).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});

test("hosted-onboarding add-to-contacts caller closes after a successful Safari handoff", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({ claim: "standalone.claim" }), {
      headers: { "content-type": "application/json" },
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const element = <MurphAddToContactsButton />;
  const rendered = await renderClientComponent(element, {
    location: {
      host: "app.example.com",
      href: "https://app.example.com/join",
      origin: "https://app.example.com",
    },
    requireButton: false,
  });

  vi.stubGlobal("navigator", {
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  });
  await rendered.rerender(element);

  try {
    const openPicker = findButton(rendered.container, "Add Murph to Contacts");
    assert.ok(openPicker);
    await act(async () => {
      openPicker.click();
    });

    expect(rendered.container.querySelector("[data-drawer-open='true']"))
      .not.toBeNull();
    const launch = findButton(
      rendered.container,
      "Open in Safari to add Murph",
    );
    assert.ok(launch);

    await act(async () => {
      launch.click();
      await flushPromises();
    });

    expect(rendered.assign).toHaveBeenCalledWith(
      "x-safari-https://app.example.com/api/murph-contact-card?handoff=standalone.claim",
    );
    expect(rendered.container.querySelector("[data-drawer-open='true']"))
      .toBeNull();
    expect(rendered.container.textContent).not.toContain("Skip for now");

    const reopenPicker = findButton(rendered.container, "Add Murph to Contacts");
    assert.ok(reopenPicker);
    await act(async () => {
      reopenPicker.click();
    });
    expect(findButton(rendered.container, "Open in Safari to add Murph")?.disabled)
      .toBe(false);
  } finally {
    await rendered.cleanup();
  }
});

test("contact card picker times out issuance and stays open for retry", async () => {
  const timeoutController = new AbortController();
  const retryTimeoutController = new AbortController();
  const timeoutSpy = vi.spyOn(AbortSignal, "timeout")
    .mockReturnValueOnce(timeoutController.signal)
    .mockReturnValue(retryTimeoutController.signal);
  const fetchMock = vi.fn<typeof fetch>()
    .mockImplementationOnce((_url, init) => rejectOnAbort(init?.signal))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ claim: "timeout.retry.claim" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  const onAddToContacts = vi.fn();
  const onOpenChange = vi.fn();
  const props = {
    initialAvatarId: "gremlin",
    onAddToContacts,
    onOpenChange,
    open: true,
  };
  const rendered = await renderClientComponent(
    <MurphContactCardPicker {...props} />,
    {
      location: {
        host: "app.example.com",
        href: "https://app.example.com/onboarding",
        origin: "https://app.example.com",
      },
      requireButton: false,
    },
  );

  vi.stubGlobal("navigator", {
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  });
  await rendered.rerender(<MurphContactCardPicker {...props} />);

  try {
    const launch = findButton(
      rendered.container,
      "Open in Safari to add Murph",
    );
    assert.ok(launch);
    await act(async () => {
      launch.click();
      await Promise.resolve();
    });

    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    expect(findButton(rendered.container, "Opening Safari…")?.disabled).toBe(true);
    expect(findButton(rendered.container, "Skip for now")?.disabled).toBe(true);
    expect(
      Array.from(
        rendered.container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
      ).every((input) => input.disabled),
    ).toBe(true);

    await act(async () => {
      timeoutController.abort(new Error("Handoff timed out."));
      await flushPromises();
    });

    expect(rendered.container.querySelector("[role='alert']")?.textContent)
      .toContain("Couldn't open Safari");
    expect(rendered.container.querySelector("[data-drawer-open='true']"))
      .not.toBeNull();
    expect(findButton(rendered.container, "Open in Safari to add Murph")?.disabled)
      .toBe(false);
    expect(onAddToContacts).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();

    const retry = findButton(
      rendered.container,
      "Open in Safari to add Murph",
    );
    assert.ok(retry);
    await act(async () => {
      retry.click();
      await flushPromises();
    });

    expect(rendered.assign).toHaveBeenCalledWith(
      "x-safari-https://app.example.com/api/murph-contact-card?handoff=timeout.retry.claim",
    );
    expect(onAddToContacts).toHaveBeenCalledWith(
      findMurphContactAvatarOption("gremlin"),
    );
  } finally {
    await rendered.cleanup();
  }
});

test("contact card picker aborts dismissal during issuance and stays retryable", async () => {
  let issuedSignal: AbortSignal | null | undefined;
  let resolveCancelledIssuance: ((response: Response) => void) | undefined;
  const fetchMock = vi.fn<typeof fetch>()
    .mockImplementationOnce((_url, init) => {
      issuedSignal = init?.signal;
      return new Promise<Response>((resolve) => {
        resolveCancelledIssuance = resolve;
      });
    })
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ claim: "dismissal.retry.claim" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  const onAddToContacts = vi.fn();
  const onOpenChange = vi.fn();
  const props = {
    initialAvatarId: "gremlin",
    onAddToContacts,
    onOpenChange,
    open: true,
  };
  const rendered = await renderClientComponent(
    <MurphContactCardPicker {...props} />,
    {
      location: {
        host: "app.example.com",
        href: "https://app.example.com/onboarding",
        origin: "https://app.example.com",
      },
      requireButton: false,
    },
  );

  vi.stubGlobal("navigator", {
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  });
  await rendered.rerender(<MurphContactCardPicker {...props} />);

  try {
    const launch = findButton(
      rendered.container,
      "Open in Safari to add Murph",
    );
    assert.ok(launch);
    await act(async () => {
      launch.click();
      await Promise.resolve();
    });

    expect(issuedSignal?.aborted).toBe(false);
    const dismiss = rendered.container.querySelector<HTMLButtonElement>(
      "[data-dismiss-drawer='true']",
    );
    assert.ok(dismiss);
    await act(async () => {
      dismiss.click();
      await flushPromises();
    });

    expect(issuedSignal?.aborted).toBe(true);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onAddToContacts).not.toHaveBeenCalled();
    expect(rendered.container.querySelector("[data-drawer-open='true']"))
      .not.toBeNull();
    expect(rendered.container.querySelector("[role='alert']")?.textContent)
      .toContain("Couldn't open Safari");

    assert.ok(resolveCancelledIssuance);
    await act(async () => {
      resolveCancelledIssuance?.(
        new Response(JSON.stringify({ claim: "cancelled.claim" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
      await flushPromises();
    });
    expect(rendered.assign).not.toHaveBeenCalled();
    expect(onAddToContacts).not.toHaveBeenCalled();

    const retry = findButton(
      rendered.container,
      "Open in Safari to add Murph",
    );
    assert.ok(retry);
    expect(retry.disabled).toBe(false);
    await act(async () => {
      retry.click();
      await flushPromises();
    });

    expect(rendered.assign).toHaveBeenCalledWith(
      "x-safari-https://app.example.com/api/murph-contact-card?handoff=dismissal.retry.claim",
    );
    expect(onAddToContacts).toHaveBeenCalledWith(
      findMurphContactAvatarOption("gremlin"),
    );
  } finally {
    await rendered.cleanup();
  }
});

test("contact card picker freezes the selected avatar during issuance", async () => {
  let resolveIssuance: ((response: Response) => void) | undefined;
  const fetchMock = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
    const signal = init?.signal;
    assert.ok(signal);
    return new Promise<Response>((resolve, reject) => {
      resolveIssuance = resolve;
      signal.addEventListener(
        "abort",
        () => reject(signal.reason ?? new Error("Handoff aborted.")),
        { once: true },
      );
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const onAddToContacts = vi.fn();
  const onOpenChange = vi.fn();
  const onSkip = vi.fn();
  const props = {
    initialAvatarId: "gremlin",
    onAddToContacts,
    onOpenChange,
    onSkip,
    open: true,
  };
  const rendered = await renderClientComponent(
    <MurphContactCardPicker {...props} />,
    {
      location: {
        host: "app.example.com",
        href: "https://app.example.com/onboarding",
        origin: "https://app.example.com",
      },
      requireButton: false,
    },
  );

  vi.stubGlobal("navigator", {
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  });
  await rendered.rerender(<MurphContactCardPicker {...props} />);

  try {
    const launch = findButton(
      rendered.container,
      "Open in Safari to add Murph",
    );
    assert.ok(launch);
    await act(async () => {
      launch.click();
      await Promise.resolve();
    });

    const gremlinInput = rendered.container.querySelector<HTMLInputElement>(
      'input[type="radio"][value="gremlin"]',
    );
    const hoodedInput = rendered.container.querySelector<HTMLInputElement>(
      'input[type="radio"][value="hooded"]',
    );
    assert.ok(gremlinInput);
    assert.ok(hoodedInput);
    expect(gremlinInput.disabled).toBe(true);
    expect(hoodedInput.disabled).toBe(true);
    expect(gremlinInput.checked).toBe(true);
    expect(hoodedInput.checked).toBe(false);
    const hoodedOption = hoodedInput.closest("label");
    assert.ok(hoodedOption);

    await act(async () => {
      hoodedOption.click();
    });

    expect(gremlinInput.checked).toBe(true);
    expect(hoodedInput.checked).toBe(false);
    assert.ok(resolveIssuance);
    await act(async () => {
      resolveIssuance?.(
        new Response(JSON.stringify({ claim: "gremlin.claim" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
      await flushPromises();
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      avatar: "gremlin",
    });
    expect(rendered.assign).toHaveBeenCalledWith(
      "x-safari-https://app.example.com/api/murph-contact-card?handoff=gremlin.claim",
    );
    expect(onAddToContacts).toHaveBeenCalledWith(
      findMurphContactAvatarOption("gremlin"),
    );
    expect(onSkip).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});

test("contact card picker keeps the normal download action in Android webviews", async () => {
  const onAddToContacts = vi.fn();
  const props = {
    initialAvatarId: "gremlin",
    onAddToContacts,
    onOpenChange: () => {},
    open: true,
  };
  const rendered = await renderClientComponent(
    <MurphContactCardPicker {...props} />,
    {
      location: {
        host: "app.example.com",
        href: "https://app.example.com/onboarding",
        origin: "https://app.example.com",
      },
      requireButton: false,
    },
  );

  vi.stubGlobal("navigator", {
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro Build/AP1A.240505.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/466.0.0.55.109;]",
  });
  await rendered.rerender(<MurphContactCardPicker {...props} />);

  try {
    const link = rendered.container.querySelector("a");
    assert.ok(link);
    expect(link.getAttribute("href")).toBe(
      "/api/murph-contact-card?avatar=gremlin",
    );
    expect(link.textContent).toContain("Add Murph to Contacts");
    expect(rendered.container.textContent).not.toContain(
      "You're in an in-app browser",
    );
    expect(rendered.container.textContent).toContain("Skip for now");

    await act(async () => {
      const clickEvent = new rendered.window.Event("click", {
        bubbles: true,
        cancelable: true,
      });
      clickEvent.preventDefault();
      link.dispatchEvent(clickEvent);
    });
    expect(onAddToContacts).toHaveBeenCalledWith(
      findMurphContactAvatarOption("gremlin"),
    );
  } finally {
    await rendered.cleanup();
  }
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function rejectOnAbort(
  signal: AbortSignal | null | undefined,
): Promise<Response> {
  assert.ok(signal);
  return new Promise<Response>((_resolve, reject) => {
    const rejectAborted = () => {
      reject(signal.reason ?? new Error("Handoff aborted."));
    };
    if (signal.aborted) {
      rejectAborted();
      return;
    }
    signal.addEventListener("abort", rejectAborted, { once: true });
  });
}

function findButton(
  container: Element,
  label: string,
): HTMLButtonElement | null {
  const ButtonElement = container.ownerDocument.defaultView?.HTMLButtonElement;
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label,
  );
  return ButtonElement && button instanceof ButtonElement ? button : null;
}
