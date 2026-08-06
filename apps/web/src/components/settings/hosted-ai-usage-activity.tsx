import { ChevronDown } from "lucide-react";

import { MurphContactLink } from "@/src/components/murph/murph-contact-link";
import { HostedSignupReferralLinkButton } from "@/src/components/settings/hosted-signup-referral-link-button";
import { buttonVariants } from "@/src/components/ui/button";
import type {
  HostedAiUsageActivitySnapshot,
  HostedAiUsageMissionActivityRow,
} from "@/src/lib/hosted-execution/usage-activity-types";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

export function HostedAiUsageActivity(props: {
  activity: HostedAiUsageActivitySnapshot;
  missionContactOption: MurphContactOption | null;
  signupReferralUrl?: string | null;
}) {
  const canStartMissions =
    props.activity.missionsEnabled && props.missionContactOption !== null;
  const currentMissions = props.activity.missions.filter(
    (mission) => mission.status !== "completed",
  );
  const historicalMissions = props.activity.missions.filter(
    (mission) => mission.status === "completed",
  );
  const hasHistory =
    historicalMissions.length > 0 || props.activity.credits.length > 0;

  return (
    <div
      className="border-y border-border/80"
      data-hosted-ai-usage-activity
    >
      <section aria-label="Referrals">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
          <h3 className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Referrals
          </h3>
          <div className="ml-auto flex items-center gap-4">
            <HostedSignupReferralLinkButton
              identityKey={
                props.activity.referralIdentityKey ?? "referral-design-preview"
              }
              signupUrl={props.signupReferralUrl}
            />
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
        </div>

        {currentMissions.length > 0 ? (
          <ul
            aria-label="Current usage referrals"
            className="divide-y divide-border/70 border-t border-border/70"
          >
            {currentMissions.map((mission) => (
              <MissionRow key={mission.id} mission={mission} />
            ))}
          </ul>
        ) : (
          <div className="border-t border-border/70 py-5">
            <p className="text-sm leading-6 text-muted-foreground">
              Invite friends to Murph or ask about referral missions.
              Qualifying rewards are added automatically.
            </p>
          </div>
        )}
      </section>

      {hasHistory ? (
        <section
          aria-label="History"
          className="border-t border-border/70"
        >
          <details className="group">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-sm py-3 text-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              History
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
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-8">
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
          <details className="group mt-3">
            <summary
              aria-label={`Details for ${mission.title}: ${mission.statusLabel}, ${mission.timingLabel}`}
              className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
              role="button"
            >
              Details
              <ChevronDown
                aria-hidden="true"
                className="size-3.5 transition-transform duration-200 group-open:rotate-180"
              />
            </summary>
            <div className="mt-3 max-w-2xl space-y-1.5 text-xs leading-5 text-muted-foreground">
              <p>{mission.requirementsLabel}</p>
              <p>Selected {mission.selectedLabel}</p>
            </div>
          </details>
        </div>
        <div className="text-left sm:text-right">
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
      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-8">
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
        <div className="text-left sm:text-right">
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
