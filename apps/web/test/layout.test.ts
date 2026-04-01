import assert from "node:assert/strict";

import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { vi } from "vitest";

vi.mock("next/font/google", () => ({
  Outfit() {
    return {
      className: "font-outfit",
    };
  },
  Geist() {
    return {
      variable: "font-geist",
    };
  },
}));

import RootLayout from "../app/layout";

test("RootLayout renders the GPL footer with a GitHub link", () => {
  const markup = renderToStaticMarkup(
    RootLayout({
      children: "hosted-shell",
    }),
  );

  assert.match(markup, /hosted-shell/);
  assert.match(markup, /Murph is open source and licensed under GPL 3\.0\./);
  assert.match(markup, /View the code on GitHub/);
  assert.match(markup, /https:\/\/github\.com\/cobuildwithus\/murph/u);
});
