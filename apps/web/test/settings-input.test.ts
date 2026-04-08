import assert from "node:assert/strict";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { Input } from "@/src/components/ui/input";

test("Input renders with data-slot attribute", () => {
  const markup = renderToStaticMarkup(
    React.createElement(Input, {
      placeholder: "Email",
    }),
  );

  assert.match(markup, /data-slot="input"/);
});
