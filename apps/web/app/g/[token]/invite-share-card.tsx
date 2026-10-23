import type { GameInvitePreview } from "@/src/lib/game/contract";

import { CLOSED_INVITE_TITLE, describeSchedule, describeStakeLabel, describeStartDate } from "./invite-copy";

export const GAME_INVITE_OG_ALT = "A Murph game challenge.";

// The event-ticket look from the game's invite design: a sienna ground, a
// cream ticket with both players, and a gold stub with the stake.
const GROUND = "linear-gradient(180deg, #98704F 0%, #7E5A3E 50%, #644630 100%)";
const TICKET = "linear-gradient(180deg, #FFFCF6 0%, #F3EEE4 100%)";
const STUB = "linear-gradient(135deg, #E6CC87 0%, #C4A058 45%, #E2C785 75%, #B08A45 100%)";
const INK = "#2D3436";
const MUTED = "#736A58";
const FAINT = "#A39782";
const SIENNA = "#8B5D3F";
const SAGE = "#5A6E32";
const TICKET_INK = "#3B2A12";
const WIDTH = 520;
const PLAYER_WIDTH = 190;
// The link reaches the invitee, and anyone they forward it to: name them as the page does.
const INVITEE_NAME = "You";

/**
 * The /g/[token] link unfurl. An open invite shows the challenge itself: the
 * challenger's first name against "You", both tasks, the days, and the stake,
 * which the invite page already shows to anyone holding the link. The name the
 * challenger typed for the invitee is their private label, so it never
 * appears. A used, expired, or missing invite shows only that it isn't
 * available. Pure inline styles with no node
 * imports, so the opengraph-image route (satori) and the /design study render
 * the same card. Fraunces is upright SemiBold throughout; there's no logo.
 */
