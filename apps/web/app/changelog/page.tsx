import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Link2 } from "lucide-react";

import { SiteFooter } from "@/src/components/homepage/site-footer";
import { resolveHostedMurphContactOptions } from "@/src/components/murph/hosted-murph-contact-action";
import {
  type ChangelogItem,
  listChangelogEditions,
} from "@/src/lib/changelog";
import { getMurphGithubStarCount } from "@/src/lib/github-stars";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { PhoneMock } from "./phone-mock";
import { StickyNav } from "../sticky-nav";
import { TryItButton } from "./try-it-button";
import {
  AppGrid,
  CalendarMock,
  ChecklistMock,
  DeviceList,
  EmailMock,
  ImagePreview,
  MetricCardMock,
  StatBlock,
  TerminalMock,
  VoiceBubble,
} from "./visuals";

const VISUALS: Record<string, ReactNode> = {
  "native-message-formatting": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "give me my weekly summary" },
        {
          from: "murph",
          body: (
            <div className="space-y-1">
              <p className="font-semibold">Three to focus on this week</p>
              <ul className="list-disc space-y-0.5 pl-4 marker:text-[#736a58]/60">
                <li>Recovery is trending down — protect sleep</li>
                <li>Glucose variability up 22%</li>
                <li>Zone 2 hit 4/4 days</li>
              </ul>
            </div>
          ),
        },
      ]}
    />
  ),
  "telegram-reactions": (
    <PhoneMock
      channel="Telegram"
      messages={[
        {
          from: "user",
          body: "Starting the new sleep routine tonight 👌",
          reaction: "✅",
        },
      ]}
    />
  ),
  "email-auto-reply": (
    <EmailMock
      from="murph@you.murph.ai"
      subject="Re: today's recap"
      body={
        <div className="space-y-1.5">
          <p>Quick read on yesterday:</p>
          <ul className="list-disc space-y-0.5 pl-4 marker:text-[#736a58]/60">
            <li>Protein 137g (+11g)</li>
            <li>Zone 2 22 min</li>
            <li>Sleep 7h12 (+38m vs avg)</li>
          </ul>
          <p className="pt-1">Want me to plan tonight around recovery?</p>
        </div>
      }
    />
  ),
  "voice-memo-transcription": (
    <StatBlock
      label="65-sec voice memo"
      before="~9 min"
      after="seconds"
      caption="now via Workers AI"
    />
  ),
  "thread-auto-compaction": (
    <StatBlock label="Auto-compact at" value="128k" caption="tokens" />
  ),
  "junction-hourly-reconcile": (
    <StatBlock
      label="Wearable refresh"
      before="6 hours"
      after="1 hour"
      caption="WHOOP, Oura, Garmin"
    />
  ),
  "apple-health-expansion": (
    <StatBlock label="Apple Health" value="+14" caption="new series" />
  ),
  "exercise-catalog-250": (
    <StatBlock label="Exercise library" value="+250" caption="at-home moves" />
  ),
  "supplement-label-lookup": (
    <StatBlock label="DSLD catalog" value="214k+" caption="supplement labels" />
  ),
  "vault-cli-cold-start": (
    <TerminalMock
      lines={[
        { command: "murph device list", timing: "0.27s" },
        { command: "murph experiment current", timing: "0.31s" },
        { command: "murph commons protocol show", timing: "0.24s" },
      ]}
    />
  ),
  "faster-cli-startup": (
    <TerminalMock
      lines={[
        { command: "murph device list", timing: "0.21s" },
        { command: "murph experiment list", timing: "0.28s" },
      ]}
    />
  ),
  "food-label-database": (
    <StatBlock label="USDA FoodData" value="~2M" caption="branded foods" />
  ),
  "strict-serving-grams-backfill": (
    <StatBlock label="Accurate grams on" value="1.7M" caption="foods + 28k supplements" />
  ),
  "every-metric-queryable": (
    <StatBlock label="Newly queryable" value="13+" caption="metrics" />
  ),
  "connected-apps-tools": (
    <AppGrid
      apps={[
        { name: "Gmail", color: "#ea4335" },
        { name: "Google Calendar", color: "#1a73e8" },
      ]}
      caption="and more — apps you live in"
    />
  ),
  "linq-message-reactions": (
    <PhoneMock
      channel="iMessage"
      messages={[
        {
          from: "user",
          body: "Walk done — 4mi, easy pace 👌",
          reaction: "✅",
        },
      ]}
    />
  ),
  "telegram-voice-memos": (
    <PhoneMock
      channel="Telegram"
      messages={[
        { from: "user", body: "Voice summary of my training this week?" },
        {
          from: "murph",
          body: <VoiceBubble duration="0:34" />,
        },
      ]}
    />
  ),
  "image-generation-tool": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "Make a simple poster for tonight's group ride" },
        {
          from: "murph",
          body: (
            <ImagePreview
              alt="Generated poster for tonight's group ride"
              caption="Generated"
            />
          ),
        },
      ]}
    />
  ),
  "medication-history": (
    <PhoneMock
      channel="iMessage"
      messages={[
        {
          from: "user",
          body: "Add the 10-day amoxicillin course I finished in March to my history",
        },
        {
          from: "murph",
          body: "Done — 10-day amoxicillin, finished March 14. Anything else from that visit?",
        },
      ]}
    />
  ),
  "behavior-followthrough-skill": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "I missed two workouts again this week..." },
        {
          from: "murph",
          body: "Both on evenings — same slot. Want to shift the plan to mornings, or pick a smaller weekly target?",
        },
      ]}
    />
  ),
  "weekly-research-scout": (
    <PhoneMock
      channel="iMessage"
      messages={[
        {
          from: "murph",
          body: (
            <div className="space-y-1">
              <p className="font-semibold">This week in your topics</p>
              <p>
                New RCT on caffeine + L-theanine timing for sustained focus —
                relevant to your morning routine. Want the takeaway?
              </p>
            </div>
          ),
        },
      ]}
    />
  ),
  "device-activity-automations": (
    <PhoneMock
      channel="iMessage"
      messages={[
        {
          from: "user",
          body: "After every WHOOP workout, send me a one-line recovery prompt",
        },
        {
          from: "murph",
          body: "Saved. I'll ping you after each workout with one recovery move.",
        },
      ]}
    />
  ),
  "computer-use-pause-resume": (
    <PhoneMock
      channel="iMessage"
      messages={[
        {
          from: "user",
          body: "Add oat milk to my Trader Joe's cart, but pause before checkout",
        },
        {
          from: "murph",
          body: "Oat milk in cart. Paused at checkout — ready when you are.",
        },
      ]}
    />
  ),
  "browser-automation-upgrade": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "Book me a haircut for next Tuesday at 6pm" },
        {
          from: "murph",
          body: "Booked at Atlas Barbers for Tue 6:00 PM. Confirmation email landed.",
        },
      ]}
    />
  ),
  "managed-health-cadence": (
    <CalendarMock
      entries={[
        { day: "Sun", time: "12:00 PM", what: "Weekly health insight" },
        { day: "Wed", time: "1:00 PM", what: "Research scout" },
      ]}
    />
  ),
  "telegram-reminder-delivery": (
    <CalendarMock
      label="Scheduled reminders"
      entries={[
        { day: "Mon", time: "8:00 AM", what: "Morning supplements" },
        { day: "Wed", time: "8:00 AM", what: "Morning supplements" },
        { day: "Fri", time: "8:00 AM", what: "Morning supplements" },
      ]}
    />
  ),
  "experiment-progress-cards": (
    <MetricCardMock
      label="Experiment in progress"
      title="Protein floor — day 5 of 14"
      value="137g"
      delta={{ direction: "up", text: "11g vs baseline" }}
      sparkline={[112, 118, 121, 126, 130, 137]}
      caption="Murph sends this as an image in chat."
    />
  ),
  "home-experiments-from-vault": (
    <MetricCardMock
      label="In progress"
      title="Zone-2 minutes — week 2"
      value="88 min"
      delta={{ direction: "up", text: "22 vs week 1" }}
      sparkline={[12, 14, 18, 22, 16, 20, 25]}
      caption="Visible on home as soon as you start."
    />
  ),
  "junction-direct-provider-link": (
    <DeviceList
      devices={[
        { name: "WHOOP", initial: "W", color: "#2d3436", status: "connected" },
        { name: "Oura", initial: "O", color: "#5a6e32", status: "connected" },
        { name: "Garmin", initial: "G", color: "#0078b8", status: "connected" },
      ]}
    />
  ),
  "junction-source-reconnect": (
    <DeviceList
      devices={[
        { name: "WHOOP", initial: "W", color: "#2d3436", status: "connected" },
        { name: "Oura", initial: "O", color: "#5a6e32", status: "reconnect" },
        { name: "Garmin", initial: "G", color: "#0078b8", status: "connected" },
      ]}
    />
  ),
  "biomarkers-onboarding-callout": (
    <ChecklistMock
      label="Connect your data"
      items={[
        { label: "Sync a wearable", done: true },
        { label: "Upload labs", done: false },
        { label: "Pick an experiment", done: false },
      ]}
    />
  ),
  "auto-pulse-trial-enrollment": (
    <ChecklistMock
      label="What you get"
      items={[
        { label: "Sign in", done: true },
        { label: "Trial active automatically", done: true },
        { label: "No credit card needed", done: true },
      ]}
    />
  ),
};

