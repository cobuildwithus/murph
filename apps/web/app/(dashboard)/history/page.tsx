export default function HistoryPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          History
        </span>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
          Experiment History
        </h1>
      </div>
      <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Coming soon. View your past experiments and results.
      </div>
    </div>
  );
}
