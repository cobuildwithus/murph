import { MessageCircle } from "lucide-react";

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
  const heading = hasMissionSurface ? "Credits & missions" : "Usage credits";
  const description = canStartMissions
    ? "Credits extend the usage included in your plan automatically. Missions are optional and only start after you choose one with Murph."
    : hasMissionSurface
      ? "Credits extend the usage included in your plan automatically. Your existing mission activity remains below."
      : "One-time credits extend the usage included in your plan automatically.";

  return (
    <div
      className="overflow-hidden rounded-xl border border-border bg-card"
      data-hosted-ai-usage-activity
    >
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="max-w-2xl">
          <h3 className="font-serif text-xl font-semibold tracking-tight text-foreground">
            {heading}
          </h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
        {canStartMissions && props.missionContactOption ? (
          <MurphContactLink
            actionLabel="Ask Murph about usage missions"
            className={cn(
              buttonVariants({ size: "default" }),
              "w-full sm:w-auto",
            )}
            option={props.missionContactOption}
          >
            <MessageCircle aria-hidden="true" />
            Ask Murph
          </MurphContactLink>
        ) : null}
      </div>

      <section className="border-t border-border/70 px-5 py-5 sm:px-6">
        <div>
          <h4 className="font-serif text-lg font-semibold tracking-tight text-foreground">
            Recent usage credits
          </h4>
          <p className="mt-1 text-sm text-muted-foreground">
            One-time credits added to your Murph. Amounts show what was added,
            not what remains.
          </p>
        </div>
        <div className="mt-4">
          <table aria-label="Recent usage credits" className="w-full text-sm">
            <thead className="hidden md:table-header-group">
              <tr className="border-b border-border/70 text-left">
                <th className={TABLE_HEADING_CLASS}>Source</th>
                <th className={cn(TABLE_HEADING_CLASS, "text-right")}>Added</th>
                <th className={cn(TABLE_HEADING_CLASS, "text-right")}>Date</th>
              </tr>
            </thead>
            <tbody className="block divide-y divide-border/70 md:table-row-group">
              {props.activity.credits.length === 0 ? (
                <tr className="block md:table-row">
                  <td
                    className="block py-5 text-muted-foreground md:table-cell"
                    colSpan={3}
                  >
                    No usage credits yet.
                  </td>
                </tr>
              ) : (
                props.activity.credits.map((credit) => (
                  <tr
                    className="grid grid-cols-2 gap-x-4 gap-y-3 py-4 md:table-row md:py-0"
                    key={credit.id}
                  >
                    <td className="col-span-2 block min-w-0 md:table-cell md:py-4 md:pr-4">
                      <span className="font-medium text-foreground">
                        {credit.sourceLabel}
                      </span>
                    </td>
                    <td className="block align-top md:table-cell md:py-4 md:text-right">
                      <MobileTableLabel>Added</MobileTableLabel>
                      <span className="font-serif font-semibold tabular-nums text-foreground">
                        {credit.addedLabel}
                      </span>
                    </td>
                    <td className="block align-top text-right text-muted-foreground md:table-cell md:py-4">
                      <MobileTableLabel>Date</MobileTableLabel>
                      {credit.dateLabel}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {hasMissionSurface ? (
        <section className="border-t border-border/70 px-5 py-5 sm:px-6">
          <div>
            <h4 className="font-serif text-lg font-semibold tracking-tight text-foreground">
              Missions
            </h4>
            <p className="mt-1 text-sm text-muted-foreground">
              {canStartMissions
                ? "Ask Murph what is available. A mission starts only after you choose one, and its reward is included in your overall AI usage."
                : "New missions are not available. Your existing activity remains here for reference."}
            </p>
          </div>
          <div className="mt-4">
            <table
              aria-label="Usage missions"
              className="w-full text-sm md:table-fixed"
            >
              <thead className="hidden md:table-header-group">
                <tr className="border-b border-border/70 text-left">
                  <th className={cn(TABLE_HEADING_CLASS, "md:w-1/2")}>
                    Mission
                  </th>
                  <th className={cn(TABLE_HEADING_CLASS, "md:w-[22%]")}>
                    Status
                  </th>
                  <th
                    className={cn(
                      TABLE_HEADING_CLASS,
                      "pr-4 text-right md:w-[12%]",
                    )}
                  >
                    Reward
                  </th>
                  <th
                    className={cn(
                      TABLE_HEADING_CLASS,
                      "text-right md:w-[16%]",
                    )}
                  >
                    Selected
                  </th>
                </tr>
              </thead>
              <tbody className="block divide-y divide-border/70 md:table-row-group">
                {props.activity.missions.length === 0 ? (
                  <tr className="block md:table-row">
                    <td
                      className="block py-5 text-muted-foreground md:table-cell"
                      colSpan={4}
                    >
                      No missions yet.
                    </td>
                  </tr>
                ) : (
                  props.activity.missions.map((mission) => (
                    <tr
                      className="grid grid-cols-2 gap-x-4 gap-y-4 py-4 md:table-row md:py-0"
                      key={mission.id}
                    >
                      <td className="col-span-2 block min-w-0 md:table-cell md:max-w-md md:py-4 md:pr-5">
                        <div className="font-medium text-foreground">
                          {mission.title}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                          {mission.requirementsLabel}
                        </div>
                        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                          Reward goes to {mission.destinationLabel}
                        </div>
                      </td>
                      <td className="block align-top md:table-cell md:py-4 md:pr-4">
                        <MobileTableLabel>Status</MobileTableLabel>
                        <div className="flex flex-col items-start gap-1.5">
                          <Badge
                            variant={missionStatusBadgeVariant(mission.status)}
                          >
                            {mission.statusLabel}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {mission.timingLabel}
                          </span>
                        </div>
                      </td>
                      <td className="block align-top md:table-cell md:py-4 md:pr-4 md:text-right">
                        <MobileTableLabel>Reward</MobileTableLabel>
                        <span className="font-serif font-semibold tabular-nums text-foreground">
                          {mission.rewardLabel}
                        </span>
                      </td>
                      <td className="col-span-2 block align-top text-muted-foreground md:table-cell md:py-4 md:text-right">
                        <MobileTableLabel>Selected</MobileTableLabel>
                        {mission.selectedLabel}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

const TABLE_HEADING_CLASS =
  "pb-2 pr-4 font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground last:pr-0";

function MobileTableLabel({ children }: { children: string }) {
  return (
    <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground md:hidden">
      {children}
    </span>
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
