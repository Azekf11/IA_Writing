import messages from "./messages/en.json";

// English is the source of truth: message keys are type-checked against it
declare module "next-intl" {
  interface AppConfig {
    Messages: typeof messages;
  }
}
