import assert from "node:assert/strict";

import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { GoalContactAction } from "@/src/components/goals/goal-contact-action";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

const START_PROMPT = "Hey Murph, help me lower my resting heart rate.";

test("goal CTA is one direct native Messages link with the exact draft", () => {
  const option: MurphContactOption = {
    copyValue: "+15550100001",
    href: `sms:+15550100001?body=${encodeURIComponent(START_PROMPT)}`,
    kind: "text",
    label: "Messages",
  };
  const markup = renderToStaticMarkup(<GoalContactAction option={option} />);

  assert.equal((markup.match(/<a\b/gu) ?? []).length, 1);
  assert.match(markup, /aria-label="Do this with Murph in Messages"/u);
  assert.match(
    markup,
    new RegExp(`href="sms:\\+15550100001\\?body=${encodeURIComponent(START_PROMPT)}"`),
  );
  assert.doesNotMatch(markup, /target=/u);
  assert.doesNotMatch(markup, /dialog|textarea|copy|choose an app/iu);
});

test("goal CTA preserves Telegram's direct web-to-app fallback", () => {
  const option: MurphContactOption = {
    copyValue: "@withmurph_bot",
    href: `https://t.me/withmurph_bot?${new URLSearchParams({
      text: START_PROMPT,
    }).toString()}`,
    kind: "telegram",
    label: "Telegram",
    rel: "noopener noreferrer",
    target: "_blank",
  };
  const markup = renderToStaticMarkup(<GoalContactAction option={option} />);

  assert.equal((markup.match(/<a\b/gu) ?? []).length, 1);
  assert.match(
    markup,
    /aria-label="Do this with Murph in Telegram \(opens in a new tab\)"/u,
  );
  assert.match(markup, /target="_blank"/u);
  assert.match(markup, /rel="noopener noreferrer"/u);
  assert.match(markup, /Opens in a new tab\./u);
  assert.doesNotMatch(markup, /dialog|textarea|copy|choose an app/iu);
});
