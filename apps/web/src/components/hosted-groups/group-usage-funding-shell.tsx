import Link from "next/link";

import { buttonVariants } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";

type GroupUsageFundingShellProps = {
  action: React.ReactNode;
  groupName: string;
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
    <div>
      {monthlyAction}
      {oneTimeAction}
    </div>
  );
}

function GroupUsageFundingShell({
  action,
  groupName,
}: GroupUsageFundingShellProps) {
  return (
    <section className="mx-auto w-full">
      <h1 className="mb-8 space-y-2">
        <span className="block font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
          Support Murph in
        </span>
        <span className="block break-words font-serif text-3xl font-semibold leading-[1.15] tracking-[-0.02em] text-balance">
          {groupName}
        </span>
      </h1>
      {action}
      <div className="mt-3 text-center">
        <Link
          className={cn(
            buttonVariants({ size: "sm", variant: "link" }),
            "text-muted-foreground",
          )}
          href="/home"
        >
          Back to Murph
        </Link>
      </div>
    </section>
  );
}

export {
  GroupUsageFundingActions,
  GroupUsageFundingShell,
};
export type {
  GroupUsageFundingActionsProps,
  GroupUsageFundingShellProps,
};
