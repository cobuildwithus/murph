import { Skeleton } from "@/src/components/ui/skeleton";

const CHART_POINTS = [
  { cx: 4, cy: 72 },
  { cx: 26, cy: 58 },
  { cx: 49, cy: 64 },
  { cx: 72, cy: 35 },
  { cx: 96, cy: 22 },
] as const;

export function BiomarkerDetailSkeleton() {
  return (
    <div aria-label="Loading biomarker history" className="flex flex-col gap-8" role="status">
      <section
        aria-hidden="true"
        className="overflow-hidden rounded-xl border border-border/70 bg-card/70"
      >
        <div className="grid lg:grid-cols-[minmax(17rem,0.72fr)_minmax(0,1.28fr)]">
          <div className="px-5 py-8 sm:px-8 sm:py-10 lg:border-r lg:border-border/70">
            <Skeleton className="h-3 w-24 motion-reduce:animate-none" />
            <Skeleton className="mt-5 h-7 w-28 motion-reduce:animate-none" />
            <div className="mt-3 flex items-center gap-3">
              <Skeleton className="size-3 shrink-0 rounded-full motion-reduce:animate-none" />
              <Skeleton className="h-12 w-32 motion-reduce:animate-none" />
              <Skeleton className="h-6 w-12 motion-reduce:animate-none" />
            </div>
            <Skeleton className="mt-4 h-4 w-28 motion-reduce:animate-none" />
            <Skeleton className="mt-2 h-3 w-24 motion-reduce:animate-none" />
          </div>

          <div className="min-w-0 border-t border-border/70 px-5 py-8 sm:px-8 sm:py-10 lg:border-t-0">
            <div
              className="relative h-72 min-w-0 overflow-hidden sm:h-80"
              data-biomarker-skeleton="chart"
            >
              <div className="absolute inset-x-0 top-0 flex items-center gap-2">
                <Skeleton className="h-2 w-5 motion-reduce:animate-none" />
                <Skeleton className="h-3 w-24 motion-reduce:animate-none" />
                <Skeleton className="h-3 w-16 motion-reduce:animate-none" />
              </div>
              <div className="absolute inset-x-8 bottom-9 top-11 flex flex-col justify-between">
                {[0, 1, 2, 3].map((line) => (
                  <span className="border-t border-dashed border-border/60" key={line} />
                ))}
              </div>
              <svg
                aria-hidden="true"
                className="absolute inset-x-8 bottom-9 top-11 h-[calc(100%_-_5rem)] w-[calc(100%_-_4rem)] text-muted-foreground/35"
                preserveAspectRatio="none"
                viewBox="0 0 100 100"
              >
                <path
                  d="M4 72 L26 58 L49 64 L72 35 L96 22"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
                {CHART_POINTS.map((point) => (
                  <circle
                    cx={point.cx}
                    cy={point.cy}
                    fill="var(--background)"
                    key={`${point.cx}-${point.cy}`}
                    r="2.25"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                ))}
              </svg>
              <div className="absolute inset-x-8 bottom-0 flex justify-between">
                <Skeleton className="h-3 w-14 motion-reduce:animate-none" />
                <Skeleton className="h-3 w-14 motion-reduce:animate-none" />
                <Skeleton className="h-3 w-14 motion-reduce:animate-none" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section aria-hidden="true" className="flex flex-col gap-6">
        <Skeleton className="h-8 w-28 motion-reduce:animate-none" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-3 w-12 motion-reduce:animate-none" />
          <div className="overflow-hidden rounded-xl border border-border/70 bg-card/90">
            <div className="hidden grid-cols-[8rem_minmax(9rem,0.8fr)_minmax(12rem,1.2fr)_minmax(10rem,1fr)] gap-4 border-b border-border/60 bg-muted/20 px-5 py-2 xl:grid">
              {["date", "result", "range", "source"].map((column) => (
                <Skeleton
                  className="h-3 w-16 motion-reduce:animate-none"
                  key={column}
                />
              ))}
            </div>
            {[0, 1, 2].map((item) => (
              <div
                className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-2 border-b border-border/60 px-4 py-4 last:border-b-0 sm:px-5 xl:grid-cols-[8rem_minmax(9rem,0.8fr)_minmax(12rem,1.2fr)_minmax(10rem,1fr)] xl:gap-4"
                key={item}
              >
                <Skeleton className="order-1 h-6 w-28 motion-reduce:animate-none xl:order-none" />
                <Skeleton className="order-2 h-4 w-20 justify-self-end motion-reduce:animate-none xl:-order-1 xl:justify-self-start" />
                <div className="order-3 col-span-2 flex gap-3 xl:contents">
                  <Skeleton className="h-3 w-36 motion-reduce:animate-none" />
                  <Skeleton className="h-3 w-24 motion-reduce:animate-none" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <span className="sr-only">Loading this biomarker&apos;s saved results.</span>
    </div>
  );
}
