import assert from "node:assert/strict";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { Button } from "@/components/ui/button";

test("Button defaults to the taller shared hosted-web height", () => {
  const markup = renderToStaticMarkup(
    React.createElement(Button, null, "Continue"),
  );

  assert.match(markup, /data-slot="button"/);
  assert.match(markup, /class="[^"]*h-14[^"]*"/);
});
