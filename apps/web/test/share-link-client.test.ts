import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import {
  buildHostedShareStatusUrl,
  ShareLinkClient,
} from "@/src/components/hosted-share/share-link-client";

test("ShareLinkClient links invite sign-in flows through the hosted join route", () => {
  const markup = renderToStaticMarkup(
    createElement(ShareLinkClient, {
      initialData: {
        inviteCode: "invite-code",
        session: {
          active: false,
          authenticated: false,
        },
        share: {
          acceptedByCurrentMember: false,
          consumed: false,
          expiresAt: "2026-03-27T12:00:00.000Z",
          preview: {
            kinds: ["food"],
            counts: {
              foods: 1,
              protocols: 0,
              recipes: 0,
              total: 1,
            },
            logMealAfterImport: true,
          },
        },
        stage: "signin",
      },
      shareCode: "share-code",
    }),
  );

  assert.ok(markup.includes('href="/join/invite-code?share=share-code"'));
  assert.match(markup, /Shared food bundle/);
  assert.match(markup, /1 food/);
  assert.match(markup, /This import also logs the shared food after import\./);
  assert.match(markup, /Verify your phone and checkout/);
});

test("buildHostedShareStatusUrl preserves the invite query for authenticated refreshes", () => {
  assert.equal(
    buildHostedShareStatusUrl("share-code", "invite-code"),
    "/api/hosted-share/share-code/status?invite=invite-code",
  );
  assert.equal(
    buildHostedShareStatusUrl("share code", null),
    "/api/hosted-share/share%20code/status",
  );
});
