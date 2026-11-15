import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";

// For t.rich. A soft navigation: a full load would lose the text in the editor.
export const privacyLink = (chunks: ReactNode) => (
  <Link
    href="/privacy"
    className="underline underline-offset-4 transition-colors hover:text-foreground"
  >
    {chunks}
  </Link>
);
