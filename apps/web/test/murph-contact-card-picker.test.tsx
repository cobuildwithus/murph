import { existsSync, statSync } from "node:fs";

import { createElement, type HTMLAttributes, type ReactNode } from "react";
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
