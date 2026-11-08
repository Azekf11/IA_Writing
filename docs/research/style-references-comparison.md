# Comparing suggestions with and without excerpts

**Status: protocol only. The comparison has not been run, so nothing is known yet about whether the
excerpts help.** The tool below has only been exercised on the simulated model, which proves it runs
and says nothing about the excerpts.

## The question

Do the excerpts make the suggestions more natural without altering more facts, and is that worth their
delay and tokens? The excerpts have a cost in rights as well ([STYLE_CORPUS.md](../STYLE_CORPUS.md#licences-and-credits)),
so without a clear gain they stay off.

## Texts

[`comparison-texts.json`](comparison-texts.json) holds 12 single-paragraph texts, 6 in English and 6 in
French. All of it is invented. Each text has the habits the app edits, figures with units, numbers
attributed to named entities and at least one denial, and comes with the list of facts an edit must
keep. `tests/comparison-texts.test.ts` checks that the route accepts them and that each fact's figures
are in its text.

## Conditions

| Condition | Server                                 |
| --------- | -------------------------------------- |
| Excerpts  | `STYLE_REFERENCES` left on             |
| None      | The same build, `STYLE_REFERENCES=off` |

Everything else is the same: model, effort, `standard` intensity, no voice sample, one attempt per text
and condition, no retry. The order alternates from one text to the next. A failed attempt is not run
again, which would hide failures; it is reported, and its unchanged text is rated like any other.

Run it on the corpus you would serve: results on another one do not carry over. A run where fewer than 10
of the 12 texts got excerpts does not answer the question, whatever the numbers say.

## Measures

| Measure                 | How                                                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fidelity                | With every edit accepted, one error per fact altered, dropped or attributed to someone else, and per fact the original does not state. A count, per version.            |
| Naturalness             | With every edit accepted, 1 to 5. 1: still reads as generated. 2: stiff or padded. 3: correct and neutral. 4: reads like a careful person. 5: could be published as is. |
| Delay to the first edit | `prep_ms + first_edit_ms` from the `Rewrite attempt` log line: the excerpts add the embedding and the search to the first, and more prompt to read to the second.       |
| Tokens                  | `input_tokens` and `output_tokens` from the same line.                                                                                                                  |

## Blinding

The tool draws for each text which version is X and which is Y, and keeps that only in `key.json`. The
sheet shows the original, the facts and both results, without credits, reasons (a reason could mention an
excerpt) or timings. The rater fills in `ratings.json` before opening `key.json` or `measures.json`. Ideally
the rater is not the person who ran it; if they are the same person, the run's output shows no condition
either.

## Decision rule, set before the run

Keep the excerpts only if both hold:

1. The total of fidelity errors with excerpts is not higher than without them.
2. The median paired gain in naturalness, with excerpts minus without, is at least +0.5.

Delay and tokens are reported next to the result and do not enter the rule, because a cost is judged
against the gain. The rule is not to be changed after seeing the results.

## Running it

Try the tool first. It costs nothing and needs the local stack with its migrations. `sheet.md`,
`measures.json`, the console and the score all say simulated:

```bash
cd frontend
supabase start
npm run compare
```

For the real run:

1. Load the corpus you would serve into the **local** database: `ingest_style.py` with `SUPABASE_URL`
   and `SUPABASE_SECRET_KEY` taken from `supabase status`. The tool refuses to run on an empty one.
2. Use a key from the dedicated workspace, whose spending limit also covers this run
   ([DEPLOY.md](../DEPLOY.md#1-anthropic)).
3. Start it, typing the key at the prompt so that it stays out of the shell's history. This is the step
   that spends money:

   ```bash
   read -rs ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY
   COMPARE_REAL=yes npm run compare
   ```

4. Rate the texts in `audit/comparison/sheet.md`, filling in `ratings.json`.
5. Read the result. With fewer than 10 texts that got excerpts, the score says the run gives no answer and
   prints no verdict:

   ```bash
   npm run compare -- score
   ```

The tool raises the local limits for the run and puts them back, and refuses any stack that is not local.
It writes to `frontend/audit/comparison/`, which git ignores.

## What it costs

An estimate, with Claude Sonnet 5.5 at $2 per million input tokens and $10 per million output tokens
(prices read on 4 November 2026). Each attempt is bounded by `max_tokens` to 8,000 output tokens, or
$0.08, and sends about 8,500 characters, or $0.006 at most: about **$0.09 per attempt and $2.10 for the
24**, if every answer used its whole output allowance. The tool's output gives the real token counts.

## What it cannot say

12 texts and one rater detect a large effect at best, and this protocol makes no claim of statistical
significance. The texts are written to contain what the checks look for, so they are harder on fidelity
than ordinary prose. The stated facts are checked, not every nuance. A single run of each condition does
not separate the excerpts from the model's own variation between two answers.
