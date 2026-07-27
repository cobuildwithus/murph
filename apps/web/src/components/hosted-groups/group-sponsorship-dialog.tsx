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
  offers: readonly GroupSponsorshipOffer[];
};

type GroupSponsorshipOffer = HostedUsageTopUpOffer & {
  runningBitDurationLabel: string | null;
};

function GroupSponsorshipDialog({
  customizationAllowed,
  offers,
  ...props
}: GroupSponsorshipDialogProps) {
  const [publicAlias, setPublicAlias] = useState("");
  const [runningBitRequest, setRunningBitRequest] = useState("");
  const [sponsorMessage, setSponsorMessage] = useState("");

  return (
    <HostedUsageTopUpDialog
      {...props}
      scope="group"
      offers={offers}
      buildCheckoutPayload={({ clientRequestKey, offerCode }) =>
        customizationAllowed
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
          : { clientRequestKey, offerCode }
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

export { GroupSponsorshipDialog };
export type { GroupSponsorshipDialogProps, GroupSponsorshipOffer };
