# Third-party notices

Material from others that this repository contains, and what it was checked against. The licence of
this repository's own code is its owner's choice and is not set here: see the README. These notes
record facts about the sources. They are not legal advice.

## Embedding model

`frontend/data/embedder/` holds a reduced and quantised copy of
[sentence-transformers/static-similarity-mrl-multilingual-v1](https://huggingface.co/sentence-transformers/static-similarity-mrl-multilingual-v1),
under the Apache License 2.0. The licence text, the changes made and the revision are in
[LICENSE](frontend/data/embedder/LICENSE) and [NOTICE](frontend/data/embedder/NOTICE) in that folder.

## Editing prompt

The system prompt in `frontend/lib/rewrite/prompt.ts` follows the method and the groups of patterns
of [blader/humanizer](https://github.com/blader/humanizer), and repeats some of its wording. Compared
with `SKILL.md` at commit `0ef9fe5bc3572734fd3ae6c448fe00a30cd5dcf0`, on 3 November 2026, counting
words that fall inside a run shared by both texts:

| Shortest run counted | Share of the prompt's 763 words |
| -------------------- | ------------------------------- |
| 5 words              | 19.0%                           |
| 8 words              | 12.6%                           |
| 12 words             | 10.2%                           |

The longest shared run is 22 words. So the reuse goes beyond ideas, and its licence is reproduced
here, with a pointer to it in the header of `prompt.ts`:

```text
MIT License

Copyright (c) 2025 Siqi Chen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

humanizer says its patterns come from Wikipedia's
["Signs of AI writing"](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), maintained by
WikiProject AI Cleanup. Measured the same way on the page's source on 4 November 2026, the prompt
shares no run of five words or more with it. The page is credited as the origin of the ideas.

## Style corpus

The passages are not in this repository. Their sources, and the rights question that should keep them
off in the public demo until it is settled, are in [docs/STYLE_CORPUS.md](docs/STYLE_CORPUS.md).
