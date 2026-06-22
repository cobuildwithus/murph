"use client";

import { useState } from "react";

import type { Expert } from "@/src/types/experiments";
import { Avatar, AvatarFallback } from "@/src/components/ui/avatar";

export function ExpertCard({
  initials,
  name,
  field,
  profileImageUrl,
  quote,
}: Expert) {
  const [imageFailed, setImageFailed] = useState(false);
  const hasField = field.trim().length > 0;
  const showProfileImage = Boolean(profileImageUrl) && !imageFailed;

  return (
    <div className="flex grow shrink basis-0 items-center gap-3.5 rounded-xl border border-secondary/25 bg-card/90 px-5 py-4">
      <Avatar className="size-12 shrink-0 overflow-hidden bg-secondary">
        {showProfileImage ? (
          // Dynamic expert images may come from local or externally curated profile URLs.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profileImageUrl}
            alt={name}
            className="aspect-square size-full rounded-full object-cover outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
            onError={() => {
              setImageFailed(true);
            }}
          />
        ) : (
          <AvatarFallback className="bg-secondary">
            <span className="font-serif text-base/5 font-semibold text-muted-foreground">
              {initials}
            </span>
          </AvatarFallback>
        )}
      </Avatar>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm/4.5 font-semibold text-foreground">
          {name}
        </span>
        {hasField ? (
          <span className="text-xs/4 text-chart-5">{field}</span>
        ) : null}
        <span className="mt-0.5 text-xs/4 text-muted-foreground/70">
          {quote}
        </span>
      </div>
    </div>
  );
}
