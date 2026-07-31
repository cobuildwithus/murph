import Link from "next/link";

import { buttonVariants } from "@/src/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";
import { cn } from "@/src/lib/utils";

const GROUP_USAGE_FUNDING_HEALTHY_STATUS_LABEL =
  "This chat has enough Murph time right now.";

type GroupUsageFundingCardProps = {
  action: React.ReactNode;
  groupName: string;
  statusLabel?: string;
};

type GroupUsageFundingActionsProps = {
  monthlyAction?: React.ReactNode;
  oneTimeAction: React.ReactNode;
};

function GroupUsageFundingActions({
  monthlyAction,
  oneTimeAction,
}: GroupUsageFundingActionsProps) {
  return (
    <div className="space-y-3">
      {monthlyAction}
      {monthlyAction ? (
        <p className="text-center text-xs leading-5 text-muted-foreground">
          Starts with $5. Murph adds another $5 only when this group needs it,
          up to the maximum you choose.
        </p>
      ) : null}
      {oneTimeAction}
    </div>
  );
}

function GroupUsageFundingCard({
  action,
  groupName,
  statusLabel,
}: GroupUsageFundingCardProps) {
  return (
    <Card className="gap-5 py-6 sm:py-8">
      <CardHeader className="px-6 sm:px-8">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-muted-foreground">{groupName}</p>
          <CardTitle>
            <h1 className="text-balance font-serif text-3xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-4xl">
              Keep Murph going
            </h1>
          </CardTitle>
          <CardDescription className="max-w-md text-pretty text-base leading-7">
            Add cost-weighted usage credit for the group. Monthly sponsorship
            charges only in $5 increments when the group needs more, up to the
            maximum you choose.
          </CardDescription>
          {statusLabel ? (
            <p className="text-sm font-medium text-foreground">
              {statusLabel}
            </p>
          ) : null}
        </div>
      </CardHeader>
      <CardFooter className="flex-col items-stretch gap-2 px-6 py-5 sm:px-8 sm:py-6">
        {action}
        <Link
          className={cn(buttonVariants({ size: "lg", variant: "ghost" }), "w-full")}
          href="/home"
        >
          Go home
        </Link>
      </CardFooter>
    </Card>
  );
}

export {
  GROUP_USAGE_FUNDING_HEALTHY_STATUS_LABEL,
  GroupUsageFundingActions,
  GroupUsageFundingCard,
};
export type {
  GroupUsageFundingActionsProps,
  GroupUsageFundingCardProps,
};
