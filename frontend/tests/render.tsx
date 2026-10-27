import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import en from "../messages/en.json";
import fr from "../messages/fr.json";

const all = { en, fr };

// Render a component inside the i18n provider for the given locale
export function renderWithIntl(ui: ReactElement, locale: "en" | "fr" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={all[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
}
