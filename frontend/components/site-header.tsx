import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Link } from "@/i18n/navigation";

// Shared top bar: title, navigation and language switch
export async function SiteHeader() {
  const t = await getTranslations("Nav");
  const tHome = await getTranslations("Home");

  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-6">
        <Link href="/" className="text-xl font-semibold tracking-tight">
          {tHome("title")}
        </Link>
        <nav className="flex gap-4 text-sm">
          <Link href="/" className="hover:underline">
            {t("home")}
          </Link>
          <Link href="/history" className="hover:underline">
            {t("history")}
          </Link>
        </nav>
      </div>
      <LanguageSwitcher />
    </header>
  );
}
