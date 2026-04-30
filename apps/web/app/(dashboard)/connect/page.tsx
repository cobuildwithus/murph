import type { Metadata } from "next";
import Image from "next/image";

import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Connect Devices — Murph",
  description: "Connect your wearables and health data sources.",
});

type LogoAsset = {
  className: string;
  height: number;
  src: string;
  width: number;
};

type ConnectSource = {
  description: string;
  id: string;
  logo: LogoAsset;
  name: string;
};

const CONNECT_SOURCES: readonly ConnectSource[] = [
  {
    description: "Recovery, strain, sleep, heart rate, and daily readiness from Whoop.",
    id: "whoop",
    logo: logoAsset("whoop.svg", "h-auto max-h-7 w-auto max-w-[8rem] object-contain", 96, 15),
    name: "Whoop",
  },
  {
    description: "Flexible hand-entered measurements, notes, workouts, and observations when no device fits.",
    id: "manual",
    logo: logoAsset("manual.svg"),
    name: "Manual",
  },
  {
    description: "Logged workouts, routes, pace, distance, and activity history from MapMyFitness.",
    id: "mapmyfitness",
    logo: logoAsset("mapmyfitness.png"),
    name: "MapMyFitness",
  },
  {
    description: "Apple Watch, iPhone, app, and HealthKit metrics in one health stream.",
    id: "apple-health",
    logo: logoAsset("apple-health.png"),
    name: "Apple Health",
  },
  {
    description: "Ring-based sleep, recovery, temperature, movement, and metabolic insight signals from Ultrahuman.",
    id: "ultrahuman",
    logo: logoAsset("ultrahuman.jpg"),
    name: "Ultrahuman",
  },
  {
    description: "Legacy Dexcom glucose readings and sensor trends from G6-era devices.",
    id: "dexcom-g6-and-older",
    logo: logoAsset("dexcom-g6-and-older.png"),
    name: "Dexcom (G6 and older)",
  },
  {
    description: "Smart-scale weight, body composition, and measurement trends from Renpho devices.",
    id: "renpho",
    logo: logoAsset("renpho.png"),
    name: "Renpho",
  },
  {
    description: "Runs, walks, routes, duration, pace, and training history from Runkeeper.",
    id: "runkeeper",
    logo: logoAsset("runkeeper.svg"),
    name: "Runkeeper",
  },
  {
    description: "Samsung phone and watch activity, sleep, heart, and wellness metrics.",
    id: "samsung-health",
    logo: logoAsset("samsung-health.svg", "h-auto max-h-9 w-auto max-w-[8rem] object-contain", 112, 16),
    name: "Samsung Health",
  },
  {
    description: "Insulin pump, CGM, therapy, and diabetes device records from Tandem.",
    id: "tandem-source",
    logo: logoAsset("tandem-source.png"),
    name: "Tandem Source",
  },
  {
    description: "Blood pressure, scale, glucose, and home health measurements from Beurer.",
    id: "beurer",
    logo: logoAsset("beurer.png"),
    name: "Beurer",
  },
  {
    description: "Rides, runs, workouts, route context, power, and training load from Strava.",
    id: "strava",
    logo: logoAsset("strava.svg", "h-auto max-h-9 w-auto max-w-[8rem] object-contain", 96, 20),
    name: "Strava",
  },
  {
    description: "Bluetooth Libre glucose readings, trends, and sensor status in near real time.",
    id: "freestyle-libre-ble",
    logo: logoAsset("freestyle-libre-ble.png"),
    name: "Freestyle Libre BLE",
  },
  {
    description: "Blood pressure, pulse, weight, and connected home measurements from Omron.",
    id: "omron",
    logo: logoAsset("omron.png"),
    name: "Omron",
  },
  {
    description: "Accu-Chek glucose readings, meter history, and diabetes tracking context records.",
    id: "accuchek",
    logo: logoAsset("accuchek.png"),
    name: "Accu-Chek",
  },
  {
    description: "Mattress-based sleep, temperature, heart rate, and nightly recovery signal trends.",
    id: "eight-sleep",
    logo: logoAsset("eight-sleep.svg"),
    name: "Eight Sleep",
  },
  {
    description: "Fitbit sleep, activity, heart rate, exercise, and daily readiness-style trends.",
    id: "fitbit",
    logo: logoAsset("fitbit.svg"),
    name: "Fitbit",
  },
  {
    description: "Libre glucose history, sensor trends, and daily time-in-range context patterns.",
    id: "freestyle-libre",
    logo: logoAsset("freestyle-libre.png"),
    name: "Freestyle Libre",
  },
  {
    description: "Garmin workouts, sleep, stress, heart, body battery, and activity data.",
    id: "garmin",
    logo: logoAsset("garmin.svg"),
    name: "Garmin",
  },
  {
    description: "Hammerhead cycling rides, route data, distance, elevation, and performance metrics.",
    id: "hammerhead",
    logo: logoAsset("hammerhead.png"),
    name: "Hammerhead",
  },
  {
    description: "iHealth blood pressure, glucose, weight, oxygen, and home measurement records.",
    id: "ihealth",
    logo: logoAsset("ihealth.png"),
    name: "iHealth",
  },
  {
    description: "Oura sleep, readiness, activity, temperature, heart, and nightly recovery trends.",
    id: "oura",
    logo: logoAsset("oura.png", "h-auto max-h-8 w-auto max-w-[8rem] object-contain", 96, 30),
    name: "Oura",
  },
  {
    description: "Peloton rides, runs, strength sessions, output, and performance training history.",
    id: "peloton",
    logo: logoAsset("peloton.svg"),
    name: "Peloton",
  },
  {
    description: "Wahoo cycling, running, heart rate, power, and trainer workout data.",
    id: "wahoo",
    logo: logoAsset("wahoo.png"),
    name: "Wahoo",
  },
  {
    description: "Bluetooth Contour glucose meter readings and diabetes tracking history records.",
    id: "contour-ble",
    logo: logoAsset("contour-ble.png"),
    name: "Contour BLE",
  },
  {
    description: "Withings scale, sleep, blood pressure, temperature, and activity measurement trends.",
    id: "withings",
    logo: logoAsset("withings.png"),
    name: "Withings",
  },
  {
    description: "Android activity, steps, heart points, workouts, and wellness record context.",
    id: "google-fit",
    logo: logoAsset("google-fit.svg"),
    name: "Google Fit",
  },
  {
    description: "Indoor rides, runs, power, distance, elevation, and virtual training sessions.",
    id: "zwift",
    logo: logoAsset("zwift.png"),
    name: "Zwift",
  },
  {
    description: "OneTouch glucose readings, meter history, and diabetes tracking record context.",
    id: "onetouch",
    logo: logoAsset("onetouch.png"),
    name: "OneTouch",
  },
  {
    description: "Abbott LibreView glucose reports, trends, sensor history, and sharing data.",
    id: "abbott-libreview",
    logo: logoAsset("abbott-libreview.svg"),
    name: "Abbott LibreView",
  },
  {
    description: "Current Dexcom CGM glucose readings, trend arrows, and sensor sessions.",
    id: "dexcom",
    logo: logoAsset("dexcom.png"),
    name: "Dexcom",
  },
  {
    description: "Kardia ECG recordings, rhythm summaries, and heart health observation history.",
    id: "kardia",
    logo: logoAsset("kardia.png"),
    name: "Kardia",
  },
  {
    description: "Nutrition logs, calories, macros, micronutrients, and meal timing from Cronometer.",
    id: "cronometer",
    logo: logoAsset("cronometer.png"),
    name: "Cronometer",
  },
  {
    description: "Polar training, sleep, heart rate, recovery, and cardio load data.",
    id: "polar",
    logo: logoAsset("polar.png"),
    name: "Polar",
  },
  {
    description: "Android Health Connect activity, sleep, vitals, nutrition, and body measurements.",
    id: "health-connect",
    logo: logoAsset("health-connect.png"),
    name: "Health Connect",
  },
] as const;

