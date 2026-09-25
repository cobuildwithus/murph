import { permanentRedirect } from "next/navigation";

export default function RetiredOverviewPage(): never {
  permanentRedirect("/home");
}
