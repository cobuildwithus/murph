import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { SiteFooter } from "@/src/components/homepage/site-footer";
import { GroupFundingSupporters } from "@/src/components/hosted-groups/group-funding-supporters";
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
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import {
  ChangelogEditionSection,
  type ResolvedChangelogTryIt,
} from "./changelog-edition-section";
import { PhoneMock } from "./phone-mock";
import {
  GROUP_FUNDING_USAGE_CREDIT_VISUAL,
  GROUP_SPONSORSHIP_USAGE_CREDIT_VISUAL,
} from "./usage-credit-visuals";
import { StickyNav } from "../sticky-nav";
import {
  AppGrid,
  AppIconCard,
  ApprovalCard,
  AssessmentCard,
  CalendarMock,
  ChecklistMock,
  CompactTableMock,
  ContactCardMock,
  DeviceList,
  DialogMock,
  EmailMock,
  ExerciseGrid,
  GoalsRegimenCard,
  ImagePreview,
  MealCard,
  MetricCardMock,
  PanelGrid,
  PdfPreview,
  PreferenceCard,
  PrivacyTimeline,
  ReferenceBandMock,
  ReasoningSteps,
  SongBubble,
  StatBlock,
  VoiceBubble,
} from "./visuals";

const VISUALS: Record<string, ReactNode> = {
  "group-funding-supporters": (
    <div className="w-full max-w-[320px] rounded-2xl border border-[#c4a882]/35 bg-[#fdfaf5] px-5 pb-6">
      <GroupFundingSupporters
        supporters={{
          monthlySponsor: {
            id: "hucp_changelog_monthly",
            name: "The Group Historian",
          },
          oneTimeContributions: [
            { id: "hucp_changelog_one_time_1", name: "Night Shift" },
            { id: "hucp_changelog_one_time_2", name: "Anonymous" },
          ],
        }}
      />
    </div>
  ),
  "murph-max-plan": (
    <PreferenceCard
      label="Murph Max"
      meta="$50 monthly"
      entries={[
        { label: "Included AI usage", value: "Highest" },
        { label: "Deep research", value: "More room" },
        { label: "Ongoing analysis", value: "Built for it" },
      ]}
    />
  ),
  "generated-contact-card-avatar": (
    <ContactCardMock
      action="Add to Contacts"
      avatarSrc="/murph-headshots/murph-headshot-08-sm.png"
      fields={[{ label: "Mobile", value: "Current Murph line" }]}
      name="Murph"
      subtitle="Your requested contact photo"
    />
  ),
  "family-setup-from-group": (
    <DialogMock
      label="Murph Family"
      title="Set this up privately"
      body="Continue in your private Murph conversation or sign in to open your Family settings."
      primary="Open Family settings"
      secondary="Message Murph privately"
    />
  ),
  "live-workout-logging": (
    <CompactTableMock
      label="Live workout"
      columns={[
        { key: "set", label: "Set" },
        { key: "reps", label: "Reps" },
        { key: "load", label: "Load" },
      ]}
      rows={[
        { set: "Bench · 1", reps: "8", load: "135 lb" },
        { set: "Bench · 2", reps: "8", load: "135 lb" },
        { set: "Bench · 3", reps: "Pending", load: "Pending" },
      ]}
    />
  ),
  "body-composition-guidance": (
    <GoalsRegimenCard
      label="One goal, clear ownership"
      meta="evidence-backed"
      entries={[
        { kind: "goal", text: "Choose the body-composition lane" },
        { kind: "habit", text: "Use the minimum useful tracking" },
        { kind: "ramp", text: "Adjust only after a real trend" },
      ]}
    />
  ),
  "group-replies-respect-the-room": (
    <PhoneMock
      channel="Group chat"
      messages={[
        { from: "user", body: "Replying here: Tuesday works better." },
        { from: "user", body: "Same here." },
        { from: "murph", body: "Tuesday has the room. Want me to help with a time?" },
      ]}
    />
  ),
  "sponsorship-creative-opt-in": (
    <PreferenceCard
      label="Personalize (optional)"
      meta="Quiet by default"
      entries={[
        { label: "No room message", value: "Selected" },
        { label: "Message, poem, or song", value: "Opt in" },
      ]}
    />
  ),
  "response-cards-survive-long-turns": (
    <CompactTableMock
      label="Private response card"
      columns={[
        { key: "metric", label: "Metric" },
        { key: "today", label: "Today" },
        { key: "goal", label: "Goal" },
      ]}
      rows={[
        { metric: "Protein", today: "92 g", goal: "120 g" },
        { metric: "Fiber", today: "24 g", goal: "30 g" },
      ]}
    />
  ),
  "typing-prewarms-private-chat": (
    <ReasoningSteps
      label="Private-chat start"
      meta="best effort"
      steps={[
        { label: "Authenticated typing hint", state: "done" },
        { label: "Warm the existing shell", state: "active" },
        { label: "Accepted message owns the reply", state: "pending" },
      ]}
    />
  ),
  "ios-app-footer-link": (
    <AppIconCard
      label="Available on iOS"
      name="Murph"
      status="Open the App Store listing"
    />
  ),
  "runtime-replacement-continuity": (
    <ReasoningSteps
      label="Conversation handoff"
      meta="automatic"
      steps={[
        { label: "Recognize the active save", state: "done" },
        { label: "Preserve the latest handoff", state: "done" },
        { label: "Resume fresh conversation work", state: "active" },
      ]}
    />
  ),
  "paused-member-retention-cleanup": (
    <ChecklistMock
      label="Paused-member privacy cleanup"
      items={[
        { label: "Ordinary assistant work stays paused", done: true },
        { label: "Expired private media is removed", done: true },
        { label: "A new member action is required", done: false },
      ]}
    />
  ),
  "background-results-use-less-shared-capacity": (
    <ReasoningSteps
      label="Background results"
      meta="less shared work"
      steps={[
        { label: "Read prior reply context in bounded batches", state: "done" },
        { label: "Prepare completed call results", state: "done" },
        { label: "Leave current replies room to run", state: "active" },
      ]}
    />
  ),
  "custom-experiment-deep-links": (
    <DialogMock
      label="Private experiment"
      title="Morning light experiment"
      body="Open the exact run you asked for. Normal sign-in and account access still apply."
      primary="Open experiment"
      secondary="Stay in chat"
    />
  ),
  "group-funding-one-recovery-owner": (
    <ChecklistMock
      label="Group funding recovery"
      items={[
        { label: "Verified payment owns the credit", done: true },
        { label: "Uncertain checkout stays recoverable", done: true },
        { label: "Create a second charge", done: false },
      ]}
    />
  ),
  "room-memory-status-recovers": (
    <PhoneMock
      channel="Group chat"
      messages={[
        { from: "user", body: "House rule: weekend workouts stay social." },
        { from: "user", body: "What should we do Saturday?" },
        { from: "murph", body: "Keep it social: easy circuit, no leaderboard." },
      ]}
    />
  ),
  "due-automations-drain-cleanly": (
    <ChecklistMock
      label="Due automations"
      items={[
        { label: "Admit the bounded due set", done: true },
        { label: "Preserve each occurrence", done: true },
        { label: "Duplicate the backlog", done: false },
      ]}
    />
  ),
  "device-sync-webhook-recovery": (
    <DeviceList
      label="Sync recovery"
      devices={[
        { color: "#5a6e32", initial: "W", name: "Wearable source", status: "syncing" },
        { color: "#3a4a1e", initial: "M", name: "Murph health record", status: "connected" },
      ]}
    />
  ),
  "first-personal-health-read": (
    <PhoneMock
      channel="Private conversation"
      messages={[
        { from: "murph", body: "Your sleep timing has been steadier this week. The useful next step may be keeping the same wake time tomorrow." },
        { from: "user", body: "That feels manageable." },
      ]}
    />
  ),
  "reusable-referral-links": (
    <PreferenceCard
      label="Your referral link"
      meta="Reusable"
      entries={[
        { label: "One stable link", value: "Ready" },
        { label: "Reward after activation", value: "Eligibility checked" },
      ]}
    />
  ),
  "focused-current-research": (
    <ReasoningSteps
      label="Focused current research"
      meta="public scope only"
      steps={[
        { label: "Represent the question safely", state: "done" },
        { label: "Map a usable source", state: "done" },
        { label: "State limits with the answer", state: "active" },
      ]}
    />
  ),
  "repeated-experiment-cadence": (
    <CalendarMock
      label="Experiment cadence"
      entries={[
        { day: "Mon", time: "7:00 AM", what: "Occurrence 1 · complete" },
        { day: "Wed", time: "7:00 AM", what: "Occurrence 2 · today" },
        { day: "Fri", time: "7:00 AM", what: "Occurrence 3 · upcoming" },
      ]}
    />
  ),
  "biomarker-reference-bands": (
    <ReferenceBandMock
      highLabel="100 mg/dL"
      label="Fasting glucose"
      lowLabel="70 mg/dL"
      markerLabel="92"
      markerPosition={62}
    />
  ),
  "interactive-imessage-cards-restored": (
    <CompactTableMock
      label="Interactive iMessage card"
      columns={[
        { key: "day", label: "Day" },
        { key: "sleep", label: "Sleep" },
        { key: "steps", label: "Steps" },
      ]}
      rows={[
        { day: "Mon", sleep: "7h 42m", steps: "9,120" },
        { day: "Tue", sleep: "7h 18m", steps: "10,404" },
      ]}
    />
  ),
  "group-room-context-grounding": (
    <PhoneMock
      channel="Group chat"
      messages={[
        { from: "user", body: "Remember, no one wants a sunrise start." },
        { from: "user", body: "Plan Saturday?" },
        { from: "murph", body: "Late-morning walk, then coffee. No sunrise involved." },
      ]}
    />
  ),
  "billing-access-recovery": (
    <DialogMock
      label="Subscription recovery"
      title="Your plan change is still settling"
      body="There is no need to start another checkout. Murph will use the confirmed billing result."
      primary="Check status"
      secondary="Return to Murph"
    />
  ),
  "cancel-pending-file-delivery": (
    <ChecklistMock
      label="Pending file"
      items={[
        { label: "Cancel before delivery starts", done: true },
        { label: "Keep the private source file", done: true },
        { label: "Recall an entered provider send", done: false },
      ]}
    />
  ),
  "meal-capture-toggle-ordering": (
    <PreferenceCard
      label="Meal capture"
      meta="Latest choice wins"
      entries={[
        { label: "Photo capture", value: "Off" },
        { label: "Daily closeout", value: "Stopped" },
      ]}
    />
  ),
  "companion-admission-before-device": (
    <AppIconCard
      label="Murph companion"
      name="Murph"
      status="Ready before device setup"
    />
  ),
  "turn-local-browser-progress": (
    <ReasoningSteps
      label="Current browser task"
      meta="this turn"
      steps={[
        { label: "Open the requested page", state: "done" },
        { label: "Check the visible details", state: "active" },
        { label: "Return the result here", state: "pending" },
      ]}
    />
  ),
  "recovery-readiness-insight": (
    <MetricCardMock
      label="Weekly recovery read"
      title="Fresh source + corroborating signal"
      value="One adjustment"
      caption="Reassess before changing more"
      sparkline={[82, 79, 76, 72, 70, 68, 69]}
    />
  ),
  "health-consent-actions-clarified": (
    <ChecklistMock
      label="Health data use"
      items={[
        { label: "Review what changes", done: true },
        { label: "Pause processing", done: false },
        { label: "Export or delete account", done: false },
      ]}
    />
  ),
  "first-contact-starts-faster": (
    <ReasoningSteps
      label="First contact"
      meta="faster path"
      steps={[
        { label: "Finish activation and consent", state: "done" },
        { label: "Warm Murph's shell", state: "active" },
        { label: "Answer the accepted message", state: "pending" },
      ]}
    />
  ),
  "late-media-origin-continuity": (
    <div className="mt-5 w-full max-w-[320px]">
      <ImagePreview
        alt="A generated image returning to its originating private conversation"
        caption="Returns to the conversation that requested it"
      />
    </div>
  ),
  "prepare-next-group": (
    <CalendarMock
      label="Next group preparation"
      entries={[
        { day: "Now", time: "30 min", what: "Prepared room style and guidance" },
        { day: "Next", time: "New room", what: "Applies once" },
      ]}
    />
  ),
  "tracked-compact-table-cards": (
    <CompactTableMock
      label="Tracked compact table"
      columns={[
        { key: "habit", label: "Habit" },
        { key: "week", label: "This week" },
        { key: "status", label: "Status" },
      ]}
      rows={[
        { habit: "Morning walk", week: "4 / 5", status: "On track" },
        { habit: "Lights out", week: "3 / 5", status: "Building" },
      ]}
    />
  ),
  "connected-app-authorization-preview": (
    <DialogMock
      label="Connected app"
      title="Continue to authorize"
      body="You are leaving Murph to approve this connection with the external service."
      primary="Continue"
      secondary="Not now"
    />
  ),
  "daily-nutrition-card-delivery": (
    <CompactTableMock
      label="Daily nutrition card"
      columns={[
        { key: "metric", label: "Metric" },
        { key: "total", label: "Total" },
        { key: "goal", label: "Goal" },
      ]}
      rows={[
        { metric: "Protein", total: "92 g", goal: "120 g" },
        { metric: "Fiber", total: "24 g", goal: "30 g" },
      ]}
    />
  ),
  "mobile-one-time-contribution": (
    <PreferenceCard
      label="One-time contribution"
      meta="Separate from monthly"
      entries={[
        { label: "Add group usage", value: "$10" },
        { label: "Checkout starts", value: "After continue" },
      ]}
    />
  ),
  "official-local-alert-health-context": (
    <MetricCardMock
      label="Official local alert"
      title="Outdoor activity context"
      value="Heat advisory"
      caption="Location-specific, not a universal threshold"
      sparkline={[72, 76, 81, 87, 92, 94, 89]}
    />
  ),
  "scheduled-reminder-authority": (
    <CalendarMock
      label="Independently approved reminders"
      entries={[
        { day: "Tue", time: "8:00 AM", what: "Medication · approved" },
        { day: "Thu", time: "6:00 PM", what: "Call Dad · review pending" },
      ]}
    />
  ),
  "onboarding-and-group-activation-recovery": (
    <ChecklistMock
      label="Setup recovery"
      items={[
        { label: "Recognize completed activation", done: true },
        { label: "Resume the existing group join", done: true },
        { label: "Repeat finished setup", done: false },
      ]}
    />
  ),
  "venice-usage-before-save": (
    <PreferenceCard
      label="Model provider"
      meta="Before save"
      entries={[
        { label: "Venice", note: "Can use capacity faster", value: "Selected" },
        { label: "Managed models", note: "Murph's standard route", value: "Available" },
      ]}
    />
  ),
  "feedback-starts-with-the-problem": (
    <PhoneMock
      channel="Private conversation"
      messages={[
        { from: "user", body: "The meal flow is frustrating." },
        { from: "murph", body: "What happened, and where did it stop you?" },
      ]}
    />
  ),
  "maintenance-without-global-pause": (
    <ChecklistMock
      label="Live storage maintenance"
      items={[
        { label: "Ordinary replies stay available", done: true },
        { label: "Attachments and checkpoints continue", done: true },
        { label: "Pause everyone by default", done: false },
      ]}
    />
  ),
  "post-onboarding-choice-point": (
    <CalendarMock
      label="One-time follow-up"
      entries={[
        {
          day: "Week 3",
          time: "1:30 PM",
          what: "What feels worth handling now?",
        },
      ]}
    />
  ),
  "clubs-challenge-pilot-page": (
    <ChecklistMock
      label="Start a club challenge"
      items={[
        { label: "Runs in iMessage", done: true },
        { label: "Supported wearable inputs", done: true },
        { label: "Automatic scoring", done: true },
        { label: "Choose a challenge format", done: false },
      ]}
    />
  ),
  "imessage-edits-become-corrections": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "Actually, I meant Tuesday." },
        {
          from: "murph",
          body: "Got it. Tuesday changes the timing, so I’ll use the corrected date.",
        },
      ]}
    />
  ),
  "imessage-instant-start": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "Can you help me understand my sleep trend?" },
        {
          from: "murph",
          body: "Yes. Send me what you’re looking at and I’ll help make sense of it.",
        },
      ]}
    />
  ),
  "current-sender-group-disclosure": (
    <PhoneMock
      channel="Group chat"
      messages={[
        { from: "user", body: "Murph, tell them about my sleep this week." },
        {
          from: "murph",
          body: "Your sleep was steadier this week, with fewer short nights than the week before.",
        },
      ]}
    />
  ),
  "group-sponsorship-moments": (
    <PreferenceCard {...GROUP_SPONSORSHIP_USAGE_CREDIT_VISUAL} />
  ),
  "generated-media-private-path": (
    <div className="mt-5 w-full max-w-[320px]">
      <ImagePreview
        alt="A generated image delivered as a private attachment"
        caption="Private attachment"
      />
    </div>
  ),
  "overall-ai-usage-bar": (
    <StatBlock
      label="AI usage available"
      value="62%"
      caption="Monthly allowance + added usage"
    />
  ),
  "group-humans-get-first-refusal": (
    <PhoneMock
      channel="Group chat"
      messages={[
        { from: "user", body: "You lot remember this place?" },
        { from: "user", body: "First trip together." },
      ]}
    />
  ),
  "overnight-imessage-reminders": (
    <CalendarMock
      label="Scheduled reminders"
      entries={[{ day: "Tue", time: "2:00 AM", what: "Check the oven" }]}
    />
  ),
  "iphone-consent-recovery": (
    <ChecklistMock
      label="Stay in the Murph app"
      items={[
        { label: "Review the current documents", done: true },
        { label: "Accept missing launch consent", done: true },
        { label: "Resume setup or sync", done: true },
        { label: "Continue without opening a browser", done: true },
      ]}
    />
  ),
  "group-room-memory": (
    <PhoneMock
      channel="Group chat"
      messages={[
        {
          from: "user",
          body: "House rule: an easy lap means nobody brings a stopwatch.",
        },
        { from: "user", body: "what should we do saturday?" },
        {
          from: "murph",
          body: "Easy lap. No stopwatch, per house rules.",
        },
      ]}
    />
  ),
  "contact-card-after-invite-signup": (
    <ContactCardMock
      name="Murph"
      subtitle="Verified line after setup"
      fields={[{ label: "Mobile", value: "(415) 555-0142" }]}
      action="Add to Contacts"
    />
  ),
  "group-funding-speaks-in-messages": (
    <PreferenceCard {...GROUP_FUNDING_USAGE_CREDIT_VISUAL} />
  ),
  "group-replies-stay-short": (
    <PhoneMock
      channel="Group chat"
      messages={[
        { from: "user", body: "how are we scoring this one?" },
        {
          from: "murph",
          body: "Total minutes moved, weekly. Ties go to whoever logged more days.",
        },
      ]}
    />
  ),
  "group-usage-always-fundable": (
    <PreferenceCard
      label="Add usage to this group"
      meta="Stripe Checkout"
      entries={[
        { label: "$5 pack", value: "Choose" },
        { label: "$10 pack", value: "Choose" },
        { label: "$25 pack", value: "Choose" },
      ]}
    />
  ),
  "group-join-permissions-preselected": (
    <ChecklistMock
      label="Join the challenge"
      items={[
        { label: "Share daily steps with the group", done: true },
        { label: "Share workout minutes with the group", done: true },
        { label: "Share sleep with the group", done: false },
        { label: "Share anything else", done: false },
      ]}
    />
  ),
  "group-contact-card-reshare": (
    <ContactCardMock
      name="Murph"
      subtitle="Shared to the group again on request"
      fields={[
        { label: "Mobile", value: "(415) 555-0142" },
        { label: "Backup", value: "(415) 555-0188" },
      ]}
      action="Add to Contacts"
    />
  ),
  "group-work-requests-declined": (
    <PhoneMock
      channel="Group chat"
      messages={[
        { from: "user", body: "murph write me a react hook for this" },
        {
          from: "murph",
          body: "That one is outside what I do. Ask me anything about health, though, and I'm around for the rest of it.",
        },
      ]}
    />
  ),
  "usage-top-up-returns-to-chat": (
    <DialogMock
      label="Usage added"
      title="You're topped up"
      body="The credit is on the account now. Pick up where you left off."
      primary="Text Murph"
      secondary="Close"
    />
  ),
  "telegram-signup-completes-setup": (
    <ChecklistMock
      label="Finish signup"
      items={[
        { label: "Verify your account", done: true },
        { label: "Link Telegram", done: true },
        { label: "Messaging setup complete", done: true },
        { label: "Answer how Murph should reach you again", done: false },
      ]}
    />
  ),
  "updated-legal-documents-keep-chat-working": (
    <ChecklistMock
      label="While your review is outstanding"
      items={[
        { label: "Group joins by reaction keep working", done: true },
        { label: "Meal photos keep uploading", done: true },
        { label: "Devices stay connected and syncing", done: true },
        { label: "Anything interrupts your conversation", done: false },
      ]}
    />
  ),
  "reactions-read-in-context": (
    <PhoneMock
      channel="iMessage"
      messages={[
        {
          from: "murph",
          body: "I'd hold off on adding creatine until your kidney panel is back.",
          reaction: "❤️",
        },
        {
          from: "murph",
          body: "Taking that as read, not as a yes. Want me to flag it when the results land?",
        },
      ]}
    />
  ),
  "signup-holds-under-a-rush": (
    <ChecklistMock
      label="During a signup rush"
      items={[
        { label: "Account creation completes", done: true },
        { label: "Trial activation completes", done: true },
        { label: "Phone line assigned", done: true },
        { label: "Waiting behind one global lock", done: false },
      ]}
    />
  ),
  "meal-capture-closes-the-day-itself": (
    <PreferenceCard
      label="Meal capture"
      meta="iPhone"
      entries={[
        { label: "Photos access", note: "Your one opt-in", value: "On" },
        { label: "Daily closeout", note: "9:00 PM local", value: "Automatic" },
        { label: "Extra setup", note: "Nothing else to turn on", value: "None" },
      ]}
    />
  ),
  "whoop-at-capacity-opens-full-sync-guide": (
    <ChecklistMock
      label="When direct slots are full"
      items={[
        { label: "The full-sync guide opens straight away", done: true },
        { label: "Voice walkthrough of the Apple Health path", done: true },
        { label: "Continue with Murph on your usual thread", done: true },
        { label: "A separate inline dead end", done: false },
      ]}
    />
  ),
  "home-survives-a-failed-panel": (
    <PanelGrid
      label="Home"
      panels={[
        { state: "ok", title: "Sleep last night", value: "7h 12m" },
        { state: "ok", title: "Steps today", value: "8,940" },
        { state: "retry", title: "Experiments" },
        { state: "ok", title: "Recovery", value: "68%" },
      ]}
    />
  ),
  "invites-explain-which-email-to-use": (
    <DialogMock
      label="Join Murph"
      title="Continue with the invited address"
      body="This invite was sent to one address, so signing in with a different one will not find it. You can ask the sender to reissue it."
      choices={[{ label: "invited@example.com", note: "Invited" }]}
      primary="Continue"
      secondary="Use a different address"
    />
  ),
  "group-song-and-contact-card-together": (
    <PhoneMock
      channel="Group chat"
      messages={[
        { from: "user", body: "make us a song and drop your contact card" },
        {
          bare: true,
          body: <SongBubble title="Four Weeks of Wednesdays" duration="1:12" />,
          from: "murph",
        },
        { from: "murph", body: "And here's my card so everyone can save me." },
      ]}
    />
  ),
  "group-usage-percent-visible": (
    <PhoneMock
      channel="Group chat"
      messages={[
        { from: "user", body: "what's our usage at?" },
        {
          from: "murph",
          body: "About 18% left for this period, which resets Aug 3. I can send the link if anyone wants to top it up.",
        },
      ]}
    />
  ),
  "group-daily-text-cap-doubled": (
    <StatBlock
      label="Group texts per day"
      before="100"
      after="200"
      caption="Direct chats keep 100"
    />
  ),
  "challenge-kickoff-asks-for-intros": (
    <PhoneMock
      channel="Group chat"
      messages={[
        {
          from: "murph",
          body: "Everyone who is in: one line about yourself and a photo, and you get drawn into the challenge comics. Both optional, we start either way.",
        },
      ]}
    />
  ),
  "generated-images-actually-arrive": (
    <PhoneMock
      channel="Group chat"
      messages={[
        { from: "user", body: "send a pic of yourself" },
        {
          bare: true,
          body: <ImagePreview alt="A generated picture from Murph" caption="murph.png" />,
          from: "murph",
        },
      ]}
    />
  ),
  "daily-activity-totals-count-every-workout": (
    <MetricCardMock
      label="Yesterday"
      title="Workouts"
      value="2"
      caption="48m lift plus a 32m walk, 80m combined"
      sparkline={[1, 0, 1, 2, 1, 1, 2]}
    />
  ),
  "onboarding-sounds-like-a-conversation": (
    <PhoneMock
      channel="iMessage"
      messages={[
        {
          from: "murph",
          body: "What would show you this is improving? Something like stairs without stopping, sleeping through the night, or lifting what you used to.",
        },
        { from: "user", body: "sleeping through the night, mostly" },
      ]}
    />
  ),
  "biomarker-pages-explain-the-number": (
    <MetricCardMock
      label="Biomarkers"
      title="HbA1c"
      value="5.4%"
      caption="Your lab's range: under 5.7%"
      sparkline={[5.8, 5.7, 5.7, 5.6, 5.5, 5.4]}
    />
  ),
  "family-usage-top-ups": (
    <PreferenceCard
      label="Settings · Family"
      meta="Per member"
      entries={[
        { label: "Dad", note: "Active", value: "Add usage" },
        { label: "Mom", note: "Active", value: "Add usage" },
        { label: "Sister", note: "Active", value: "Add usage" },
      ]}
    />
  ),
  "garmin-historical-permission-preflight": (
    <DialogMock
      label="Before you continue"
      title="Turn on Historical Data"
      body="Garmin leaves this permission off by default. It is what lets Murph see anything from before today."
      media={<VoiceBubble duration="0:08" />}
      primary="Continue to Garmin"
      secondary="Cancel"
    />
  ),
  "text-murph-after-personalizing": (
    <DialogMock
      label="Welcome to Murph"
      title="You're set. Say hello."
      body="Murph is on your usual thread. Pick a channel and start the conversation."
      choices={[
        { label: "Messages", note: "Ready" },
        { label: "Telegram", note: "Ready" },
      ]}
      primary="Text Murph"
      secondary="Not now"
    />
  ),
  "mobile-settings-and-connect-polish": (
    <PreferenceCard
      label="Settings · Family"
      meta="On a phone"
      entries={[
        { label: "Dad", note: "Owner", value: "Manage" },
        { label: "Mom", note: "Active member", value: "Manage" },
        { label: "Sister", note: "Invite pending", value: "Copy link" },
      ]}
    />
  ),
  "whoop-full-sync-dialog-actions": (
    <DialogMock
      label="Get full sync"
      title="Two steps to full WHOOP history"
      body="Install the companion app, then hand the rest back to Murph in your usual thread."
      primary="Download App"
      secondary="Continue with Murph"
    />
  ),
  "experiment-results-match-the-dashboard": (
    <MetricCardMock
      label="Run report"
      title="Time asleep"
      value="7h 04m"
      caption="14 baseline days beside 14 intervention days"
      sparkline={[6.3, 6.5, 6.4, 6.7, 6.9, 7, 7.1]}
      delta={{ direction: "up", text: "22 min vs baseline" }}
    />
  ),
  "knowledge-page": (
    <ChecklistMock
      label="What Murph works from"
      items={[
        { label: "Reviewed research and evidence grades", done: true },
        { label: "Specialist skills per health area", done: true },
        { label: "Your labs, devices, and history", done: true },
        { label: "Actions it can take for you", done: true },
      ]}
    />
  ),
  "two-week-experiment-baselines": (
    <StatBlock
      label="Baseline before an experiment"
      before="7 days"
      after="14 days"
      caption="Saved runs keep their timing"
    />
  ),
  "progress-updates-before-slow-work": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "here's my bloodwork from Tuesday" },
        {
          from: "murph",
          body: "Got it, saving it now and reading through the panels. Back in a moment.",
        },
      ]}
    />
  ),
  "approved-files-send-themselves": (
    <ChecklistMock
      label="After you approve"
      items={[
        { label: "Approve with your passkey", done: true },
        { label: "Murph finishes that exact send", done: true },
        { label: "One attachment, no caption bubble", done: true },
        { label: "Type a confirmation first", done: false },
      ]}
    />
  ),
  "group-ask-answers-come-back-promptly": (
    <StatBlock
      label="Answer from a group you asked"
      before="2m 20s"
      after="Seconds"
      caption="No second message needed"
    />
  ),
  "hosted-work-runs-on-two-cores": (
    <StatBlock
      label="Hosted container"
      before="1 vCPU"
      after="2 vCPU"
      caption="Memory doubled to 6 GiB"
    />
  ),
  "murph-personas": (
    <PreferenceCard
      label="Who do you want in your corner?"
      meta="First run"
      entries={[
        {
          label: "Main personality",
          note: "Six to choose from",
          value: "Scientist",
        },
        {
          label: "Supporting",
          note: "Optional second personality",
          value: "Hype Coach",
        },
        { label: "Voice", note: "Preview before you save", value: "Husky" },
      ]}
    />
  ),
  "consented-group-to-member-questions": (
    <PhoneMock
      channel="Group chat"
      messages={[
        {
          from: "murph",
          body: "To compare weekly step totals I need each of you to allow one question to your own Murph. Like this message to allow it.",
          reaction: "👍",
        },
        { from: "murph", body: "Thanks. That permission covers steps only." },
      ]}
    />
  ),
  "group-usage-funding": (
    <PreferenceCard
      label="Fund this group"
      meta="No plan required"
      entries={[
        { label: "$5 pack", value: "Choose" },
        { label: "$10 pack", value: "Choose" },
        { label: "$25 pack", value: "Choose" },
      ]}
    />
  ),
  "biomarkers-index-rebuilt": (
    <ChecklistMock
      label="Biomarkers"
      items={[
        { label: "Device readings first", done: true },
        { label: "Lab results grouped by health area", done: true },
        { label: "One canonical unit per history", done: true },
        { label: "A catch-all Other pile", done: false },
      ]}
    />
  ),
  "low-usage-mentioned-in-conversation": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "how did I sleep last week?" },
        {
          from: "murph",
          body: "Averaged 6h41m, best on the two nights you stopped screens by 10. Heads up, we're low on usage this period and may pause soon.",
        },
      ]}
    />
  ),
  "group-newsletter-setup": (
    <PreferenceCard
      label="Group newsletter"
      meta="Saved once"
      entries={[
        { label: "Cadence", note: "Sunday mornings", value: "Weekly" },
        { label: "Delivery", note: "The chat that set it up", value: "This group" },
        { label: "Scopes", note: "Nothing outside these", value: "Movement, sleep" },
      ]}
    />
  ),
  "completed-experiments-show-daily-points": (
    <MetricCardMock
      label="Finished experiment"
      title="Resting heart rate"
      value="54 bpm"
      caption="14 baseline days, 14 intervention days"
      sparkline={[58, 57, 58, 57, 56, 55, 54, 54]}
      delta={{ direction: "down", text: "3 bpm vs baseline" }}
    />
  ),
  "scheduled-messages-get-the-full-murph": (
    <ChecklistMock
      label="A scheduled check-in"
      items={[
        { label: "Same prompt as a live chat", done: true },
        { label: "Same skills and tools", done: true },
        { label: "Same voice and style", done: true },
        { label: "A stripped-down second profile", done: false },
      ]}
    />
  ),
  "challenge-standings-explain-missing-data": (
    <PhoneMock
      channel="Group chat"
      messages={[
        {
          from: "murph",
          body: "Standings through Thursday: 412k steps between four of you. Two people are not counted yet, one needs to reconnect a watch and one has not shared steps.",
        },
      ]}
    />
  ),
  "phone-link-settings-recovery": (
    <DialogMock
      label="Settings"
      title="Link your phone"
      body="We'll text a code to confirm it is you. This replaces any number already on the account."
      choices={[{ label: "(415) 555-0142", note: "Your number" }]}
      primary="Send code"
      secondary="Cancel"
    />
  ),
  "weekly-insights-skip-obvious-weekend": (
    <PhoneMock
      channel="iMessage"
      messages={[
        {
          from: "murph",
          body: "This week's one thing: your recovery held up on the four days you ate before 8pm and dropped on the three you did not. Worth a closer look than the Saturday night.",
        },
      ]}
    />
  ),
  "named-lab-marker-answers-faster": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "what was my last ferritin?" },
        {
          from: "murph",
          body: "62 ng/mL on May 14, inside the 30 to 400 range your lab uses. Up from 41 in January.",
        },
      ]}
    />
  ),
  "dense-voice-memo-keeps-onboarding-moving": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { bare: true, body: <VoiceBubble duration="2:47" />, from: "user" },
        {
          from: "murph",
          body: "Got all of that. I'm sorting the training, the supplements, and the medical history at the same time. One more question while that runs.",
        },
      ]}
    />
  ),
  "welcome-continues-your-conversation": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "murph", body: "Hey, this is Murph. Good to have you." },
        { from: "user", body: "hey, my knee has been bugging me on runs" },
        {
          from: "murph",
          body: "Let's start there. Which part of the knee, and how far in does it show up?",
        },
      ]}
    />
  ),
  "approval-page-sign-in-recovery": (
    <ApprovalCard
      action="Send your lab results PDF"
      detail="This browser is signed out. Sign in on this device to finish approving."
      cta="Sign in to approve"
    />
  ),
  "pulse-finishes-after-payment-setup": (
    <ChecklistMock
      label="Start Pulse"
      items={[
        { label: "Confirm Start Pulse once", done: true },
        { label: "Add a payment method at Stripe", done: true },
        { label: "Pulse starts on the way back", done: true },
        { label: "Click Start Pulse a second time", done: false },
      ]}
    />
  ),
  "contaminant-tests-on-product-pages": (
    <ChecklistMock
      label="Independent product testing"
      items={[
        { label: "Contaminant observations with their source", done: true },
        { label: "Sample and lot provenance", done: true },
        { label: "Honest ranges, not invented exact values", done: true },
        { label: "A safe or unsafe verdict", done: false },
      ]}
    />
  ),
  "private-experiments-open-from-home": (
    <MetricCardMock
      label="Home"
      title="Magnesium before bed"
      value="Day 19"
      caption="Opens to your saved run"
      sparkline={[6.1, 6.4, 6.3, 6.8, 7, 6.9, 7.2]}
      delta={{ direction: "up", text: "26 min more sleep" }}
    />
  ),
  "strava-connections-paused": (
    <ChecklistMock
      label="Strava, while paused"
      items={[
        { label: "Existing connection keeps its data", done: true },
        { label: "Status stays truthful", done: true },
        { label: "Disconnect still works", done: true },
        { label: "New or renewed connections", done: false },
      ]}
    />
  ),
  "sleep-support-that-stays": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "I keep waking up at 3am again" },
        {
          from: "murph",
          body: "Your last two weeks show sleep splitting around 2:50am, mostly after late screens. Want to run a two-week wind-down experiment? I'd check in Fridays.",
        },
      ]}
    />
  ),
  "usage-top-ups": (
    <PreferenceCard
      label="Add usage"
      meta="Stripe Checkout"
      entries={[
        { label: "$5 pack", value: "Choose" },
        { label: "$10 pack", value: "Choose" },
        { label: "$25 pack", value: "Choose" },
      ]}
    />
  ),
  "murph-safe-product-search": (
    <ChecklistMock
      label="What a product record shows"
      items={[
        { label: "Label contents and doses", done: true },
        { label: "Linked product-test observations", done: true },
        { label: "Untested claims marked unknown", done: true },
        { label: "A safe or unsafe verdict", done: false },
      ]}
    />
  ),
  "onboarding-asks-before-it-prescribes": (
    <PhoneMock
      channel="Private iMessage"
      messages={[
        {
          from: "murph",
          body: "What are one or two things you'd want different about your health this year?",
        },
        { from: "user", body: "sleep through the night, more energy" },
        {
          from: "murph",
          body: "Saved. We'll work toward those. Nothing to start today unless you want to.",
        },
      ]}
    />
  ),
  "family-member-plan-management": (
    <PreferenceCard
      label="Family plan"
      meta="4 of 6 seats"
      entries={[
        { label: "You", value: "Edge" },
        { label: "Partner", value: "Updating to Edge" },
        { label: "Dad", value: "Pulse" },
      ]}
    />
  ),
  "leave-a-group-yourself": (
    <PhoneMock
      channel="Private iMessage"
      messages={[
        { from: "user", body: "leave the marathon group for me" },
        {
          from: "murph",
          body: "Done. You've left Marathon Crew, and your sharing with that group has ended. The iMessage thread itself stays.",
        },
      ]}
    />
  ),
  "replies-read-like-texting": (
    <PhoneMock
      channel="iMessage"
      messages={[
        { from: "user", body: "what should I eat before tomorrow's race?" },
        { from: "user", body: "also it starts at 7am" },
        {
          from: "murph",
          body: "Early start changes it: light carbs tonight, then a small breakfast about 90 minutes out.",
        },
      ]}
    />
  ),
  "model-settings-refresh": (
    <PreferenceCard
      label="AI model"
      meta="Family Edge"
      entries={[
        { label: "Luna", note: "Fast everyday answers", value: "Available" },
        { label: "Terra", note: "The default balance", value: "Current" },
        { label: "GPT-5.6 Sol", note: "Deepest reasoning", value: "Selected" },
      ]}
    />
  ),
  "experiment-cards-honest-colors": (
    <StatBlock
      label="HRV up 6 ms on the card"
      before="Flagged unfavorable"
      after="Shown favorable"
      caption="colored by the biomarker, not the hypothesis"
    />
  ),
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
  "pulse-trial-two-weeks": (
    <StatBlock
      label="Pulse Trial length"
      before="10 days"
      after="14 days"
      caption="new trials only"
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
      label="Wearable record days"
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

        <div className="mx-auto max-w-[1080px] px-6 py-16 sm:px-10 sm:py-20 lg:py-24 xl:px-0">
          {editions.map((edition, editionIndex) => (
            <ChangelogEditionSection
              key={edition.id}
              buildItemHref={buildChangelogItemPath}
              edition={edition}
              isFirst={editionIndex === 0}
              tryItByItemId={tryItByItemId}
              visuals={VISUALS}
            />
          ))}
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

async function resolveTryItByItemId({
  authenticated,
  editions,
}: {
  authenticated: boolean;
  editions: readonly { items: readonly ChangelogItem[] }[];
}): Promise<Map<string, ResolvedChangelogTryIt>> {
  const itemsWithTryIt = editions
    .flatMap((edition) => edition.items)
    .filter((item) => item.tryIt);

  const entries = await Promise.all(
    itemsWithTryIt.map(async (item) => {
      const tryIt = item.tryIt!;
      if (tryIt.href) {
        const resolved: ResolvedChangelogTryIt = {
          authenticated,
          label: tryIt.label,
          options: [],
        };
        return [item.id, resolved] as const;
      }

      const prompt = tryIt.prompt!;
      const options = await resolveHostedMurphContactOptions({
        message: {
          body: prompt,
          subject: `Try it: ${item.title}`,
        },
      });
      const resolved: ResolvedChangelogTryIt = {
        authenticated,
        label: tryIt.label,
        options,
        prompt,
      };
      return [item.id, resolved] as const;
    }),
  );

  return new Map(entries);
}
