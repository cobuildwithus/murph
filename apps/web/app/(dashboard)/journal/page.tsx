import { permanentRedirect } from "next/navigation";

export default function RetiredJournalPage(): never {
  permanentRedirect("/home");
}
