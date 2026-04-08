import assert from "node:assert/strict";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { Input } from "@/components/ui/input";

test("Input defaults to the taller shared hosted-web height", () => {
  const markup = renderToStaticMarkup(
    React.createElement(Input, {
      placeholder: "Email",
    }),
  );

  assert.match(markup, /data-slot="input"/);
  assert.match(markup, /class="[^"]*h-14[^"]*"/);
});
