"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  LandingAuthActions,
  LandingAuthDialogButton,
} from "@/app/auth-controls";
import { cn } from "@/src/lib/utils";
import {
  MURPH_TAGLINE,
  MURPH_TAGLINE_LINE_1,
  MURPH_TAGLINE_LINE_2,
} from "@/src/lib/site-metadata";
import { type HeroContactInfo } from "@/src/lib/hero-contact-info";
import {
  buildMurphSmsHref,
  buildMurphTelegramTextHref,
} from "@/src/lib/murph-contact-routing";

export type HeroMessengerChannel = "imessage" | "telegram";

import { ExperimentCard, type ExperimentResult } from "./phone-mock";
import {
  ChallengeCard,
  GROUP_MEMBERS,
  NewsletterCard,
  type GroupMember,
} from "./group-chat-cards";
import {
  MurphHeadshotAvatar,
  type MurphHeadshotSrc,
} from "./murph-headshot-avatar";
import { VoiceMemoPlayer } from "@/src/components/ui/voice-memo-player";

type BloodworkMarker = {
  label: string;
  from: string;
  to: string;
  unit: string;
  delta: string;
  tone: "good" | "warn";
};

type BloodworkResult = {
  eyebrow: string;
  sideLabel?: string;
  markers: ReadonlyArray<BloodworkMarker>;
  note?: string;
};

type OrderResult = {
  eyebrow: string;
  status: string;
  title: string;
  detail?: string;
  arriving: string;
  price: string;
};

type SoloTextItem = {
  kind: "text";
  id: number;
  from: "user" | "murph";
  text: string;
};
type MemberTextItem = {
  kind: "text";
  id: number;
  from: "member";
  sender: GroupMember;
  text: string;
};
type TextItem = SoloTextItem | MemberTextItem;
type CardItem = { kind: "card"; id: number; result: ExperimentResult };
type BloodworkItem = { kind: "bloodwork"; id: number; result: BloodworkResult };
type OrderItem = { kind: "order"; id: number; result: OrderResult };
type ChallengeItem = { kind: "challenge"; id: number };
type NewsletterItem = { kind: "newsletter"; id: number };
type TimestampItem = { kind: "timestamp"; id: number; text: string };
type AudioItem = { kind: "audio"; id: number; src: string };
type ContactItem = {
  kind: "contact";
  id: number;
  info: HeroContactInfo;
  text: string;
};
type StreamItem =
  | TextItem
  | CardItem
  | BloodworkItem
  | OrderItem
  | ChallengeItem
  | NewsletterItem
  | TimestampItem
  | AudioItem
  | ContactItem;

type Exchange = {
  topic: string;
  user: string;
  murph: string;
  card?: ExperimentResult;
  bloodwork?: BloodworkResult;
  order?: OrderResult;
};

const EXCHANGES: ReadonlyArray<Exchange> = [
  {
    topic: "Magnesium",
    user: "Did the magnesium actually do anything?",
    card: {
      eyebrow: "Day 14 · Magnesium",
      stats: [
        { label: "Deep sleep", value: "1h 42m", delta: "+18%" },
        { label: "HRV", value: "52.1", unit: "ms", delta: "+12%" },
        { label: "REM", value: "1h 08m", delta: "+6%" },
      ],
      trend: {
        baseline: [58, 56, 60, 57, 59],
        active: [59, 64, 68, 71, 75, 78, 82, 85],
        label: "14 day trend",
      },
    },
    murph:
      "Two weeks in, deep sleep up 18% and HRV up 12% vs your baseline. Want me to reorder the Thorne 200ct?",
  },
  {
    topic: "Bone density",
    user: "Book me a DEXA scan nearby.",
    order: {
      eyebrow: "Appointment booked · today",
      status: "Confirmed",
      title: "BodySpec DEXA scan",
      detail: "Thursday · 2:00 pm · Mission St, 1.4 mi away",
      arriving: "Added to your calendar",
      price: "$49",
    },
    murph:
      "Booked BodySpec on Mission for Thursday at 2pm: $49, 1.4 miles away. I added the confirmation and prep notes to your calendar.",
  },
  {
    topic: "LDL cholesterol",
    user: "Did my LDL get worse?",
    bloodwork: {
      eyebrow: "Latest panel · vs March",
      sideLabel: "2 flagged",
      markers: [
        { label: "LDL", from: "108", to: "122", unit: "mg/dL", delta: "+14", tone: "warn" },
        { label: "HDL", from: "62", to: "58", unit: "mg/dL", delta: "-4", tone: "warn" },
        { label: "Triglycerides", from: "112", to: "98", unit: "mg/dL", delta: "-14", tone: "good" },
      ],
    },
    murph:
      "LDL up 14 since March. The diet shift after Easter lines up. I drafted three questions for your June visit.",
  },
  {
    topic: "Sleep quality",
    user: "Why am I sleeping so badly this week?",
    card: {
      eyebrow: "Day 18 · Caffeine",
      comparison: {
        label: "18 night deep sleep window",
        rows: [
          {
            label: "Nights without PM espresso",
            value: "1h 34m",
            level: 0.92,
            tone: "good",
          },
          {
            label: "Nights after PM espresso",
            value: "1h 11m",
            level: 0.42,
            delta: "-24%",
            tone: "warn",
          },
        ],
      },
    },
    murph:
      "The clearest pattern is less deep sleep after afternoon espresso: 1h 11m vs 1h 34m, down 24% on nights you have coffee after 2pm.",
  },
  {
    topic: "Doctor recap",
    user: "When did I last see Dr. Lee?",
    murph:
      "March 14th. She wanted a 6-month follow-up on the B12. I held a 30-minute slot for July 2nd and pulled her notes from the visit.",
  },
  {
    topic: "Daily walk",
    user: "How are the walks going this month?",
    card: {
      eyebrow: "June walks",
      stats: [
        { label: "Days", value: "18/26", delta: "+2 vs May" },
        { label: "Avg time", value: "42", unit: "min", delta: "+4 vs May" },
      ],
    },
    murph:
      "18 of 26 days, averaging 42 minutes. Three more this week and you beat April. Garmin shows no unusual change in your recent training load.",
  },
  {
    topic: "Mammogram",
    user: "Did I schedule the mammogram?",
    murph:
      "Yes, October 14th at 10am at Sutter. I queued the prep notes for the night before and a morning-of reminder. Insurance pre-auth is in.",
  },
  {
    topic: "Blood pressure",
    user: "Why is my BP up this week?",
    card: {
      eyebrow: "Last 7 days · BP",
      stats: [
        { label: "Avg systolic", value: "132", unit: "mmHg", delta: "from 124" },
        { label: "Avg diastolic", value: "84", unit: "mmHg", delta: "from 78" },
      ],
    },
    murph:
      "Sodium ran high three days in a row and you missed two walks. Steady week before we adjust anything.",
  },
  {
    topic: "Omega-3",
    user: "Reorder my omega-3.",
    order: {
      eyebrow: "Order placed · today",
      status: "Confirmed",
      title: "Nordic Naturals Ultimate Omega",
      detail: "1280 mg EPA+DHA · 120 softgels",
      arriving: "Arriving Wednesday",
      price: "$41.96",
    },
    murph:
      "Reordered. I also queued a lipid recheck for November.",
  },
  {
    topic: "B12",
    user: "Do I still need the B12?",
    murph:
      "Your last B12 was 312, just above the low end. I pulled the trend and drafted a question for your next visit.",
  },
  {
    topic: "Steps",
    user: "How are my steps this week?",
    murph:
      "Average 8.4k a day, up 600 from last week. The morning walk habit is sticking. Two more steady weeks and your Z2 base will move.",
  },
  {
    topic: "Sauna",
    user: "Did the sauna actually help my HRV?",
    murph:
      "Sauna nights show +9 ms HRV vs non-sauna nights over the past month. Worth keeping the Tuesday and Friday sessions.",
  },
  {
    topic: "Dentist",
    user: "Book my dentist cleaning.",
    order: {
      eyebrow: "Appointment held · today",
      status: "On hold",
      title: "Smile Dental on Mission",
      detail: "Tuesday June 11 · 11:00 am · In-network",
      arriving: "Confirm to lock the slot",
      price: "$0 copay",
    },
    murph:
      "Smile Dental on Mission has Tuesday at 11am, in-network with your BlueShield. I held the slot. Confirm and I will book it.",
  },
  {
    topic: "Competition",
    user: "How am I tracking for the marathon?",
    card: {
      eyebrow: "Marathon · 11 weeks out",
      stats: [
        { label: "Long run", value: "18", unit: "mi", delta: "+2 vs last" },
        { label: "Z2 pace", value: "4:32", unit: "/km", delta: "-8s vs Jan" },
      ],
    },
    murph:
      "On pace. Long runs hitting 18 mi at 5:48, Z2 base 4:32/km, training load steady. Three weeks until tempo block. Want me to lock in next month?",
  },
  {
    topic: "Tabata",
    user: "Did the Tabata block actually work?",
    card: {
      eyebrow: "Week 2 · Tabata",
      stats: [
        { label: "Lactate threshold", value: "4.4", unit: "mmol/L", delta: "from 3.8" },
        { label: "Zone 2 pace", value: "5:12", unit: "/km", delta: "-12s" },
      ],
    },
    murph:
      "Two weeks logged. Lactate threshold moved from 3.8 to 4.4 mmol/L. Zone 2 pace dropped 12s/km. Two more weeks to confirm?",
  },
  {
    topic: "HRV",
    user: "How's my HRV been this month?",
    murph:
      "Average 51 ms, up 8% from May. HRV was highest on sauna nights, mostly Tuesday and Friday.",
  },
  {
    topic: "Recovery",
    user: "How did I recover today?",
    card: {
      eyebrow: "Tuesday · morning brief",
      stats: [
        { label: "HRV", value: "54", unit: "ms", delta: "+9%" },
        { label: "Deep sleep", value: "1h 38m", delta: "+16%" },
        { label: "Resting HR", value: "57", unit: "bpm", delta: "-3%" },
      ],
    },
    murph:
      "Recovery score 87, above your recent baseline. Today looks like a strong training day.",
  },
];

