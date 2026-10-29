import { useTranslations } from "next-intl";

// Says plainly where the style references come from
export function SourcesNote() {
  const t = useTranslations("Home");

  return (
    <aside className="border-t border-border pt-6">
      <h2 className="text-sm font-semibold">{t("sourcesTitle")}</h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
        {t("sourcesBody")}
      </p>
    </aside>
  );
}
