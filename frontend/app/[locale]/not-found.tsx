import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

// Next serves a missing page as an empty shell that the scripts then draw. This title goes into
// that shell; the catch-all gives the same one to the page the scripts draw.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "NotFound" });
  return { title: t("title") };
}

export default function NotFound() {
  const t = useTranslations("NotFound");

  return (
    <div className="flex flex-1 flex-col justify-center gap-4 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
      <Link
        href="/"
        className="w-fit rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover"
      >
        {t("back")}
      </Link>
    </div>
  );
}
