import { permanentRedirect } from "next/navigation";

export default function RetiredHistoryPage(): never {
  permanentRedirect("/journal");
}
