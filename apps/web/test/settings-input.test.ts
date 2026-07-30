import assert from "node:assert/strict";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { Input } from "@/src/components/ui/input";
import { Textarea } from "@/src/components/ui/textarea";

test("Input renders with data-slot attribute", () => {
  const markup = renderToStaticMarkup(
    React.createElement(Input, {
      placeholder: "Email",
    }),
  );

  assert.match(markup, /data-slot="input"/);
});

test("shared fields honor the group sponsorship border-only focus override", () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(Input, { className: "focus-visible:ring-0" }),
      React.createElement(Textarea, { className: "focus-visible:ring-0" }),
    ),
  );

  assert.equal(markup.match(/focus-visible:ring-0/g)?.length, 2);
  assert.doesNotMatch(markup, /focus-visible:ring-3/);
  assert.equal(markup.match(/focus-visible:border-ring/g)?.length, 2);
});
