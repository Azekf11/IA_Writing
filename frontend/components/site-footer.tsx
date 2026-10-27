import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function SiteFooter() {
  const t = await getTranslations("Footer");

  return (
    <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-foreground/10 pt-4 text-xs text-foreground/60">
      <p>{t("notice")}</p>
      <Link href="/privacy" className="underline">
        {t("privacy")}
      </Link>
    </footer>
  );
}
