import type { ReactNode } from "react";

/**
 * Layout for the "how should Murph reach you" card: the phone action above a
 * labelled divider, with the Telegram action below it. The join island and the
 * design catalog share this so the spacing between the two channels is proven
 * by the same markup that ships.
 */
export function HostedContactChannelChoice({
  phone,
  telegram,
}: {
  phone: ReactNode;
  telegram: ReactNode;
}) {
  return (
    <div className="space-y-5">
      {phone}

      <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        OR
        <span className="h-px flex-1 bg-border" />
      </div>

      {telegram}
    </div>
  );
}
