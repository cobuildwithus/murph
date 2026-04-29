import assert from "node:assert/strict";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

vi.mock("next/link", () => ({
  default(props: { children?: ReactNode; href: string }) {
    return createElement("a", { href: props.href }, props.children);
  },
}));

vi.mock("@/src/components/experiments/experiment-detail/start-experiment-button", () => ({
  StartExperimentButton(props: { protocolDays: number }) {
    return createElement(
      "div",
      null,
      createElement(
        "button",
        {
          "data-slot": "auth-button",
          type: "button",
        },
        "Start Experiment",
      ),
      createElement("span", null, `${props.protocolDays}-day protocol`),
    );
  },
}));

import { ExperimentHeader } from "@/src/components/experiments/experiment-detail/experiment-header";

test("removes the unwanted Bryan Johnson description qualifier from the rendered header copy", () => {
  const markup = renderToStaticMarkup(
    createElement(ExperimentHeader, {
      title: "Bryan Johnson Sauna",
      category: "Recovery",
      durationDays: 21,
      evidenceLevel: 3,
      evidenceLabel: "Field testing · Usable",
      status: "upcoming",
      baselineDays: 7,
      description:
        "A higher-burden daily sauna routine publicly described by Bryan Johnson, including post-workout timing, heat-protection tactics, and self-reported results best read as personal context rather than expected outcomes.",
    }),
  );

  assert.match(
    markup,
    /A higher-burden daily sauna routine publicly described by Bryan Johnson, including post-workout timing, heat-protection tactics, and self-reported results\./,
  );
  assert.doesNotMatch(markup, /best read as personal context rather than expected outcomes\./);
});

test("shows protocol days at the top level without counting baseline days", () => {
  const markup = renderToStaticMarkup(
    createElement(ExperimentHeader, {
      title: "Bryan Johnson Sauna",
      category: "Recovery",
      durationDays: 21,
      evidenceLevel: 3,
      evidenceLabel: "Field testing · Usable",
      status: "upcoming",
      baselineDays: 7,
      description: "Daily sauna protocol with a baseline period.",
    }),
  );

  assert.match(markup, /14 DAYS/);
  assert.match(markup, /14-day protocol/);
  assert.match(markup, /data-slot="auth-button"/);
  assert.doesNotMatch(markup, /7-day baseline/);
  assert.doesNotMatch(markup, /21 DAYS/);
  assert.doesNotMatch(markup, /21-day protocol/);
});

test("shows active protocol progress without counting baseline days", () => {
  const markup = renderToStaticMarkup(
    createElement(ExperimentHeader, {
      title: "Bryan Johnson Sauna",
      category: "Recovery",
      durationDays: 21,
      evidenceLevel: 3,
      evidenceLabel: "Field testing · Usable",
      status: "active",
      day: 8,
      baselineDays: 7,
      description: "Daily sauna protocol with a baseline period.",
    }),
  );

  assert.match(markup, /Day 1 of 14/);
  assert.doesNotMatch(markup, /Day 8 of 21/);
});
