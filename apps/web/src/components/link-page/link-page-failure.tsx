"use client";

import {
  LinkPagePill,
  LinkPageScreen,
} from "@/src/components/link-page/link-page-shell";

/** A page that failed to load, so no state of its own could be shown. */
export function LinkPageFailureScreen({ onRetry }: { onRetry?: () => void }) {
  return (
    <LinkPageScreen
      actions={<LinkPagePill onClick={onRetry}>Try again</LinkPagePill>}
      detail="Nothing changed. Try again in a moment."
      title="Something went wrong."
    />
  );
}
