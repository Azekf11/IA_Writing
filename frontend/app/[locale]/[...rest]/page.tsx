import { notFound } from "next/navigation";

// The tab names the page, as it does for every other one
export { generateMetadata } from "../not-found";

// Unknown URLs under a valid locale render the localized not-found page
export default function CatchAll() {
  notFound();
}
