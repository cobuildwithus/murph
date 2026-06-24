import { CheckCircle2, Clock3 } from "lucide-react";
import { headers } from "next/headers";

import { ComputerHandoffActiveView } from "@/src/components/computer-use/computer-handoff-active-view";
import { ComputerHandoffAuthRequiredState } from "@/src/components/computer-use/computer-handoff-auth-required";
import { resolveHostedMurphContactOptions } from "@/src/components/murph/hosted-murph-contact-action";
import { MurphContactLink } from "@/src/components/murph/murph-contact-link";
import { buttonVariants } from "@/src/components/ui/button";
import { createComputerUseService } from "@/src/lib/computer-use/service";
import { resolveComputerBrowserViewportPreset } from "@/src/lib/computer-use/viewport";
import { requireActiveHostedAppSession } from "@/src/lib/hosted-onboarding/app-session";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { cn } from "@/src/lib/utils";

const HANDOFF_DONE_REPLY_BODY = "Done";
const HANDOFF_VIEWPORT_SSR_TIMEOUT_MS = 5_000;

export default async function ComputerHandoffPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await readHandoffSessionOrAuthState();
  if (!session) {
    return <ComputerHandoffAuthRequiredState />;
  }

  const service = createComputerUseService();
  const state = await service.readHandoffPageState({
    memberId: session.member.id,
    token,
  });

  if (
    state.kind === "completed" ||
    state.kind === "checkpointing" ||
    state.kind === "expired"
  ) {
    const isCompleted = state.kind === "completed";
    const Icon = isCompleted ? CheckCircle2 : Clock3;
    const title = isCompleted
      ? "All set"
      : state.kind === "checkpointing"
        ? "Saving your progress"
        : "This link expired";
    const iconClassName = isCompleted
      ? "mb-4 h-8 w-8 text-primary"
      : "mb-4 h-8 w-8 text-muted-foreground";
    const nextStep = isCompleted
      ? "Reply to Murph to continue."
      : state.kind === "checkpointing"
        ? "Keep this tab open for a moment, then return to Murph when saving finishes."
        : "Return to Murph and ask for a new link.";
    const contactOptions = isCompleted
      ? await resolveHostedMurphContactOptions({
          message: { body: HANDOFF_DONE_REPLY_BODY },
        })
      : [];

    return (
      <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
        <section className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center">
          <div className="rounded-2xl border border-border bg-card p-6">
            <Icon className={iconClassName} aria-hidden="true" />
            <h1 className="font-serif text-3xl text-balance">{title}</h1>
            <p className="mt-4 text-sm text-muted-foreground text-pretty">{nextStep}</p>
            {contactOptions.length > 0 ? (
              <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {contactOptions.map((option) => (
                  <MurphContactLink
                    key={`${option.kind}:${option.href}`}
                    actionLabel="Reply to Murph"
                    option={option}
                    className={cn(
                      buttonVariants({ size: "lg" }),
                      "w-full sm:w-auto",
                    )}
                  >
                    Reply in {option.label}
                  </MurphContactLink>
                ))}
              </div>
            ) : isCompleted ? (
              <div className="mt-6 border-t border-border pt-4">
                <p className="text-sm text-muted-foreground">
                  Return to your Murph thread and reply with:
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

  const preset = resolveComputerBrowserViewportPreset(
    (await headers()).get("user-agent"),
  );
  try {
    await Promise.race([
      service.ensureHandoffViewport({
        memberId: session.member.id,
        preset,
        token,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("viewport resize timed out")),
          HANDOFF_VIEWPORT_SSR_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    console.warn("[computer-handoff] viewport resize failed", error);
  }

  const doneEndpoint = `/api/computer/handoff/${encodeURIComponent(token)}/done`;

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

async function readHandoffSessionOrAuthState() {
  try {
    return await requireActiveHostedAppSession();
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