const AUTO_RUN_TOPICS = [
  "Magnesium",
] as const;

// Unnamed iMessage groups are titled by participant count (excluding you):
// Murph plus the three joined members.
const GROUP_HEADER_LABEL = `${GROUP_MEMBERS.length + 1} People`;

// One headline spanning personal intelligence and social follow-through. The
// lines come from the shared brand-copy source in site-metadata.
const HERO_HEADLINE = {
  line1: MURPH_TAGLINE_LINE_1,
  line2: MURPH_TAGLINE_LINE_2,
} as const;

const HERO_COPY = {
  act1: {
    paragraph:
      "Wearables, bloodwork, doctor visits, supplements, blood pressure, sleep. Murph reads it all, figures out what actually works, and helps you build habits that stick.",
  },
  act2: {
    paragraph:
      "Start a health challenge with your friends, right in your group chat. Murph sets fair baselines, referees the week, calls the winner, and keeps everyone in the loop.",
  },
} as const;

const GROUP_MESSAGES = {
  userKickoff: "walk challenge starts tomorrow. loser buys steak dinner 🥩",
  murphKickoff:
    "Baselines are set from everyone's wearables. I keep score, standings drop daily, and the winner gets dinner. Good luck.",
  timestamp: "Saturday 9:02 AM",
  theoQuestion: "no shot you guys are keeping up with me this week 😤",
  murphStandings:
    "Standings, day 5 of 7. Maya is one sunrise walk from taking the lead. Theo, bold words for a man who logged 11 minutes yesterday.",
  mayaReply: "😂 not the sunrise walk pressure",
  samSongReply: "why does this actually slap 😭",
  theoSongReply: "take it down. i'm still winning btw",
  sundayTimestamp: "Sunday 8:02 AM",
  murphNewsletter: "This week's wins just landed in everyone's inbox.",
} as const;

const CHALLENGE_ROAST_AUDIO_SRC = "/audio/challenge-roast.mp3";

// Identifies consecutive-message runs so avatars and name labels appear once
// per sender run, like iMessage. Voice memos are always Murph's.
function senderKeyOf(item: StreamItem): string | null {
  if (item.kind === "audio") return "murph";
  if (item.kind !== "text") return null;
  return item.from === "member" ? `member:${item.sender.id}` : item.from;
}

function findExchangeByTopic(topic: string): Exchange {
  const exchange = EXCHANGES.find(
    (candidate) => candidate.topic.toLowerCase() === topic.toLowerCase(),
  );
  if (!exchange) {
    throw new Error(`Missing homepage hero exchange for ${topic}`);
  }
  return exchange;
}

const AUTO_RUN_EXCHANGES = AUTO_RUN_TOPICS.map(findExchangeByTopic);

type Floater = {
  text: string;
  member?: GroupMember;
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
  flyX: string;
  flyY: string;
  delay: number;
  duration: number;
};

type FloaterStyle = React.CSSProperties & {
  "--delay": string;
  "--dur": string;
  "--fly-x": string;
  "--fly-y": string;
};

// Floaters live in the top/bottom strips, the left edge, and the right-edge
// column, avoiding the hero text area. Top floaters use a pixel offset that
// clears the fixed nav (~60px). Fly vectors point toward the phone (~x=78%, y=50%).
const FLOATERS: ReadonlyArray<Floater> = [
  // top - just below the nav, spread across the width
  { text: "Magnesium", top: "78px", left: "8%", flyX: "60vw", flyY: "42vh", delay: 0, duration: 11 },
  { text: "Dentist", top: "78px", left: "26%", flyX: "44vw", flyY: "42vh", delay: 1.1, duration: 11.5 },
  { text: "Competition", top: "78px", left: "44%", flyX: "26vw", flyY: "42vh", delay: 2.7, duration: 12 },
  { text: "LDL cholesterol", top: "78px", right: "6%", flyX: "-14vw", flyY: "42vh", delay: 3.2, duration: 15 },
  // left edge - short labels only so they don't crowd the hero text column
  { text: "Steps", top: "22%", left: "1%", flyX: "60vw", flyY: "28vh", delay: 0.4, duration: 10.5 },
  { text: "Omega-3", top: "40%", left: "1%", flyX: "60vw", flyY: "10vh", delay: 1.6, duration: 11.5 },
  { text: "B12", top: "58%", left: "1%", flyX: "60vw", flyY: "-8vh", delay: 0.9, duration: 10 },
  { text: "Sauna", top: "76%", left: "1%", flyX: "60vw", flyY: "-26vh", delay: 2.4, duration: 12 },
  // right edge
  { text: "Mammogram", top: "14%", right: "2%", flyX: "-14vw", flyY: "36vh", delay: 1.4, duration: 13 },
  { text: "Doctor recap", top: "50%", right: "2%", flyX: "-14vw", flyY: "0vh", delay: 2.2, duration: 12.5 },
  { text: "Bone density", top: "86%", right: "2%", flyX: "-14vw", flyY: "-36vh", delay: 1.8, duration: 12 },
  // bottom
  { text: "Daily walk", bottom: "4%", left: "5%", flyX: "58vw", flyY: "-42vh", delay: 1.3, duration: 10.5 },
  { text: "Sleep quality", bottom: "5%", left: "26%", flyX: "44vw", flyY: "-40vh", delay: 2.7, duration: 13.5 },
  { text: "Blood pressure", bottom: "4%", right: "28%", flyX: "6vw", flyY: "-42vh", delay: 2.6, duration: 14 },
  // Person floaters stay in the top strip and right edge with the topic
  // labels: those bands clear the phone mock; free-floating offsets like the
  // old top:138px landed on the phone's corner at wide viewports.
  {
    text: "Theo",
    member: GROUP_MEMBERS[0],
    top: "78px",
    right: "22%",
    flyX: "2vw",
    flyY: "42vh",
    delay: 0.2,
    duration: 10.8,
  },
  {
    text: "Maya",
    member: GROUP_MEMBERS[1],
    top: "31%",
    right: "1.5%",
    flyX: "-13vw",
    flyY: "19vh",
    delay: 1.9,
    duration: 12.2,
  },
  {
    text: "Sam",
    member: GROUP_MEMBERS[2],
    bottom: "16%",
    right: "9%",
    flyX: "-16vw",
    flyY: "-18vh",
    delay: 2.9,
    duration: 11.6,
  },
];

const FLOATER_INDEX_BY_TEXT: Record<string, number> = FLOATERS.reduce(
  (acc, f, i) => {
    acc[f.text.toLowerCase()] = i;
    return acc;
  },
  {} as Record<string, number>,
);

const FIRST_RUN_DELAY = 1800;
const USER_BUBBLE_AT = 1400;
const TYPING_AT = 2200;
const REPLY_AT = 3600;
const CYCLE_LENGTH = 7800;
// Give the final act-1 reply breathing room before the compose sheet covers
// it (auto path only; a direct person-floater click starts the sheet fast).
const GROUP_SEQUENCE_BREATHER = 1900;
const COMPOSE_SHEET_UP_AT = 700;
const GROUP_SWAP_AT = 1600;
const GROUP_FACES_LAUNCH_AT = 2600;
const GROUP_FACE_FLIGHT_MS = 1400;
// Members fly in as one quick burst: barely staggered so the group forms
// together instead of trickling in one by one.
const GROUP_JOIN_STAGGER = 450;
const GROUP_LAST_CHIP_AT =
  GROUP_FACES_LAUNCH_AT +
  (GROUP_MEMBERS.length - 1) * GROUP_JOIN_STAGGER +
  GROUP_FACE_FLIGHT_MS;
