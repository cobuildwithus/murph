import { act, createElement, type ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/src/components/ui/input", () => ({
  Input: ({ onChange, ...props }: ComponentProps<"input">) =>
    createElement("input", { ...props, onInput: onChange }),
}));

import { BlockedNumbers } from "../app/(dashboard)/ops/blocked-numbers";
import { renderClientComponent } from "./render-client-component";
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });
it("lists, unblocks and refreshes through the authenticated route", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ blocks: [{ contact: "synthetic@example.invalid", reason: "operator", createdAt: "2026-11-15T00:00:00Z" }], nextCursor: null }))
    .mockResolvedValueOnce(Response.json({ ok: true })).mockResolvedValueOnce(Response.json({ blocks: [], nextCursor: null }));
  vi.stubGlobal("fetch", fetchMock);
  const rendered = await renderClientComponent(createElement(BlockedNumbers)); cleanup = rendered.cleanup;
  const button = (text: string) => [...rendered.container.querySelectorAll("button")].find(item => item.textContent === text)!;
  await act(async () => button("Show blocked numbers").click());
  expect(rendered.container.textContent).toContain("synthetic@example.invalid");
  await act(async () => button("Unblock").click());
  expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ operation: "unblock", contact: "synthetic@example.invalid" });
  expect(rendered.container.textContent).toContain("Number unblocked.");
  expect(rendered.container.textContent).toContain("No blocked numbers.");
});
it("shows a recoverable list error without inventing an empty result", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
  const rendered = await renderClientComponent(createElement(BlockedNumbers)); cleanup = rendered.cleanup;
  await act(async () => [...rendered.container.querySelectorAll("button")].find(item => item.textContent === "Show blocked numbers")!.click());
  expect(rendered.container.querySelector('[role="alert"]')?.textContent).toContain("Try again");
  expect(rendered.container.textContent).not.toContain("No blocked numbers.");
});

it("blocks a pasted contact and preserves it after a failed mutation", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ ok: true })).mockResolvedValueOnce(Response.json({ blocks: [], nextCursor: null }));
  vi.stubGlobal("fetch", fetchMock);
  const rendered = await renderClientComponent(createElement(BlockedNumbers)); cleanup = rendered.cleanup;
  const field = rendered.container.querySelector("input")!;
  await act(async () => { field.value = "synthetic@example.invalid"; field.dispatchEvent(new rendered.window.Event("input", { bubbles: true })); });
  const submit = async () => act(async () => { rendered.container.querySelector("form")!.dispatchEvent(new rendered.window.Event("submit", { bubbles: true, cancelable: true })); });
  await submit();
  expect(field.value).toBe("synthetic@example.invalid");
  expect(rendered.container.querySelector('[role="alert"]')?.textContent).toContain("Try again");
  await submit();
  expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ operation: "block", contact: "synthetic@example.invalid" });
  expect(field.value).toBe("");
  expect(rendered.container.textContent).toContain("Number blocked.");
});
