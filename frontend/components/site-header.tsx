import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";
import { NavLink } from "@/components/nav-link";
import { ThemeControls } from "@/components/theme-controls";
import { Link } from "@/i18n/navigation";

// Shared top bar: brand, navigation, language and appearance
export async function SiteHeader() {
  const t = await getTranslations("Nav");
  const tHome = await getTranslations("Home");

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="flex items-center gap-5">
        <Link
          href="/"
          className="font-serif text-xl font-medium tracking-tight"
        >
          {tHome("title")}
        </Link>
        <nav className="flex gap-1">
          <NavLink href="/">{t("home")}</NavLink>
          <NavLink href="/history">{t("history")}</NavLink>
        </nav>
      </div>
      <div className="flex items-center gap-2">
        <LanguageSwitcher />
        <ThemeControls />
      </div>
    </header>
  );
}
