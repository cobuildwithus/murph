import type { ReactNode, Ref } from "react";
import { CheckIcon } from "lucide-react";

import { Spinner } from "@/src/components/ui/spinner";
import { cn } from "@/src/lib/utils";

type GroupFundingStatusTone = "attention" | "done" | "working";

function GroupFundingPage({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col px-6 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-[max(env(safe-area-inset-top),2.5rem)]">
      {children}
    </main>
  );
}

function GroupUsageFundingShell({
  children,
  groupName,
}: {
  children: ReactNode;
  groupName: string;
}) {
  return (
    <section className="flex w-full flex-1 flex-col gap-6">
      <h1 className="space-y-2 text-center">
        <span className="block font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
          Support Murph in
        </span>
        <span className="block break-words font-serif text-3xl font-semibold leading-[1.15] tracking-[-0.02em] text-balance">
          {groupName}
        </span>
      </h1>
      {children}
    </section>
  );
}

function GroupFundingMessage({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="flex w-full flex-1 flex-col justify-center gap-8 text-center">
      <div className="space-y-3">
        <h1 className="font-serif text-3xl font-semibold leading-[1.15] tracking-[-0.02em] text-balance">
          {title}
        </h1>
        <p className="text-base/6 text-pretty text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </section>
  );
}

function GroupFundingNotice({
  action,
  description,
  ref,
  title,
  tone = "neutral",
}: {
  action?: ReactNode;
  description: string;
  /** Pass a ref to move focus to the notice; it becomes focusable by script. */
  ref?: Ref<HTMLDivElement>;
  title: string;
  tone?: "attention" | "neutral";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl px-4 py-3.5 outline-none",
        tone === "attention" ? "bg-destructive/[0.07]" : "bg-muted",
      )}
      data-slot="group-funding-notice"
      data-tone={tone}
      ref={ref}
      role={tone === "attention" ? "alert" : "status"}
      tabIndex={ref ? -1 : undefined}
    >
      <p
        className={cn(
          "text-sm/5 font-semibold",
          tone === "attention" ? "text-destructive" : "text-foreground",
        )}
      >
        {title}
      </p>
      <p className="mt-0.5 text-sm/5 text-pretty text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

function GroupFundingStatusView({
  children,
  error,
  message,
  title,
  tone,
}: {
  children?: ReactNode;
  error?: string | null;
  message: string;
  title: string;
  tone: GroupFundingStatusTone;
}) {
  return (
    <div
      className="flex flex-1 flex-col"
      data-slot="group-funding-status"
      data-tone={tone}
    >
      <div
        aria-live="polite"
        className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center"
        role="status"
      >
        {tone === "working" ? (
          <Spinner className="mb-2 size-6 text-primary" />
        ) : tone === "done" ? (
          <span className="mb-2 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <CheckIcon aria-hidden="true" className="size-6 stroke-[2.5]" />
          </span>
        ) : null}
        <h2 className="font-serif text-2xl/8 font-semibold text-balance tracking-[-0.01em]">
          {title}
        </h2>
        <p className="max-w-[32ch] text-base/6 text-pretty text-muted-foreground">
          {message}
        </p>
      </div>
      {error ? (
        <p className="pb-3 text-center text-sm/5 text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {children ? <div className="flex flex-col gap-2">{children}</div> : null}
    </div>
  );
}

export {
  GroupFundingMessage,
  GroupFundingNotice,
  GroupFundingPage,
  GroupFundingStatusView,
  GroupUsageFundingShell,
};
export type { GroupFundingStatusTone };
