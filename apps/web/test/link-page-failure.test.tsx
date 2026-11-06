import { act, createElement } from "react";
import { expect, test, vi } from "vitest";

import AppError from "../app/error";
import { renderClientComponent } from "./render-client-component";

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt?: string; src: string }) =>
    createElement("img", { alt: alt ?? "", src }),
}));

test("a page outside the dashboard fails onto the shared night screen and can retry", async () => {
  const retry = vi.fn();
  const rendered = await renderClientComponent(
    createElement(AppError, { error: new Error("private failure"), retry }),
  );

  expect(rendered.container.textContent).toContain("Something went wrong.");
  expect(rendered.container.textContent).toContain("Nothing changed. Try again in a moment.");
  expect(rendered.container.textContent).not.toContain("private failure");

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });
  expect(retry).toHaveBeenCalledOnce();

  await rendered.cleanup();
});
