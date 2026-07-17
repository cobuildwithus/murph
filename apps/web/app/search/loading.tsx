import { Skeleton } from "@/src/components/ui/skeleton";

export default function MurphSafeLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8 sm:py-20" aria-busy="true" aria-label="Loading Murph Safe">
      <Skeleton className="h-3 w-36" />
      <Skeleton className="mt-6 h-12 w-full max-w-2xl" />
      <Skeleton className="mt-4 h-6 w-full max-w-xl" />
      <div className="mt-12 grid gap-5 border-t border-border pt-6">
        {[0, 1, 2].map((index) => (
          <div key={index} className="grid gap-3 border-b border-border pb-6 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <div className="grid gap-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-7 w-4/5" />
              <Skeleton className="h-4 w-2/5" />
            </div>
            <Skeleton className="h-5 w-40 sm:justify-self-end" />
          </div>
        ))}
      </div>
    </main>
  );
}
