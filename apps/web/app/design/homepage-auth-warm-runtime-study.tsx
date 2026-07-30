import { HostedPrivyReadinessState } from "@/src/components/hosted-onboarding/hosted-auth-panel-island";

export function HomepageAuthWarmRuntimeStudy() {
  return (
    <div
      className="grid gap-5 lg:grid-cols-2"
      data-design-section="homepage-auth-warm-runtime"
      id="homepage-auth-warm-runtime"
    >
      <div className="rounded-2xl border border-border bg-card p-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Idle warmup
        </p>
        <h3 className="mt-3 font-serif text-2xl font-semibold tracking-tight text-foreground">
          Ready before the click
        </h3>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          After the homepage paints, the shared Privy provider may initialize in
          the background. The dialog, authentication controls, and CAPTCHA stay
          unmounted until someone chooses Log in or Signup.
        </p>
      </div>
      <div className="rounded-2xl border border-border bg-card p-6" inert>
        <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Early click fallback
        </p>
        <HostedPrivyReadinessState
          onKeepWaiting={() => {}}
          onRestart={() => {}}
          restartAvailable={false}
          timedOut={false}
        />
      </div>
    </div>
  );
}
