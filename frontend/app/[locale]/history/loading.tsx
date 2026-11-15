import { useTranslations } from "next-intl";
import { HistorySkeleton } from "@/components/history-skeleton";

// What a click on History shows at once. The page's own wait for the list looks exactly the same.
export default function HistoryLoading() {
  const t = useTranslations("History");

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-serif text-3xl font-medium tracking-tight">
        {t("title")}
      </h1>
      <HistorySkeleton />
    </div>
  );
}
