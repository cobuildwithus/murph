import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ImessageSevenDayHealthCardStudy } from "@/app/design/imessage-seven-day-health-card-study";

test("design studies expose complete, sparse, and unavailable production card states", () => {
  const markup = renderToStaticMarkup(
    createElement(ImessageSevenDayHealthCardStudy),
  );

  expect(markup).toContain(
    'data-design-component="imessage-seven-day-health-card"',
  );
  expect(markup.match(/data-design-state="complete"/gu)).toHaveLength(2);
  expect(markup.match(/data-design-state="sparse"/gu)).toHaveLength(2);
  expect(markup.match(/data-design-state="no-data"/gu)).toHaveLength(2);
  expect(markup).toContain('data-design-contract="imessage-native-wearable-trend-card"');
  expect(markup).toContain('data-metric-key="hrv-rmssd"');
  expect(markup).toContain('data-metric-key="hrv-sdnn"');
  expect(markup).toContain('data-day-value="missing"');
  expect(markup).toContain('data-sparkline="·······"');
  expect(markup).toContain("AVG · VS PRIOR 7D");
  expect(markup).toContain("· unavailable");
  expect(markup).toContain('inert=""');
  expect(markup).not.toMatch(/<(?:button|footer|legend|svg)\b/u);
  expect(markup).not.toMatch(/pill|tooltip|tap to|reply with|better|worse/iu);
});

test("design and screenshot catalogs keep reviewer-openable seven-day health anchors", () => {
  const componentsSource = readFileSync(
    new URL("../app/design/components-content.tsx", import.meta.url),
    "utf8",
  );
  const sectionsSource = readFileSync(
    new URL("../app/design/sections-content.tsx", import.meta.url),
    "utf8",
  );

  expect(componentsSource).toContain('id="imessage-seven-day-health-card"');
  expect(componentsSource).toContain("<ImessageSevenDayHealthCardStudy />");
  expect(sectionsSource).toContain('id="imessage-seven-day-health-card"');
  expect(sectionsSource).toContain("<ImessageSevenDayHealthCardStudy />");
});
