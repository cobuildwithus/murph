import assert from "node:assert/strict";
import test from "node:test";

import { validateFrontendDesignProof } from "./check-frontend-design-proof.mjs";

test("accepts the dedicated consent design catalog and route", () => {
  const result = validateFrontendDesignProof({
    changedPaths: [
      "apps/web/src/components/legal/hosted-legal-consent-card.tsx",
      "apps/web/app/design/consent-content.tsx",
    ],
    prBodyHtml: `
<h2>Design proof</h2>
<ul>
<li>Design page: <code>/design?tab=consent</code></li>
<li>Desktop screenshot: <img src="https://example.test/consent-desktop.svg"></li>
<li>Mobile screenshot: <img src="https://example.test/consent-mobile.svg"></li>
</ul>
`,
  });

  assert.deepEqual(result, {
    errors: [],
    required: true,
    uiPaths: ["apps/web/src/components/legal/hosted-legal-consent-card.tsx"],
  });
});
