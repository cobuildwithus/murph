import Image from "next/image";
import { RefreshCcw } from "lucide-react";

const MACROS = [
  { name: "Protein", amount: "138 g", width: "84%" },
  { name: "Carbs", amount: "214 g", width: "62%" },
  { name: "Fat", amount: "81 g", width: "55%" },
] as const;

function CameraArtifact() {
  return (
    <div className="w-full max-w-[250px] rounded-[46px] bg-[#d8d8dd] p-[3px] shadow-[0_32px_70px_-28px_rgba(60,40,20,0.55)]">
      <div className="rounded-[43px] bg-black p-[6px]">
        <div className="relative aspect-[9/18.5] overflow-hidden rounded-[37px]">
          <Image
            alt="A salad bowl framed in the phone camera"
            className="object-cover"
            fill
            sizes="250px"
            src="/meal-snap-2.jpg"
          />

          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/45 to-transparent"
          />
          <div
            aria-hidden="true"
            className="absolute top-2.5 left-1/2 h-[24px] w-[86px] -translate-x-1/2 rounded-full bg-black"
          />

          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 via-black/35 to-transparent pt-12">
            <div className="flex items-center justify-center gap-1.5">
              {[".5", "1x", "2", "5"].map((zoom) => (
                <span
                  key={zoom}
                  className={
                    zoom === "1x"
                      ? "flex size-7 items-center justify-center rounded-full bg-black/45 font-mono text-[10px] font-semibold text-[#f5c542]"
                      : "flex size-5 items-center justify-center rounded-full bg-black/35 font-mono text-[8px] text-white/85"
                  }
                >
                  {zoom}
                </span>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between px-5">
              <div className="relative size-8 overflow-hidden rounded-[8px] ring-1 ring-white/60">
                <Image
                  alt=""
                  aria-hidden="true"
                  className="object-cover"
                  fill
                  sizes="32px"
                  src="/meal-snap-2.jpg"
                />
              </div>
              <div className="flex size-[52px] items-center justify-center rounded-full border-[3px] border-white">
                <div className="size-[42px] rounded-full bg-white" />
              </div>
              <div className="flex size-8 items-center justify-center rounded-full bg-white/20">
                <RefreshCcw aria-hidden="true" className="size-3.5 text-white" />
              </div>
            </div>

            <div className="mt-2.5 flex items-center justify-center gap-4 font-mono text-[9px] font-medium tracking-[0.15em]">
              <span className="text-white/70">VIDEO</span>
              <span className="text-[#f5c542]">PHOTO</span>
            </div>

            <div className="flex justify-center pt-2 pb-2">
              <div className="h-1 w-24 rounded-full bg-white/80" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Other shots in the roll, dimmed so the food photo Murph picks out reads as
// the one it grabbed on its own.
const OTHER_ROLL_PHOTOS = [
  "/design-assets/hero-morning-outdoor-light-exposure.jpeg",
  "/design-assets/cold-plunge-tub.jpeg",
  "/design-assets/hero-walking-after-every-meal.jpeg",
] as const;

function BackgroundLogArtifact() {
  return (
    <div className="w-full max-w-[320px] rounded-2xl bg-[#fffcf6] p-3.5 ring-1 ring-black/[0.05] shadow-[0_12px_40px_-12px_rgba(45,52,54,0.18)]">
      <div className="flex items-center justify-between px-1">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-[#8a6428]">
          Your camera roll
        </span>
      </div>

      <div className="mt-3 grid grid-cols-[1.9fr_1fr] gap-2">
        <div className="relative overflow-hidden rounded-xl ring-2 ring-[#2c7a3f]">
          <div className="relative aspect-square">
            <Image
              alt="Your meal photo, picked out of the camera roll on its own"
              className="object-cover"
              fill
              sizes="200px"
              src="/meal-snap-2.jpg"
            />
          </div>
          <span className="absolute top-2 left-2 rounded-full bg-black/55 px-2 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-white backdrop-blur-sm">
            New
          </span>
          <span className="absolute right-2 bottom-2 rounded-full bg-[#2c7a3f] px-2.5 py-1 font-mono text-[9px] font-medium tracking-[0.1em] text-white shadow-[0_4px_12px_rgba(0,0,0,0.25)]">
            ✓ Logged
          </span>
        </div>

        <div className="flex flex-col gap-2" aria-hidden="true">
          {OTHER_ROLL_PHOTOS.map((src) => (
            <div
              key={src}
              className="relative min-h-0 flex-1 overflow-hidden rounded-lg opacity-55"
            >
              <Image
                alt=""
                className="object-cover"
                fill
                sizes="90px"
                src={src}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-baseline justify-between border-t border-[#c4a882]/25 px-1 pt-2.5">
        <span className="text-[0.875rem] font-semibold text-[#2d3436]">
          Grain bowl
        </span>
        <span className="font-mono text-[0.875rem] font-semibold tabular-nums text-[#2d3436]">
          ≈ 570 cal
        </span>
      </div>
    </div>
  );
}

function DailyTallyArtifact() {
  return (
    <div className="w-full max-w-[340px]">
      <p className="mb-2 pl-1 font-mono text-[10px] tracking-[0.08em] text-[#736a58]">
        Murph · 9:30 PM
      </p>
      <div className="w-fit rounded-2xl rounded-bl-[6px] bg-white px-4 py-2.5 text-[0.9375rem] leading-[1.4] text-[#2d3436] shadow-[0_8px_24px_-6px_rgba(60,40,20,0.2)]">
        Dinner closed you out at 2,140. That&apos;s five days straight hitting
        your protein target.
      </div>
      <div className="mt-3 rounded-2xl bg-[#fffcf6] p-5 ring-1 ring-black/[0.05] shadow-[0_12px_40px_-12px_rgba(45,52,54,0.18)]">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-[#8a6428]">
            Daily tally
          </span>
          <span className="font-mono text-[10px] tabular-nums text-[#736a58]">
            3 meals
          </span>
        </div>
        <p className="mt-3 font-serif text-[2rem] font-semibold leading-none tracking-[-0.02em] text-[#2d3436]">
          2,140 cal
        </p>
        <div className="mt-4 space-y-3">
          {MACROS.map((m) => (
            <div key={m.name}>
              <div className="flex items-baseline justify-between text-[0.8125rem] leading-[1.4]">
                <span className="text-[#635a48]">{m.name}</span>
                <span className="font-mono tabular-nums text-[#2d3436]">
                  {m.amount}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-[#2d3436]/[0.08]">
                <div
                  className="h-full rounded-full bg-[#2c7a3f]/80"
                  style={{ width: m.width }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  {
    number: "01",
    heading: "You take the picture.",
    body: "The same photo you'd snap anyway. Don't open an app, don't type a thing.",
    artifact: <CameraArtifact />,
  },
  {
    number: "02",
    heading: "Murph logs it by itself.",
    body: "No app to open. Your phone flags the food photos on its own, and Murph logs them for you.",
    artifact: <BackgroundLogArtifact />,
  },
  {
    number: "03",
    heading: "Your tally texts you at night.",
    body: "Calories, macros, and streaks, in the same thread as everything else.",
    artifact: <DailyTallyArtifact />,
  },
] as const;

export function MealPhotosSection() {
  return (
    <section className="bg-[linear-gradient(170deg,#f8f0dd_0%,#efe1c2_100%)] px-4 py-20 sm:px-8 lg:px-16 lg:py-28">
      <div className="mx-auto max-w-[1200px]">
        <div className="max-w-[720px]">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#8a6428]">
            Calorie counting
          </p>
          <h2 className="mt-4 font-serif text-[clamp(2rem,4vw,3.25rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-[#2d3436]">
            The calorie tracker you never open.
          </h2>
          <p className="mt-5 max-w-[62ch] text-[1rem] leading-[1.7] text-[#3a322a]">
            Take a picture of your plate and put your phone away. No logging,
            no weighing, no forgetting.
          </p>
        </div>

        <div className="mt-14 grid gap-14 sm:grid-cols-2 sm:gap-10 lg:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.number} className="flex flex-col">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8a6428]">
                {step.number}
              </p>
              <h3 className="mt-3 font-serif text-[1.375rem] font-semibold leading-[1.1] tracking-[-0.02em] text-[#2d3436]">
                {step.heading}
              </h3>
              <p className="mt-2 max-w-[36ch] text-[0.875rem] leading-[1.6] text-[#635a48]">
                {step.body}
              </p>
              <div className="mt-7">{step.artifact}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
