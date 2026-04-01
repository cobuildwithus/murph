import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function JoinInviteLoading() {
  return (
    <main className="min-h-screen px-5 py-12 md:px-8">
      <div className="mx-auto max-w-3xl">
        <Card className="shadow-sm">
          <CardHeader className="gap-5">
            <Badge variant="secondary" className="w-fit">Loading invite</Badge>
            <div className="space-y-3">
              <Skeleton className="h-12 w-3/4 md:h-14" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-5/6" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3 rounded-xl border border-stone-200/60 bg-stone-50/70 p-5">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-2/3" />
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
