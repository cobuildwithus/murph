import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  buildContactSupportMailto,
  ContactSupportAction,
  MURPH_SUPPORT_EMAIL,
  shouldShowContactSupportAction,
} from "@/src/components/support/contact-support-action";

describe("contact support action", () => {
  it("builds a support mailto href with encoded subject and body content", () => {
    const href = buildContactSupportMailto({
      body: "Hi Murph support,\n\nPlease help & advise.",
      subject: "Murph support & billing",
    });

    expect(href).toBe(
      `mailto:${MURPH_SUPPORT_EMAIL}?subject=Murph+support+%26+billing&body=Hi+Murph+support%2C%0A%0APlease+help+%26+advise.`,
    );
  });

  it("shows the support action only when the copy explicitly asks the user to contact support", () => {
    expect(shouldShowContactSupportAction("Please Contact Support right away.")).toBe(true);
    expect(shouldShowContactSupportAction("Please contact us instead.")).toBe(false);
    expect(shouldShowContactSupportAction(null)).toBe(false);
  });

  it("renders the default support email action label and href", () => {
    const markup = renderToStaticMarkup(
      createElement(ContactSupportAction, {
        body: "Help",
        subject: "Need support",
      }),
    );

    assert.match(markup, /Email support/);
    assert.match(markup, /href="mailto:support@withmurph\.ai\?subject=Need\+support&amp;body=Help"/);
  });
});
