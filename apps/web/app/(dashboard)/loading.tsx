import { Skeleton } from "@/src/components/ui/skeleton";

/**
 * Route-group transition feedback. The dashboard layout (shell + browser-vault
 * provider) persists across this boundary, so only the page body swaps to these
 * placeholders. Mirrors the shared page header + content rhythm so the switch to
 * real content lands without a layout shift.
 */
export default function DashboardLoading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="flex flex-col gap-8"
      role="status"
    >
      <span className="sr-only">Loading dashboard</span>
      <div aria-hidden="true" className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-24 motion-reduce:animate-none" />
          <Skeleton className="h-9 w-72 max-w-full motion-reduce:animate-none" />
          <Skeleton className="mt-1 h-4 w-96 max-w-full motion-reduce:animate-none" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-40 motion-reduce:animate-none" />
          <Skeleton className="h-40 motion-reduce:animate-none" />
          <Skeleton className="h-40 motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  );
}
