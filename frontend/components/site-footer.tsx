import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function SiteFooter() {
  const t = await getTranslations("Footer");

  return (
    <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-5 text-xs text-muted">
      <p>{t("notice")}</p>
      <Link
        href="/privacy"
        className="-my-2 py-2 underline-offset-4 hover:text-foreground hover:underline"
      >
        {t("privacy")}
      </Link>
    </footer>
  );
}
