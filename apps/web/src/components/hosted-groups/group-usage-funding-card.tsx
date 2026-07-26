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

type GroupUsageFundingCardProps = {
  action: React.ReactNode;
  groupName: string;
};

function GroupUsageFundingCard({
  action,
  groupName,
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
            Add messages for everyone in the chat.
          </CardDescription>
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

export { GroupUsageFundingCard };
export type { GroupUsageFundingCardProps };
