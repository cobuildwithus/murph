export function EnvironmentReportSkeleton() {
  return (
    <section
      aria-busy="true"
      aria-live="polite"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="border-b border-border px-5 py-5 sm:px-7">
        <p className="font-serif text-xl font-semibold text-foreground">
          Preparing your report
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Murph is unlocking your private Environment details.
        </p>
      </div>

      <div className="grid border-b border-border sm:grid-cols-2">
        <div className="space-y-3 px-5 py-6 sm:border-r sm:px-7">
          <SkeletonLine className="w-24" />
          <SkeletonLine className="h-8 w-40" />
          <SkeletonLine className="w-56 max-w-full" />
        </div>
        <div className="space-y-3 border-t border-border px-5 py-6 sm:border-t-0 sm:px-7">
          <div className="flex items-center justify-between gap-5">
            <SkeletonLine className="w-32" />
            <SkeletonLine className="h-7 w-12" />
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary/50">
            <div className="h-full w-2/5 animate-pulse rounded-full bg-primary/35 motion-reduce:animate-none" />
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-7">
        <SkeletonSection />
        <SkeletonSection />
      </div>

    </section>
  );
}

function SkeletonSection() {
  return (
    <div className="rounded-lg border border-border p-4">
      <SkeletonLine className="h-5 w-28" />
      <div className="mt-5 space-y-3">
        <SkeletonLine className="w-full" />
        <SkeletonLine className="w-5/6" />
        <SkeletonLine className="w-2/3" />
      </div>
    </div>
  );
}

function SkeletonLine({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block h-3 animate-pulse rounded-full bg-secondary/60 motion-reduce:animate-none ${className}`}
    />
  );
}
