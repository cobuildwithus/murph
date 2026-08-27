import { Badge } from "@/src/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import type {
  HostedRecentMemberLifecycle,
  HostedRecentMemberRetention,
  HostedRecentMemberRetentionRow,
} from "@/src/lib/hosted-ops/recent-member-retention";

const INTEGER_FORMATTER = new Intl.NumberFormat("en-US");
const UTC_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "short",
  timeZone: "UTC",
  timeZoneName: "short",
});

export function RecentMemberRetention(input: {
  retention: HostedRecentMemberRetention;
  titleId?: string;
}) {
  const titleId = input.titleId ?? "growth-recent-members-title";
  const capturedAt = new Date(input.retention.capturedAt);

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div>
        <h2
          className="font-serif text-xl font-semibold tracking-tight text-foreground"
          id={titleId}
        >
          Recent member retention
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          The newest 20 real member signups, newest first. Counts use durable
          inbound message receipts from personal conversations: Today is the
          current UTC day and 7 days is rolling. Returned means Murph received
          a personal message on a later UTC day than signup.
        </p>
      </div>

      {input.retention.members.length === 0 ? (
        <div className="rounded-xl border border-border/70 bg-card/90 px-4 py-10 text-center text-sm text-muted-foreground">
          No real member signups yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card/90">
          <ul className="divide-y divide-border/70 md:hidden" data-layout="mobile-rows">
            {input.retention.members.map((member) => (
              <MobileMemberRow
                capturedAt={capturedAt}
                key={member.memberId}
                member={member}
              />
            ))}
          </ul>
          <div className="hidden md:block" data-layout="desktop-table">
            <Table className="min-w-[1080px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Member</TableHead>
                  <TableHead>Retention</TableHead>
                  <TableHead className="text-right">Today</TableHead>
                  <TableHead className="text-right">7 days</TableHead>
                  <TableHead className="text-right">All time</TableHead>
                  <TableHead>First message</TableHead>
                  <TableHead className="pr-4">Latest message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {input.retention.members.map((member) => (
                  <TableRow key={member.memberId}>
                    <TableCell className="min-w-64 whitespace-normal px-4 py-3">
                      <MemberIdentity
                        capturedAt={capturedAt}
                        member={member}
                      />
                    </TableCell>
                    <TableCell className="min-w-36 whitespace-normal py-3">
                      <LifecycleSummary member={member} />
                    </TableCell>
                    <MessageCount value={member.messagesToday} />
                    <MessageCount value={member.messagesLast7Days} />
                    <MessageCount value={member.messagesAllTime} />
                    <TableCell className="min-w-36 text-muted-foreground">
                      {formatFirstMessage(member)}
                    </TableCell>
                    <TableCell className="min-w-36 pr-4 text-muted-foreground">
                      {member.lastMessageAt === null
                        ? "Not yet"
                        : formatAgo(member.lastMessageAt, capturedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </section>
  );
}

function MobileMemberRow(input: {
  capturedAt: Date;
  member: HostedRecentMemberRetentionRow;
}) {
  return (
    <li className="px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <MemberIdentity
          capturedAt={input.capturedAt}
          member={input.member}
        />
        <LifecycleSummary member={input.member} />
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3">
        <MobileMessageCount label="Today" value={input.member.messagesToday} />
        <MobileMessageCount
          label="7 days"
          value={input.member.messagesLast7Days}
        />
        <MobileMessageCount
          label="All time"
          value={input.member.messagesAllTime}
        />
      </dl>
      <dl className="mt-4 grid grid-cols-2 gap-4 text-xs text-muted-foreground">
        <div>
          <dt className="font-mono text-[9px] uppercase tracking-[0.1em]">
            First message
          </dt>
          <dd className="mt-1 text-foreground">
            {formatFirstMessage(input.member)}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[9px] uppercase tracking-[0.1em]">
            Latest message
          </dt>
          <dd className="mt-1 text-foreground">
            {input.member.lastMessageAt === null
              ? "Not yet"
              : formatAgo(input.member.lastMessageAt, input.capturedAt)}
          </dd>
        </div>
      </dl>
    </li>
  );
}

function MemberIdentity(input: {
  capturedAt: Date;
  member: HostedRecentMemberRetentionRow;
}) {
  return (
    <div className="min-w-0">
      <div className="font-medium text-foreground">
        {input.member.maskedPhoneNumberHint ??
          `Member · ${input.member.memberId.slice(-8)}`}
      </div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">
        Joined {formatUtcDateTime(input.member.createdAt)} · {formatAgo(
          input.member.createdAt,
          input.capturedAt,
        )}
      </div>
      <div className="text-xs leading-5 text-muted-foreground">
        {formatAccountState(input.member)} · {input.member.onboardingCompleted
          ? "Onboarding complete"
          : "Onboarding open"}
      </div>
    </div>
  );
}

function LifecycleSummary(input: {
  member: HostedRecentMemberRetentionRow;
}) {
  return (
    <div className="shrink-0">
      <LifecycleBadge lifecycle={input.member.lifecycle} />
      {input.member.messagesToday > 0 ? (
        <div className="mt-1 text-xs text-muted-foreground">
          Active today
        </div>
      ) : null}
    </div>
  );
}

function LifecycleBadge(input: { lifecycle: HostedRecentMemberLifecycle }) {
  if (input.lifecycle === "returned") {
    return <Badge>Returned</Badge>;
  }

  if (input.lifecycle === "activated") {
    return <Badge variant="secondary">Activated</Badge>;
  }

  return <Badge variant="outline">No message yet</Badge>;
}

function MessageCount(input: { value: number }) {
  return (
    <TableCell className="text-right font-serif text-lg font-semibold tabular-nums text-foreground">
      {INTEGER_FORMATTER.format(input.value)}
    </TableCell>
  );
}

function MobileMessageCount(input: { label: string; value: number }) {
  return (
    <div>
      <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
        {input.label}
      </dt>
      <dd className="mt-1 font-serif text-2xl font-semibold tabular-nums text-foreground">
        {INTEGER_FORMATTER.format(input.value)}
      </dd>
    </div>
  );
}

function formatAccountState(member: HostedRecentMemberRetentionRow): string {
  if (member.suspended) {
    return "Suspended";
  }

  if (member.billingPhase === "trial") {
    return member.billingPlanName === null
      ? "Trial"
      : `${member.billingPlanName} trial`;
  }

  if (member.billingPhase === "paid") {
    return member.billingPlanName ?? "Paid";
  }

  return sentenceCase(member.billingStatus);
}

function formatFirstMessage(
  member: HostedRecentMemberRetentionRow,
): string {
  if (member.firstMessageAt === null) {
    return "Not yet";
  }

  const createdAt = new Date(member.createdAt);
  const firstMessageAt = new Date(member.firstMessageAt);
  const elapsedMs = Math.max(0, firstMessageAt.getTime() - createdAt.getTime());

  if (elapsedMs < 60_000) {
    return "Within 1m";
  }

  if (elapsedMs < 60 * 60_000) {
    return `${Math.floor(elapsedMs / 60_000)}m after signup`;
  }

  if (elapsedMs < 24 * 60 * 60_000) {
    return `${Math.floor(elapsedMs / (60 * 60_000))}h after signup`;
  }

  return `${Math.floor(elapsedMs / (24 * 60 * 60_000))}d after signup`;
}

function formatAgo(value: string, capturedAt: Date): string {
  const elapsedMs = Math.max(
    0,
    capturedAt.getTime() - new Date(value).getTime(),
  );

  if (elapsedMs < 60_000) {
    return "just now";
  }

  if (elapsedMs < 60 * 60_000) {
    return `${Math.floor(elapsedMs / 60_000)}m ago`;
  }

  if (elapsedMs < 24 * 60 * 60_000) {
    return `${Math.floor(elapsedMs / (60 * 60_000))}h ago`;
  }

  return `${Math.floor(elapsedMs / (24 * 60 * 60_000))}d ago`;
}

function formatUtcDateTime(value: string): string {
  return UTC_DATE_TIME_FORMATTER.format(new Date(value));
}

function sentenceCase(value: string): string {
  const normalized = value.replaceAll("_", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
