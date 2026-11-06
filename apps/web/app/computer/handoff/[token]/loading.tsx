import { LinkPageDots } from "@/src/components/link-page/link-page-dots";
import {
  LinkPageFrame,
  LinkPageScreen,
} from "@/src/components/link-page/link-page-shell";

export default function ComputerHandoffLoading() {
  return (
    <LinkPageFrame>
      <div aria-busy aria-live="polite" className="flex flex-1 flex-col" role="status">
        <LinkPageScreen title="One moment.">
          <LinkPageDots />
        </LinkPageScreen>
      </div>
    </LinkPageFrame>
  );
}
