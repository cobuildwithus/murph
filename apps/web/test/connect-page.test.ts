import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

vi.mock("next/image", () => ({
  default: (props: {
    alt?: string;
    className?: string;
    height?: number;
    src: string;
    width?: number;
  }) =>
    createElement("img", {
      alt: props.alt ?? "",
      className: props.className,
      height: props.height,
      src: props.src,
      width: props.width,
    }),
}));

test("ConnectPage renders Just Cobuild source names and logo marks", async () => {
  const { default: ConnectPage, metadata } = await import("../app/(dashboard)/connect/page");
  const markup = renderToStaticMarkup(createElement(ConnectPage));

  assert.equal(metadata.title, "Connect Devices — Murph");
  assert.match(markup, /Connect your health/);
  assert.match(markup, /Just Cobuild sources/);
  assert.match(markup, /lg:grid-cols-2 xl:grid-cols-4/);
  assert.doesNotMatch(markup, /data-priority list/);
  assert.doesNotMatch(markup, /Priority/u);
  assert.doesNotMatch(markup, /Health data source from the Just Cobuild priority catalog/u);

  const sources = [
    {
      assetPath: "/brand-logos/connect/whoop.svg",
      description: "Recovery, strain, sleep, heart rate, and daily readiness from Whoop.",
      name: "Whoop",
    },
    {
      assetPath: "/brand-logos/connect/mapmyfitness.png",
      description: "Logged workouts, routes, pace, distance, and activity history from MapMyFitness.",
      name: "MapMyFitness",
    },
    {
      assetPath: "/brand-logos/connect/apple-health.png",
      description: "Apple Watch, iPhone, app, and HealthKit metrics in one health stream.",
      name: "Apple Health",
    },
    {
      assetPath: "/brand-logos/connect/ultrahuman.jpg",
      description: "Ring-based sleep, recovery, temperature, movement, and metabolic insight signals from Ultrahuman.",
      name: "Ultrahuman",
    },
    {
      assetPath: "/brand-logos/connect/dexcom-g6-and-older.png",
      description: "Legacy Dexcom glucose readings and sensor trends from G6-era devices.",
      name: "Dexcom (G6 and older)",
    },
    {
      assetPath: "/brand-logos/connect/renpho.png",
      description: "Smart-scale weight, body composition, and measurement trends from Renpho devices.",
      name: "Renpho",
    },
    {
      assetPath: "/brand-logos/connect/runkeeper.png",
      description: "Runs, walks, routes, duration, pace, and training history from Runkeeper.",
      name: "Runkeeper",
    },
    {
      assetPath: "/brand-logos/connect/samsung-health.png",
      description: "Samsung phone and watch activity, sleep, heart, and wellness metrics.",
      name: "Samsung Health",
    },
    {
      assetPath: "/brand-logos/connect/tandem-source.png",
      description: "Insulin pump, CGM, therapy, and diabetes device records from Tandem.",
      name: "Tandem Source",
    },
    {
      assetPath: "/brand-logos/connect/beurer.png",
      description: "Blood pressure, scale, glucose, and home health measurements from Beurer.",
      name: "Beurer",
    },
    {
      assetPath: "/brand-logos/connect/strava.svg",
      description: "Rides, runs, workouts, route context, power, and training load from Strava.",
      name: "Strava",
    },
    {
      assetPath: "/brand-logos/connect/freestyle-libre-ble.png",
      description: "Bluetooth Libre glucose readings, trends, and sensor status in near real time.",
      name: "Freestyle Libre BLE",
    },
    {
      assetPath: "/brand-logos/connect/omron.png",
      description: "Blood pressure, pulse, weight, and connected home measurements from Omron.",
      name: "Omron",
    },
    {
      assetPath: "/brand-logos/connect/accuchek.png",
      description: "Accu-Chek glucose readings, meter history, and diabetes tracking context records.",
      name: "Accu-Chek",
    },
    {
      assetPath: "/brand-logos/connect/eight-sleep.svg",
      description: "Mattress-based sleep, temperature, heart rate, and nightly recovery signal trends.",
      name: "Eight Sleep",
    },
    {
      assetPath: "/brand-logos/connect/fitbit.svg",
      description: "Fitbit sleep, activity, heart rate, exercise, and daily readiness-style trends.",
      name: "Fitbit",
    },
    {
      assetPath: "/brand-logos/connect/freestyle-libre.png",
      description: "Libre glucose history, sensor trends, and daily time-in-range context patterns.",
      name: "Freestyle Libre",
    },
    {
      assetPath: "/brand-logos/connect/garmin.png",
      description: "Garmin workouts, sleep, stress, heart, body battery, and activity data.",
      name: "Garmin",
    },
    {
      assetPath: "/brand-logos/connect/hammerhead.png",
      description: "Hammerhead cycling rides, route data, distance, elevation, and performance metrics.",
      name: "Hammerhead",
    },
    {
      assetPath: "/brand-logos/connect/ihealth.png",
      description: "iHealth blood pressure, glucose, weight, oxygen, and home measurement records.",
      name: "iHealth",
    },
    {
      assetPath: "/brand-logos/connect/oura.png",
      description: "Oura sleep, readiness, activity, temperature, heart, and nightly recovery trends.",
      name: "Oura",
    },
    {
      assetPath: "/brand-logos/connect/peloton.svg",
      description: "Peloton rides, runs, strength sessions, output, and performance training history.",
      name: "Peloton",
    },
    {
      assetPath: "/brand-logos/connect/wahoo.png",
      description: "Wahoo cycling, running, heart rate, power, and trainer workout data.",
      name: "Wahoo",
    },
    {
      assetPath: "/brand-logos/connect/contour-ble.png",
      description: "Bluetooth Contour glucose meter readings and diabetes tracking history records.",
      name: "Contour BLE",
    },
    {
      assetPath: "/brand-logos/connect/withings.png",
      description: "Withings scale, sleep, blood pressure, temperature, and activity measurement trends.",
      name: "Withings",
    },
    {
      assetPath: "/brand-logos/connect/google-fit.svg",
      description: "Android activity, steps, heart points, workouts, and wellness record context.",
      name: "Google Fit",
    },
    {
      assetPath: "/brand-logos/connect/zwift.png",
      description: "Indoor rides, runs, power, distance, elevation, and virtual training sessions.",
      name: "Zwift",
    },
    {
      assetPath: "/brand-logos/connect/onetouch.png",
      description: "OneTouch glucose readings, meter history, and diabetes tracking record context.",
      name: "OneTouch",
    },
    {
      assetPath: "/brand-logos/connect/abbott-libreview.svg",
      description: "Abbott LibreView glucose reports, trends, sensor history, and sharing data.",
      name: "Abbott LibreView",
    },
    {
      assetPath: "/brand-logos/connect/dexcom.png",
      description: "Current Dexcom CGM glucose readings, trend arrows, and sensor sessions.",
      name: "Dexcom",
    },
    {
      assetPath: "/brand-logos/connect/kardia.png",
      description: "Kardia ECG recordings, rhythm summaries, and heart health observation history.",
      name: "Kardia",
    },
    {
      assetPath: "/brand-logos/connect/cronometer.png",
      description: "Nutrition logs, calories, macros, micronutrients, and meal timing from Cronometer.",
      name: "Cronometer",
    },
    {
      assetPath: "/brand-logos/connect/polar.png",
      description: "Polar training, sleep, heart rate, recovery, and cardio load data.",
      name: "Polar",
    },
    {
      assetPath: "/brand-logos/connect/health-connect.png",
      description: "Android Health Connect activity, sleep, vitals, nutrition, and body measurements.",
      name: "Health Connect",
    },
  ];

  assert.equal(sources.length, 34);
  assert.equal(markup.match(/data-connection-state="idle"/gu)?.length, sources.length);
  assert.doesNotMatch(markup, /Coming soon/u);
  assert.doesNotMatch(markup, /Not connected/u);
  assert.doesNotMatch(markup, />Connected</u);
  assert.doesNotMatch(markup, />Connect<\/button>/u);
  assert.doesNotMatch(markup, />Manual</u);
  assert.doesNotMatch(markup, /Whoop V2/u);

  for (const source of sources) {
    assert.match(markup, new RegExp(escapeRegExp(source.name)));
    assert.match(markup, new RegExp(`src="${escapeRegExp(source.assetPath)}"`));
    assert.match(
      markup,
      new RegExp(`<img(?=[^>]*alt="")(?=[^>]*src="${escapeRegExp(source.assetPath)}")[^>]*>`, "u"),
    );
    assert.ok(
      existsSync(path.join(process.cwd(), "apps/web/public", source.assetPath)),
      `${source.assetPath} should exist under apps/web/public`,
    );

    const firstWord = source.description.split(/\s+/u)[0];
    assert.notEqual(firstWord, "Sync");
    assert.notEqual(firstWord, "Import");

    const wordCount = source.description.split(/\s+/u).length;
    assert.ok(wordCount >= 10 && wordCount <= 15, `${source.description} should be 10-15 words`);
    assert.match(markup, new RegExp(escapeRegExp(source.description)));
  }

  for (const staleDescription of [
    "Health data source from the Just Cobuild priority catalog.",
    "Sync recovery, strain, sleep, heart rate, and daily readiness trends.",
    "Import logged workouts, routes, pace, distance, and activity history from MapMyFitness.",
  ]) {
    assert.doesNotMatch(markup, new RegExp(escapeRegExp(staleDescription)));
  }

  for (const description of sources.map((source) => source.description)) {
    const wordCount = description.split(/\s+/u).length;
    assert.ok(wordCount >= 10 && wordCount <= 15, `${description} should be 10-15 words`);
  }

  assert.doesNotMatch(markup, />St</);
  assert.doesNotMatch(markup, />Ap</);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