const DESCRIPTION =
  "See what is new in Murph, why it matters, and the simplest way to try each update.";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Changelog · Murph",
  description: DESCRIPTION,
  alternates: {
    canonical: "/changelog",
  },
  openGraph: {
    type: "article",
  },
});

type ResolvedTryIt = {
  authenticated: boolean;
  label: string;
  options: MurphContactOption[];
  prompt?: string | null;
};

export default async function ChangelogPage() {
  const [{ authenticated }, githubStarCount] = await Promise.all([
    getHostedPageAuthSnapshot(),
    getMurphGithubStarCount(),
  ]);
  const editions = listChangelogEditions();
  const tryItByItemId = await resolveTryItByItemId({
    authenticated,
    editions,
  });

  return (
    <>
      <main className="min-h-dvh bg-[#f5f0e8] text-[#2d3436] antialiased">
        <StickyNav
          authenticated={authenticated}
          githubStarCount={githubStarCount}
        />
        <section className="bg-[#1f241c] px-6 pt-24 pb-12 text-[#f5f0e8] sm:px-10 sm:pt-28 sm:pb-14 lg:px-16 lg:pt-32 lg:pb-16">
          <div className="mx-auto max-w-[1080px]">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="h-px w-10 bg-[#c4a882]/60" />
              <p className="font-mono text-[10px] font-medium text-[#c4a882] uppercase tracking-[0.18em]">
                Changelog
              </p>
            </div>
            <h1 className="mt-5 max-w-[18ch] font-serif text-3xl font-semibold leading-[1.08] tracking-tight text-balance sm:text-4xl lg:text-[2.75rem]">
              What&rsquo;s new with Murph
            </h1>
            <p className="mt-4 max-w-[52ch] text-[15px] leading-[1.65] text-pretty text-[#f5f0e8]/70 sm:text-base">
              Check in every day to see the features and improvements we built for you.
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-[1080px] px-6 py-16 sm:px-10 sm:py-20 lg:px-0 lg:py-24">
          {editions.map((edition, editionIndex) => {
            const features = edition.items.filter((item) => item.kind === "feature");
            const improvements = edition.items.filter(
              (item) => item.kind === "improvement",
            );

            return (
              <section
                key={edition.id}
                aria-labelledby={`edition-${edition.id}`}
                className={editionIndex === 0 ? "" : "mt-20 border-t border-[#c4a882]/35 pt-20"}
              >
                <div className="grid items-start gap-10 lg:grid-cols-[240px_1fr] lg:gap-16">
                  <div className="lg:sticky lg:top-24 lg:self-start">
                    <time
                      className="font-mono text-[10px] font-medium text-[#736a58] uppercase tracking-[0.18em]"
                      dateTime={edition.publishedOn}
                    >
                      {formatEditionDate(edition.publishedOn)}
                    </time>
                    <h2
                      id={`edition-${edition.id}`}
                      className="mt-3 font-serif text-[1.75rem] font-semibold leading-[1.15] tracking-tight text-balance"
                    >
                      {edition.title}
                    </h2>
                    <p className="mt-3 max-w-[36ch] text-[14.5px] leading-[1.6] text-pretty text-[#5f584b]">
                      {edition.summary}
                    </p>
                  </div>

                  <div>
                    {features.length > 0 ? (
                      <ItemGroup
                        label="New features"
                        items={features}
                        tryItByItemId={tryItByItemId}
                      />
                    ) : null}
                    {improvements.length > 0 ? (
                      <div className={features.length > 0 ? "mt-10" : ""}>
                        <ItemGroup
                          label="Under the hood"
                          items={improvements}
                          tryItByItemId={tryItByItemId}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function ItemGroup({
  label,
  items,
  tryItByItemId,
}: {
  items: readonly ChangelogItem[];
  label: string;
  tryItByItemId: Map<string, ResolvedTryIt>;
}) {
  return (
    <div>
      <p className="font-mono text-[10px] font-medium text-[#3a4a1e] uppercase tracking-[0.18em]">
        {label}
      </p>
      <div className="mt-4 grid gap-4">
        {items.map((item) => {
          const resolved = tryItByItemId.get(item.id);
          return (
            <article
              key={item.id}
              id={item.id}
              className="group/card relative scroll-mt-28 rounded-2xl border border-[#c4a882]/35 bg-[#fffcf6]/85 p-6 transition-colors duration-200 ease-out hover:border-[#c4a882]/55 sm:p-7"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] font-medium text-[#736a58] uppercase tracking-[0.18em]">
                    {item.kind === "feature" ? "Feature" : "Improvement"}
                  </p>
                  <h3 className="mt-2 font-serif text-[1.5rem] font-semibold leading-[1.15] tracking-tight text-balance sm:text-[1.6rem]">
                    {item.title}
                  </h3>
                </div>
                <a
                  aria-label={`Permalink to ${item.title}`}
                  className="-mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#736a58] opacity-0 transition-[background-color,color,opacity] hover:bg-[#c4a882]/15 hover:text-[#3a4a1e] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5a6e32]/40 group-hover/card:opacity-100"
                  href={`#${item.id}`}
                >
                  <Link2 aria-hidden="true" className="h-4 w-4" />
                </a>
              </div>
              <p className="mt-4 max-w-[66ch] text-[15.5px] leading-[1.65] text-pretty text-[#4d453b]">
                {item.summary}
              </p>
              {item.details ? (
                <p className="mt-2.5 max-w-[66ch] text-[14.5px] leading-[1.6] text-pretty text-[#736a58]">
                  {item.details}
                </p>
              ) : null}
              {VISUALS[item.id] ?? null}
              {item.tryIt && resolved ? (
                <TryIt item={item} resolved={resolved} />
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function TryIt({
  item,
  resolved,
}: {
  item: ChangelogItem;
  resolved: ResolvedTryIt;
}) {
  const tryIt = item.tryIt;
  if (!tryIt) {
    return null;
  }

  return (
    <div className="mt-5 flex justify-end border-t border-[#c4a882]/30 pt-5">
      <div>
        {tryIt.href ? (
          <a
            href={tryIt.href}
            className="group/try inline-flex items-center gap-1.5 rounded-full border border-[#3a4a1e]/15 bg-[#3a4a1e] px-3 py-1.5 text-[13px] font-medium text-[#f5f0e8] outline-none transition-[background-color,color] duration-150 ease-out hover:bg-[#2d3a16] focus-visible:ring-2 focus-visible:ring-[#5a6e32]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffcf6] active:scale-[0.97]"
          >
            {tryIt.label}
            <span aria-hidden="true" className="text-xs leading-none transition-transform duration-150 ease-out group-hover/try:translate-x-0.5">→</span>
          </a>
        ) : (
          <TryItButton
            authenticated={resolved.authenticated}
            label={resolved.label}
            options={resolved.options}
            prompt={resolved.prompt}
          />
        )}
      </div>
    </div>
  );
}

async function resolveTryItByItemId({
  authenticated,
  editions,
}: {
  authenticated: boolean;
  editions: readonly { items: readonly ChangelogItem[] }[];
}): Promise<Map<string, ResolvedTryIt>> {
  const itemsWithPrompt = editions
    .flatMap((edition) => edition.items)
    .filter((item) => item.tryIt?.prompt && !item.tryIt.href);

  const entries = await Promise.all(
    itemsWithPrompt.map(async (item) => {
      const prompt = item.tryIt!.prompt!;
      const options = await resolveHostedMurphContactOptions({
        message: {
          body: prompt,
          subject: `Try it: ${item.title}`,
        },
      });
      return [
        item.id,
        {
          authenticated,
          label: item.tryIt!.label,
          options,
          prompt,
        } satisfies ResolvedTryIt,
      ] as const;
    }),
  );

  return new Map(entries);
}

function formatEditionDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00.000Z`));
}
