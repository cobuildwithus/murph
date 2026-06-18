import { CheckCircle2, Clock3, Monitor } from "lucide-react";

import { Button } from "@/src/components/ui/button";
import { createComputerUseService } from "@/src/lib/computer-use/service";
import { requireActiveHostedAppSession } from "@/src/lib/hosted-onboarding/app-session";

export default async function ComputerHandoffPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [{ token }, session] = await Promise.all([
    params,
    requireActiveHostedAppSession(),
  ]);
  const service = createComputerUseService();
  const state = await service.readHandoffPageState({
    memberId: session.member.id,
    token,
  });

  if (state.kind === "completed" || state.kind === "expired") {
    const Icon = state.kind === "completed" ? CheckCircle2 : Clock3;
    const title = state.kind === "completed"
      ? "Browser step saved"
      : "Browser handoff expired";
    const iconClassName = state.kind === "completed"
      ? "mb-4 h-8 w-8 text-primary"
      : "mb-4 h-8 w-8 text-muted-foreground";
    const nextStep = state.kind === "completed"
      ? "Return to Murph and reply done so the browser run can continue."
      : "Return to Murph and ask to restart this browser step.";

    return (
      <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
        <section className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center">
          <div className="rounded-lg border border-border bg-card p-6">
            <Icon className={iconClassName} aria-hidden="true" />
            <h1 className="font-serif text-3xl">{title}</h1>
            {state.suggestedReply ? (
              <div className="mt-6 rounded-md border border-border bg-background p-4">
                <div className="mb-2 text-sm font-medium text-muted-foreground">
                  Reply in Murph
                </div>
                <p className="whitespace-pre-wrap break-words font-mono text-sm text-foreground">
                  {state.suggestedReply}
                </p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">{nextStep}</p>
            )}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-4 py-4 text-foreground sm:px-6 sm:py-6">
      <section className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-6xl flex-col gap-4 sm:min-h-[calc(100vh-3rem)]">
        <header className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background">
              <Monitor className="h-5 w-5 text-primary" aria-hidden="true" />
            </span>
            <div>
              <h1 className="font-serif text-2xl leading-tight">Finish the browser step</h1>
              <p className="text-sm text-muted-foreground">
                Complete this page, click Done, then return to Murph and reply.
              </p>
            </div>
          </div>
          <form action={`/api/computer/handoff/${encodeURIComponent(token)}/done`} method="post">
            <Button type="submit" size="lg">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Done
            </Button>
          </form>
        </header>
        <iframe
          allow={state.iframeAllow}
          className="min-h-[68vh] flex-1 rounded-lg border border-border bg-card"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
          src={state.liveViewUrl}
          title="Murph browser handoff"
        />
      </section>
    </main>
  );
}
