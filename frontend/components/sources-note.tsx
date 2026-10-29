import { Library } from "lucide-react";
import { useTranslations } from "next-intl";

// Says plainly where the style references come from
export function SourcesNote() {
  const t = useTranslations("Home");

  return (
    <aside className="flex gap-4 rounded-2xl border border-border bg-surface-2 p-5">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-text">
        <Library className="size-5" aria-hidden />
      </span>
      <div>
        <h2 className="text-sm font-semibold">{t("sourcesTitle")}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          {t("sourcesBody")}
        </p>
      </div>
    </aside>
  );
}
