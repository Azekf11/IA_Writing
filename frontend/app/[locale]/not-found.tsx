import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("NotFound");

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center gap-4 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
      <Link
        href="/"
        className="w-fit rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:brightness-110"
      >
        {t("back")}
      </Link>
    </main>
  );
}
