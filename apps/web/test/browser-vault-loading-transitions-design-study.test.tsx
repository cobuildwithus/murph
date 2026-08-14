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
  expect(markup).toContain('data-design-transition="biomarker-trend"');
  expect(markup).toContain('data-design-state="data"');
  expect(markup).toContain("7-day average");
  expect(markup).toContain('data-design-transition="biomarkers-list"');
  expect(markup).toContain('data-design-state="labs-ready"');
  expect(markup).toContain('data-design-state="complete"');
  expect(markup).toContain("From your devices");
  expect(markup).toContain("Nutrients &amp; fatty acids");
  expect(markup).toContain('inert=""');
  expect(markup).not.toMatch(/hbm_[A-Za-z0-9]+/u);
});
