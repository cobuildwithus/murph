import Image from "next/image";
import type { ReactNode } from "react";

import { LinkPageScanCode } from "@/src/components/link-page/scan-code";
import { MURPH_IOS_APP_STORE_URL } from "@/src/lib/site-metadata";
import type { GameInvitePreview, GameStake } from "@/src/lib/game/contract";

import { closedInviteCopy, describeCheckIn, describeInviteTiming, describeStakeLabel, inviteShareCopy } from "./invite-copy";

type OpenPreview = Extract<GameInvitePreview, { status: "open" }>;

// The app's invite card, on its night ground (GameCard's web variant).
const NIGHT = "#1C1915";

/**
 * What a texted challenge link shows: the app's own invite card. The headline,
 * when it runs, both tasks, the stake on its ticket, then Get the app. The page
 * supplies `<main>`, the app link, the invite's own link, and whether the
 * device is a computer; this view paints the night ground. On a computer an
 * open invite shows a code for that link in place of the buttons: the game is
 * on the phone. The device decides that, never the width, so a wide phone or
 * tablet keeps its buttons; width only moves the code beside the card.
 */
export function GameInviteView(props: { appUrl: string; inviteUrl: string; onComputer: boolean; preview: GameInvitePreview | null }) {
  const { preview } = props;
  return (
    <div className="@container flex flex-1 flex-col bg-[#1C1915] text-[#FFFCF6]">
      <div className="flex flex-1 flex-col @5xl:flex-row @5xl:items-center @5xl:justify-center @5xl:gap-20">
        <div className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col px-6 pb-6 pt-3 sm:my-auto sm:flex-none sm:py-16 @5xl:mx-0">
          <div className="flex h-11 shrink-0 items-center">
            <Image alt="Murph" className="h-[25px] w-auto" height={25} priority src="/logo-dark.svg" width={112} />
          </div>
          {preview?.status === "open"
            ? <OpenInvite appUrl={props.onComputer ? null : props.appUrl} preview={preview} />
            : <ClosedInvite preview={preview} />}
        </div>
        {preview?.status === "open" && props.onComputer ? (
          <LinkPageScanCode
            detail="Point your phone's camera here."
            label="A code that opens this invite on your phone."
            title="Scan to play."
            url={props.inviteUrl}
          />
        ) : null}
      </div>
    </div>
  );
}

/** `appUrl` is null on a computer, where the code stands in for the buttons. */
function OpenInvite({ appUrl, preview }: { appUrl: string | null; preview: OpenPreview }) {
  const checkIn = describeCheckIn(preview.terms.checkInKind);
  return (
    <>
      <section className="pt-5">
        <Headline>{`${inviteShareCopy(preview).title}.`}</Headline>
        <Subline>{describeInviteTiming(preview)}</Subline>
        {checkIn ? <p className="mt-1 text-pretty text-base font-medium leading-[22px] text-[#FFFCF6]/60">{checkIn}</p> : null}
        <ul className="mt-[22px] flex flex-col gap-2">
          {preview.maxPlayers === 10 ? (
            <TaskRow avatar={<GroupMark />} task={preview.terms.defaultTask ?? ""} />
          ) : (
            [1, 0].map((seat) => (
              <TaskRow
                avatar={seat === 0 ? <Initial name={preview.inviterFirstName} /> : <YouMark />}
                key={seat}
                label={seat === 0 ? preview.inviterFirstName : "You"}
                task={preview.terms.tasks.find((task) => task.seat === seat)?.text ?? ""}
              />
            ))
          )}
          {preview.terms.stakes.map((stake, index) => (
            <li className="pt-2" key={index}>
              {stake.kind === "dare" ? <PinkSlip stake={stake} /> : <GoldTicket stake={stake} />}
            </li>
          ))}
        </ul>
      </section>
      {appUrl ? (
        <div className="mt-auto flex flex-col items-center gap-4 pt-10 sm:mt-0 sm:pt-12">
          <a
            className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#FFFCF6] text-[17px] font-semibold text-[#2D3436] outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#FFFCF6]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1C1915]"
            href={MURPH_IOS_APP_STORE_URL}
          >
            <AppleLogo />
            Get the app
          </a>
          <p className="text-center text-[15px] font-medium leading-5 text-[#FFFCF6]/60">
            Already have Murph?{" "}
            <a className="rounded-sm font-semibold text-[#FFFCF6] underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#FFFCF6]/70" href={appUrl}>
              Open it
            </a>
          </p>
        </div>
      ) : null}
    </>
  );
}

function ClosedInvite({ preview }: { preview: Exclude<GameInvitePreview, { status: "open" }> | null }) {
  const copy = closedInviteCopy(preview);
  return (
    <section className="pt-5">
      <Headline>{copy.title}</Headline>
      <Subline>{copy.detail}</Subline>
    </section>
  );
}

function Headline({ children }: { children: string }) {
  return (
    <h1 className="text-balance font-serif text-[40px] font-semibold leading-[44px] tracking-[-0.02em] sm:text-5xl sm:leading-[52px]">
      {children}
    </h1>
  );
}

