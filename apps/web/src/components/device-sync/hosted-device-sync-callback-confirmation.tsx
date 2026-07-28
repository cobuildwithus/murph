import { buttonVariants } from "@/src/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";
import { cn } from "@/src/lib/utils";

type HostedDeviceSyncCallbackConfirmationProps =
  | {
      action: string;
      state: "confirmation";
    }
  | {
      action?: never;
      state: "failure";
    };

export function HostedDeviceSyncCallbackConfirmation(
  props: HostedDeviceSyncCallbackConfirmationProps,
) {
  const confirming = props.state === "confirmation";

  return (
    <main
      className="flex min-h-svh items-center justify-center bg-background px-5 py-12 antialiased sm:px-8"
      data-design-section="device-sync-callback-confirmation"
    >
      <Card className="w-full max-w-lg gap-6 py-6">
        <CardHeader className="gap-3 px-6 sm:px-8">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
            Device connection
          </p>
          <CardTitle>
            <h1 className="text-balance font-serif text-3xl font-semibold leading-tight tracking-tight text-foreground">
              {confirming ? "Finish connecting your device" : "Connection not completed"}
            </h1>
          </CardTitle>
          <CardDescription className="text-pretty text-base leading-relaxed">
            {confirming
              ? "Continue only if you just signed in to your own wearable account."
              : "This connection link could not be verified. Nothing was connected from it."}
          </CardDescription>
        </CardHeader>

        <CardContent className="px-6 sm:px-8">
          <p className="text-pretty rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
            {confirming
              ? "If someone sent you this link, return to Murph and start the connection again."
              : "Return to Murph and start again from Connect devices."}
          </p>
        </CardContent>

        <CardFooter className="border-border bg-muted/30 px-6 py-5 sm:px-8">
          {confirming ? (
            <form
              action={props.action}
              className="flex w-full flex-col-reverse gap-3 sm:flex-row sm:justify-end"
              method="post"
            >
              <a
                className={cn(buttonVariants({ size: "lg", variant: "outline" }), "active:scale-[0.96]")}
                href="/connect"
              >
                Return to Murph
              </a>
              <button
                className={cn(buttonVariants({ size: "lg" }), "active:scale-[0.96]")}
                type="submit"
              >
                Finish connection
              </button>
            </form>
          ) : (
            <a
              className={cn(
                buttonVariants({ size: "lg" }),
                "ml-auto active:scale-[0.96]",
              )}
              href="/connect"
            >
              Return to Murph
            </a>
          )}
        </CardFooter>
      </Card>
    </main>
  );
}
