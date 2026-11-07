"use client";

import { LinkPageFailureScreen } from "@/src/components/link-page/link-page-failure";
import { LinkPageFrame } from "@/src/components/link-page/link-page-shell";

/** Covers every route outside `(dashboard)`, which has its own error screen. */
export default function AppError({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <LinkPageFrame>
      <LinkPageFailureScreen onRetry={retry} />
    </LinkPageFrame>
  );
}
