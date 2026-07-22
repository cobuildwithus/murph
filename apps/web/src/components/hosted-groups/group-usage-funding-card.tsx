import Link from "next/link";

import { Badge } from "@/src/components/ui/badge";
import { buttonVariants } from "@/src/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";
import { cn } from "@/src/lib/utils";

type GroupUsageFundingCardProps = {
  action: React.ReactNode;
  capacityLabel: string;
  groupName: string;
};

function GroupUsageFundingCard({
  action,
  capacityLabel,
  groupName,
}: GroupUsageFundingCardProps) {
  return (
    <Card className="gap-5 py-6 sm:py-8">
      <CardHeader className="gap-4 px-6 sm:px-8">
        <Badge
          variant="secondary"
          className="w-fit font-mono text-[10px] uppercase tracking-[0.12em]"
        >
          Group usage · {capacityLabel}
        </Badge>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-muted-foreground">{groupName}</p>
          <CardTitle>
            <h1 className="text-balance font-serif text-3xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-4xl">
              Add group credit
            </h1>
          </CardTitle>
          <CardDescription className="max-w-md text-pretty text-base leading-7">
            One-time credit belongs to this group. Personal plans stay unchanged.
          </CardDescription>
        </div>
      </CardHeader>
      <CardFooter className="flex-col items-stretch gap-2 px-6 py-5 sm:px-8 sm:py-6">
        {action}
        <Link
          className={cn(buttonVariants({ size: "lg", variant: "ghost" }), "w-full")}
          href="/home"
        >
          Open Murph
        </Link>
      </CardFooter>
    </Card>
  );
}

export { GroupUsageFundingCard };
export type { GroupUsageFundingCardProps };
