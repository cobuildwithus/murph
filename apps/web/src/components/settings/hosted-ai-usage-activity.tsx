import { ChevronDown } from "lucide-react";

import { MurphContactLink } from "@/src/components/murph/murph-contact-link";
import { buttonVariants } from "@/src/components/ui/button";
import type {
  HostedAiUsageActivitySnapshot,
  HostedAiUsageMissionActivityRow,
} from "@/src/lib/hosted-execution/usage-activity-types";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

export function HostedAiUsageActivity(props: {
  activity: HostedAiUsageActivitySnapshot;
  missionContactOption: MurphContactOption | null;
}) {
  const canStartMissions =
    props.activity.missionsEnabled && props.missionContactOption !== null;
  const hasMissionSurface =
    canStartMissions || props.activity.missions.length > 0;
  const currentMissions = props.activity.missions.filter(
    (mission) =>
      mission.status === "in_progress" ||
      mission.status === "waiting_for_group",
  );
  const historicalMissions = props.activity.missions.filter(
    (mission) =>
      mission.status !== "in_progress" &&
      mission.status !== "waiting_for_group",
  );
  const hasHistory =
    historicalMissions.length > 0 || props.activity.credits.length > 0;
  const showReferralEmptyState =
    canStartMissions &&
    currentMissions.length === 0 &&
    !hasHistory;

  if (!hasMissionSurface && !hasHistory) {
    return null;
  }

  return (
    <div
      className="border-y border-border/80"
      data-hosted-ai-usage-activity
    >
      {hasMissionSurface ? (
        <section aria-label="Referrals">
          <div className="flex min-h-14 items-center justify-between gap-4 py-3">
            <h3 className="font-serif text-xl font-semibold tracking-tight text-foreground">
              Referrals
            </h3>
            {canStartMissions && props.missionContactOption ? (
              <MurphContactLink
                actionLabel="Ask Murph about referrals"
                className={buttonVariants({
                  className: "h-auto px-0",
                  size: "sm",
                  variant: "link",
                })}
                option={props.missionContactOption}
              >
                Ask Murph
              </MurphContactLink>
            ) : null}
          </div>

          {currentMissions.length > 0 ? (
            <ul
              aria-label="Active usage referrals"
              className="divide-y divide-border/70 border-t border-border/70"
            >
              {currentMissions.map((mission) => (
                <MissionRow key={mission.id} mission={mission} />
              ))}
            </ul>
          ) : null}
          {showReferralEmptyState ? (
            <div className="grid gap-2 border-t border-border/70 py-5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-8">
              <p className="text-sm font-medium text-foreground">
                No active referrals
              </p>
              <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                Ask Murph to start one in a new group. Get the group talking,
                and the reward is added automatically.
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {hasHistory ? (
        <section
          aria-label={hasMissionSurface ? "History" : "Purchased credits"}
          className={hasMissionSurface ? "border-t border-border/70" : undefined}
        >
          <details className="group">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-sm py-3 text-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              {hasMissionSurface ? "History" : "Purchased credits"}
              <ChevronDown
                aria-hidden="true"
                className="size-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
              />
            </summary>
            <ul
              aria-label="Usage activity history"
              className="divide-y divide-border/70 border-t border-border/70"
            >
              {historicalMissions.map((mission) => (
                <MissionRow historical key={mission.id} mission={mission} />
              ))}
              {props.activity.credits.map((credit) => (
                <HistoryRow
                  amountLabel={credit.addedLabel}
                  key={credit.id}
                  primaryMeta={credit.sourceLabel}
                  secondaryMeta={credit.dateLabel}
                  title="Usage purchase"
                />
              ))}
            </ul>
          </details>
        </section>
      ) : null}
    </div>
  );
}

function MissionRow(props: {
  historical?: boolean;
  mission: HostedAiUsageMissionActivityRow;
}) {
  const { mission } = props;

  if (props.historical) {
    return (
      <HistoryRow
        amountLabel={mission.rewardLabel}
        destinationLabel={mission.destinationLabel}
        primaryMeta={mission.statusLabel}
        secondaryMeta={mission.timingLabel}
        title={mission.title}
      />
    );
  }

  return (
    <li className="py-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-5 sm:gap-8">
        <div className="min-w-0">
          <h4 className="text-balance font-serif text-xl font-semibold leading-snug tracking-tight text-foreground">
            {mission.title}
          </h4>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">
              {mission.statusLabel}
            </span>
            <span aria-hidden="true" className="text-border">
              /
            </span>
            <span>{mission.timingLabel}</span>
          </p>
        </div>
        <div className="text-right">
          <div className="font-serif text-2xl font-semibold leading-none tabular-nums text-foreground">
            {mission.rewardLabel}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            to {mission.destinationLabel}
          </div>
        </div>
      </div>
    </li>
  );
}

function HistoryRow(props: {
  amountLabel: string;
  destinationLabel?: string;
  primaryMeta: string;
  secondaryMeta: string;
  title: string;
}) {
  return (
    <li className="py-3.5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-5 sm:gap-8">
        <div className="min-w-0">
          <h4 className="text-balance text-sm font-medium leading-snug text-foreground">
            {props.title}
          </h4>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">
              {props.primaryMeta}
            </span>
            <span aria-hidden="true" className="text-border">
              /
            </span>
            <span>{props.secondaryMeta}</span>
          </p>
        </div>
        <div className="text-right">
          <div className="font-serif text-lg font-semibold tabular-nums text-foreground">
            {props.amountLabel}
          </div>
          {props.destinationLabel ? (
            <div className="mt-1 text-xs text-muted-foreground">
              to {props.destinationLabel}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}
