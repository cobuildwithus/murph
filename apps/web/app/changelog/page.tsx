import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Link2 } from "lucide-react";

import { SiteFooter } from "@/src/components/homepage/site-footer";
import { resolveHostedMurphContactOptions } from "@/src/components/murph/hosted-murph-contact-action";
import {
  buildAbsoluteChangelogUrl,
  buildChangelogCardPath,
  buildChangelogItemPath,
  buildChangelogPagePath,
  CHANGELOG_PREVIEW_CARD_ITEMS,
  type ChangelogItem,
  resolveChangelogEditionPage,
  resolveChangelogPage,
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
  AppIconCard,
  ApprovalCard,
  AssessmentCard,
  CalendarMock,
  ChecklistMock,
  DeviceList,
  EmailMock,
  ExerciseGrid,
  GoalsRegimenCard,
  ImagePreview,
  MealCard,
  MetricCardMock,
  PdfPreview,
  PreferenceCard,
  PrivacyTimeline,
  ReasoningSteps,
  SongBubble,
  StatBlock,
  VoiceBubble,
} from "./visuals";

const VISUALS: Record<string, ReactNode> = {
  "model-and-reasoning-controls": (
    <PreferenceCard
      label="Thinking settings"
      meta="next reply"
      entries={[
        { label: "Model", value: "Terra" },
        { label: "Reasoning", value: "Medium" },
        { label: "Plan access", value: "Active" },
      ]}
    />
  ),
  "private-group-join-confirmation": (
    <PhoneMock
      channel="Private iMessage"
      messages={[
        {
          from: "murph",
          body: "You just joined a Murph group. Was that intentional?",
        },
        {
          from: "murph",
          body: "You can review or change what you share from the group controls.",
        },
      ]}
    />
  ),
  "approved-actions-resume": (
    <ApprovalCard
      action="Confirm the pharmacy refill"
      cta="Approve and resume"
      detail="Murph continues the parked task as soon as your decision lands."
    />
  ),
  "group-tools-stay-group-scoped": (
    <ChecklistMock
      label="Available in a group"
      items={[
        { label: "Group newsletter and shared weekly view", done: true },
        { label: "Room-owned reminders and challenge rules", done: true },
        { label: "A member's wearables or connected accounts", done: false },
        { label: "Personal billing, browser, or phone controls", done: false },
      ]}
    />
  ),
  "browser-vault-stays-warm": (
    <StatBlock
      label="Dashboard navigation"
      before="Full reload"
      after="Stays warm"
      caption="memory only, cleared on logout"
    />
  ),
  "managed-login-live-fallback": (
    <ReasoningSteps
      label="Browser login recovery"
      steps={[
        { label: "Managed login could not start", state: "done" },
        { label: "Restore the task browser", state: "done" },
        {
          label: "Continue in the secure live login",
          note: "No failed retry loop",
          state: "active",
        },
      ]}
    />
  ),
  "group-weekly-shared-view": (
    <EmailMock
      from="Murph"
      subject="The group, this week"
      body={
        <div className="space-y-1.5">
          <p>Three members shared seven nights of sleep.</p>
          <p>Average duration rose 24 minutes in the group&apos;s timezone.</p>
          <p>Friday was the common low point. Worth comparing notes?</p>
        </div>
      }
    />
  ),
  "device-replays-storage-noop": (
    <StatBlock
      label="Unchanged wearable replay"
      before="Saved again"
      after="No new copy"
      caption="corrections still land"
    />
  ),
  "eye-health-playbook": (
    <AssessmentCard
      topic="Eye health"
      assessment="Dryness after screen-heavy days, without pain, light sensitivity, or vision loss."
      nextAction="Start with breaks, blinking, and preservative-free tears"
      rationale="Urgent warning signs stay first if the pattern changes."
    />
  ),
  "exercise-library-250-visual-guides": (
    <ExerciseGrid
      tiles={[
        { hue: 34, name: "Dead bug", reps: "6 / side" },
        { hue: 88, name: "Couch stretch", reps: "45 sec" },
        { hue: 18, name: "Split squat", reps: "8 / side" },
      ]}
      caption="Each movement opens to a short step-by-step carousel."
    />
  ),
  "value-first-onboarding": (
    <PhoneMock
      channel="Private iMessage"
      messages={[
        { from: "murph", body: "What would be useful to work through today?" },
        { from: "user", body: "why am I exhausted every afternoon?" },
        {
          from: "murph",
          body: "Let's start there. I can ask for the rest of your health context only when it helps.",
        },
      ]}
    />
  ),
  "supplements-use-saved-context": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "should I add magnesium?" },
        {
          from: "murph",
          body: "Maybe, but your saved labs do not show a clear deficiency, and one of your medications changes the timing. Let's weigh the likely upside first.",
        },
      ]}
    />
  ),
  "phone-call-content-encrypted": (
    <ChecklistMock
      label="Stored after a Murph call"
      items={[
        { label: "Encrypted call brief and final result", done: true },
        { label: "Minimal provider status and timestamps", done: true },
        { label: "Raw transcript or recording", done: false },
        { label: "Call audio", done: false },
      ]}
    />
  ),
  "sessions-and-restores-fail-safer": (
    <PrivacyTimeline
      events={[
        { day: 0, label: "Session bound to server-held proof", tone: "neutral" },
        { day: 0, label: "Restore validates the incoming workspace", tone: "neutral" },
        { day: 0, label: "Failure keeps the last good copy", tone: "neutral" },
      ]}
      caption="A failed restore never becomes an empty replacement."
    />
  ),
  "voice-card-tap-preview": (
    <PreferenceCard
      label="Pick Murph's voice"
      meta="tap to preview"
      entries={[
        { label: "Classic Murph", note: "Clear and energetic", value: "Playing" },
        { label: "Warm and friendly", note: "Soft and conversational", value: "Preview" },
        { label: "Deep and calming", note: "Low and steady", value: "Preview" },
      ]}
    />
  ),
  "small-phone-layout-polish": (
    <ChecklistMock
      label="Small-screen pass"
      items={[
        { label: "Labs and Habits demos stay inside the card", done: true },
        { label: "Connect and reconnect messages stack", done: true },
        { label: "Duplicate units and dense waveform bars trimmed", done: true },
      ]}
    />
  ),
  "new-group-state-recovery": (
    <PhoneMock
      channel="iMessage · New group"
      messages={[
        { from: "user", body: "Murph, can you referee our sleep challenge?" },
        {
          from: "murph",
          body: "Yes. This group is new, so I'll set up the shared rules first, then we can choose what counts.",
        },
      ]}
    />
  ),
  "murph-style-controls": (
    <PreferenceCard
      label="How Murph talks"
      entries={[
        { label: "Texting tone", value: "Direct" },
        { label: "Voice memo", value: "Classic Murph" },
        { label: "Humor · Push · Detail", value: "4 · 6 · 7" },
      ]}
    />
  ),
  "edge-model-choice": (
    <PreferenceCard
      label="Model"
      meta="Edge"
      entries={[
        { label: "GPT-5.6 Terra", note: "Default", value: "Available" },
        { label: "GPT-5.6 Sol", note: "Stronger reasoning", value: "Selected" },
      ]}
    />
  ),
  "group-challenge-comics-and-stakes": (
    <PhoneMock
      channel="iMessage · Sunday crew"
      messages={[
        {
          from: "murph",
          bare: true,
          body: (
            <ImagePreview
              alt="Comic-strip group challenge standings"
              caption="Week 2 standings, remixed from the group chat"
            />
          ),
        },
      ]}
    />
  ),
  "whoop-recovery-strain-healthkit": (
    <MetricCardMock
      label="WHOOP via Apple Health"
      title="Recovery"
      value="78%"
      delta={{ direction: "up", text: "9 points" }}
      sparkline={[62, 68, 65, 71, 69, 74, 78]}
      caption="Workout Strain joins the same private record."
    />
  ),
  "grounded-health-advice": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "how do I improve my deep sleep?" },
        {
          from: "murph",
          body: "Your deep sleep averaged 48m the last two weeks, down from 1h 12m in May.",
        },
        {
          from: "murph",
          body: "The drop lines up with your 10:40pm bedtime slipping past midnight on weeknights. Want to start there?",
        },
      ]}
    />
  ),
  "weekly-improvement-coach": (
    <PhoneMock
      channel="iMessage · Tuesday"
      messages={[
        {
          from: "murph",
          body: "You haven't lifted in 3 weeks, and it's the one gap in an otherwise strong month.",
        },
        {
          from: "murph",
          body: "Want to put two 20-minute sessions on the calendar this week? I'll write them.",
        },
      ]}
    />
  ),
  "generated-images-saved-to-vault": (
    <PhoneMock
      channel="iMessage · Sunday crew"
      messages={[
        { from: "user", body: "make the group photo, but at sunrise" },
        {
          from: "murph",
          bare: true,
          body: (
            <ImagePreview
              alt="Regenerated group chat photo at sunrise"
              caption="Variation on the saved group photo"
            />
          ),
        },
      ]}
    />
  ),
  "quieter-weekly-messages": (
    <StatBlock
      label="Weekly digest"
      before="Every week"
      after="When it matters"
      caption="ordinary weeks stay silent"
    />
  ),
  "apple-health-connect-card": (
    <DeviceList
      devices={[
        {
          name: "Apple Health",
          initial: "A",
          color: "#2d3436",
          status: "connected",
        },
        { name: "WHOOP", initial: "W", color: "#2d3436", status: "connected" },
        { name: "Oura", initial: "O", color: "#5a6e32", status: "reconnect" },
      ]}
    />
  ),
  "whoop-sleep-beats-empty-copies": (
    <StatBlock
      label="Deep sleep, same night"
      before="0m"
      after="1h 24m"
      caption="WHOOP record, not the empty copy"
    />
  ),
  "songs-fit-their-length": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "30-second song to get me out of bed" },
        {
          from: "murph",
          body: (
            <SongBubble
              title="Up and out"
              artist="Murph · ElevenLabs"
              duration="0:30"
            />
          ),
        },
      ]}
    />
  ),
  "group-bursts-reach-murph": (
    <StatBlock
      label="Messages in a group burst"
      before="First 10"
      after="All of them"
      caption="no waiting for the next wake-up"
    />
  ),
  "reply-message-bubbles": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "how'd my week go?" },
        { from: "murph", body: "Four runs, 22 miles. Best week since April." },
        {
          from: "murph",
          body: "Sleep held above 7 hours every night but Friday.",
        },
        { from: "murph", body: "Want to push for five runs next week?" },
      ]}
    />
  ),
  "group-rename-and-avatar": (
    <PhoneMock
      channel="iMessage · Sunday crew"
      messages={[
        { from: "user", body: "rename us to Sunday Crew and make a group pic" },
        {
          from: "murph",
          bare: true,
          body: (
            <ImagePreview
              alt="Generated group chat photo"
              caption="Sunday Crew · set as group photo"
            />
          ),
        },
      ]}
    />
  ),
  "challenge-score-sharing": (
    <ChecklistMock
      label="Sunday Crew asks to score"
      items={[
        { label: "Running distance, daily total", done: true },
        { label: "Strength sessions, daily count", done: true },
        { label: "Routes and raw workouts", done: false },
      ]}
    />
  ),
  "weekly-note-alternates-features": (
    <CalendarMock
      label="Your weekly note"
      entries={[
        { day: "Week 1", time: "Sun", what: "What shipped in Murph" },
        { day: "Week 2", time: "Sun", what: "A feature you haven't tried" },
      ]}
    />
  ),
  "small-fixes-july-eight": (
    <ChecklistMock
      label="Fixed this week"
      items={[
        { label: "Replies stop quoting your text back", done: true },
        { label: "Typing bubble works in group chats", done: true },
        { label: "Image generation waits before giving up", done: true },
        { label: "A skipped device sync retries", done: true },
      ]}
    />
  ),
  "vault-files-actually-send": (
    <PdfPreview
      title="Bloodwork — Jun 2026"
      meta="Delivered · 2 pages"
      lines={5}
    />
  ),
  "faster-recovery-from-stalled-replies": (
    <StatBlock
      label="Recovery from a silent connection"
      before="5 min"
      after="90s"
      caption="then it reconnects and answers"
    />
  ),
  "experiments-track-themselves": (
    <ChecklistMock
      label="How Murph scores it"
      items={[
        { label: "Runs from your watch, counted automatically", done: true },
        { label: "Sauna and tretinoin, assumed done on schedule", done: true },
        { label: "Skipped a day? One text flips it to missed", done: true },
      ]}
    />
  ),
  "group-health-newsletter": (
    <EmailMock
      from="Murph"
      subject="The crew, this week"
      body={
        <div className="space-y-1.5">
          <p>Dana logged 6 workouts, a season high.</p>
          <p>Everyone&apos;s sleep held above 7 hours except Fridays.</p>
          <p>Nobody&apos;s touched the step goal yet, so that&apos;s the dare for next week.</p>
        </div>
      }
    />
  ),
  "messages-preempt-background-work": (
    <StatBlock
      label="Interrupt during background work"
      before="77s wait"
      after="answered now"
      caption="your text preempts the chore"
    />
  ),
  "typing-holds-until-reply-lands": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "how'd I sleep last night?" },
        { from: "murph", bare: true, body: "Murph is typing…" },
        { from: "murph", body: "7h 42m, best all week. Deep sleep was up too." },
      ]}
    />
  ),
  "group-join-by-liking": (
    <PhoneMock
      channel="iMessage · Run club"
      messages={[
        {
          from: "murph",
          reaction: "❤️",
          body: "Opening a group here. Already have Murph? Like this to join and share your daily steps.",
        },
        { from: "murph", body: "You're in, Dana. Here's the link to manage what you share." },
      ]}
    />
  ),
  "group-challenge-referee": (
    <PhoneMock
      channel="iMessage · Sunday crew"
      messages={[
        {
          from: "murph",
          body: (
            <div className="space-y-1">
              <p className="font-semibold">Day 3 standings</p>
              <p>Theo 9,412 steps · Will 8,730 · Sam 7,915</p>
            </div>
          ),
        },
        { from: "user", body: "ref, Sam counted a golf cart ride" },
        {
          from: "murph",
          body: "Ruling: cart steps don't count. Standings hold. Dinner stakes unchanged.",
        },
      ]}
    />
  ),
  "family-invite-imessage-accept": (
    <PhoneMock
      channel="Messages"
      messages={[
        { from: "user", body: "Hi Murph, joining the family plan (code family_k3)" },
        {
          from: "murph",
          body: "You're in. Sarah's plan covers you now. This number is yours to text anytime.",
        },
      ]}
    />
  ),
  "device-workouts-count-toward-experiments": (
    <StatBlock
      label="Running block adherence"
      before="0 logged"
      after="4 of 7"
      caption="same watch data, now counted"
    />
  ),
  "reminders-vary-approach": (
    <PhoneMock
      channel="iMessage"
      messages={[
        {
          from: "murph",
          body: "Zone 2 tonight. Even 20 easy minutes keeps the streak honest.",
        },
        {
          from: "murph",
          body: "Sauna night. Would 10 minutes be so bad? Tomorrow-you says thanks.",
        },
      ]}
    />
  ),
  "group-chat-reliability-hardening": (
    <ChecklistMock
      label="A group now survives"
      items={[
        { label: "Owner's card lapses, group keeps Murph", done: true },
        { label: "Members join or leave, replies continue", done: true },
        { label: "One stable route per chat, no lost threads", done: true },
      ]}
    />
  ),
  "faster-texting-replies": (
    <StatBlock
      label="Warm wake round trip"
      before="750 ms"
      after="188 ms"
      caption="plus a leaner cold start and direct wake"
    />
  ),
  "device-history-import-self-heals": (
    <StatBlock
      label="Failed history import"
      before="Stuck until reconnect"
      after="Re-runs itself"
      caption="180 days of history, recovered automatically"
    />
  ),
  "group-preferred-names-roster": (
    <PhoneMock
      channel="iMessage · Sleep league"
      messages={[
        {
          from: "murph",
          body: "Theo takes the night: 8h 12m. Will, 6h 40m. Your bedtime is writing checks your alarm can't cash.",
        },
      ]}
    />
  ),
  "challenge-stat-sharing-kinds": (
    <ChecklistMock
      label="Shareable challenge stats"
      items={[
        { label: "Steps and activity minutes", done: true },
        { label: "Workouts and heart-rate-zone minutes", done: true },
        { label: "Strain, VO2 max, resting HR, HRV", done: true },
        { label: "Only what each member approves", done: true },
      ]}
    />
  ),
  "progress-updates-while-working": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "just sent my full lab panel" },
        { from: "murph", body: "Reading it now. 34 markers, give me a minute." },
        { from: "murph", body: "Done. Three things worth a look, starting with ferritin." },
      ]}
    />
  ),
  "imessage-group-chats-self-serve": (
    <PhoneMock
      channel="iMessage · The boys"
      messages={[
        { from: "user", body: "added Murph so we can settle the steps debate" },
        {
          from: "murph",
          body: "Happy to referee. Everyone send me your weekly average, and nobody round up.",
        },
      ]}
    />
  ),
  "group-contact-card-intro": (
    <PhoneMock
      channel="iMessage · Sunday crew"
      messages={[
        {
          from: "murph",
          body: "If you don't have me saved yet, that card is me. Shoot me a text and I'll get you set up.",
        },
        { from: "murph", body: "(shared the Murph contact card)" },
      ]}
    />
  ),
  "overnight-memory-consolidation": (
    <CalendarMock
      label="Overnight maintenance"
      entries={[
        { day: "Mon", time: "3:00am", what: "Consolidate the week's context" },
        { day: "Wed", time: "3:00am", what: "Fold new facts into memory" },
        { day: "Fri", time: "3:00am", what: "Prune stale threads" },
      ]}
    />
  ),
  "family-seat-flow": (
    <ChecklistMock
      label="Family seat flow"
      items={[
        { label: "Invite & add seat · $7/mo, one step", done: true },
        { label: "Seat count reconciles before it renders", done: true },
        { label: "Remove empty seats you no longer need", done: true },
      ]}
    />
  ),
  "group-join-links": (
    <ChecklistMock
      label="Joining a group shares"
      items={[
        { label: "You're in the group chat", done: true },
        { label: "Health stats you explicitly approve", done: true },
        { label: "Private chats or your vault", done: false },
        { label: "Anything else: joining alone shares nothing", done: false },
      ]}
    />
  ),
  "red-light-therapy-guidance": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "how long should I sit in front of my red light panel?" },
        {
          from: "murph",
          body: "Which model, and how far away? Dose falls off fast with distance. I'll do the math from the panel's measured output.",
        },
      ]}
    />
  ),
  "hosted-family-plan-mvp": (
    <ChecklistMock
      label="Family covers"
      items={[
        { label: "2–6 sponsored seats at $7/mo each", done: true },
        { label: "Private accounts — no shared chats or vault", done: true },
        { label: "Each member gets their own Pulse allowance", done: true },
        { label: "Invite by Telegram, phone, or email", done: true },
      ]}
    />
  ),
  "linq-contact-card-share": (
    <PhoneMock
      channel="iMessage"
      messages={[
        {
          from: "murph",
          body: "Got it — I'll text you when the pharmacy opens.",
        },
        {
          from: "murph",
          body: "(shared my contact so you can save the number)",
        },
      ]}
    />
  ),
  "pulse-trial-10-days": (
    <StatBlock
      label="Pulse Trial length"
      before="7 days"
      after="10 days"
      caption="every new trial, no card required"
    />
  ),
  "device-sync-reconnect-context": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "Why was my sleep so short last night?" },
        {
          from: "murph",
          body: "Your Garmin hasn't synced since Wednesday — let's reconnect before I read the gap as a bad night.",
        },
      ]}
    />
  ),
  "onboarding-delegate-slow-saves": (
    <StatBlock
      label="Onboarding mid-write"
      before="Stalls on save"
      after="Keeps talking"
      caption="supplements and labs save in background"
    />
  ),
  "homepage-editorial-refresh": (
    <ChecklistMock
      label="New on the homepage"
      items={[
        { label: "Clock-in hero with live voice-memo demo", done: true },
        { label: "Editorial asymmetric layout for the asks", done: true },
        { label: "Trust band rewritten to match the FAQ", done: true },
        { label: "Integrations grid with the Murph mark as hub", done: true },
      ]}
    />
  ),
  "linq-reminder-wake-no-replay": (
    <StatBlock
      label="Scheduled reminder fires"
      before="Could replay"
      after="Once"
      caption="on cron rewind"
    />
  ),
  "garmin-junction-sleep-records": (
    <DeviceList
      devices={[
        { name: "Garmin", initial: "G", color: "#0078b8", status: "connected" },
        { name: "WHOOP", initial: "W", color: "#2d3436", status: "connected" },
        { name: "Oura", initial: "O", color: "#5a6e32", status: "connected" },
      ]}
    />
  ),
  "first-contact-classifier-fail-open": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "hey is this Murph? can it help with sleep?" },
        {
          from: "murph",
          body: "Yes — here's your signup link. (Classifier was offline; we still let real people through.)",
        },
      ]}
    />
  ),
  "weekly-insight-framing-refresh": (
    <PhoneMock
      channel="iMessage"
      messages={[
        {
          from: "murph",
          body: (
            <div className="space-y-1">
              <p className="font-semibold">This week, one pattern stands out</p>
              <p>
                Your worst sleep nights all followed late training — stress
                regulation, not volume, is the lever.
              </p>
            </div>
          ),
        },
      ]}
    />
  ),
  "safety-critical-context-snapshot": (
    <GoalsRegimenCard
      entries={[
        { kind: "habit", text: "Active: lisinopril 10mg, daily" },
        { kind: "goal", text: "Allergy: penicillin (anaphylaxis)" },
        { kind: "ramp", text: "Condition: hypertension, active" },
      ]}
    />
  ),
  "image-gen-reference-images": (
    <PhoneMock
      channel="iMessage"
      messages={[
        {
          from: "user",
          body: "Use that fridge photo and add fresh produce on the middle shelf",
        },
        {
          from: "murph",
          bare: true,
          body: (
            <ImagePreview
              alt="Generated image based on a reference photo"
              caption="Built on image 1"
            />
          ),
        },
      ]}
    />
  ),
  "durable-progress-photo-captures": (
    <PrivacyTimeline
      events={[
        { day: 0, label: "Send a progress photo", tone: "neutral" },
        { day: 0, label: "Saved as a vault capture", tone: "neutral" },
        { day: 90, label: "Still there — compare the series", tone: "neutral" },
      ]}
      caption="Bytes live in captures, not inbox."
    />
  ),
  "weekly-digest-substance-gate": (
    <PhoneMock
      channel="iMessage"
      messages={[
        {
          from: "murph",
          body: "Your WHOOP hasn't sent data in 8 days — want to reconnect? I'll skip Sunday's recap until then.",
        },
      ]}
    />
  ),
  "first-contact-classifier-budget": (
    <ChecklistMock
      label="When an unknown number texts"
      items={[
        { label: "Mentions Murph or asks Murph a question → admit", done: true },
        { label: "Obvious spam or unrelated → block", done: true },
        { label: "Cap of 4 classifier attempts per contact", done: true },
      ]}
    />
  ),
  "home-redirect-notice-dedup": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "I keep texting the wrong line" },
        {
          from: "murph",
          body: "We'll talk over at +1 (555) 010-7740. (Told once — not on every reply.)",
        },
      ]}
    />
  ),
  "retell-phone-call-authority-fix": (
    <StatBlock
      label="Phone-call path"
      before="Stale callbacks"
      after="Fail-closed"
      caption="hardened on the Retell seam"
    />
  ),
  "retell-phone-calls": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "Call my pharmacy — is my prescription ready?" },
        {
          from: "murph",
          body: "Calling now. I'll text you when I hang up.",
        },
        {
          from: "murph",
          body: "Pharmacy said your refill is ready, pickup window 9–7. Want me to add a reminder for after work?",
        },
      ]}
    />
  ),
  "uploaded-health-records-vault": (
    <ChecklistMock
      label="What Murph does with a lab PDF"
      items={[
        { label: "Save raw evidence to your vault", done: true },
        { label: "Extract values into a blood test record", done: true },
        { label: "Link relevant conditions and meds", done: true },
        { label: "Tell you what stands out", done: true },
      ]}
    />
  ),
  "onboarding-name-free-text": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "murph", body: "What should I call you?" },
        { from: "user", body: "just Sam" },
        { from: "murph", body: "Got it, Sam. Age and a quick gender ask are optional — skip either anytime." },
      ]}
    />
  ),
  "handoff-return-to-source-channel": (
    <ChecklistMock
      label="Return where you started"
      items={[
        { label: "Text-origin handoff → reply on text", done: true },
        { label: "Telegram-origin → reply on Telegram", done: true },
        { label: "Email-origin → same email thread", done: true },
      ]}
    />
  ),
  "whoop-junction-local-day": (
    <StatBlock
      label="WHOOP / Junction days"
      before="UTC drift"
      after="Local day"
      caption="records line up with your calendar"
    />
  ),
  "assistant-progress-cap": (
    <StatBlock
      label="Mid-turn progress updates"
      before="Up to 5"
      after="2 max"
      caption="spaced apart, only when silence hurts"
    />
  ),
  "preflight-outbox-no-churn": (
    <StatBlock
      label="Pre-provider retries"
      before="97 churned attempts"
      after="0"
      caption="parked until approval lands"
    />
  ),
  "message-variants-deliverability": (
    <ChecklistMock
      label="Refreshed system replies"
      items={[
        { label: "Welcome & signup", done: true },
        { label: "Daily quota", done: true },
        { label: "Home-line redirect", done: true },
        { label: "AI usage notices", done: true },
      ]}
    />
  ),
  "linq-typing-cadence": (
    <StatBlock
      label="Linq typing refresh"
      before="Every 2 sec"
      after="Per-turn"
      caption="no high-frequency keepalive"
    />
  ),
  "device-activity-listener-handoff": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "Did three WHOOP workouts today — all back-to-back" },
        {
          from: "murph",
          body: "Sent your recovery prompt after each one. Listener stays on for tomorrow.",
        },
      ]}
    />
  ),
  "coach-skills-six-new": (
    <ChecklistMock
      label="New coach skills"
      items={[
        { label: "Sleep & recovery readiness", done: true },
        { label: "Stress regulation", done: true },
        { label: "Nutrition strategy", done: true },
        { label: "Running & cardio", done: true },
        { label: "Strength training", done: true },
        { label: "Competition training", done: true },
      ]}
    />
  ),
  "linq-first-contact-admission": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "yo new phone who dis" },
        {
          from: "murph",
          body: "(no reply, no invite, no member record — fail-closed)",
        },
      ]}
    />
  ),
  "live-browser-replaces-screen-inspection": (
    <StatBlock
      label="Browser inspection"
      before="Static screenshot"
      after="Live browser"
      caption="passkey-gated handoff"
    />
  ),
  "checkout-confirm-in-chat": (
    <PhoneMock
      channel="iMessage"
      messages={[
        {
          from: "murph",
          body: "Cart's ready. Reply 'go ahead' to place the order.",
        },
        { from: "user", body: "go ahead" },
        { from: "murph", body: "Done — confirmation incoming." },
      ]}
    />
  ),
  "linq-off-hours-reminder-guard": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "Remind me to take melatonin at 2am" },
        {
          from: "murph",
          body: "2am can look spammy to iMessage. Want 10pm instead, or keep 2am?",
        },
      ]}
    />
  ),
  "longer-tool-loops-before-compaction": (
    <StatBlock
      label="Compaction threshold"
      before="84k"
      after="100k"
      caption="tokens — long tool loops finish whole"
    />
  ),
  "proactive-chronic-support": (
    <AssessmentCard
      topic="Lower-back tightness"
      meta="day 9"
      assessment="Pattern reads mechanical, not inflammatory — symptoms ease when you move and don't wake you at night."
      nextAction="Try 90/90 breathing — 5 min before bed for 5 nights."
      rationale="Low-risk; we'll review Monday and adjust from there."
    />
  ),
  "physical-therapy-skill": (
    <ReasoningSteps
      meta="for this strain"
      steps={[
        {
          label: "Triage & red flags",
          state: "done",
          note: "Cleared — no neuro signs, no night pain",
        },
        {
          label: "Exercise selection & dose",
          state: "active",
          note: "2 moves, 3×/week — start light",
        },
        {
          label: "Follow-up & progression",
          state: "pending",
        },
      ]}
    />
  ),
  "active-plan-context": (
    <GoalsRegimenCard
      entries={[
        { kind: "goal", text: "Protein floor — 140g per day" },
        { kind: "habit", text: "Lift, mornings only" },
        { kind: "ramp", text: "Zone 2 → 90 min/wk by Aug" },
      ]}
    />
  ),
  "exercise-image-walkthroughs": (
    <ExerciseGrid
      tiles={[
        { name: "90/90 breathing", reps: "4 min", hue: 78 },
        { name: "Glute bridge", reps: "10 reps", hue: 32 },
        { name: "Standing reach", reps: "8 / side", hue: 20 },
      ]}
      caption="Want me to walk you through these?"
    />
  ),
  "song-generation": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "Write me a 30-sec hype track for tonight's lift" },
        {
          from: "murph",
          body: (
            <SongBubble
              title="Tonight's lift, 30 sec"
              artist="Murph · ElevenLabs"
              duration="0:30"
            />
          ),
        },
      ]}
    />
  ),
  "sensitive-action-approval": (
    <ApprovalCard
      action="Export your vault as JSON"
      detail="Murph needs a one-time signature from your passkey-protected wallet before the download starts."
      cta="Approve with passkey"
    />
  ),
  "assistant-pdf-skill": (
    <PdfPreview
      title="Training week — Jun 17–23"
      meta="1 page · A4"
      lines={5}
    />
  ),
  "connected-apps-outlook-zoho": (
    <AppGrid
      apps={[
        { name: "Gmail", color: "#ea4335" },
        { name: "Outlook", color: "#0078d4" },
        { name: "Zoho Mail", color: "#c8202f" },
      ]}
      caption="Connect once, draft and send in chat"
    />
  ),
  "connected-apps-files-tasks-notes": (
    <AppGrid
      apps={[
        { name: "Google Drive", color: "#1a73e8" },
        { name: "OneDrive", color: "#0364b8" },
        { name: "Dropbox", color: "#0061fe" },
        { name: "Notion", color: "#1f1f1f" },
        { name: "Todoist", color: "#e44232" },
        { name: "Google Tasks", color: "#1967d2" },
      ]}
      caption="Six more apps Murph can reach"
    />
  ),
  "connected-apps-calendar-events": (
    <CalendarMock
      label="New event on your calendar"
      entries={[
        { day: "Tue", time: "2:00 PM", what: "Call with Sam — Zoom (45m)" },
        { day: "Wed", time: "9:00 AM", what: "Dentist follow-up — 12th & Pine" },
      ]}
    />
  ),
  "home-experiment-result-cards": (
    <MetricCardMock
      label="Your finished experiment"
      title="Caffeine cutoff — 2 PM"
      value="+38m"
      delta={{ direction: "up", text: "sleep onset latency" }}
      sparkline={[34, 30, 28, 24, 22, 18, 14, 11]}
      caption="Home leads with your real results."
    />
  ),
  "computer-use-managed-auth": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "Book a haircut at Atlas Barbers for Tue 6pm" },
        {
          from: "murph",
          body: "Paused on their login — I'll hand you to a managed sign-in so I can finish the booking after.",
        },
      ]}
    />
  ),
  "finite-supply-reorder-check-in": (
    <CalendarMock
      label="One reminder, around when you run out"
      entries={[
        { day: "Now", time: "ordered", what: "Magnesium glycinate — 30 day" },
        { day: "Jul 22", time: "9:00 AM", what: "Check in: reorder or skip?" },
      ]}
    />
  ),
  "experiment-lifecycle-moments": (
    <CalendarMock
      label="Experiment in flight"
      entries={[
        { day: "Day 1", time: "started", what: "Caffeine cutoff — 2 PM" },
        { day: "Day 4", time: "9:00 AM", what: "Halfway nudge: how's it landing?" },
        { day: "Day 15", time: "9:00 AM", what: "Morning-after final review" },
      ]}
    />
  ),
  "computer-use-auto-compact": (
    <StatBlock
      label="Long browser turn"
      before="One big compact"
      after="Quiet trims"
      caption="memory compacts mid-task"
    />
  ),
  "foreground-wake-preemption-fix": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "Walk done — 4mi, easy pace 👌" },
        {
          from: "murph",
          body: "Nice. I'll still ping you at 9 PM for the meditation prompt like we set up.",
        },
      ]}
    />
  ),
  "inbox-media-retention-window": (
    <PrivacyTimeline
      events={[
        { day: 0, label: "You send Murph a photo", tone: "neutral" },
        { day: 14, label: "Raw bytes auto-expire", tone: "expire" },
      ]}
      caption="Murph remembers what it was — only the raw bytes go."
    />
  ),
  "hosted-egress-container-identity": (
    <ChecklistMock
      label="Tools restored inside container turns"
      items={[
        { label: "Research scout", done: true },
        { label: "Route estimates", done: true },
        { label: "Supplement lookups", done: true },
      ]}
    />
  ),
  "telegram-image-response-fix": (
    <PhoneMock
      channel="Telegram"
      messages={[
        { from: "user", body: "Show me a glute bridge with a picture" },
        {
          from: "murph",
          bare: true,
          body: (
            <ImagePreview
              alt="Generated glute bridge demo"
              caption="Delivered to Telegram"
            />
          ),
        },
      ]}
    />
  ),
  "messaging-italic-underline": (
    <PhoneMock
      channel="Linq"
      messages={[
        { from: "user", body: "summarize my week with emphasis" },
        {
          from: "murph",
          body: (
            <div className="space-y-1">
              <p>
                You hit your <strong>protein floor</strong> 6 of 7 days —{" "}
                <em>up from 3 last week</em>.
              </p>
              <p>
                One watch-out: <span className="underline">sleep is trending shorter</span>.
              </p>
            </div>
          ),
        },
      ]}
    />
  ),
  "resume-checkout-from-join": (
    <ChecklistMock
      label="Picking back up"
      items={[
        { label: "You bounced from checkout", done: true },
        { label: "Sign back in at /join", done: true },
        { label: "Drop right back into checkout", done: true },
      ]}
    />
  ),
  "passkey-mfa-setup": (
    <ChecklistMock
      label="Security"
      items={[
        { label: "Passkey enrolled", done: true },
        { label: "Face ID or Touch ID", done: true },
        { label: "Required at sign-in", done: true },
      ]}
    />
  ),
  "handoff-viewport-match": (
    <StatBlock
      label="Handoff browser"
      before="Default"
      after="Session-sized"
      caption="remembered per device"
    />
  ),
  "handoff-mobile-takeover-overlay": (
    <PhoneMock
      channel="iMessage"
      messages={[
        {
          from: "murph",
          body: "Paused at checkout — tap Take over to confirm and pay.",
        },
      ]}
    />
  ),
  "os-control-typing-delay-removed": (
    <StatBlock
      label="Browser typing"
      before="Per-key pause"
      after="Snappy"
      caption="OS-control delay removed"
    />
  ),
  "auto-reply-cross-session-context": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "Pick up where we left off last night?" },
        {
          from: "murph",
          body: "Yeah — you wanted the protein floor at 140g and to retry the early lift. Still good?",
        },
      ]}
    />
  ),
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
    <MetricCardMock
      label="In long chats"
      title="Murph stays trim"
      value="Lower"
      delta={{ direction: "down", text: "AI cost" }}
      sparkline={[28, 32, 36, 38, 30, 22, 18, 16]}
      caption="History compacts itself in the background."
    />
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
    <StatBlock
      label="Behind the scenes"
      before="Slow start"
      after="Snappy"
      caption="internal tools start faster"
    />
  ),
  "faster-cli-startup": (
    <StatBlock
      label="First reply of the day"
      before="Pause"
      after="Right away"
      caption="warm tools, faster first reply"
    />
  ),
  "food-label-database": (
    <StatBlock label="USDA FoodData" value="~2M" caption="branded foods" />
  ),
  "strict-serving-grams-backfill": (
    <StatBlock label="Accurate grams on" value="1.7M" caption="foods + 28k supplements" />
  ),
  "every-metric-queryable": (
    <ChecklistMock
      label="Newly queryable"
      items={[
        { label: "Caffeine", done: true },
        { label: "Water", done: true },
        { label: "Mindfulness minutes", done: true },
        { label: "Heart-rate recovery", done: true },
        { label: "AFib burden", done: true },
        { label: "…and 8 more", done: true },
      ]}
    />
  ),
  "companion-app-sign-in": (
    <AppIconCard label="iOS app" name="Murph" status="Coming soon" />
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
          bare: true,
          body: (
            <ImagePreview
              alt="Generated poster for tonight's group ride"
              caption="Generated by Murph"
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
  "junction-meal-imports": (
    <MealCard
      source="MyFitnessPal"
      time="1:12 PM"
      title="Chicken & rice bowl"
      calories={540}
      macros={{ protein: 38, carbs: 62, fat: 14 }}
    />
  ),
};

const DESCRIPTION =
  "See what is new in Murph, why it matters, and the simplest way to try each update.";

type ChangelogPageProps = {
  searchParams: Promise<{ edition?: string | string[] }>;
};

export async function generateMetadata({
  searchParams,
}: ChangelogPageProps): Promise<Metadata> {
  const page = await resolveRequestedChangelogPage(searchParams);
  const previewCardItemIds = page.editions
    .flatMap((edition) => edition.items)
    .slice(0, CHANGELOG_PREVIEW_CARD_ITEMS)
    .map((item) => item.id);
  const previewCardImage = {
    alt: "What's new in Murph, recent features and improvements.",
    height: 630,
    type: "image/png",
    url: buildAbsoluteChangelogUrl(buildChangelogCardPath(previewCardItemIds)),
    width: 1200,
  } as const;
  return createMurphPageMetadata({
    title:
      page.currentPage === 1
        ? "Murph Changelog, new features and improvements to try"
        : `Murph Changelog, page ${page.currentPage}`,
    description: DESCRIPTION,
    alternates: {
      canonical: buildChangelogPagePath(page.currentPage),
    },
    openGraph: {
      images: [previewCardImage],
      type: "article",
    },
    twitter: {
      images: [previewCardImage],
    },
  });
}

type ResolvedTryIt = {
  authenticated: boolean;
  label: string;
  options: MurphContactOption[];
  prompt?: string | null;
};

export default async function ChangelogPage({
  searchParams,
}: ChangelogPageProps) {
  const page = await resolveRequestedChangelogPage(searchParams);
  const [{ authenticated }, githubStarCount] = await Promise.all([
    getHostedPageAuthSnapshot(),
    getMurphGithubStarCount(),
  ]);
  const editions = page.editions;
  const tryItByItemId = await resolveTryItByItemId({
    authenticated,
    editions,
  });

  return (
    <>
      <main className="min-h-dvh bg-[#f5f0e8] text-[#2d3436] antialiased">
        <StickyNav
          authenticated={authenticated}
          darkTop
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
              {page.currentPage === 1
                ? "The latest seven days of features and improvements, with the full archive one step away."
                : "Seven days of features and improvements from the full Murph archive."}
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
                  <div className="min-w-0 lg:sticky lg:top-24 lg:self-start">
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

                  <div className="min-w-0">
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
          <ChangelogPagination
            currentPage={page.currentPage}
            totalPages={page.totalPages}
          />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function ChangelogPagination({
  currentPage,
  totalPages,
}: {
  currentPage: number;
  totalPages: number;
}) {
  if (totalPages <= 1) {
    return null;
  }
  const pageItems = buildPaginationItems(currentPage, totalPages);

  return (
    <nav
      aria-label="Changelog pages"
      className="mt-20 border-t border-[#c4a882]/35 pt-8"
    >
      <div className="flex items-center justify-between gap-4">
        {currentPage > 1 ? (
          <a
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-[#3a4a1e] outline-none transition-colors hover:bg-[#c4a882]/15 focus-visible:ring-2 focus-visible:ring-[#7a8c6e] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5f0e8]"
            href={buildChangelogPagePath(currentPage - 1)}
            rel="prev"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            Newer
          </a>
        ) : (
          <span aria-hidden="true" className="w-[72px]" />
        )}

        <ol className="hidden items-center gap-1 sm:flex">
          {pageItems.map((item) =>
            typeof item === "number" ? (
              <li key={item}>
                <a
                  aria-current={item === currentPage ? "page" : undefined}
                  aria-label={`Page ${item}`}
                  className={
                    item === currentPage
                      ? "inline-flex size-9 items-center justify-center rounded-lg bg-[#3a4a1e] font-mono text-[11px] font-medium text-[#f5f0e8] outline-none focus-visible:ring-2 focus-visible:ring-[#7a8c6e] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5f0e8]"
                      : "inline-flex size-9 items-center justify-center rounded-lg font-mono text-[11px] font-medium text-[#736a58] outline-none transition-colors hover:bg-[#c4a882]/15 hover:text-[#3a4a1e] focus-visible:ring-2 focus-visible:ring-[#7a8c6e] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5f0e8]"
                  }
                  href={buildChangelogPagePath(item)}
                >
                  {item}
                </a>
              </li>
            ) : (
              <li
                key={item}
                aria-hidden="true"
                className="inline-flex size-7 items-center justify-center font-mono text-[11px] text-[#736a58]"
              >
                …
              </li>
            ),
          )}
        </ol>

        <p className="font-mono text-[10px] font-medium text-[#736a58] uppercase tracking-[0.12em] sm:hidden">
          Page {currentPage} of {totalPages}
        </p>

        {currentPage < totalPages ? (
          <a
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-[#3a4a1e] outline-none transition-colors hover:bg-[#c4a882]/15 focus-visible:ring-2 focus-visible:ring-[#7a8c6e] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5f0e8]"
            href={buildChangelogPagePath(currentPage + 1)}
            rel="next"
          >
            Older
            <ChevronRight aria-hidden="true" className="size-4" />
          </a>
        ) : (
          <span aria-hidden="true" className="w-[72px]" />
        )}
      </div>
    </nav>
  );
}

function buildPaginationItems(
  currentPage: number,
  totalPages: number,
): readonly (number | "ellipsis-start" | "ellipsis-end")[] {
  const visiblePages = new Set([
    1,
    totalPages,
    currentPage - 1,
    currentPage,
    currentPage + 1,
  ]);
  const pages = [...visiblePages]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((left, right) => left - right);
  const items: (number | "ellipsis-start" | "ellipsis-end")[] = [];

  for (const page of pages) {
    const previous = items.at(-1);
    if (typeof previous === "number" && page - previous > 1) {
      items.push(previous === 1 ? "ellipsis-start" : "ellipsis-end");
    }
    items.push(page);
  }
  return items;
}

async function resolveRequestedChangelogPage(
  searchParams: ChangelogPageProps["searchParams"],
) {
  const pageNumber = resolveChangelogEditionPage((await searchParams).edition);
  const page = pageNumber === null ? null : resolveChangelogPage(pageNumber);
  if (!page) {
    notFound();
  }
  return page;
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
              className="group/card relative min-w-0 scroll-mt-28 rounded-2xl border border-[#c4a882]/35 bg-[#fffcf6]/85 p-6 transition-colors duration-200 ease-out hover:border-[#c4a882]/55 sm:p-7"
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
                  href={buildChangelogItemPath(item.id)}
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