const COMPOSE_SHEET_REVEAL_AT = GROUP_LAST_CHIP_AT + 900;
const COMPOSE_SHEET_FADE_MS = 350;
const GROUP_KICKOFF_USER_AT = COMPOSE_SHEET_REVEAL_AT + 300;
const GROUP_KICKOFF_TYPING_AT = COMPOSE_SHEET_REVEAL_AT + 1100;
const GROUP_KICKOFF_REPLY_AT = COMPOSE_SHEET_REVEAL_AT + 2300;
const GROUP_TIMESTAMP_AT = COMPOSE_SHEET_REVEAL_AT + 4900;
const GROUP_BEATS_START_AT = COMPOSE_SHEET_REVEAL_AT + 5700;
const GROUP_BEAT_GAP = 6500;
const MAX_ITEMS = 30;

type ComposeSheetState = "hidden" | "pending" | "up" | "leaving";

export function HeroClocksIn({
  authenticated,
  contactInfo,
  messengerChannel,
  murphHeadshotSrc,
}: {
  authenticated: boolean;
  contactInfo: HeroContactInfo;
  messengerChannel: HeroMessengerChannel;
  murphHeadshotSrc: MurphHeadshotSrc;
}) {
  const [items, setItems] = useState<ReadonlyArray<StreamItem>>([]);
  // Floaters currently flying toward the phone. A set (not a single index)
  // because the group burst launches three staggered flights that overlap.
  const [activeFloaterIdxs, setActiveFloaterIdxs] = useState<
    ReadonlySet<number>
  >(() => new Set());
  const [typing, setTyping] = useState(false);
  const [responseInFlight, setResponseInFlightState] = useState(false);
  const [engaged, setEngagedState] = useState(false);
  const [composerValue, setComposerValue] = useState("");
  const [groupMode, setGroupModeState] = useState(false);
  const [composeSheet, setComposeSheet] =
    useState<ComposeSheetState>("hidden");
  const [usedFloaters, setUsedFloaters] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const cycleRef = useRef(0);
  const idRef = useRef(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const cancelDemoRef = useRef<(() => void) | null>(null);
  const engagedRef = useRef(false);
  const cancelledRef = useRef(false);
  const groupSequenceStartedRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const isAtBottomRef = useRef(true);
  const responseInFlightRef = useRef(false);

  const setGroupMode = (next: boolean) => {
    setGroupModeState(next);
  };

  const setResponseInFlight = (next: boolean) => {
    responseInFlightRef.current = next;
    setResponseInFlightState(next);
  };

  const setEngaged = () => {
    engagedRef.current = true;
    setEngagedState(true);
  };

  const nextId = () => ++idRef.current;

  // In group mode Murph is attributed like any other sender (avatar + name),
  // matching how iMessage renders every non-you participant.
  const murphSender = {
    id: "murph",
    name: "Murph",
    avatarSrc: murphHeadshotSrc,
  };

  const activateFloater = (idx: number | null) => {
    if (idx === null) return;
    setActiveFloaterIdxs((prev) => {
      if (prev.has(idx)) return prev;
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
  };

  const deactivateFloater = (idx: number | null) => {
    if (idx === null) return;
    setActiveFloaterIdxs((prev) => {
      if (!prev.has(idx)) return prev;
      const next = new Set(prev);
      next.delete(idx);
      return next;
    });
  };

  const appendItems = (nextItems: ReadonlyArray<StreamItem>) => {
    setItems((prev) => [...prev, ...nextItems].slice(-MAX_ITEMS));
  };

  const clearScheduledDemo = ({
    resetVisualState = true,
  }: {
    resetVisualState?: boolean;
  } = {}) => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    if (resetVisualState) {
      setTyping(false);
      setActiveFloaterIdxs(new Set());
      setResponseInFlight(false);
    }
  };

  const cancelScheduledDemo = () => {
    cancelledRef.current = true;
    setComposeSheet("hidden");
    clearScheduledDemo();
  };

  const prepareScheduledDemo = ({
    resetVisualState = true,
  }: {
    resetVisualState?: boolean;
  } = {}) => {
    clearScheduledDemo({ resetVisualState });
    cancelledRef.current = false;
    cancelDemoRef.current = cancelScheduledDemo;
  };

  const prepareScheduledDemoForMount = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    cancelledRef.current = false;
    cancelDemoRef.current = cancelScheduledDemo;
  };

  const queue = (
    fn: () => void,
    ms: number,
    options: { allowAfterEngaged?: boolean } = {},
  ) => {
    const timer = setTimeout(() => {
      if (cancelledRef.current) return;
      if (engagedRef.current && !options.allowAfterEngaged) return;
      fn();
    }, ms);
    timersRef.current.push(timer);
  };

  const markFloaterUsed = (idx: number | null) => {
    if (idx === null) return;
    const f = FLOATERS[idx];
    if (!f) return;
    setUsedFloaters((prev) => {
      if (prev.has(f.text)) return prev;
      const next = new Set(prev);
      next.add(f.text);
      return next;
    });
  };

  const buildExchangeReplyItems = (ex: Exchange): ReadonlyArray<StreamItem> => {
    const next: StreamItem[] = [];
    if (ex.card) {
      next.push({ kind: "card", id: nextId(), result: ex.card });
    }
    if (ex.bloodwork) {
      next.push({
        kind: "bloodwork",
        id: nextId(),
        result: ex.bloodwork,
      });
    }
    if (ex.order) {
      next.push({
        kind: "order",
        id: nextId(),
        result: ex.order,
      });
    }
    next.push({
      kind: "text",
      id: nextId(),
      from: "murph",
      text: ex.murph,
    });
    return next;
  };

  const buildCompletedExchangeItems = (
    ex: Exchange,
  ): ReadonlyArray<StreamItem> => [
    {
      kind: "text",
      id: nextId(),
      from: "user",
      text: ex.user,
    },
    ...buildExchangeReplyItems(ex),
  ];

  const startGroupSequence = ({
    allowAfterEngaged,
  }: {
    allowAfterEngaged: boolean;
  }) => {
    if (groupSequenceStartedRef.current) return;
    groupSequenceStartedRef.current = true;
    setComposeSheet("pending");

    queue(
      () => {
        setComposeSheet("up");
      },
      COMPOSE_SHEET_UP_AT,
      { allowAfterEngaged },
    );

    queue(
      () => {
        // The group is a NEW conversation, not an audience added to the
        // private 1:1 thread: clear the personal history under the compose
        // sheet so none of the user's private health talk travels with it.
        setItems([]);
        setTyping(false);
        setGroupMode(true);
      },
      GROUP_SWAP_AT,
      { allowAfterEngaged },
    );

    GROUP_MEMBERS.forEach((member, index) => {
      const idx = FLOATER_INDEX_BY_TEXT[member.name.toLowerCase()] ?? null;
      const startsAt = GROUP_FACES_LAUNCH_AT + index * GROUP_JOIN_STAGGER;

      queue(
        () => {
          activateFloater(idx);
        },
        startsAt,
        { allowAfterEngaged },
      );

      queue(
        () => {
          markFloaterUsed(idx);
          deactivateFloater(idx);
        },
        startsAt + GROUP_FACE_FLIGHT_MS,
        { allowAfterEngaged },
      );
    });

    queue(
      () => {
        setComposeSheet("leaving");
      },
      COMPOSE_SHEET_REVEAL_AT,
      { allowAfterEngaged },
    );

    queue(
      () => {
        setComposeSheet("hidden");
      },
      COMPOSE_SHEET_REVEAL_AT + COMPOSE_SHEET_FADE_MS,
      { allowAfterEngaged },
    );

    queue(
      () => {
        setResponseInFlight(true);
        appendItems([
          {
            kind: "text",
            id: nextId(),
            from: "user",
            text: GROUP_MESSAGES.userKickoff,
          },
        ]);
      },
      GROUP_KICKOFF_USER_AT,
      { allowAfterEngaged },
    );

    queue(
      () => setTyping(true),
      GROUP_KICKOFF_TYPING_AT,
      { allowAfterEngaged },
    );

    queue(
      () => {
        setTyping(false);
        appendItems([
          {
            kind: "text",
            id: nextId(),
            from: "murph",
            text: GROUP_MESSAGES.murphKickoff,
          },
        ]);
        setResponseInFlight(false);
      },
      GROUP_KICKOFF_REPLY_AT,
      { allowAfterEngaged },
    );

    queue(
      () => {
        appendItems([
          {
            kind: "timestamp",
            id: nextId(),
            text: GROUP_MESSAGES.timestamp,
          },
        ]);
      },
      GROUP_TIMESTAMP_AT,
      { allowAfterEngaged },
    );

    queue(
      () => {
        appendItems([
          {
            kind: "text",
            id: nextId(),
            from: "member",
            sender: GROUP_MEMBERS[0],
            text: GROUP_MESSAGES.theoQuestion,
          },
        ]);
      },
      GROUP_BEATS_START_AT,
      { allowAfterEngaged },
    );

    queue(
      () => {
        appendItems([
          {
            kind: "text",
            id: nextId(),
            from: "murph",
            text: GROUP_MESSAGES.murphStandings,
          },
          { kind: "challenge", id: nextId() },
        ]);
      },
      GROUP_BEATS_START_AT + GROUP_BEAT_GAP,
      { allowAfterEngaged },
    );

    queue(
      () => {
        appendItems([
          {
            kind: "text",
            id: nextId(),
            from: "member",
            sender: GROUP_MEMBERS[1],
            text: GROUP_MESSAGES.mayaReply,
          },
        ]);
      },
      GROUP_BEATS_START_AT + GROUP_BEAT_GAP * 2,
      { allowAfterEngaged },
    );

    queue(
      () => {
        appendItems([
          { kind: "audio", id: nextId(), src: CHALLENGE_ROAST_AUDIO_SRC },
        ]);
      },
      GROUP_BEATS_START_AT + GROUP_BEAT_GAP * 3,
      { allowAfterEngaged },
    );

    queue(
      () => {
        appendItems([
          {
            kind: "text",
            id: nextId(),
            from: "member",
            sender: GROUP_MEMBERS[2],
            text: GROUP_MESSAGES.samSongReply,
          },
        ]);
      },
      GROUP_BEATS_START_AT + GROUP_BEAT_GAP * 3 + 2400,
      { allowAfterEngaged },
    );

    queue(
      () => {
        appendItems([
          {
            kind: "text",
            id: nextId(),
            from: "member",
            sender: GROUP_MEMBERS[0],
            text: GROUP_MESSAGES.theoSongReply,
          },
        ]);
      },
      GROUP_BEATS_START_AT + GROUP_BEAT_GAP * 3 + 4300,
      { allowAfterEngaged },
    );

    queue(
      () => {
        appendItems([
          {
            kind: "timestamp",
            id: nextId(),
            text: GROUP_MESSAGES.sundayTimestamp,
          },
          {
            kind: "text",
            id: nextId(),
            from: "murph",
            text: GROUP_MESSAGES.murphNewsletter,
          },
          { kind: "newsletter", id: nextId() },
        ]);
      },
      GROUP_BEATS_START_AT + GROUP_BEAT_GAP * 4,
      { allowAfterEngaged },
    );
  };

  // Track whether the user is at the bottom of the thread; if they scroll up
  // we stop auto-scrolling so they can read history undisturbed.
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const onScroll = () => {
      const threshold = 16;
      isAtBottomRef.current =
        node.scrollHeight - node.scrollTop - node.clientHeight < threshold;
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll on new content only when the user hasn't scrolled up. The
  // first scroll jumps instantly so a seeded thread doesn't animate on load;
  // later appends scroll smoothly.
  const hasAutoScrolledRef = useRef(false);
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    if (isAtBottomRef.current) {
      node.scrollTo({
        top: Number.MAX_SAFE_INTEGER,
        behavior: hasAutoScrolledRef.current ? "smooth" : "auto",
      });
      hasAutoScrolledRef.current = true;
    }
  }, [items, typing]);

  useEffect(() => {
    prepareScheduledDemoForMount();

    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      queue(
        () => {
          setComposeSheet("hidden");
          setGroupMode(false);
          const exchange = AUTO_RUN_EXCHANGES[0];
          const idx =
            FLOATER_INDEX_BY_TEXT[exchange.topic.toLowerCase()] ?? null;
          markFloaterUsed(idx);
          setItems(buildCompletedExchangeItems(exchange));
        },
        0,
        { allowAfterEngaged: true },
      );
      return () => {
        cancelScheduledDemo();
        cancelDemoRef.current = null;
      };
    }

    const runCycle = () => {
      if (cancelledRef.current || engagedRef.current) return;

      const ex = AUTO_RUN_EXCHANGES[cycleRef.current];
      cycleRef.current += 1;

      if (!ex) {
        startGroupSequence({ allowAfterEngaged: false });
        return;
      }

      const idx = FLOATER_INDEX_BY_TEXT[ex.topic.toLowerCase()] ?? null;
      setResponseInFlight(true);
      activateFloater(idx);

      queue(() => {
        appendItems([
          {
            kind: "text",
            id: nextId(),
            from: "user",
            text: ex.user,
          },
        ]);
        markFloaterUsed(idx);
        deactivateFloater(idx);
      }, USER_BUBBLE_AT);

      queue(() => setTyping(true), TYPING_AT);

      queue(() => {
        setTyping(false);
        appendItems(buildExchangeReplyItems(ex));
        setResponseInFlight(false);
        if (cycleRef.current >= AUTO_RUN_EXCHANGES.length) {
          queue(
            () => startGroupSequence({ allowAfterEngaged: false }),
            GROUP_SEQUENCE_BREATHER,
          );
        }
      }, REPLY_AT);

      if (cycleRef.current < AUTO_RUN_EXCHANGES.length) {
        queue(runCycle, CYCLE_LENGTH);
      }
    };

    queue(runCycle, FIRST_RUN_DELAY);

    return () => {
      cancelScheduledDemo();
      cancelDemoRef.current = null;
    };
    // The hero demo is intentionally started once on mount. User actions cancel
    // and reschedule the tracked timers explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSend = async () => {
    const text = composerValue.trim();
    if (!text || responseInFlightRef.current) return;

    const replaceTransitionThread =
      groupMode && composeSheet !== "hidden";
    setEngaged();
    cancelDemoRef.current?.();
    setResponseInFlight(true);
    if (!groupMode) {
      groupSequenceStartedRef.current = false;
    }
    setComposeSheet("hidden");
    setComposerValue("");

    const userItem: SoloTextItem = {
      kind: "text",
      id: nextId(),
      from: "user",
      text,
    };
    if (replaceTransitionThread) {
      setItems([userItem]);
    } else {
      appendItems([userItem]);
    }

    await new Promise((r) => setTimeout(r, 450));
    setTyping(true);

    await new Promise((r) => setTimeout(r, 1100));
    setTyping(false);
    appendItems([
      {
        kind: "contact",
        id: nextId(),
        info: contactInfo,
        text: "Hey mate, shoot me a message and we can get started.",
      },
    ]);
    setResponseInFlight(false);
  };

  const focusConversation = () => {
    scrollerRef.current?.focus({ preventScroll: true });
  };

  const handleComposerEngagement = () => {
    // An explicit topic or person choice already owns the audience. Only
    // preempt the unattended demo so a draft started in the private composer
    // cannot be carried into its scheduled group transition.
    if (engagedRef.current) return;

    const restorePrivateThread = groupMode;
    setEngaged();
    cancelDemoRef.current?.();
    groupSequenceStartedRef.current = false;
    setComposeSheet("hidden");
    setGroupMode(false);
    setTyping(false);

    if (restorePrivateThread) {
      setItems(buildCompletedExchangeItems(AUTO_RUN_EXCHANGES[0]));
    }
  };

  const runExchangeOnce = (ex: Exchange) => {
    if (responseInFlightRef.current) return;

    setEngaged();
    cancelDemoRef.current?.();
    prepareScheduledDemo();
    setResponseInFlight(true);
    focusConversation();

    if (groupMode) {
      groupSequenceStartedRef.current = false;
      setGroupMode(false);
      setItems([]);
      setTyping(false);
    }

    const idx = FLOATER_INDEX_BY_TEXT[ex.topic.toLowerCase()] ?? null;
    activateFloater(idx);

    queue(
      () => {
        appendItems([
          {
            kind: "text",
            id: nextId(),
            from: "user",
            text: ex.user,
          },
        ]);
        markFloaterUsed(idx);
        deactivateFloater(idx);
      },
      USER_BUBBLE_AT,
      { allowAfterEngaged: true },
    );

    queue(
      () => setTyping(true),
      USER_BUBBLE_AT + 550,
      { allowAfterEngaged: true },
    );

    queue(
      () => {
        setTyping(false);
        appendItems(buildExchangeReplyItems(ex));
        setResponseInFlight(false);
      },
      USER_BUBBLE_AT + 1650,
      { allowAfterEngaged: true },
    );
  };

  const handleFloaterClick = (f: Floater) => {
    if (composeSheet !== "hidden" || responseInFlightRef.current) return;
    if (f.member) {
      if (groupSequenceStartedRef.current) return;
      setEngaged();
      cancelDemoRef.current?.();
      prepareScheduledDemo();
      // Commit the fresh thread and its audience together, then move focus onto
      // the stable conversation surface before presentation begins.
      setItems([]);
      setTyping(false);
      setGroupMode(true);
      focusConversation();
      startGroupSequence({ allowAfterEngaged: true });
      return;
    }

    const ex = EXCHANGES.find(
      (e) => e.topic.toLowerCase() === f.text.toLowerCase(),
    );
    if (!ex) return;
    runExchangeOnce(ex);
  };

  const channelIcon =
    messengerChannel === "telegram" ? (
      <TelegramLogo className="size-[18px]" />
    ) : (
      <IMessageLogo className="size-[18px]" />
    );
  const composeSheetMembers = GROUP_MEMBERS.filter((member) =>
    usedFloaters.has(member.name),
  );
  const composerBusy = responseInFlight && engaged;
  const conversationIsLive = engaged;

  return (
    <section className="relative min-h-svh overflow-hidden bg-[#f5f0e8]">
      <style>{`
        @keyframes hero-float {
          0%, 100% { transform: translate(0, 0); }
          25% { transform: translate(6px, -4px); }
          50% { transform: translate(-3px, 5px); }
          75% { transform: translate(4px, 2px); }
        }
        @keyframes hero-coalesce {
          0% { opacity: 1; transform: translate(0, 0) scale(1); }
          22% { opacity: 1; transform: translate(0, 0) scale(1.08); }
          70% { opacity: 0.45; }
          100% {
            opacity: 0;
            transform: translate(var(--fly-x), var(--fly-y)) scale(0.55);
          }
        }
        @keyframes hero-coalesce-color {
          0% { color: rgba(196, 168, 130, 0.6); }
          18% { color: #5a6e32; }
          100% { color: #5a6e32; }
        }
        @keyframes hero-msg-in {
          from { opacity: 0; transform: translateY(8px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes hero-typing-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
          30% { transform: translateY(-3px); opacity: 0.85; }
        }
        .hero-floater {
          animation: hero-float var(--dur, 12s) ease-in-out infinite;
          animation-delay: var(--delay, 0s);
        }
        .hero-floater:hover,
        .hero-floater:focus-within {
          animation-play-state: paused;
        }
        .hero-floater--active {
          animation: hero-coalesce 1.4s cubic-bezier(0.55, 0, 0.85, 0.2) forwards;
        }
        .hero-floater--active .hero-floater-btn {
          animation: hero-coalesce-color 1.4s ease-out forwards;
          pointer-events: none;
        }
        .hero-msg-in {
          animation: hero-msg-in 0.36s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .hero-typing-dot {
          animation: hero-typing-bounce 1.2s ease-in-out infinite;
        }
        @keyframes hero-caret-blink {
          0%, 45% { opacity: 1; }
          50%, 95% { opacity: 0; }
          100% { opacity: 1; }
        }
        .hero-compose-caret {
          animation: hero-caret-blink 1.1s step-end infinite;
        }
        .hero-scroller::-webkit-scrollbar { display: none; }
        @media (prefers-reduced-motion: reduce) {
          .hero-floater, .hero-floater--active, .hero-msg-in, .hero-typing-dot, .hero-compose-caret {
            animation: none !important;
          }
          .hero-compose-sheet, .hero-copy-layer, .hero-header-layer {
            transition: none !important;
          }
        }
      `}</style>

      <div className="pointer-events-none relative mx-auto grid min-h-svh max-w-[1280px] grid-cols-1 items-center gap-6 px-5 pt-20 pb-10 sm:gap-10 sm:px-10 sm:pb-16 lg:grid-cols-12 lg:gap-20 lg:px-16 lg:pt-24">
        <div className="pointer-events-auto relative z-10 lg:col-span-7">
          <h1 className="sr-only">{MURPH_TAGLINE}</h1>
          <div
            aria-hidden="true"
            className="font-serif text-[clamp(2.5rem,5vw,4rem)] font-semibold leading-[1.03] tracking-[-0.03em] text-black [text-wrap:balance]"
          >
            <span className="block">{HERO_HEADLINE.line1}</span>
            <span className="mt-2 block text-[#5a6e32]">
              {HERO_HEADLINE.line2}
            </span>
          </div>
          <div className="grid">
            <HeroCopyLayer
              active={!groupMode}
              ariaHidden={groupMode}
              inactiveClassName="-translate-y-7"
              copy={HERO_COPY.act1}
            />
            <HeroCopyLayer
              active={groupMode}
              ariaHidden={!groupMode}
              inactiveClassName="translate-y-7"
              copy={HERO_COPY.act2}
            />
          </div>

          <div className="mt-10 hidden lg:block">
            <LandingAuthActions
              authLabel="Meet Murph"
              authenticated={authenticated}
              context="hero"
              leadingIcon={channelIcon}
              preloadAuthPanel
            />
          </div>
        </div>

        <div className="pointer-events-auto relative z-10 lg:col-span-5">
          <div className="relative mx-auto w-full max-w-[280px] sm:max-w-[320px] lg:aspect-[3/4] lg:max-w-[520px]">
            <div className="lg:absolute lg:left-1/2 lg:top-1/2 lg:w-[340px] lg:-translate-x-1/2 lg:-translate-y-1/2">
              <PhoneShell>
                <StatusBar />
                <div className="relative overflow-hidden">
                  <div className="absolute inset-x-0 top-0 z-20">
                    <ChatHeader
                      groupMode={groupMode}
                      murphHeadshotSrc={murphHeadshotSrc}
                    />
                  </div>
                  <div className="relative h-[460px] lg:h-[580px]">
                    <p role="status" className="sr-only">
                      {engaged
                        ? groupMode
                          ? "Group conversation selected."
                          : "Private conversation selected."
                        : ""}
                    </p>
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-gradient-to-b from-[#f5f0e8] via-[#f5f0e8]/85 to-transparent"
                    />
                    <div
                      ref={scrollerRef}
                      role={conversationIsLive ? "log" : undefined}
                      aria-label={
                        groupMode
                          ? "Group conversation with Murph"
                          : "Private conversation with Murph"
                      }
                      aria-live={conversationIsLive ? "polite" : "off"}
                      aria-relevant="additions text"
                      aria-busy={conversationIsLive && responseInFlight}
                      tabIndex={-1}
                      className="hero-scroller h-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#5a6e32] lg:overflow-y-auto lg:overscroll-contain"
                      style={{
                        scrollbarWidth: "none",
                        msOverflowStyle: "none",
                      }}
                    >
                      <div className="flex min-h-full flex-col justify-end gap-2 px-3.5 pb-4 pt-[72px]">
                        {items.map((it, i) => {
                          if (it.kind === "card") {
                            return (
                              <div key={it.id} className="hero-msg-in shrink-0">
                                <ExperimentCard result={it.result} />
                              </div>
                            );
                          }
                          if (it.kind === "bloodwork") {
                            return (
                              <div key={it.id} className="hero-msg-in shrink-0">
                                <BloodworkCard result={it.result} />
                              </div>
                            );
                          }
                          if (it.kind === "order") {
                            return (
                              <div key={it.id} className="hero-msg-in shrink-0">
                                <OrderCard result={it.result} />
                              </div>
                            );
                          }
                          if (it.kind === "challenge") {
                            return (
                              <div
                                key={it.id}
                                className="hero-msg-in mr-auto w-full max-w-[94%] shrink-0"
                              >
                                <ChallengeCard />
                              </div>
                            );
                          }
                          if (it.kind === "newsletter") {
                            return (
                              <div
                                key={it.id}
                                className="hero-msg-in mr-auto w-full max-w-[94%] shrink-0"
                              >
                                <NewsletterCard />
                              </div>
                            );
                          }
                          if (it.kind === "contact") {
                            return (
                              <div
                                key={it.id}
                                className="hero-msg-in mr-auto w-full max-w-[86%] shrink-0"
                              >
                                <ContactCard
                                  info={it.info}
                                  text={it.text}
                                  authenticated={authenticated}
                                />
                              </div>
                            );
                          }
                          if (it.kind === "timestamp") {
                            return (
                              <TimestampSeparator key={it.id} text={it.text} />
                            );
                          }
                          if (it.kind === "audio") {
                            const prevItem = items[i - 1];
                            const showMurphLabel =
                              !prevItem ||
                              senderKeyOf(prevItem) !== "murph";
                            return (
                              <div
                                key={it.id}
                                className="hero-msg-in mr-auto w-full max-w-[86%] shrink-0"
                              >
                                <div className="flex items-end gap-1.5">
                                  <div
                                    aria-hidden="true"
                                    className="mb-0.5 size-[18px] shrink-0 rounded-full bg-cover bg-center ring-1 ring-[#c4a882]/25"
                                    style={{
                                      backgroundImage: `url('${murphHeadshotSrc}')`,
                                    }}
                                  />
                                  <div className="min-w-0 flex-1">
                                    {showMurphLabel ? (
                                      <p className="mb-0.5 pl-1 font-mono text-[9px] tracking-[0.08em] text-[#736a58]">
                                        Murph
                                      </p>
                                    ) : null}
                                    <div className="rounded-[17px] bg-white px-2.5 py-2">
                                      <VoiceMemoPlayer
                                        containerClassName=""
                                        src={it.src}
                                      />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          const next = items[i + 1];
                          const prev = items[i - 1];
                          const isTail =
                            !next ||
                            senderKeyOf(next) !== senderKeyOf(it);
                          // In the group chat every non-you sender is
                          // attributed like iMessage does it, Murph included.
                          const sender =
                            it.from === "member"
                              ? it.sender
                              : it.from === "murph" && groupMode
                                ? murphSender
                                : undefined;
                          const showSenderLabel =
                            Boolean(sender) &&
                            (!prev || senderKeyOf(prev) !== senderKeyOf(it));
                          return (
                            <MessageBubble
                              key={it.id}
                              from={it.from}
                              sender={sender}
                              showSenderLabel={showSenderLabel}
                              text={it.text}
                              isTail={isTail}
                            />
                          );
                        })}
                        {typing ? <TypingBubble /> : null}
                      </div>
                    </div>
                  </div>
                  {composeSheet !== "hidden" ? (
                    <ComposeSheet
                      members={composeSheetMembers}
                      murphHeadshotSrc={murphHeadshotSrc}
                      state={composeSheet}
                    />
                  ) : null}
                </div>
                <Composer
                  busy={composerBusy}
                  value={composerValue}
                  onEngage={handleComposerEngagement}
                  onChange={setComposerValue}
                  onSubmit={handleSend}
                />
                <HomeIndicator />
              </PhoneShell>
            </div>
          </div>
        </div>

        <div className="pointer-events-auto relative z-10 mx-auto mt-2 w-full max-w-[320px] lg:hidden [&_a]:w-full [&_button]:w-full">
          <LandingAuthActions
            authLabel="Meet Murph"
            authenticated={authenticated}
            context="hero"
            leadingIcon={channelIcon}
          />
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 z-0 hidden lg:block">
        {FLOATERS.map((f, i) => {
          if (usedFloaters.has(f.text)) return null;
          const isActive = activeFloaterIdxs.has(i);
          const isPerson = Boolean(f.member);
          // Every floater is inert while Murph is answering or the compose
          // sheet covers the thread, preserving one complete conversation at
          // a time.
          const isDisabled =
            isActive ||
            responseInFlight ||
            composeSheet !== "hidden" ||
            (isPerson && groupMode);
          const floaterStyle: FloaterStyle = {
            top: f.top,
            bottom: f.bottom,
            left: f.left,
            right: f.right,
            "--dur": `${f.duration}s`,
            "--delay": `${f.delay}s`,
            "--fly-x": f.flyX,
            "--fly-y": f.flyY,
          };
          return (
            <div
              key={f.text}
              className={cn(
                "hero-floater absolute",
                isActive && "hero-floater--active",
              )}
              style={floaterStyle}
            >
              <button
                type="button"
                onClick={() => handleFloaterClick(f)}
                disabled={isDisabled}
                aria-label={
                  f.member
                    ? `Start a group chat with ${f.text}`
                    : `Ask Murph about ${f.text}`
                }
                // No disabled dimming: the demo disables every floater at once,
                // so a state-dependent opacity pulsed the whole hero. Each kind
                // holds one resting tone instead; hover still shifts it green.
                className={cn(
                  "hero-floater-btn pointer-events-auto cursor-pointer select-none whitespace-nowrap bg-transparent font-mono text-[10px] tracking-[0.18em] transition-colors duration-200 ease-out hover:text-[#5a6e32] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5a6e32] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5f0e8] disabled:cursor-default",
                  f.member
                    ? "inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[#c4a882]/40 bg-[#f5f0e8]/90 py-1 pl-1 pr-2.5 text-[#736a58] backdrop-blur-sm"
                    : "inline-flex min-h-8 items-center rounded-md px-2 py-1 uppercase text-[#756c5a]",
                )}
              >
                {f.member ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="size-[22px] rounded-full bg-cover bg-center ring-1 ring-[#c4a882]/25"
                      style={{
                        backgroundImage: `url('${f.member.avatarSrc}')`,
                      }}
                    />
                    <span>{f.text}</span>
                  </>
                ) : (
                  f.text
                )}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Paragraph layers are stacked in one grid cell so height is the max of both
// variants. The shared headline and the document's single h1 stay stable
// outside the roll.
function HeroCopyLayer({
  active,
  ariaHidden,
  copy,
  inactiveClassName,
}: {
  active: boolean;
  ariaHidden: boolean;
  copy: {
    paragraph: string;
  };
  inactiveClassName: string;
}) {
  return (
    <div
      aria-hidden={ariaHidden}
      className={cn(
        "hero-copy-layer col-start-1 row-start-1 transition-[opacity,transform] duration-[700ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
        active
          ? "translate-y-0 opacity-100"
          : cn("pointer-events-none opacity-0", inactiveClassName),
      )}
    >
      <p className="mt-6 max-w-[52ch] text-[1.0625rem] leading-[1.7] text-pretty text-[#3a322a] lg:mt-10">
        {copy.paragraph}
      </p>
    </div>
  );
}

function ComposeSheet({
  members,
  murphHeadshotSrc,
  state,
}: {
  members: ReadonlyArray<GroupMember>;
  murphHeadshotSrc: MurphHeadshotSrc;
  state: ComposeSheetState;
}) {
  return (
    <div
      // Purely decorative stage prop: it can never be operated (the phone
      // mock's demo drives it), so keep the whole sheet out of the a11y tree.
      aria-hidden="true"
      className={cn(
        "hero-compose-sheet pointer-events-none absolute inset-x-0 bottom-0 top-0 z-30 rounded-t-[18px] bg-[#faf6ee] shadow-[0_-12px_32px_-18px_rgba(45,52,54,0.45)] ring-1 ring-inset ring-[#c4a882]/15 transition-[opacity,transform]",
        state === "up" &&
          "translate-y-0 opacity-100 duration-[520ms] ease-[cubic-bezier(0.32,0.72,0,1)]",
        state === "pending" &&
          "translate-y-full opacity-100 duration-[520ms] ease-[cubic-bezier(0.32,0.72,0,1)]",
        state === "leaving" &&
          "translate-y-3 opacity-0 duration-[350ms] ease-in",
      )}
    >
      <div className="relative flex h-[52px] items-center justify-center px-4">
        <p className="text-[15px] font-semibold tracking-tight text-[#2d3436]">
          New Message
        </p>
        <span className="absolute right-3 top-1/2 flex size-[30px] -translate-y-1/2 items-center justify-center rounded-full bg-[#2d3436]/[0.08]">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M1.5 1.5L10.5 10.5M10.5 1.5L1.5 10.5"
              stroke="#2d3436"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </div>

      <div className="px-3.5">
        <div className="relative flex min-h-[44px] w-full flex-wrap items-center gap-1.5 rounded-[18px] bg-white/75 py-2 pl-4 pr-10 ring-1 ring-inset ring-[#c4a882]/20">
          <span className="shrink-0 text-[13px] leading-none text-[#736a58]/80">
            To:
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <RecipientChip
              avatarSrc={murphHeadshotSrc}
              label="Murph"
            />
            {members.map((member) => (
              <RecipientChip
                key={member.id}
                avatarSrc={member.avatarSrc}
                label={member.name}
              />
            ))}
            <span
              aria-hidden="true"
              className="hero-compose-caret h-[16px] w-[1.5px] shrink-0 rounded-full bg-[#5a6e32]"
            />
          </div>
          <span className="absolute right-2.5 top-1/2 flex size-[26px] -translate-y-1/2 items-center justify-center rounded-full bg-[#2d3436]/[0.08]">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M6 1.2V10.8M1.2 6H10.8"
                stroke="#2d3436"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </div>
      </div>
    </div>
  );
}

function RecipientChip({
  avatarSrc,
  label,
}: {
  avatarSrc: string;
  label: string;
}) {
  return (
    <span
      data-hero-recipient-chip={label}
      className="hero-msg-in inline-flex h-[28px] shrink-0 items-center gap-1.5 rounded-full border border-[#c4a882]/25 bg-white py-0.5 pl-1 pr-2.5 text-[12.5px] font-medium tracking-tight text-[#2d3436]"
    >
      <span
        aria-hidden="true"
        className="size-[20px] rounded-full bg-cover bg-center ring-1 ring-[#c4a882]/25"
        style={{ backgroundImage: `url('${avatarSrc}')` }}
      />
      {label}
    </span>
  );
}

function OrderCard({ result }: { result: OrderResult }) {
  return (
    <div className="overflow-hidden rounded-[18px] border border-[#c4a882]/25 bg-white/75 px-3 pb-3 pt-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[8px] font-medium uppercase tracking-[0.16em] text-[#5a6e32]">
          {result.eyebrow}
        </span>
        <span className="rounded-full bg-[#5a6e32]/15 px-2 py-[2px] font-mono text-[8px] font-medium uppercase tracking-[0.14em] text-[#3d5028]">
          {result.status}
        </span>
      </div>
      <p className="mt-2 font-serif text-[13px] font-semibold leading-tight text-[#2d3436]">
        {result.title}
      </p>
      {result.detail ? (
        <p className="mt-0.5 text-[10px] leading-[1.4] text-[#736a58]">
          {result.detail}
        </p>
      ) : null}
      <div className="mt-2.5 flex items-baseline justify-between gap-2 border-t border-[#c4a882]/20 pt-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#736a58]">
          {result.arriving}
        </span>
        <span className="font-serif text-[12px] font-semibold tabular-nums text-[#2d3436]">
          {result.price}
        </span>
      </div>
    </div>
  );
}

const CONTACT_PREFILL_BODY = "Hey Murph, I'd love to learn more.";

function ContactCard({
  info,
  text,
  authenticated,
}: {
  info: HeroContactInfo;
  text: string;
  authenticated: boolean;
}) {
  const ctaClassName =
    "group flex w-full items-center justify-center gap-1 rounded-[10px] bg-[#5a6e32] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[#7a8c6e]";
  const telegramHref = buildMurphTelegramTextHref({
    body: CONTACT_PREFILL_BODY,
    username: info.telegram,
  });
  const smsHref = buildMurphSmsHref({
    body: CONTACT_PREFILL_BODY,
    murphPhoneNumber: info.phone,
  });
  return (
    <div className="overflow-hidden rounded-[16px] border border-[#c4a882]/25 bg-white px-3 pb-2.5 pt-2.5">
      <p className="text-[13px] leading-[1.45] text-[#2d3436]">{text}</p>
      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
        <a
          href={telegramHref}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-1.5 rounded-[8px] border border-[#c4a882]/35 px-2 py-1.5 text-[10.5px] font-medium tracking-tight text-[#2d3436] transition-colors hover:border-[#5a6e32]/40 hover:bg-[#5a6e32]/5"
        >
          <TelegramLogo className="size-[14px]" />
          Telegram
        </a>
        <a
          href={smsHref}
          className="flex items-center justify-center gap-1.5 rounded-[8px] border border-[#c4a882]/35 px-2 py-1.5 text-[10.5px] font-medium tracking-tight text-[#2d3436] transition-colors hover:border-[#5a6e32]/40 hover:bg-[#5a6e32]/5"
        >
          <IMessageLogo className="size-[14px]" />
          iMessage
        </a>
      </div>
      <div
        aria-hidden="true"
        className="mt-3 flex items-center gap-2"
      >
        <div className="h-px flex-1 bg-[#c4a882]/40" />
        <span className="font-mono text-[9px] font-medium uppercase tracking-[0.18em] text-[#736a58]">
          or
        </span>
        <div className="h-px flex-1 bg-[#c4a882]/40" />
      </div>
      <div className="mt-2.5">
        {authenticated ? (
          <Link href="/home" prefetch={false} className={ctaClassName}>
            Open Murph
            <span
              aria-hidden="true"
              className="inline-block transition-transform group-hover:translate-x-0.5"
            >
              →
            </span>
          </Link>
        ) : (
          <LandingAuthDialogButton
            buttonClassName={ctaClassName}
            buttonLabel="Get started"
            requireLaunchConsentOnCompletion
            showArrow
          />
        )}
      </div>
    </div>
  );
}

function TelegramLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="12" fill="#2AABEE" />
      <path
        d="M17.66 7.4 5.45 12.13c-.83.32-.82.78-.15.98l3.13.98 7.25-4.57c.34-.21.65-.1.4.13l-5.87 5.3-.23 3.4c.33 0 .47-.15.66-.33l1.58-1.53 3.28 2.42c.6.33 1.04.16 1.19-.56l2.15-10.13c.22-.88-.32-1.28-.99-1.02z"
        fill="#fff"
      />
    </svg>
  );
}

function IMessageLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      aria-hidden="true"
    >
      <rect width="24" height="24" rx="5.5" fill="#34C759" />
      <path
        d="M12 6.5c-3.7 0-6.7 2.42-6.7 5.4 0 1.62.92 3.06 2.36 4.06l-.78 1.96 2.48-1.15c.81.3 1.71.46 2.64.46 3.7 0 6.7-2.42 6.7-5.4S15.7 6.5 12 6.5z"
        fill="#fff"
      />
    </svg>
  );
}

function BloodworkCard({ result }: { result: BloodworkResult }) {
  return (
    <div className="overflow-hidden rounded-[18px] border border-[#c4a882]/25 bg-white/75 px-3 pb-3 pt-2.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[8px] font-medium uppercase tracking-[0.16em] text-[#a04f30]">
          {result.eyebrow}
        </span>
        {result.sideLabel ? (
          <span className="font-mono text-[8px] tracking-[0.08em] text-[#736a58]">
            {result.sideLabel}
          </span>
        ) : null}
      </div>
      <ul className="mt-2 divide-y divide-[#2d3436]/[0.06]">
        {result.markers.map((m) => (
          <li
            key={m.label}
            className="flex items-center gap-2 py-1.5 first:pt-0.5 last:pb-0.5"
          >
            <span className="min-w-[68px] font-serif text-[11px] font-semibold leading-tight text-[#2d3436]">
              {m.label}
            </span>
            <span className="flex items-baseline gap-1 font-mono text-[9px] tabular-nums text-[#736a58]">
              <span>{m.from}</span>
              <span aria-hidden="true">→</span>
              <span className="text-[#2d3436]">{m.to}</span>
              <span className="text-[8px]">{m.unit}</span>
            </span>
            <span
              className={cn(
                "ml-auto rounded-full px-1.5 py-[1px] font-mono text-[8.5px] font-medium tabular-nums",
                m.tone === "good"
                  ? "bg-[#5a6e32]/15 text-[#3d5028]"
                  : "bg-[#a04f30]/15 text-[#a04f30]",
              )}
            >
              {m.delta} {m.unit}
            </span>
          </li>
        ))}
      </ul>
      {result.note ? (
        <p className="mt-2 rounded-[10px] bg-[#f5f0e8]/85 px-2.5 py-1.5 text-[10px] leading-[1.4] text-[#635a48]">
          {result.note}
        </p>
      ) : null}
    </div>
  );
}

function PhoneShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative rounded-[2.75rem] bg-[#0a0a0a] p-[4px] shadow-[0_16px_36px_-18px_rgba(0,0,0,0.4)] lg:shadow-[0_30px_80px_-20px_rgba(0,0,0,0.55)]">
      <div className="overflow-hidden rounded-[2.5rem] bg-[#f5f0e8]">
        {children}
      </div>
    </div>
  );
}

function StatusBar() {
  return (
    <div className="relative flex items-center justify-between bg-[#f5f0e8] px-6 pb-1.5 pt-3.5">
      <span className="text-[0.8125rem] font-semibold tracking-tight text-[#2d3436]">
        9:41
      </span>
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-[7px] h-[24px] w-[92px] -translate-x-1/2 rounded-full bg-[#0a0a0a]"
      />
      <div className="flex items-center gap-1.5">
        <svg width="14" height="10" viewBox="0 0 14 11" fill="#2d3436" aria-hidden="true">
          <rect x="0" y="6" width="3.6" height="5" rx="0.8" />
          <rect x="5.2" y="3" width="3.6" height="8" rx="0.8" />
          <rect x="10.4" y="0" width="3.6" height="11" rx="0.8" />
        </svg>
        <svg
          width="14"
          height="11"
          viewBox="1 3 22 17"
          fill="#2d3436"
          aria-hidden="true"
          className="relative -top-[1px]"
        >
          <path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z" />
        </svg>
        <svg width="22" height="11" viewBox="0 0 22 11" fill="none" aria-hidden="true">
          <rect x="0.5" y="0.5" width="18" height="10" rx="2.6" stroke="#2d3436" strokeWidth="0.9" />
          <rect x="19.2" y="3.6" width="1.6" height="3.8" rx="0.6" fill="#2d3436" />
          <rect x="1.9" y="1.9" width="14.2" height="7.2" rx="1.4" fill="#2d3436" />
        </svg>
      </div>
    </div>
  );
}

function ChatHeader({
  groupMode,
  murphHeadshotSrc,
}: {
  groupMode: boolean;
  murphHeadshotSrc: MurphHeadshotSrc;
}) {
  return (
    <div className="relative z-20 flex items-start justify-between px-2.5 pb-2 pt-1.5">
      <div className="flex h-[30px] items-center gap-1.5 rounded-full bg-[#2d3436]/10 px-2.5 pr-1.5 backdrop-blur-md ring-1 ring-inset ring-white/50">
        <svg width="7" height="13" viewBox="0 0 6 11" fill="none" aria-hidden="true">
          <path
            d="M5 1L1 5.5L5 10"
            stroke="#2d3436"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-[#f5f0e8]/95 px-1 text-[9.5px] font-semibold tabular-nums text-[#2d3436]">
          13
        </span>
      </div>

      <div className="grid flex-1 place-items-center">
        <div
          aria-hidden={groupMode}
          className={cn(
            "hero-header-layer col-start-1 row-start-1 flex flex-col items-center transition-opacity duration-500 ease-out",
            groupMode ? "pointer-events-none opacity-0" : "opacity-100",
          )}
        >
          <MurphHeadshotAvatar src={murphHeadshotSrc} />
          <HeaderNamePill label="Murph" />
        </div>
        <div
          aria-hidden={!groupMode}
          className={cn(
            "hero-header-layer col-start-1 row-start-1 flex flex-col items-center transition-opacity duration-500 ease-out",
            groupMode ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <GroupHeaderAvatars murphHeadshotSrc={murphHeadshotSrc} />
          <HeaderNamePill label={GROUP_HEADER_LABEL} />
        </div>
      </div>

      <div className="flex size-[34px] items-center justify-center rounded-full bg-[#2d3436]/10 backdrop-blur-md ring-1 ring-inset ring-white/50">
        <svg width="19" height="15" viewBox="0 0 17 13" fill="none" aria-hidden="true">
          <rect
            x="0.85"
            y="0.85"
            width="10.5"
            height="11.3"
            rx="2.6"
            stroke="#2d3436"
            strokeWidth="1.7"
            fill="none"
          />
          <path
            d="M11.6 5 L16.2 2.4 V10.6 L11.6 8 Z"
            stroke="#2d3436"
            strokeWidth="1.7"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </div>
    </div>
  );
}

function HeaderNamePill({ label }: { label: string }) {
  return (
    <div className="-mt-[5px] flex items-center gap-[3px] rounded-full bg-[#2d3436]/10 px-2.5 py-[3px] backdrop-blur-md ring-1 ring-inset ring-white/50">
      <p className="text-[0.6875rem] font-semibold tracking-tight text-[#2d3436]">
        {label}
      </p>
      <svg width="5" height="8" viewBox="0 0 5 8" fill="none" aria-hidden="true">
        <path
          d="M1 1L4 4L1 7"
          stroke="#736a58"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

// Matches Apple's unnamed-group iMessage header: a bunched avatar cluster
// (two small in back on top, two larger in front on the bottom) above an
// "N People" pill, rather than a flat overlapping row.
function GroupHeaderAvatars({
  murphHeadshotSrc,
}: {
  murphHeadshotSrc: MurphHeadshotSrc;
}) {
  const cluster = [
    { src: GROUP_MEMBERS[0].avatarSrc, size: 20, left: 8, top: 0, z: 0 },
    { src: GROUP_MEMBERS[1].avatarSrc, size: 20, left: 29, top: 2, z: 0 },
    { src: GROUP_MEMBERS[2].avatarSrc, size: 22, left: 31, top: 17, z: 10 },
    { src: murphHeadshotSrc, size: 27, left: 8, top: 15, z: 20 },
  ];
  return (
    <div aria-hidden="true" className="relative h-[42px] w-[57px]">
      {cluster.map((avatar) => (
        <div
          key={avatar.src}
          className="absolute rounded-full bg-cover bg-center ring-2 ring-[#f5f0e8]"
          style={{
            backgroundImage: `url('${avatar.src}')`,
            height: `${avatar.size}px`,
            left: `${avatar.left}px`,
            top: `${avatar.top}px`,
            width: `${avatar.size}px`,
            zIndex: avatar.z,
          }}
        />
      ))}
    </div>
  );
}

type MessageSender = {
  id: string;
  name: string;
  avatarSrc: string;
};

function MessageBubble({
  from,
  isTail,
  sender,
  showSenderLabel,
  text,
}: {
  from: TextItem["from"];
  isTail: boolean;
  sender?: MessageSender;
  showSenderLabel?: boolean;
  text: string;
}) {
  const isUser = from === "user";
  const isMember = from === "member" && Boolean(sender);
  const tailFill = isUser ? "#5a6e32" : isMember ? "#ece7dc" : "#ffffff";
  const bubbleClassName = cn(
    "rounded-[17px] px-3.5 py-2",
    isUser
      ? "bg-[#5a6e32] text-white"
      : isMember
        ? "bg-[#ece7dc] text-[#2d3436]"
        : "bg-white text-[#2d3436]",
  );
  const tailClassName = cn(
    "pointer-events-none absolute -bottom-[2px]",
    isUser ? "-right-[3px]" : "-left-[3px] -scale-x-100",
  );

  return (
    <div
      className={cn(
        "hero-msg-in relative",
        isUser ? "ml-auto max-w-[80%]" : "mr-auto max-w-[86%]",
      )}
    >
      {sender ? (
        <div className="flex items-end gap-1.5">
          <div
            aria-hidden="true"
            className="mb-0.5 size-[18px] shrink-0 rounded-full bg-cover bg-center ring-1 ring-[#c4a882]/25"
            style={{ backgroundImage: `url('${sender.avatarSrc}')` }}
          />
          <div className="min-w-0">
            {showSenderLabel ? (
              <p className="mb-0.5 pl-1 font-mono text-[9px] tracking-[0.08em] text-[#736a58]">
                {sender.name}
              </p>
            ) : null}
            <div className="relative">
              <div className={bubbleClassName}>
                <p className="text-[0.875rem] leading-[1.5] tracking-tight">
                  {text}
                </p>
              </div>
              {isTail ? (
                <MessageTail className={tailClassName} fill={tailFill} />
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="relative">
          <div className={bubbleClassName}>
            <p className="text-[0.875rem] leading-[1.5] tracking-tight">
              {text}
            </p>
          </div>
          {isTail ? (
            <MessageTail className={tailClassName} fill={tailFill} />
          ) : null}
        </div>
      )}
    </div>
  );
}

function MessageTail({
  className,
  fill,
}: {
  className: string;
  fill: string;
}) {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="9"
      viewBox="0 0 14 9"
      fill={fill}
      className={className}
    >
      <path d="M0 0 C 0 4 4 8 14 8 C 12.5 7.5 8.5 5 6 0 Z" />
    </svg>
  );
}

function TimestampSeparator({ text }: { text: string }) {
  return (
    <div className="hero-msg-in flex justify-center py-1.5">
      <p className="text-center text-[9.5px] font-medium leading-none tracking-tight text-[#736a58]">
        {text}
      </p>
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="hero-msg-in relative mr-auto max-w-[40%]">
      <span className="sr-only">Murph is replying</span>
      <div className="flex items-center gap-1 rounded-[15px] bg-white px-3 py-2.5">
        <span
          className="hero-typing-dot size-1.5 rounded-full bg-[#736a58]"
          style={{ animationDelay: "0s" }}
        />
        <span
          className="hero-typing-dot size-1.5 rounded-full bg-[#736a58]"
          style={{ animationDelay: "0.18s" }}
        />
        <span
          className="hero-typing-dot size-1.5 rounded-full bg-[#736a58]"
          style={{ animationDelay: "0.36s" }}
        />
      </div>
      <svg
        aria-hidden="true"
        width="14"
        height="9"
        viewBox="0 0 14 9"
        fill="#ffffff"
        className="pointer-events-none absolute -bottom-[2px] -left-[3px] -scale-x-100"
      >
        <path d="M0 0 C 0 4 4 8 14 8 C 12.5 7.5 8.5 5 6 0 Z" />
      </svg>
    </div>
  );
}

function Composer({
  busy,
  value,
  onEngage,
  onChange,
  onSubmit,
}: {
  busy: boolean;
  value: string;
  onEngage: () => void;
  onChange: (next: string) => void;
  onSubmit: () => void;
}) {
  const hasText = value.trim().length > 0;
  return (
    <div className="bg-[#f5f0e8] px-3 pb-2 pt-1.5">
      {busy ? (
        <p
          id="hero-composer-status"
          role="status"
          className="mb-1 text-center font-mono text-[9px] tracking-[0.08em] text-[#635a48]"
        >
          Murph is replying…
        </p>
      ) : null}
      <form
        aria-busy={busy}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="flex items-center gap-2"
      >
        <button
          type="button"
          aria-label="Attach"
          tabIndex={-1}
          className="flex size-[30px] shrink-0 items-center justify-center rounded-full border border-[#c4a882]/25 bg-white text-[#5a6e32]"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path
              d="M7 1.8V12.2M1.8 7H12.2"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <div className="relative flex flex-1 items-center rounded-full border border-[#c4a882]/25 bg-white py-[6px] pl-4 pr-3">
          <input
            type="text"
            value={value}
            onFocus={onEngage}
            onChange={(e) => {
              onEngage();
              onChange(e.target.value);
            }}
            placeholder={busy ? "Murph is replying…" : "iMessage"}
            aria-label="Message Murph"
            aria-describedby={busy ? "hero-composer-status" : undefined}
            autoComplete="off"
            disabled={busy}
            className={cn(
              "min-w-0 flex-1 bg-transparent text-[0.8125rem] tracking-tight text-[#2d3436] caret-[#5a6e32] outline-none placeholder:text-[#736a58] disabled:cursor-wait",
              hasText ? "pr-7" : "pr-4",
            )}
          />
          {hasText ? (
            <button
              type="submit"
              aria-label="Send"
              disabled={busy}
              className="absolute right-[3px] top-1/2 flex size-[26px] shrink-0 -translate-y-1/2 items-center justify-center rounded-full bg-[#5a6e32] text-white transition-colors hover:bg-[#7a8c6e] disabled:cursor-wait disabled:opacity-45"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M7 12V3 M3 7 L7 3 L11 7"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : (
            <svg
              width="13"
              height="13"
              viewBox="0 0 14 14"
              fill="#736a58"
              fillOpacity="0.4"
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
            >
              <rect x="0.5" y="5" width="1.6" height="4" rx="0.8" />
              <rect x="3.2" y="3" width="1.6" height="8" rx="0.8" />
              <rect x="5.9" y="1" width="1.6" height="12" rx="0.8" />
              <rect x="8.6" y="3" width="1.6" height="8" rx="0.8" />
              <rect x="11.3" y="5" width="1.6" height="4" rx="0.8" />
            </svg>
          )}
        </div>
      </form>
    </div>
  );
}

function HomeIndicator() {
  return (
    <div className="flex justify-center bg-[#f5f0e8] pb-2 pt-1.5">
      <div className="h-[4px] w-[110px] rounded-full bg-[#2d3436]/85" />
    </div>
  );
}
