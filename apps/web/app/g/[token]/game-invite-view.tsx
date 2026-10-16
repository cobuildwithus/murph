import Image from "next/image";

import { buttonVariants } from "@/src/components/ui/button";
import type { GameInvitePreview, GameSchedule, GameStake } from "@/src/lib/game/contract";

import { CopyInviteLink } from "./copy-invite-link";

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** What a texted challenge link shows, from the invite preview. The page supplies `<main>`. */
export function GameInviteView(props: { preview: GameInvitePreview | null; token: string }) {
  const { preview } = props;
  return (
    <div className="mx-auto flex max-w-md flex-col">
      <Image alt="Murph" className="h-6 w-auto self-start" height={24} priority src="/logo.svg" width={107} />
      {preview?.status === "open" ? (
        <section className="py-12 sm:py-16">
          <h1 className="text-balance font-serif text-4xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl">
            {preview.inviterFirstName} challenged you
          </h1>
          <dl className="mt-8 divide-y divide-border border-y border-border text-base">
            {preview.terms.tasks.map((task) => (
              <Row key={task.seat} label={task.seat === 0 ? preview.inviterFirstName : "You"} value={task.text} />
            ))}
            <Row label="Days" value={describeSchedule(preview.terms.schedule)} />
            {preview.terms.stakes.map((stake, index) => (
              <Row key={index} label={describeStakeLabel(stake)} value={stake.item} />
            ))}
          </dl>
          <div className="mt-8 flex flex-col gap-4">
            <a className={buttonVariants({ className: "w-full", size: "xl" })} href={`murphv2://invite/${encodeURIComponent(props.token)}`}>
              Open in Murph
            </a>
            <CopyInviteLink />
          </div>
        </section>
      ) : (
        <section className="py-12 sm:py-16">
          <h1 className="font-serif text-4xl font-semibold leading-[1.05] tracking-[-0.03em]">
            This invite isn&apos;t available
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">{closedInviteCopy(preview?.status)}</p>
        </section>
      )}
    </div>
  );
}

/** A used or expired invite shows only its status: no names or terms. */
function closedInviteCopy(status: "used" | "expired" | undefined): string {
  if (status === "used") return "This challenge was already accepted.";
  if (status === "expired") return "This invite expired. Ask for a new link.";
  return "Ask for a new link.";
}

function Row(props: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-3">
      <dt className="shrink-0 text-muted-foreground">{props.label}</dt>
      <dd className="text-right font-medium">{props.value}</dd>
    </div>
  );
}

function describeSchedule(schedule: GameSchedule): string {
  if ("count" in schedule) return `Any ${schedule.count} ${schedule.count === 1 ? "day" : "days"} a week`;
  if (schedule.days.length === 7) return "Every day";
  return [...schedule.days].sort((left, right) => left - right).map((day) => WEEKDAY_NAMES[day]).join(", ");
}

function describeStakeLabel(stake: GameStake): string {
  return stake.kind === "winner_gets" ? "Winner gets" : "Each missed day";
}
