import assert from "node:assert/strict";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { Button } from "@/src/components/ui/button";

test("Button renders with data-slot attribute", () => {
  const markup = renderToStaticMarkup(
    React.createElement(Button, null, "Continue"),
  );

  assert.match(markup, /data-slot="button"/);
});
