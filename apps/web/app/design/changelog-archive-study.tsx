import {
  listChangelogEditions,
  type ChangelogEdition,
} from "@/src/lib/changelog";

import {
  ChangelogEditionSection,
  type ResolvedChangelogTryIt,
} from "../changelog/changelog-edition-section";
import { PhoneMock } from "../changelog/phone-mock";
import {
  CalendarMock,
  ChecklistMock,
  CompactTableMock,
  ContactCardMock,
  ReferenceBandMock,
} from "../changelog/visuals";

const DESIGN_CHANGELOG_EDITION: ChangelogEdition = {
  id: "2030-01-17",
  publishedOn: "2030-01-17",
  title: "A week that closes its own loops",
  summary:
    "Synthetic release copy shows the production archive rhythm without reading live product data.",
  items: [
    {
      id: "design-follow-up",
      kind: "feature",
      priority: 5,
      title: "Follow-ups arrive where the work started",
      summary:
        "A finished task returns one useful result to the same conversation, with the next decision easy to spot.",
      details:
        "This fixture exercises a full feature card with supporting detail at desktop and phone widths.",
      relevanceTags: ["design"],
      sourcePullRequests: [],
    },
    {
      id: "design-recovery",
      kind: "improvement",
      priority: 4,
      title: "Recovery explains what to do next",
      summary:
        "When a flow cannot continue, the archive card keeps the explanation short and names the next available action.",
      relevanceTags: ["design"],
      sourcePullRequests: [],
    },
    {
      id: "design-contact",
      kind: "improvement",
      priority: 3,
      title: "Contact details stay tied to the right line",
      summary:
        "The archive can pair a short release note with one verified contact action and no extra identity claims.",
      relevanceTags: ["design"],
      sourcePullRequests: [],
    },
    {
      id: "design-correction",
      kind: "improvement",
      priority: 2,
      title: "Corrections stay attached to the conversation",
      summary:
        "The archive can explain a conversational correction beside a compact phone example without overwhelming the release note.",
      relevanceTags: ["design"],
      sourcePullRequests: [],
    },
    {
      id: "design-table",
      kind: "feature",
      priority: 3,
      title: "Compact tables make dense changes scannable",
      summary:
        "The archive can show a small responsive table when rows and columns explain the released behavior better than another paragraph.",
      relevanceTags: ["design"],
      sourcePullRequests: [],
    },
    {
      id: "design-reference-band",
      kind: "improvement",
      priority: 2,
      title: "Reference context stays visible",
      summary:
        "A bounded chart study covers numeric context without turning the changelog into a dashboard.",
      relevanceTags: ["design"],
      sourcePullRequests: [],
    },
  ],
};

const DESIGN_VISUALS = {
  "design-correction": (
    <PhoneMock
      channel="Private conversation"
      messages={[
        { from: "user", body: "Actually, I meant Tuesday." },
        { from: "murph", body: "Got it, I’ll use Tuesday." },
      ]}
    />
  ),
  "design-contact": (
    <ContactCardMock
      action="Add to Contacts"
      avatarSrc="/murph-headshots/murph-headshot-08-sm.png"
      fields={[{ label: "Mobile", value: "(415) 555-0142" }]}
      name="Murph"
      subtitle="Verified line after setup"
    />
  ),
  "design-follow-up": (
    <CalendarMock
      entries={[{ day: "Tue", time: "2:00 AM", what: "Review the result" }]}
      label="Scheduled follow-up"
    />
  ),
  "design-recovery": (
    <ChecklistMock
      items={[
        { label: "Review the current documents", done: true },
        { label: "Accept missing launch consent", done: true },
        { label: "Continue without opening a browser", done: true },
      ]}
      label="Stay in the app"
    />
  ),
  "design-table": (
    <CompactTableMock
      columns={[
        { key: "metric", label: "Metric" },
        { key: "today", label: "Today" },
        { key: "goal", label: "Goal" },
      ]}
      label="Compact response"
      rows={[
        { metric: "Protein", today: "92 g", goal: "120 g" },
        { metric: "Fiber", today: "24 g", goal: "30 g" },
      ]}
    />
  ),
  "design-reference-band": (
    <ReferenceBandMock
      highLabel="100 mg/dL"
      label="Reference context"
      lowLabel="70 mg/dL"
      markerLabel="92"
      markerPosition={62}
    />
  ),
} as const;

const LATEST_PRODUCTION_ITEM_IDS = new Set([
  "appointment-reminders-by-default",
  "blood-pressure-history-completion",
  "sharper-single-photo-review",
  "web-search-restored",
  "workout-card-status-rendering",
]);
const LATEST_PRODUCTION_SOURCE_EDITION = listChangelogEditions().find(
  (edition) =>
    edition.items.some((item) => LATEST_PRODUCTION_ITEM_IDS.has(item.id)),
);
const LATEST_PRODUCTION_CHANGELOG_EDITION = LATEST_PRODUCTION_SOURCE_EDITION
  ? {
      ...LATEST_PRODUCTION_SOURCE_EDITION,
      items: LATEST_PRODUCTION_SOURCE_EDITION.items.filter((item) =>
        LATEST_PRODUCTION_ITEM_IDS.has(item.id),
      ),
    }
  : null;
const LATEST_PRODUCTION_TRY_IT_BY_ITEM_ID: ReadonlyMap<
  string,
  ResolvedChangelogTryIt
> = new Map([
    [
      "appointment-reminders-by-default",
      {
        authenticated: false,
        label: "Tell Murph about an appointment",
        options: [],
        prompt:
          "I have a confirmed dentist appointment next Thursday at 2 PM.",
      },
    ],
]);

const LATEST_PRODUCTION_VISUALS = {
  "appointment-reminders-by-default": (
    <CalendarMock
      entries={[
        { day: "Thu", time: "2:00 PM", what: "Dentist appointment" },
      ]}
      label="Confirmed appointment"
    />
  ),
} as const;

export function ChangelogArchiveStudy() {
  return (
    <div
      className="-mx-5 scroll-mt-20 bg-[#f5f0e8] px-5 py-12 text-[#2d3436] sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12"
      data-design-study="changelog-archive"
      id="changelog-archive"
      inert
    >
      <div className="mx-auto max-w-[1080px]">
        {LATEST_PRODUCTION_CHANGELOG_EDITION ? (
          <div
            data-design-state="latest-production-edition"
            id="changelog-archive-latest"
          >
            <ChangelogEditionSection
              buildItemHref={(itemId) => `#${itemId}`}
              edition={LATEST_PRODUCTION_CHANGELOG_EDITION}
              isFirst
              tryItByItemId={LATEST_PRODUCTION_TRY_IT_BY_ITEM_ID}
              visuals={LATEST_PRODUCTION_VISUALS}
            />
          </div>
        ) : null}
        <div className="mt-20 border-t border-[#c4a882]/35 pt-20">
          <ChangelogEditionSection
            buildItemHref={(itemId) => `#${itemId}`}
            edition={DESIGN_CHANGELOG_EDITION}
            isFirst
            visuals={DESIGN_VISUALS}
          />
        </div>
      </div>
    </div>
  );
}
