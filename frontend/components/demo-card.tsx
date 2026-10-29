import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

// A fixed before/after example on the home page: shows the product without calling the API
export function DemoCard() {
  const t = useTranslations("Home");

  return (
    <section
      aria-label={t("demoTitle")}
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-card"
    >
      <div className="border-b border-border px-5 py-3 text-xs font-medium text-muted">
        {t("demoTitle")}
      </div>

      <div className="grid gap-px bg-border md:grid-cols-[1fr_auto_1fr]">
        <div className="bg-surface p-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-remove">
            {t("demoBefore")}
          </p>
          <p className="leading-relaxed">
            <span className="rounded bg-remove-soft px-1 py-0.5 text-remove line-through decoration-remove/50">
              {t("demoOriginal")}
            </span>
          </p>
        </div>

        <div
          className="hidden place-items-center bg-surface px-1 md:grid"
          aria-hidden
        >
          <ArrowRight className="size-5 text-muted" />
        </div>

        <div className="bg-surface p-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-add">
            {t("demoAfter")}
          </p>
          <p className="leading-relaxed">
            <span className="rounded bg-add-soft px-1 py-0.5 text-add">
              {t("demoRewrite")}
            </span>
          </p>
          <p className="mt-3 text-xs text-muted">{t("demoReason")}</p>
        </div>
      </div>
    </section>
  );
}
