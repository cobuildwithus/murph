import type { ReactNode } from "react";

export default function JoinInviteSuccessLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`#site-footer { display: none; }`}</style>
      {children}
    </>
  );
}
