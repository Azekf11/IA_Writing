import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";

export const alt = "Rewrity";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Share card: the product name and its promise on the carbon background
export default async function OpenGraphImage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Home" });

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: "#0e1013",
        color: "#e8eaee",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: "#6c93ff",
          }}
        />
        <div style={{ fontSize: 40, fontWeight: 700 }}>Rewrity</div>
      </div>
      <div
        style={{
          fontSize: 84,
          fontWeight: 800,
          lineHeight: 1.05,
          letterSpacing: -2,
        }}
      >
        {t("headline")}
      </div>
      <div style={{ fontSize: 30, color: "#98a0ad" }}>EN · FR</div>
    </div>,
    size,
  );
}
