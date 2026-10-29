import { useTranslations } from "next-intl";

const KEYS = ["sources", "languages", "control"] as const;

// Three headline numbers under the hero
export function StatsStrip() {
  const t = useTranslations("Home");

  return (
    <dl className="grid grid-cols-3 divide-x divide-border rounded-2xl border border-border bg-surface">
      {KEYS.map((key) => (
        <div key={key} className="flex flex-col gap-1 px-4 py-4 sm:px-6">
          <dt className="order-2 text-xs text-muted sm:text-sm">
            {t(`stats.${key}`)}
          </dt>
          <dd className="order-1 text-2xl font-bold tracking-tight text-accent sm:text-3xl">
            {t(`statsValue.${key}`)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
