import { CheckCircle2, Clock3 } from "lucide-react";
import { redirect } from "next/navigation";

import { ComputerHandoffActiveView } from "@/src/components/computer-use/computer-handoff-active-view";
import { ComputerHandoffAuthRequiredState } from "@/src/components/computer-use/computer-handoff-auth-required";
import { ComputerHandoffReplyAction } from "@/src/components/computer-use/computer-handoff-reply-action";
import { resolveHostedMurphContactOptions } from "@/src/components/murph/hosted-murph-contact-action";
import { buttonVariants } from "@/src/components/ui/button";
import { createComputerUseService } from "@/src/lib/computer-use/service";
import { requireHostedAppSession } from "@/src/lib/hosted-onboarding/app-session";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import type { MurphContactKind, MurphContactOption } from "@/src/lib/murph-contact-routing";
import { cn } from "@/src/lib/utils";

const HANDOFF_DONE_REPLY_BODY = "Done";
type HandoffSearchParams = {
  managed?: string | string[];
};

export default async function ComputerHandoffPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<HandoffSearchParams>;
}) {
  const { token } = await params;
  const resolvedSearchParams = await (searchParams ?? Promise.resolve({}));
  const managedState = readManagedHandoffState(resolvedSearchParams);
  const session = await readHandoffSessionOrAuthState();
  if (!session) {
    return <ComputerHandoffAuthRequiredState />;
  }

  const service = createComputerUseService();
  const state = await service.readHandoffPageState({
    memberId: session.member.id,
    token,
  });

  const managedEndpoint =
    `/api/computer/handoff/${encodeURIComponent(token)}/managed-login`;

  if (state.kind === "managed_login") {
    if (managedState !== "retry" && managedState !== "waiting") {
      redirect(managedEndpoint);
    }
    const isRetry = managedState === "retry";
    return (
      <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
        <section className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center">
          <div className="rounded-2xl border border-border bg-card p-6">
            <Clock3 className="mb-4 h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <h1 className="font-serif text-3xl text-balance">
              {isRetry ? "Secure sign-in could not start" : "Finishing secure sign-in"}
            </h1>
            <p className="mt-4 text-sm text-muted-foreground text-pretty">
              {isRetry
                ? "Try again. If the site still cannot connect, return to Murph and ask for a live browser link."
                : "Kernel is still finishing this sign-in. Check again in a moment."}
            </p>
            <a
              href={managedEndpoint}
              className={cn(buttonVariants({ size: "lg" }), "mt-6 inline-flex")}
            >
              {isRetry ? "Try again" : "Check again"}
            </a>
          </div>
        </section>
      </main>
    );
  }

  if (
    state.kind === "checkpointing" &&
    state.purpose === "managed_login" &&
    managedState === "retry"
  ) {
    return (
      <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
        <section className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center">
          <div className="rounded-2xl border border-border bg-card p-6">
            <Clock3 className="mb-4 h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <h1 className="font-serif text-3xl text-balance">
              Secure sign-in could not start
            </h1>
            <p className="mt-4 text-sm text-muted-foreground text-pretty">
              The secure sign-in provider could not connect. Return to Murph and ask for a live browser link.
            </p>
            <a
              href="/home"
              className={cn(buttonVariants({ size: "lg" }), "mt-6 inline-flex")}
            >
              Return to Murph
            </a>
          </div>
        </section>
      </main>
    );
  }

  if (
    state.kind === "completed" ||
    state.kind === "checkpointing" ||
    state.kind === "expired"
  ) {
    const isCompleted = state.kind === "completed";
    const canSendDoneReply = isCompleted;
    const isEmailReturn = isCompleted && state.returnContactKind === "email";
    const Icon = isCompleted ? CheckCircle2 : Clock3;
    const title = isCompleted
      ? "All set"
      : state.kind === "checkpointing"
        ? "Saving your progress"
        : "This link expired";
    const iconClassName = isCompleted
      ? "mb-4 h-8 w-8 text-primary"
      : "mb-4 h-8 w-8 text-muted-foreground";
    const nextStep = isEmailReturn
      ? "Reply with Done in your existing Murph email thread to continue."
      : isCompleted
        ? "Reply to Murph to continue."
      : state.kind === "checkpointing"
        ? "Keep this tab open for a moment, then return to Murph when saving finishes."
        : "Return to Murph and ask for a new link.";
    const contactOptions = canSendDoneReply && !isEmailReturn
      ? await resolveCompletedHandoffContactOptions(state.returnContactKind)
      : [];

    return (
      <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
        <section className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center">
          <div className="rounded-2xl border border-border bg-card p-6">
            <Icon className={iconClassName} aria-hidden="true" />
            <h1 className="font-serif text-3xl text-balance">{title}</h1>
            <p className="mt-4 text-sm text-muted-foreground text-pretty">{nextStep}</p>
            {isEmailReturn ? (
              <div className="mt-6 border-t border-border pt-4">
                <p className="text-sm text-muted-foreground">
                  Reply in the existing email thread with:
                </p>
                <p className="mt-3 break-words font-mono text-sm text-foreground">
                  {HANDOFF_DONE_REPLY_BODY}
                </p>
              </div>
            ) : contactOptions.length > 0 ? (
              <div className="mt-6">
                <ComputerHandoffReplyAction options={contactOptions} />
              </div>
            ) : canSendDoneReply ? (
              <div className="mt-6 border-t border-border pt-4">
                <p className="text-sm text-muted-foreground">
                  Reply with:
                </p>
                <p className="mt-3 break-words font-mono text-sm text-foreground">
                  {HANDOFF_DONE_REPLY_BODY}
                </p>
              </div>
            ) : null}
          </div>
        </section>
      </main>
    );
  }

  const encodedToken = encodeURIComponent(token);
  const doneEndpoint = `/api/computer/handoff/${encodedToken}/done`;

  return (
    <main className="relative min-h-dvh bg-foreground text-foreground">
      <ComputerHandoffActiveView
        doneEndpoint={doneEndpoint}
        iframeAllow={state.iframeAllow}
        liveViewUrl={state.liveViewUrl}
      />
    </main>
  );
}

function readManagedHandoffState(
  searchParams: HandoffSearchParams,
): "retry" | "waiting" | null {
  const value = Array.isArray(searchParams.managed)
    ? searchParams.managed[0]
    : searchParams.managed;
  return value === "retry" ||
      value === "waiting"
    ? value
    : null;
}

async function readHandoffSessionOrAuthState() {
  try {
    return await requireHostedAppSession();
  } catch (error) {
    if (
      isHostedOnboardingError(error)
      && error.code === "AUTH_REQUIRED"
      && error.httpStatus === 401
    ) {
      return null;
    }

    throw error;
  }
}

async function resolveCompletedHandoffContactOptions(
  returnContactKind: MurphContactKind | null,
): Promise<MurphContactOption[]> {
  let options: MurphContactOption[];
  try {
    options = await resolveHostedMurphContactOptions({
      message: { body: HANDOFF_DONE_REPLY_BODY },
      preferredKind: returnContactKind,
    });
  } catch {
    return [];
  }
  return returnContactKind
    ? options.filter((option) => option.kind === returnContactKind)
    : options;
}