export default function ConnectPage() {
  return (
    <div className="flex w-full min-w-0 max-w-[calc(100vw-3rem)] flex-col gap-8 md:max-w-full">
      <div className="min-w-0">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
            Just Cobuild sources
          </p>
          <h1 className="mt-2 font-serif text-3xl font-semibold tracking-normal text-foreground">
            Connect your health
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Bring in sleep, activity, recovery, glucose, and device context from
            the tools you already use.
          </p>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        {CONNECT_SOURCES.map((source) => (
          <div
            key={source.id}
            className="box-border flex min-w-0 w-full max-w-full flex-col justify-between overflow-hidden rounded-xl border border-border/50 bg-[rgba(255,252,246,0.9)] p-5"
          >
            <div className="mb-5 flex h-14 min-w-0 items-center">
              <SourceLogo source={source} />
            </div>

            <div className="mb-5 min-w-0">
              <h2 className="font-serif text-lg font-semibold text-foreground">
                {source.name}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {source.description}
              </p>
            </div>

            <div className="box-border w-full max-w-full rounded-xl border border-border/60 bg-background px-6 py-3 text-center text-sm font-medium text-muted-foreground">
              Coming soon
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourceLogo({ source }: { source: ConnectSource }) {
  return (
    <Image
      src={source.logo.src}
      alt=""
      width={source.logo.width}
      height={source.logo.height}
      className={source.logo.className}
    />
  );
}

function logoAsset(
  fileName: string,
  className = "size-11 object-contain",
  width = 44,
  height = 44,
): LogoAsset {
  return {
    className,
    height,
    src: `/brand-logos/connect/${fileName}`,
    width,
  };
}
