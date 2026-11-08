# Rewrity: frontend

The Next.js app (App Router, TypeScript, Tailwind), deployed on Vercel. How to run it and test it is in
the [root README](../README.md); how it works is in [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

## Scripts

| Command             | What it does                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `npm run dev`       | Dev server                                                                                       |
| `npm run build`     | Production build                                                                                 |
| `npm run start`     | Serves the production build                                                                      |
| `npm run lint`      | ESLint                                                                                           |
| `npm run typecheck` | TypeScript, no emit                                                                              |
| `npm run format`    | Prettier, on all files                                                                           |
| `npm test`          | Unit and component tests (Vitest)                                                                |
| `npm run e2e`       | Browser tests on the production build, with the API mocked                                       |
| `npm run test:db`   | Database policy tests, against a running local Supabase                                          |
| `npm run audit`     | The whole site in a browser, against a running local Supabase                                    |
| `npm run stand-in`  | A local stand-in for the model, for a demo without an API key                                    |
| `npm run compare`   | [The excerpts comparison](../docs/research/style-references-comparison.md), simulated by default |

## Text and languages

English and French, with prefixed routes (`/en`, `/fr`). The locale comes from the URL, then the
`NEXT_LOCALE` cookie, then `Accept-Language`.

- Texts live in `messages/en.json` and `messages/fr.json`, never in components.
- English is the source of truth: keys are type-checked against it.
- A test fails if the two files differ in keys or placeholders.

Adding a language takes more than a message file: `i18n/routing.ts`, the `locale` enum in
`lib/rewrite/schema.ts`, the `rewrites.locale` check in a migration, `lib/style/language.ts`, and a
corpus for that language.
