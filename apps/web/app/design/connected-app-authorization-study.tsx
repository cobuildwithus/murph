import { Link2 } from "lucide-react";

import { IntegrationsConnectLauncherView } from "@/src/components/connected-apps/integrations-connect-launcher";

const launcherStates = [
  { label: "Waiting", state: "waiting" },
  { label: "Connecting", state: "connecting" },
  { label: "Failed", state: "failed" },
] as const;

export function ConnectedAppAuthorizationStudy() {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-border bg-background"
      data-design-section="connected-app-authorization-handoff"
      id="connected-app-authorization-handoff"
      inert
    >
      <div className="grid gap-px bg-border lg:grid-cols-3">
        {launcherStates.map(({ label, state }) => (
          <article className="bg-background text-foreground" key={state}>
            <p className="border-b border-border px-4 py-3 font-mono text-xs uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            <div className="min-h-[680px] px-4 py-8 sm:px-6">
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
                <IntegrationsConnectLauncherView state={state} />
              </section>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
