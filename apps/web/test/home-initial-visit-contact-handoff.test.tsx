import assert from "node:assert/strict";

import { act, createElement, type HTMLAttributes, type ReactNode } from "react";
import { test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

vi.mock("@/src/components/murph/murph-persona-picker", () => ({
  MurphPersonaPicker({ open }: { open: boolean }) {
    return open
      ? createElement("section", { "data-murph-persona-picker": "open" })
      : null;
  },
}));

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
    open ? createElement("div", null, children) : null,
  DialogContent: (props: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props),
  DialogDescription: (props: HTMLAttributes<HTMLParagraphElement>) =>
    createElement("p", props),
  DialogHeader: (props: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props),
  DialogTitle: (props: HTMLAttributes<HTMLHeadingElement>) =>
    createElement("h2", props),
}));

vi.mock("@/src/components/ui/drawer", () => ({
  Drawer: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
    open
      ? createElement("div", { "data-drawer-open": "true" }, children)
      : null,
  DrawerContent: (props: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props),
  DrawerDescription: (props: HTMLAttributes<HTMLParagraphElement>) =>
    createElement("p", props),
  DrawerFooter: (props: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props),
  DrawerHeader: (props: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props),
  DrawerTitle: (props: HTMLAttributes<HTMLHeadingElement>) =>
    createElement("h2", props),
}));

vi.mock("@/src/hooks/use-mobile", () => ({
  useIsMobile: () => true,
}));

test("initial-visit contact handoff advances to persona setup after Safari launches", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({ claim: "initial-visit.claim" }), {
      headers: { "content-type": "application/json" },
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const { HomeInitialVisitPersonaPickerClient } = await import(
    "../app/(dashboard)/home/initial-visit-persona-picker-client"
  );
  const createInitialVisitElement = () =>
    createElement(HomeInitialVisitPersonaPickerClient, {
      contactAction: {
        href: "sms:+15550100001",
        kind: "text",
        label: "Messages",
      },
    });
  const rendered = await renderClientComponent(createInitialVisitElement(), {
    location: {
      hash: "",
      host: "app.example.com",
      href: "https://app.example.com/home?initialVisit=true",
      origin: "https://app.example.com",
      pathname: "/home",
      search: "?initialVisit=true",
    },
    requireButton: false,
  });

  vi.stubGlobal("navigator", {
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  });
  await rendered.rerender(createInitialVisitElement());

  try {
    const launch = Array.from(rendered.container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Open in Safari to add Murph",
    );
    assert.ok(launch);

    await act(async () => {
      launch.click();
      await flushPromises();
    });

    assert.deepEqual(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)), {
      avatar: "classic",
    });
    assert.equal(
      rendered.assign.mock.calls[0]?.[0],
      "x-safari-https://app.example.com/api/murph-contact-card?handoff=initial-visit.claim",
    );
    assert.equal(
      rendered.container.querySelector("[data-drawer-open='true']"),
      null,
    );
    assert.ok(
      rendered.container.querySelector("[data-murph-persona-picker='open']"),
    );
    assert.doesNotMatch(rendered.container.textContent ?? "", /Skip for now/u);
  } finally {
    await rendered.cleanup();
  }
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
