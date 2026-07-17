import { Skeleton } from "@/src/components/ui/skeleton";

export default function MurphSafeProductLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8 sm:py-20" aria-busy="true" aria-label="Loading product record">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="mt-8 h-14 w-full max-w-3xl" />
      <Skeleton className="mt-4 h-6 w-64" />
      <div className="mt-12 grid gap-10 border-t border-border pt-10">
        {[0, 1, 2].map((index) => (
          <div key={index} className="grid gap-4 border-b border-border pb-10">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-9 w-72 max-w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ))}
      </div>
    </main>
  );
}
