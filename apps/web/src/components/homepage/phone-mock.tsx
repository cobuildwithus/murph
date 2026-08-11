import {
  MurphHeadshotAvatar,
  type MurphHeadshotSrc,
} from "./murph-headshot-avatar";
import { PhoneChatScroller } from "./phone-chat-scroller";

export type PhoneMessage = {
  from: "murph" | "user";
  text: string;
};

export type ExperimentStat = {
  label: string;
  value: string;
  unit?: string;
  delta?: string;
};

export type ExperimentComparisonRow = {
  label: string;
  value: string;
  unit?: string;
  level: number;
  delta?: string;
  tone: "good" | "warn";
};

export type ExperimentResult = {
  eyebrow: string;
  stats?: ReadonlyArray<ExperimentStat>;
  trend?: {
    baseline: ReadonlyArray<number>;
    active: ReadonlyArray<number>;
    label?: string;
  };
  comparison?: {
    label?: string;
    rows: ReadonlyArray<ExperimentComparisonRow>;
  };
};

export type PhoneResultPlacement = "after" | "before";

export function PhoneMock({
  conversationHeight = 460,
  headerTitle = "Murph",
  murphHeadshotSrc,
  messages,
  priorMessages,
  result,
  resultPlacement = "before",
}: {
  conversationHeight?: number;
  headerTitle?: string;
  murphHeadshotSrc: MurphHeadshotSrc;
  messages: ReadonlyArray<PhoneMessage>;
  priorMessages?: ReadonlyArray<PhoneMessage>;
  result?: ExperimentResult;
  resultPlacement?: PhoneResultPlacement;
}) {
  const resultCard = result ? (
    <div className="shrink-0">
      <ExperimentCard result={result} />
    </div>
  ) : null;

  return (
    <div className="relative rounded-[2.75rem] bg-[#0a0a0a] p-[4px] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.55)]">
      <div className="overflow-hidden rounded-[2.5rem] bg-[#f5f0e8]">
        <StatusBar />
        <div className="relative">
          <div className="absolute inset-x-0 top-0 z-20">
            <ChatHeader
              murphHeadshotSrc={murphHeadshotSrc}
              title={headerTitle}
            />
          </div>
          <PhoneChatScroller conversationHeight={conversationHeight}>
            <div className="flex min-h-full flex-col justify-end gap-2 px-3 pb-3 pt-[68px]">
              {priorMessages && priorMessages.length > 0 ? (
                <MessageStream messages={priorMessages} />
              ) : null}
              {resultPlacement === "before" ? resultCard : null}
              <MessageStream messages={messages} />
              {resultPlacement === "after" ? resultCard : null}
            </div>
          </PhoneChatScroller>
        </div>
        <Composer />
        <HomeIndicator />
      </div>
    </div>
  );
}

function MessageStream({
  messages,
}: {
  messages: ReadonlyArray<PhoneMessage>;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-1">
      {messages.map((m, index) => {
        const next = messages[index + 1];
        const isTail = !next || next.from !== m.from;
        return (
          <MessageBubble
            key={index}
            from={m.from}
            isTail={isTail}
            text={m.text}
          />
        );
      })}
    </div>
  );
}

