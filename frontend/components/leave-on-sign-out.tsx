"use client";

import { useEffect } from "react";
import { followSessionShown } from "@/lib/signed-out";

// In the layout, so that the pages that show nothing of the account hear of a sign-out in another
// tab too: the privacy page, a missing page, the error page, a history that could not be read
export function LeaveOnSignOut({ locale }: { locale: string }) {
  useEffect(() => followSessionShown(locale), [locale]);
  return null;
}
