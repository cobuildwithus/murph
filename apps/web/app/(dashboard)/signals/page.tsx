export default function SignalsPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Signals
        </span>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
          Your Signals
        </h1>
      </div>
      <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Coming soon. Track your biometric signals over time.
      </div>
    </div>
  );
}