export function ExperimentCard({ result }: { result: ExperimentResult }) {
  const sideLabel =
    result.trend?.label ?? result.comparison?.label ?? null;
  const statColumns = result.stats?.length === 2 ? "grid-cols-2" : "grid-cols-3";

  return (
    <div className="overflow-hidden rounded-[18px] border border-[#c4a882]/25 bg-white/65 px-3 pb-3 pt-2.5 shadow-[0_2px_8px_-4px_rgba(45,52,54,0.12)]">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[8px] font-medium uppercase tracking-[0.16em] text-[#5a6e32]">
          {result.eyebrow}
        </span>
        {sideLabel ? (
          <span className="font-mono text-[8px] tracking-[0.08em] text-[#736a58]">
            {sideLabel}
          </span>
        ) : null}
      </div>

      {result.stats ? (
        <div className={`mt-2.5 grid gap-1.5 ${statColumns}`}>
          {result.stats.map((s) => (
            <StatTile key={s.label} stat={s} />
          ))}
        </div>
      ) : null}

      {result.trend ? (
        <div className="mt-2.5">
          <MiniChart
            baseline={result.trend.baseline}
            active={result.trend.active}
          />
          <div className="mt-1 flex items-center justify-end gap-2.5 text-[7.5px] tracking-tight text-[#736a58]">
            <span className="flex items-center gap-1">
              <span className="h-px w-3 border-t border-dashed border-[#c4a882]" />
              Baseline
            </span>
            <span className="flex items-center gap-1">
              <span className="h-[1.5px] w-3 bg-[#5a6e32]" />
              Active
            </span>
          </div>
        </div>
      ) : null}

      {result.comparison ? (
        <div className="mt-2 space-y-2">
          {result.comparison.rows.map((row) => (
            <ComparisonRow key={row.label} row={row} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ComparisonRow({ row }: { row: ExperimentComparisonRow }) {
  const isGood = row.tone === "good";
  const barColor = isGood ? "bg-[#5a6e32]" : "bg-[#8b5d3f]";
  const deltaColor = isGood ? "text-[#5a6e32]" : "text-[#8b5d3f]";
  const clamped = Math.max(0, Math.min(1, row.level));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-[8px] font-medium uppercase tracking-[0.12em] text-[#736a58]">
          {row.label}
        </p>
        <div className="flex items-baseline gap-1">
          <span className="font-serif text-[14px] font-semibold leading-none tracking-tight text-[#2d3436]">
            {row.value}
          </span>
          {row.unit ? (
            <span className="text-[8px] tracking-tight text-[#736a58]">
              {row.unit}
            </span>
          ) : null}
          {row.delta ? (
            <span className={`ml-1 text-[8.5px] font-medium tracking-tight ${deltaColor}`}>
              {row.delta}
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-[#f5f0e8]/90">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${clamped * 100}%` }}
        />
      </div>
    </div>
  );
}

function StatTile({ stat }: { stat: ExperimentStat }) {
  const isNegative = stat.delta?.startsWith("−") || stat.delta?.startsWith("-");
  return (
    <div className="rounded-[10px] bg-[#f5f0e8]/85 px-2 py-1.5">
      <p className="font-mono text-[7px] font-medium uppercase tracking-[0.12em] text-[#736a58]">
        {stat.label}
      </p>
      <p className="mt-0.5 font-serif text-[14px] font-semibold leading-[1.05] tracking-tight text-[#2d3436]">
        {stat.value}
        {stat.unit ? (
          <span className="ml-0.5 font-sans text-[8px] font-normal tracking-tight text-[#736a58]">
            {stat.unit}
          </span>
        ) : null}
      </p>
      {stat.delta ? (
        <p
          className={`mt-0.5 text-[8px] font-medium tracking-tight ${
            isNegative ? "text-[#8b5d3f]" : "text-[#5a6e32]"
          }`}
        >
          {stat.delta}
        </p>
      ) : null}
    </div>
  );
}

function MiniChart({
  active,
  baseline,
}: {
  active: ReadonlyArray<number>;
  baseline: ReadonlyArray<number>;
}) {
  const W = 240;
  const H = 32;
  const padX = 5;
  const padY = 3;
  const all = [...baseline, ...active];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;
  const usableW = W - padX * 2;
  const usableH = H - padY * 2;
  // baseline's last point and active's first point share an X (they overlap so the
  // dashed and solid lines join cleanly), so total distinct X positions =
  // baseline.length + active.length - 1, not the naive sum.
  const activeStart = baseline.length - 1;
  const totalPoints = activeStart + active.length;
  const step = usableW / Math.max(1, totalPoints - 1);
  const xFor = (i: number) => padX + i * step;
  const yFor = (v: number) => padY + usableH - ((v - min) / range) * usableH;
  const baselinePath = baseline
    .map(
      (v, i) =>
        `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(v).toFixed(1)}`,
    )
    .join(" ");
  const activePath = active
    .map(
      (v, i) =>
        `${i === 0 ? "M" : "L"} ${xFor(activeStart + i).toFixed(
          1,
        )} ${yFor(v).toFixed(1)}`,
    )
    .join(" ");
  const lastX = xFor(totalPoints - 1);
  const lastY = yFor(active[active.length - 1]);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-8 w-full"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d={baselinePath}
        fill="none"
        stroke="#c4a882"
        strokeOpacity="0.65"
        strokeWidth="1.5"
        strokeDasharray="3 3"
        strokeLinecap="round"
      />
      <path
        d={activePath}
        fill="none"
        stroke="#5a6e32"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r="2.4" fill="#5a6e32" />
    </svg>
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
        {/* Signal — 3 bars */}
        <svg width="14" height="10" viewBox="0 0 14 11" fill="#2d3436" aria-hidden="true">
          <rect x="0" y="6" width="3.6" height="5" rx="0.8" />
          <rect x="5.2" y="3" width="3.6" height="8" rx="0.8" />
          <rect x="10.4" y="0" width="3.6" height="11" rx="0.8" />
        </svg>
        {/* WiFi */}
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
        {/* Battery */}
        <svg width="22" height="11" viewBox="0 0 22 11" fill="none" aria-hidden="true">
          <rect
            x="0.5"
            y="0.5"
            width="18"
            height="10"
            rx="2.6"
            stroke="#2d3436"
            strokeWidth="0.9"
          />
          <rect x="19.2" y="3.6" width="1.6" height="3.8" rx="0.6" fill="#2d3436" />
          <rect x="1.9" y="1.9" width="14.2" height="7.2" rx="1.4" fill="#2d3436" />
        </svg>
      </div>
    </div>
  );
}

function ChatHeader({
  murphHeadshotSrc,
  title,
}: {
  murphHeadshotSrc: MurphHeadshotSrc;
  title: string;
}) {
  return (
    <div className="relative z-20 flex items-start justify-between px-2.5 pb-2 pt-1.5">
      {/* Back pill with unread badge — liquid glass */}
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

      {/* Center: avatar floating just above name pill */}
      <div className="flex flex-1 flex-col items-center">
        <MurphHeadshotAvatar src={murphHeadshotSrc} />
        <div className="-mt-[5px] flex items-center gap-[3px] rounded-full bg-[#2d3436]/10 px-2.5 py-[3px] backdrop-blur-md ring-1 ring-inset ring-white/50">
          <p className="text-[0.6875rem] font-semibold tracking-tight text-[#2d3436]">
            {title}
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
      </div>

      {/* FaceTime button — outlined camera, liquid glass */}
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

function MessageBubble({
  from,
  isTail,
  text,
}: PhoneMessage & { isTail: boolean }) {
  const isUser = from === "user";
  const tailFill = isUser ? "#5a6e32" : "#ffffff";

  return (
    <div
      className={`relative ${
        isUser ? "ml-auto max-w-[68%]" : "mr-auto max-w-[78%]"
      }`}
    >
      <div
        className={`rounded-[15px] px-3 py-[7px] ${
          isUser ? "bg-[#5a6e32] text-white" : "bg-white text-[#2d3436]"
        }`}
      >
        <p className="text-[0.8125rem] leading-[1.4] tracking-tight">{text}</p>
      </div>
      {isTail ? (
        <svg
          aria-hidden="true"
          width="14"
          height="9"
          viewBox="0 0 14 9"
          fill={tailFill}
          className={`pointer-events-none absolute -bottom-[2px] ${
            isUser ? "-right-[3px]" : "-left-[3px] -scale-x-100"
          }`}
        >
          <path d="M0 0 C 0 4 4 8 14 8 C 12.5 7.5 8.5 5 6 0 Z" />
        </svg>
      ) : null}
    </div>
  );
}

function Composer() {
  return (
    <div className="bg-[#f5f0e8] px-3 pb-2 pt-1.5">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
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
        </span>
        <div className="flex flex-1 items-center justify-between rounded-full border border-[#c4a882]/25 bg-white py-[6px] pl-4 pr-3">
          <span className="text-[0.8125rem] tracking-tight text-[#736a58]">
            iMessage
          </span>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="#736a58" fillOpacity="0.4" aria-hidden="true">
            <rect x="0.5" y="5" width="1.6" height="4" rx="0.8" />
            <rect x="3.2" y="3" width="1.6" height="8" rx="0.8" />
            <rect x="5.9" y="1" width="1.6" height="12" rx="0.8" />
            <rect x="8.6" y="3" width="1.6" height="8" rx="0.8" />
            <rect x="11.3" y="5" width="1.6" height="4" rx="0.8" />
          </svg>
        </div>
      </div>
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
