import { LINK_PAGE_PILL_CLASS, LinkPageScreen } from "@/src/components/link-page/link-page-shell";

export const WIN_LINK_TITLE = "A new win in Murph";
export const WIN_LINK_DESCRIPTION = "Open it on your iPhone to share it.";

export function WinLinkView({ appUrl }: { appUrl: string }) {
  return (
    <LinkPageScreen
      actions={<a className={LINK_PAGE_PILL_CLASS} href={appUrl}>Open in Murph</a>}
      announceDetail={false}
      detail={WIN_LINK_DESCRIPTION}
      title={WIN_LINK_TITLE}
    />
  );
}
