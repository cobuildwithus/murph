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
  expect(markup).toContain('data-design-transition="biomarker-trend"');
  expect(markup).toContain('data-design-state="data"');
  expect(markup).toContain("7-day average");
  expect(markup).toContain('data-design-transition="biomarkers-list"');
  expect(markup).toContain('data-design-state="labs-ready"');
  expect(markup).toContain('data-design-state="complete"');
  expect(markup).toContain("From your devices");
  expect(markup).toContain("Nutrients &amp; fatty acids");
  expect(markup).toContain('data-design-transition="biomarker-result-detail"');
  expect(markup).toContain('data-design-state="stale-populated"');
  expect(markup).toContain('data-design-state="refresh-pending-populated"');
  expect(markup).toContain('data-design-state="stale-empty"');
  expect(markup).toContain("Ferritin");
  expect(markup).toContain("No results found");
  expect(markup).toContain("This history may be out of date");
  expect(markup).toContain("Refresh");
  expect(markup).not.toContain("Refreshing this history");
  expect(markup).not.toContain("last saved results remain visible");
  expect(markup).toContain('inert=""');
  expect(markup).not.toMatch(/hbm_[A-Za-z0-9]+/u);
});
