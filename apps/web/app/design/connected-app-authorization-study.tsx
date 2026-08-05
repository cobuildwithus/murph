import { Link2 } from "lucide-react";

import { IntegrationsConnectLauncherView } from "@/src/components/connected-apps/integrations-connect-launcher";

export function ConnectedAppAuthorizationStudy() {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-border bg-background"
      data-design-section="connected-app-authorization-handoff"
      id="connected-app-authorization-handoff"
      inert
    >
      <main className="min-h-[680px] bg-background px-4 py-8 text-foreground sm:px-6">
        <section className="mx-auto flex min-h-[620px] max-w-xl flex-col items-center justify-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-card">
            <Link2 className="h-6 w-6 text-primary" aria-hidden="true" />
          </span>
          <p className="mt-6 font-mono text-xs uppercase tracking-wide text-muted-foreground">
            Connected apps
          </p>
          <h2 className="mt-3 font-serif text-3xl leading-tight text-balance break-words sm:text-4xl">
            Connect Gmail
          </h2>
          <p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground text-pretty break-words">
            Murph uses Composio to securely connect Gmail. On the next screen, you’ll review and approve access.
          </p>
          <IntegrationsConnectLauncherView
            secondsRemaining={5}
            state="waiting"
          />
        </section>
      </main>
    </div>
  );
}
