import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { ShareLinkClient } from "@/src/components/hosted-share/share-link-client";

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
            counts: {
              foods: 1,
              protocols: 0,
              recipes: 0,
            },
            foodTitles: ["Smoothie"],
            logMealAfterImport: false,
            protocolTitles: [],
            recipeTitles: [],
            title: "Smoothie pack",
          },
        },
        stage: "signin",
      },
      shareCode: "share-code",
    }),
  );

  assert.ok(markup.includes('href="/join/invite-code?share=share-code"'));
  assert.match(markup, /Verify your phone and checkout/);
});
