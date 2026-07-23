import assert from "node:assert/strict";

import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import SubprocessorsPage from "../app/subprocessors/page";

test("subprocessor register preserves accessible wide-table semantics", async () => {
  const markup = renderToStaticMarkup(await SubprocessorsPage());

  assert.match(markup, /aria-label="Scrollable legal document table"/u);
  assert.match(markup, /role="region"/u);
  assert.match(markup, /tabindex="0"/u);
  assert.match(markup, /<caption class="sr-only">Legal document table\. Columns: Provider,/u);
  assert.match(markup, /w-\[min\(1120px,calc\(100vw-3rem\)\)\]/u);
  assert.match(markup, /min-w-\[1120px\]/u);
  assert.match(markup, /<th[^>]+scope="row"[^>]*>Vercel<\/th>/u);
});
