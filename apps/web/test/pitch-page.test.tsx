import assert from "node:assert/strict";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

vi.mock("next/link", () => ({
  default(props: {
    children?: ReactNode;
    className?: string;
    href: { toString(): string } | string;
    "aria-label"?: string;
  }) {
    return createElement(
      "a",
      {
        "aria-label": props["aria-label"],
        className: props.className,
        href: props.href.toString(),
      },
      props.children,
    );
  },
}));

import PitchPage, { metadata as pitchMetadata } from "../app/pitch/page";

test("PitchPage metadata and route entrypoint render the deck landmark", () => {
  assert.equal(pitchMetadata.title, "Murph · Pitch");
  assert.equal(
    pitchMetadata.description,
    "Murph is your personal AI health team. It learns from your wearables, bloodwork, and health history, texts you first, and runs health challenges in your group chats.",
  );
  assert.deepEqual(pitchMetadata.openGraph?.images, [
    {
      alt: "Murph, your personal AI health team.",
      height: 630,
      type: "image/png",
      url: "/pitch/opengraph-image",
      width: 1200,
    },
  ]);

  const markup = renderToStaticMarkup(createElement(PitchPage));

  assert.match(markup, /<main[^>]*data-pitch-deck="true"/);
  assert.match(markup, /data-pitch-chrome="true"/);
  assert.match(markup, /aria-label="Slide 1: Title"/);
  assert.match(markup, /Your personal<br\/>AI health team\./);
  assert.match(markup, /Live since July\. Revenue up every month\./);
  assert.match(markup, /\$431/);
  assert.match(markup, /paying customers/);
  assert.match(markup, /monthly active users/);
  assert.match(markup, /\$3\.7B/);
  assert.doesNotMatch(markup, /The social layer for health experiments/);
  assert.doesNotMatch(markup, /MRR grew 61% in the 30 days through September 2/);
  assert.doesNotMatch(markup, /12% weekly compound MRR growth/);
  assert.match(markup, /Scroll or use arrow keys/);
  assert.match(markup, /01 \/ 13/);
});

