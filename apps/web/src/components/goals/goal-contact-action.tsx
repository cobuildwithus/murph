"use client";

import { ArrowRight } from "lucide-react";

import { MurphContactDialog } from "@/src/components/murph/murph-contact-dialog";
import { MurphContactLink } from "@/src/components/murph/murph-contact-link";
import { Button } from "@/src/components/ui/button";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

export function GoalContactAction({
  options,
}: {
  options: readonly MurphContactOption[];
}) {
  const content = (
    <>
      Do this with Murph
      <ArrowRight data-icon="inline-end" aria-hidden="true" />
    </>
  );

  const directOption = options.length === 1 ? options[0] : null;

  if (directOption) {
    return (
      <Button
        nativeButton={false}
        render={(
          <MurphContactLink
            actionLabel="Do this with Murph"
            option={directOption}
          />
        )}
        size="lg"
      >
        {content}
      </Button>
    );
  }

  if (options.length === 0) {
    return (
      <Button disabled size="lg">
        {content}
      </Button>
    );
  }

  return (
    <MurphContactDialog
      description="Choose an app, review the editable message, then send it when you are ready."
      options={options}
      title="Do this with Murph"
      trigger={
        <Button size="lg">
          {content}
        </Button>
      }
    />
  );
}
