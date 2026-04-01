import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function HostedShareLoading() {
  return (
    <main className="min-h-screen px-5 py-12 md:px-8">
      <Card className="mx-auto w-full max-w-2xl shadow-sm">
        <CardHeader className="gap-5">
          <Badge variant="secondary" className="w-fit">Loading share</Badge>
          <div className="space-y-3">
            <Skeleton className="h-12 w-2/3 md:h-14" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 rounded-xl border border-stone-200/60 bg-stone-50/60 p-4">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
