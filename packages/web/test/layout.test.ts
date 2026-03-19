import assert from "node:assert/strict";

import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import RootLayout from "../app/layout";

test("RootLayout keeps the class-based theme shell around the app body", () => {
  const markup = renderToStaticMarkup(
    RootLayout({
      children: "theme-shell",
    }),
  );

  assert.match(markup, /class="[^"]*bg-bg[^"]*text-foreground[^"]*selection:bg-accent[^"]*selection:text-bg[^"]*font-body[^"]*antialiased[^"]*"/);
  assert.match(markup, /theme-shell/);
});
