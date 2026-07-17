import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { ErrandsSection } from "@/src/components/homepage/errands-section";

test("ErrandsSection renders the static errand timeline copy", () => {
  const markup = renderToStaticMarkup(createElement(ErrandsSection));

  assert.match(markup, /Errands, handled/);
  assert.match(markup, /Murph can call anyone and order anything\./);
  assert.match(
    markup,
    /It shops the web and sits on hold so you don&#x27;t have to\./,
  );
  assert.match(
    markup,
    /Nothing gets bought or booked without your say-so\./,
  );
  assert.match(
    markup,
    /running low on omega-3, and my tooth&#x27;s been aching\. can you handle it\?/,
  );
  assert.match(
    markup,
    /Opened a browser · compared omega-3 prices at three stores/,
  );
  assert.match(
    markup,
    /Called Cedar Dental · waited on hold 9 minutes/,
  );
  assert.match(
    markup,
    /Booked a cleaning, Thursday 10:15 AM · added to your calendar/,
  );
  assert.match(
    markup,
    /Both handled\. Dentist is Thursday at 10:15\./,
  );
  assert.match(
    markup,
    /The omega-3 refill came to \$23\.79 with a subscribe discount\. Approve and it ships\./,
  );
  assert.match(markup, /approved 👍/);
  assert.match(
    markup,
    /One text\. Seventeen minutes\. Zero apps opened\./,
  );
  assert.match(
    markup,
    /Also plugs into Google Calendar, Gmail, Amazon, Instacart, clinician search, and hundreds more\./,
  );
  assert.match(markup, /📦 Omega-3 refill, left at your door\./);
  assert.match(markup, /doorstep-delivery\.jpg/);
  assert.doesNotMatch(markup, /personal health assistant/i);
  assert.doesNotMatch(markup, /composio/i);
});
