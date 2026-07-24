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
  MurphContactCardPreview,
  MurphContactCardPicker,
} from "@/src/components/murph/murph-contact-card-picker";

import { renderClientComponent } from "./render-client-component";

vi.mock("@/src/components/ui/drawer", () => ({
  Drawer: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
    open ? createElement("div", { "data-drawer-open": "true" }, children) : null,
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
    <MurphContactCardPicker onOpenChange={() => {}} open />,
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

    expect(fetchMock).toHaveBeenCalledWith("/api/murph-contact-card", {
      body: JSON.stringify({ avatar: "gremlin" }),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
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

test("contact card picker keeps an issuance failure open and retryable", async () => {
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ claim: "retry.claim" }), {
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
