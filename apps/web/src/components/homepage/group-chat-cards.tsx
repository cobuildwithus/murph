import { cn } from "@/src/lib/utils";

import { EmailIcon } from "./email-icon";

export const GROUP_MEMBERS = [
  { id: "theo", name: "Theo", avatarSrc: "/personas/sleeper-avatar.avif" },
  { id: "maya", name: "Maya", avatarSrc: "/personas/athlete-avatar.avif" },
  { id: "sam", name: "Sam", avatarSrc: "/personas/founder-avatar.avif" },
] as const;

export type GroupMember = (typeof GROUP_MEMBERS)[number];

const CHALLENGE_ROWS = [
  {
    name: "You",
    avatarSrc: null,
    daysDone: "5/5 days",
    level: 1,
    delta: "+31% steps vs baseline",
  },
  {
    name: "Maya",
    avatarSrc: "/personas/athlete-avatar.avif",
    daysDone: "4/5 days",
    level: 0.8,
    delta: "+22 min avg walk",
  },
  {
    name: "Sam",
    avatarSrc: "/personas/founder-avatar.avif",
    daysDone: "4/5 days",
    level: 0.8,
    delta: "+12% steps vs baseline",
  },
  {
    name: "Theo",
    avatarSrc: "/personas/sleeper-avatar.avif",
    daysDone: "3/5 days",
    level: 0.6,
    delta: "+4% steps vs baseline",
  },
] as const;

function ChallengeRowAvatar({
  name,
  src,
}: {
  name: string;
  src: string | null;
}) {
  if (!src) {
    return (
      <div
        aria-hidden="true"
        className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-[#5a6e32] font-mono text-[8px] font-semibold uppercase tracking-[0.06em] text-white"
      >
        {name.slice(0, 3)}
      </div>
    );
  }
  return (
    <div
      aria-hidden="true"
      className="size-[26px] shrink-0 rounded-full bg-cover bg-center ring-1 ring-[#c4a882]/30"
      style={{ backgroundImage: `url('${src}')` }}
    />
  );
}

const NEWSLETTER_ROWS = [
  "You · every walk day logged",
  "Theo · best sleep week since May",
  "Maya · 4 sunrise walks logged",
  "Sam · steps up 12% on baseline",
] as const;

export function ChallengeCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[18px] border border-[#c4a882]/25 bg-white/75 px-3 pb-3 pt-2.5",
        className,
      )}
    >
      <div className="font-mono text-[8px] font-medium tracking-[0.16em] text-[#5a6e32]">
        Walk challenge · Day 5 of 7
      </div>
      <div className="mt-2.5 space-y-2.5">
        {CHALLENGE_ROWS.map((row) => (
          <div key={row.name} className="flex items-center gap-2.5">
            <ChallengeRowAvatar name={row.name} src={row.avatarSrc} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-serif text-[13px] font-semibold leading-tight text-[#2d3436]">
                    {row.name}
                  </p>
                  <p className="mt-0.5 font-mono text-[8px] tracking-[0.12em] text-[#736a58]">
                    {row.daysDone}
                  </p>
                </div>
                <p className="shrink-0 text-right text-[9px] font-medium leading-tight tracking-tight text-[#5a6e32]">
                  {row.delta}
                </p>
              </div>
              <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-[#f5f0e8]/90">
                <div
                  className="h-full rounded-full bg-[#5a6e32]"
                  style={{ width: `${row.level * 100}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 border-t border-[#c4a882]/20 pt-2 font-mono text-[9px] tracking-[0.12em] text-[#736a58]">
        Scored on adherence and change vs your own baseline
      </p>
    </div>
  );
}

export function NewsletterCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[18px] border border-[#c4a882]/25 bg-white/75 px-3 pb-3 pt-2.5",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 font-mono text-[8px] font-medium tracking-[0.16em] text-[#5a6e32]">
        <EmailIcon className="size-3 shrink-0" />
        <span>Weekly newsletter · Sunday 8:02 AM</span>
      </div>
      <p className="mt-2 font-serif text-[15px] font-semibold leading-tight text-[#2d3436]">
        Your crew: week 3 in health
      </p>
      <div className="mt-2 divide-y divide-[#2d3436]/[0.06]">
        {NEWSLETTER_ROWS.map((row) => (
          <p
            key={row}
            className="py-1.5 text-[10.5px] leading-[1.35] tracking-tight text-[#736a58] first:pt-0 last:pb-0"
          >
            {row}
          </p>
        ))}
      </div>
      <p className="mt-3 border-t border-[#c4a882]/20 pt-2 font-mono text-[9px] tracking-[0.12em] text-[#736a58]">
        Emailed to everyone who opted in
      </p>
    </div>
  );
}