export function GameInviteShareCard({ preview }: { preview: GameInvitePreview | null }) {
  return (
    <div
      style={{
        alignItems: "center",
        background: GROUND,
        display: "flex",
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      {preview?.status === "open" ? <OpenTicket preview={preview} /> : <ClosedTicket />}
    </div>
  );
}

function OpenTicket({ preview }: { preview: Extract<GameInvitePreview, { status: "open" }> }) {
  const tasks = preview.terms.tasks;
  const stake = preview.terms.stakes[0];
  const when = `${describeSchedule(preview.terms.schedule).toUpperCase()} · ${preview.lengthDays ?? 7} DAYS`
    + (preview.startsOn ? ` · STARTS ${describeStartDate(preview.startsOn).toUpperCase()}` : "");
  const nameSize = nameFontSize(Math.max(preview.inviterFirstName.length, INVITEE_NAME.length));
  return (
    <div
      style={{
        borderRadius: 26,
        boxShadow: "0 18px 36px rgba(46, 24, 10, 0.3), 0 3px 8px rgba(46, 24, 10, 0.2)",
        display: "flex",
        flexDirection: "column",
        width: WIDTH,
      }}
    >
      <div
        style={{
          alignItems: "center",
          background: TICKET,
          borderTopLeftRadius: 26,
          borderTopRightRadius: 26,
          display: "flex",
          flexDirection: "column",
          gap: 28,
          padding: "40px 36px 36px",
        }}
      >
        <Label color={SIENNA} size={20} spacing={5.6}>CHALLENGE</Label>
        <div style={{ alignItems: "flex-start", display: "flex", justifyContent: "space-between", width: "100%" }}>
          <Player bar={SAGE} name={preview.inviterFirstName} size={nameSize} task={taskFor(tasks, 0)} />
          <div style={{ color: FAINT, display: "flex", fontFamily: "Fraunces", fontSize: 30, fontWeight: 600, lineHeight: `${nameSize + 8}px` }}>
            vs.
          </div>
          <Player bar={SIENNA} name={INVITEE_NAME} size={nameSize} task={taskFor(tasks, 1)} />
        </div>
        <Label color={FAINT} size={18} spacing={3.6}>{when}</Label>
      </div>
      <Perforation />
      {stake ? (
        <div
          style={{
            alignItems: "center",
            background: STUB,
            borderBottomLeftRadius: 26,
            borderBottomRightRadius: 26,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "24px 36px 32px",
          }}
        >
          <Label color="rgba(59, 42, 18, 0.7)" size={18} spacing={4.3}>
            {describeStakeLabel(stake).toUpperCase()}
          </Label>
          <div
            style={{
              color: TICKET_INK,
              display: "flex",
              fontFamily: "Fraunces",
              fontSize: stake.item.length > 22 ? 34 : 44,
              fontWeight: 600,
              lineHeight: 1.2,
              textAlign: "center",
            }}
          >
            {stake.item}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ClosedTicket() {
  return (
    <div
      style={{
        alignItems: "center",
        background: TICKET,
        borderRadius: 26,
        boxShadow: "0 18px 36px rgba(46, 24, 10, 0.3), 0 3px 8px rgba(46, 24, 10, 0.2)",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        padding: "56px 48px",
        width: WIDTH,
      }}
    >
      <div style={{ color: INK, display: "flex", fontFamily: "Fraunces", fontSize: 46, fontWeight: 600, lineHeight: 1.15, textAlign: "center" }}>
        {CLOSED_INVITE_TITLE}
      </div>
      <div style={{ color: MUTED, display: "flex", fontFamily: "DM Sans", fontSize: 26 }}>Ask for a new link.</div>
    </div>
  );
}

function Player(props: { bar: string; name: string; size: number; task: string }) {
  return (
    <div style={{ alignItems: "center", display: "flex", flexDirection: "column", gap: 8, width: PLAYER_WIDTH }}>
      <div
        style={{
          color: INK,
          display: "flex",
          fontFamily: "Fraunces",
          fontSize: props.size,
          fontWeight: 600,
          letterSpacing: -0.6,
          lineHeight: `${props.size + 8}px`,
          textAlign: "center",
        }}
      >
        {props.name}
      </div>
      <div style={{ background: props.bar, borderRadius: 2, display: "flex", height: 4, width: 40 }} />
      <div style={{ color: MUTED, display: "flex", fontFamily: "DM Sans", fontSize: 24, lineHeight: 1.3, textAlign: "center" }}>
        {props.task}
      </div>
    </div>
  );
}

function Label(props: { children: string; color: string; size: number; spacing: number }) {
  return (
    <div style={{ color: props.color, display: "flex", fontFamily: "DM Sans", fontSize: props.size, letterSpacing: props.spacing }}>
      {props.children}
    </div>
  );
}

/** The tear line between ticket and stub, with a notch at each edge. */
function Perforation() {
  return (
    <div style={{ background: "linear-gradient(180deg, #F3EEE4 50%, #E6CC87 50%)", display: "flex", height: 30, position: "relative" }}>
      <div style={{ borderTop: "2px dashed rgba(59, 42, 18, 0.35)", display: "flex", marginLeft: 26, marginRight: 26, marginTop: 14, width: WIDTH - 52 }} />
      <div style={{ background: SIENNA, borderRadius: 15, display: "flex", height: 30, left: -15, position: "absolute", top: 0, width: 30 }} />
      <div style={{ background: SIENNA, borderRadius: 15, display: "flex", height: 30, position: "absolute", right: -15, top: 0, width: 30 }} />
    </div>
  );
}

/** Names never wrap, so long ones step down to fit their 190px column. */
function nameFontSize(length: number): number {
  return Math.max(24, Math.min(62, Math.floor(PLAYER_WIDTH / (0.56 * Math.max(length, 1)))));
}

function taskFor(tasks: ReadonlyArray<{ seat: number; text: string }>, seat: number): string {
  return tasks.find((task) => task.seat === seat)?.text ?? "";
}
