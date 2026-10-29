import { notFound } from "next/navigation";

// Unknown URLs under a valid locale render the localized not-found page
export default function CatchAll() {
  notFound();
}
