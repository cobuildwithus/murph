import { ChevronDown, MessageCircle } from "lucide-react";

import { MurphContactLink } from "@/src/components/murph/murph-contact-link";
import { Badge } from "@/src/components/ui/badge";
import { buttonVariants } from "@/src/components/ui/button";
import type {
  HostedAiUsageActivitySnapshot,
  HostedAiUsageMissionActivityStatus,
} from "@/src/lib/hosted-execution/usage-activity-types";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";
import { cn } from "@/src/lib/utils";

export function HostedAiUsageActivity(props: {
  activity: HostedAiUsageActivitySnapshot;
  missionContactOption: MurphContactOption | null;
}) {
  const canStartMissions =
    props.activity.missionsEnabled && props.missionContactOption !== null;
  const hasMissionSurface =
    canStartMissions || props.activity.missions.length > 0;

  return (
    <div
      className="overflow-hidden rounded-xl border border-border bg-card"
      data-hosted-ai-usage-activity
    >
      {hasMissionSurface ? (
        <section className="px-5 py-5 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <h3 className="font-serif text-lg font-semibold tracking-tight text-foreground">
              Missions
            </h3>
            {canStartMissions && props.missionContactOption ? (
              <MurphContactLink
                actionLabel="Ask Murph about usage missions"
                className={buttonVariants({ size: "sm" })}
                option={props.missionContactOption}
              >
                <MessageCircle aria-hidden="true" />
                Ask Murph
              </MurphContactLink>
            ) : null}
          </div>

          {props.activity.missions.length === 0 ? (
            <p className="pt-4 text-sm text-muted-foreground">
              No missions selected.
            </p>
          ) : (
            <ul
              aria-label="Usage missions"
              className="mt-4 divide-y divide-border/70 border-t border-border/70"
            >
              {props.activity.missions.map((mission) => (
                <li className="py-4" key={mission.id}>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:gap-6">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-medium text-foreground">
                          {mission.title}
                        </h4>
                        <Badge
                          variant={missionStatusBadgeVariant(mission.status)}
                        >
                          {mission.statusLabel}
                        </Badge>
                      </div>
                      <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                        {mission.timingLabel}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="font-serif text-lg font-semibold tabular-nums text-foreground">
                        {mission.rewardLabel}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        to {mission.destinationLabel}
                      </div>
                    </div>
                  </div>
                  <details className="group mt-3 text-xs text-muted-foreground">
                    <summary
                      aria-label={`Details for ${mission.title}, ${mission.statusLabel}, selected ${mission.selectedLabel}`}
                      className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
                    >
                      Details
                      <ChevronDown
                        aria-hidden="true"
                        className="size-3.5 transition-transform group-open:rotate-180"
                      />
                    </summary>
                    <div className="mt-2 max-w-2xl space-y-1.5 leading-5">
                      <p>{mission.requirementsLabel}</p>
                      <p className="font-mono text-[10px] uppercase tracking-[0.1em]">
                        Selected {mission.selectedLabel}
                      </p>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section
        className={cn(
          "px-5 py-5 sm:px-6",
          hasMissionSurface && "border-t border-border/70",
        )}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="font-serif text-lg font-semibold tracking-tight text-foreground">
            Purchased credits
          </h3>
          <p className="text-xs text-muted-foreground">
            Amounts added, not current balance.
          </p>
        </div>

        {props.activity.credits.length === 0 ? (
          <p className="pt-4 text-sm text-muted-foreground">
            No purchased credits yet.
          </p>
        ) : (
          <ul
            aria-label="Purchased usage credits"
            className="mt-4 divide-y divide-border/70 border-t border-border/70"
          >
            {props.activity.credits.map((credit) => (
              <li
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3.5"
                key={credit.id}
              >
                <div className="min-w-0">
                  <div className="font-medium text-foreground">
                    {credit.sourceLabel}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {credit.dateLabel}
                  </div>
                </div>
                <div className="font-serif font-semibold tabular-nums text-foreground">
                  {credit.addedLabel}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function missionStatusBadgeVariant(
  status: HostedAiUsageMissionActivityStatus,
): "default" | "outline" | "secondary" {
  if (status === "completed") {
    return "default";
  }
  if (status === "waiting_for_group") {
    return "outline";
  }
  return "secondary";
}
