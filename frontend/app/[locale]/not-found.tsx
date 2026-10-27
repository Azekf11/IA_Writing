import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("NotFound");

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
      <Link href="/" className="underline">
        {t("back")}
      </Link>
    </main>
  );
}
