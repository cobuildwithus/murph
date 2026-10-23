import Image from "next/image";

import { buttonVariants } from "@/src/components/ui/button";
import type { GameInvitePreview } from "@/src/lib/game/contract";

import { CopyInviteLink } from "./copy-invite-link";
import { CLOSED_INVITE_TITLE, describeSchedule, describeStakeLabel } from "./invite-copy";

/** What a texted challenge link shows, from the invite preview. The page supplies `<main>` and the app link. */
export function GameInviteView(props: { appUrl: string; preview: GameInvitePreview | null }) {
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
            <Row label="Artifact" value={preview.terms.checkInKind === "any" ? "Choose each day" : preview.terms.checkInKind === "heart_rate" ? "Heart-rate graph · wearable required" : "Photo"} />
            <Row label="Days" value={`${describeSchedule(preview.terms.schedule)} · ${preview.lengthDays ?? 7} days`} />
            {preview.terms.stakes.map((stake, index) => (
              <Row key={index} label={describeStakeLabel(stake)} value={stake.item} />
            ))}
          </dl>
          <div className="mt-8 flex flex-col gap-4">
            <a className={buttonVariants({ className: "w-full", size: "xl" })} href={props.appUrl}>
              Open in Murph
            </a>
            <CopyInviteLink />
          </div>
        </section>
      ) : (
        <section className="py-12 sm:py-16">
          <h1 className="font-serif text-4xl font-semibold leading-[1.05] tracking-[-0.03em]">
            {CLOSED_INVITE_TITLE}
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">{closedInviteCopy(preview)}</p>
        </section>
      )}
    </div>
  );
}

/** Closed previews omit terms; cancellation can name the inviter. */
function closedInviteCopy(preview: GameInvitePreview | null): string {
  if (preview?.status === "used") return "This challenge was already accepted.";
  if (preview?.status === "expired") {
    if (preview.reason === "cancelled") {
      const name = preview.inviterFirstName?.trim();
      return name ? `${name} called this one off. Ask for a new link.` : "This invite was called off. Ask for a new link.";
    }
    return "This invite expired. Ask for a new link.";
  }
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