function Subline({ children }: { children: string }) {
  return <p className="mt-2.5 text-pretty text-base font-medium leading-[22px] text-[#FFFCF6]/60">{children}</p>;
}

/** One player's task: their face or initial, "You" or their name, then the task. */
function TaskRow(props: { avatar: ReactNode; label?: string; task: string }) {
  return (
    <li className="flex min-h-16 items-center gap-3 rounded-[18px] bg-[#2A2622] py-2.5 pl-3 pr-4">
      {props.avatar}
      <div className="flex min-w-0 flex-col gap-px">
        {props.label ? <span className="text-xs font-semibold leading-4 text-[#FFFCF6]/55">{props.label}</span> : null}
        <span className="text-balance break-words text-lg font-semibold leading-[23px]">{props.task}</span>
      </div>
    </li>
  );
}

function Avatar({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span aria-hidden className="flex size-[38px] shrink-0 items-center justify-center rounded-full" style={{ background: color }}>
      {children}
    </span>
  );
}

function Initial({ name }: { name: string }) {
  return <Avatar color="#5A6E32"><span className="text-base font-semibold">{[...name.trim()][0]?.toUpperCase() ?? ""}</span></Avatar>;
}

/** The invitee is never named here: the name the challenger typed is their own private label. */
function YouMark() {
  return (
    <Avatar color="#8B5D3F">
      <svg fill="#FFFCF6" height="20" viewBox="0 0 20 20" width="20">
        <circle cx="10" cy="6.6" r="3.6" />
        <path d="M3.2 17.2c.6-3.6 3.4-5.8 6.8-5.8s6.2 2.2 6.8 5.8c.1.5-.3.8-.7.8H3.9c-.4 0-.8-.3-.7-.8z" />
      </svg>
    </Avatar>
  );
}

function GroupMark() {
  return (
    <Avatar color="#5A6E32">
      <svg fill="#FFFCF6" height="20" viewBox="0 0 22 20" width="22">
        <circle cx="8" cy="6.4" r="3.3" />
        <path d="M2 16.8c.5-3.3 3-5.3 6-5.3s5.5 2 6 5.3c.1.5-.3.8-.7.8H2.7c-.4 0-.8-.3-.7-.8z" />
        <circle cx="15.2" cy="7" r="2.7" opacity=".75" />
        <path d="M15.6 11.4c2.4.2 4.2 1.9 4.6 4.6.1.4-.2.7-.6.7h-3.7c-.2-2-1-3.8-2.4-5 .6-.2 1.3-.3 2.1-.3z" opacity=".75" />
      </svg>
    </Avatar>
  );
}

/** The prize ticket: gold, quarter-circle notches cut from each corner. */
function GoldTicket({ stake }: { stake: GameStake }) {
  return (
    <div className="relative flex flex-col gap-1 overflow-hidden px-5 py-[18px]" style={{ background: "linear-gradient(135deg, #EBD18B 0%, #D9B969 55%, #C59D4E 100%)" }}>
      <span className="font-mono text-[10px] uppercase leading-[14px] tracking-[0.2em] text-[#3B2A12]/80">{describeStakeLabel(stake)}</span>
      <span className="text-balance break-words font-serif text-[26px] font-semibold leading-8 text-[#3B2A12]">{stake.item}</span>
      {["-left-[9px] -top-[9px]", "-right-[9px] -top-[9px]", "-bottom-[9px] -left-[9px]", "-bottom-[9px] -right-[9px]"].map((corner) => (
        <span aria-hidden className={`absolute size-[18px] rounded-full ${corner}`} key={corner} style={{ background: NIGHT }} />
      ))}
    </div>
  );
}

/** The dare: the loser's pink slip, typed in, with a bite from each side. */
function PinkSlip({ stake }: { stake: GameStake }) {
  return (
    <div className="relative flex flex-col gap-0.5 overflow-hidden rounded-xl px-6 pb-[11px] pt-2.5" style={{ background: "linear-gradient(180deg, #FAD2D8 0%, #F6C4CC 50%, #F0B4BF 100%)" }}>
      <span className="font-mono text-[10px] uppercase leading-[14px] tracking-[0.24em] text-[#8E2340]">{describeStakeLabel(stake)}</span>
      <span className="break-words text-[17px] leading-[23px] text-[#28305C]" style={{ fontFamily: "\"American Typewriter\", \"Courier New\", ui-monospace, monospace" }}>{stake.item}</span>
      {["-left-2", "-right-2"].map((side) => (
        <span aria-hidden className={`absolute top-1/2 size-4 -translate-y-1/2 rounded-full ${side}`} key={side} style={{ background: NIGHT }} />
      ))}
    </div>
  );
}

function AppleLogo() {
  return (
    <svg aria-hidden fill="currentColor" height="20" viewBox="0 0 17 20" width="17">
      <path d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.5 1.3 0 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.2 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4zM11.6 3c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3-1.5z" />
    </svg>
  );
}
