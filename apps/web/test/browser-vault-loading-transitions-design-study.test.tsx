import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { BrowserVaultLoadingTransitionsStudy } from "@/app/design/browser-vault-loading-transitions-study";

test("the design catalog renders each Browser Vault loading transition with synthetic production states", () => {
  const markup = renderToStaticMarkup(
    createElement(BrowserVaultLoadingTransitionsStudy),
  );

  expect(markup).toContain(
    'data-design-section="browser-vault-loading-transitions"',
  );
  expect(markup).toContain('data-design-transition="experiment-summary"');
  expect(markup).toContain('data-design-state="content"');
  expect(markup).toContain("Before and during the experiment");
  expect(markup).toContain('data-design-transition="private-experiment"');
  expect(markup).toContain('data-design-state="error"');
  expect(markup).toContain('data-design-state="result"');
  expect(markup).toContain("Loading your experiment");
  expect(markup).toContain("Your experiment couldn&#x27;t load");
  expect(markup).toContain("Evening wind-down practice");
  expect(markup).not.toMatch(/hbm_[A-Za-z0-9]+/u);
});
