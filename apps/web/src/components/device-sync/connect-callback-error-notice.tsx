import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button, buttonVariants } from "@/src/components/ui/button";
import { ContactSupportAction } from "@/src/components/support/contact-support-action";
import { cn } from "@/src/lib/utils";

const CONNECT_CALLBACK_ERROR_SUPPORT_SUBJECT = "Murph device connection help";

export function ConnectCallbackErrorNotice({
  errorCode = null,
  message,
  onSignIn = null,
  sourceLabel = null,
  title,
}: {
  errorCode?: string | null;
  message: string;
  onSignIn?: (() => void) | null;
  sourceLabel?: string | null;
  title: string;
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      {/* The actions sit outside the description so the Alert's link styling
          does not underline them into looking like inline links. */}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        {/* When the failure was a lost session, signing in is the actual
            recovery, so it leads and support drops to a fallback. */}
        {onSignIn ? (
          <Button
            className="w-full justify-center font-semibold sm:w-auto"
            onClick={onSignIn}
            variant="default"
          >
            Log in
          </Button>
        ) : null}
        <ContactSupportAction
          body={buildConnectCallbackSupportBody({ errorCode, sourceLabel })}
          className="w-full justify-center sm:w-auto"
          subject={CONNECT_CALLBACK_ERROR_SUPPORT_SUBJECT}
        >
          Email support
        </ContactSupportAction>
        <a
          className={cn(
            buttonVariants({ variant: "outline" }),
            "w-full justify-center font-semibold sm:w-auto",
          )}
          href="/home"
        >
          Go to home
        </a>
      </div>
    </Alert>
  );
}

function buildConnectCallbackSupportBody({
  errorCode,
  sourceLabel,
}: {
  errorCode: string | null;
  sourceLabel: string | null;
}): string {
  // Support needs the failing source and code to answer without a round trip.
  // createConnectCallbackNotice only passes a catalog-resolved source name and a
  // Murph error code here, so raw callback query text cannot reach this draft.
  return [
    `I could not finish connecting ${sourceLabel ?? "a device"} in Murph.`,
    "",
    "What happened:",
    "",
    `Reference: ${errorCode ?? "unknown"}`,
  ].join("\n");
}
