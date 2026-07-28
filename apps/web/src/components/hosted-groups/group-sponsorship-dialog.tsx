"use client";

import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";

import {
  HostedUsageTopUpDialog,
  type HostedUsageTopUpDialogProps,
  type HostedUsageTopUpOffer,
} from "@/src/components/settings/hosted-usage-top-up-dialog";
import { Button } from "@/src/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/src/components/ui/collapsible";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/src/components/ui/field";
import { Input } from "@/src/components/ui/input";
import { Textarea } from "@/src/components/ui/textarea";

type GroupSponsorshipDialogProps = Omit<
  HostedUsageTopUpDialogProps,
  "buildCheckoutPayload" | "offers" | "renderSelectionDetails" | "scope"
> & {
  customizationAllowed: boolean;
  frozenSponsorship?: FrozenGroupSponsorship | null;
  offers: readonly GroupSponsorshipOffer[];
};

type FrozenGroupSponsorship = {
  publicAlias: string | null;
  runningBitRequest: string | null;
  sponsorMessage: string | null;
};

type GroupSponsorshipOffer = HostedUsageTopUpOffer & {
  runningBitDurationLabel: string | null;
};

function GroupSponsorshipDialog({
  customizationAllowed,
  frozenSponsorship,
  offers,
  ...props
}: GroupSponsorshipDialogProps) {
  const [publicAlias, setPublicAlias] = useState(
    frozenSponsorship?.publicAlias ?? "",
  );
  const [runningBitRequest, setRunningBitRequest] = useState(
    frozenSponsorship?.runningBitRequest ?? "",
  );
  const [sponsorMessage, setSponsorMessage] = useState(
    frozenSponsorship?.sponsorMessage ?? "",
  );
  const recoveringFrozenPurchase =
    props.activePurchase != null && frozenSponsorship !== undefined;

  return (
    <HostedUsageTopUpDialog
      {...props}
      scope="group"
      offers={offers}
      buildCheckoutPayload={({ clientRequestKey, offerCode }) => {
        if (recoveringFrozenPurchase) {
          return {
            clientRequestKey,
            offerCode,
            sponsorship: frozenSponsorship ?? {},
          };
        }
        return customizationAllowed
          ? {
              clientRequestKey,
              offerCode,
              sponsorship: {
                publicAlias,
                sponsorMessage,
                ...(offerCode === "usage_5_usd"
                  ? {}
                  : { runningBitRequest }),
              },
            }
          : { clientRequestKey, offerCode };
      }}
      renderPurchaseDetails={
        recoveringFrozenPurchase && frozenSponsorship
          ? <FrozenSponsorshipDetails sponsorship={frozenSponsorship} />
          : null
      }
      renderSelectionDetails={({ disabled, selectedOffer }) => {
        const selectedSponsorshipOffer = offers.find(
          (offer) => offer.offerCode === selectedOffer?.offerCode,
        );
        return customizationAllowed ? (
          <Collapsible>
            <CollapsibleTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full justify-between"
                  disabled={disabled}
                />
              }
            >
              Make it funny (optional)
              <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
            </CollapsibleTrigger>
            <CollapsibleContent className="h-auto">
              <FieldGroup className="pt-4">
                <Field data-disabled={disabled || undefined}>
                  <FieldLabel htmlFor="group-sponsor-alias">
                    Credit me as
                  </FieldLabel>
                  <Input
                    id="group-sponsor-alias"
                    value={publicAlias}
                    onChange={(event) => setPublicAlias(event.target.value)}
                    maxLength={80}
                    disabled={disabled}
                    placeholder="Jake’s Lower Back"
                  />
                  <FieldDescription>
                    Optional. Murph never guesses your public name.
                  </FieldDescription>
                </Field>
                <Field data-disabled={disabled || undefined}>
                  <FieldLabel htmlFor="group-sponsor-message">
                    Note to Murph or the group
                  </FieldLabel>
                  <Textarea
                    id="group-sponsor-message"
                    value={sponsorMessage}
                    onChange={(event) => setSponsorMessage(event.target.value)}
                    maxLength={280}
                    disabled={disabled}
                    placeholder="Please stop inviting Jake to basketball."
                  />
                </Field>
                {selectedSponsorshipOffer?.runningBitDurationLabel ? (
                  <Field data-disabled={disabled || undefined}>
                    <FieldLabel htmlFor="group-sponsor-bit">
                      Temporary running bit
                    </FieldLabel>
                    <Textarea
                      id="group-sponsor-bit"
                      value={runningBitRequest}
                      onChange={(event) =>
                        setRunningBitRequest(event.target.value)
                      }
                      maxLength={240}
                      disabled={disabled}
                      placeholder="Treat me like Murph’s exhausted CFO."
                    />
                    <FieldDescription>
                      Lasts for {selectedSponsorshipOffer.runningBitDurationLabel}.
                      Murph may remix or ignore it. Serious, private, and health
                      conversations always take priority.
                    </FieldDescription>
                  </Field>
                ) : null}
              </FieldGroup>
            </CollapsibleContent>
          </Collapsible>
        ) : null;
      }}
    />
  );
}

function FrozenSponsorshipDetails({
  sponsorship,
}: {
  sponsorship: FrozenGroupSponsorship;
}) {
  const details = [
    ["Sponsor name", sponsorship.publicAlias],
    ["Note", sponsorship.sponsorMessage],
    ["Running bit", sponsorship.runningBitRequest],
  ].filter((entry): entry is [string, string] => entry[1] !== null);
  if (details.length === 0) {
    return null;
  }
  return (
    <div className="rounded-2xl border border-border bg-muted/30 p-5">
      <p className="text-sm font-medium text-foreground">
        Your original sponsor details are still attached
      </p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        Cancel this payment before changing them.
      </p>
      <dl className="mt-3 space-y-2">
        {details.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </dt>
            <dd className="whitespace-pre-wrap text-sm leading-6 text-foreground">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export { GroupSponsorshipDialog };
export type {
  FrozenGroupSponsorship,
  GroupSponsorshipDialogProps,
  GroupSponsorshipOffer,
};
