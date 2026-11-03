import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import { renderToString } from "react-dom/server";
import en from "../messages/en.json";
import fr from "../messages/fr.json";

const all = { en, fr };

function Intl({
  locale,
  children,
}: {
  locale: "en" | "fr";
  children: ReactNode;
}) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={all[locale]}
      timeZone="Europe/Paris"
    >
      {children}
    </NextIntlClientProvider>
  );
}

// Render a component inside the i18n provider for the given locale
export function renderWithIntl(ui: ReactElement, locale: "en" | "fr" = "en") {
  return render(ui, {
    wrapper: ({ children }) => <Intl locale={locale}>{children}</Intl>,
  });
}

// The page as the server sent it, with the boxes filled in as a reader can before the scripts
// arrive, and then the scripts
export function hydrateAfter(
  typeEarly: (page: HTMLElement) => void,
  ui: ReactElement,
) {
  const container = document.createElement("div");
  document.body.append(container);
  container.innerHTML = renderToString(<Intl locale="en">{ui}</Intl>);
  typeEarly(container);
  return render(ui, {
    container,
    hydrate: true,
    wrapper: ({ children }) => <Intl locale="en">{children}</Intl>,
  });
}
