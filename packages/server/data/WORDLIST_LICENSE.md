# Word list license

`xwordlist.txt` is derived from the [Collaborative Word List](https://github.com/Crossword-Nexus/collaborative-word-list) by Crossword Nexus, downloaded on September 24, 2026. It was filtered to entries made only of the letters A-Z, 3-15 letters long, with a score of 50 or more, and uppercased. Entries rejected by `isOffensive()` in `packages/server/src/engine/wordlist.ts` were then removed; the loader applies the same check. The format is `WORD;score`, one entry per line.

The original list is distributed under the MIT License:

```
MIT License

Copyright (c) 2021 Crossword-Nexus

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

To refresh the list, download `xwordlist.dict` from the repository and rerun the same filter (the loader drops offensive entries at startup), for example:

```bash
awk -F';' '$1 ~ /^[A-Za-z]+$/ && length($1) >= 3 && length($1) <= 15 && $2 >= 50 {print toupper($1) ";" $2}' xwordlist.dict > xwordlist.txt
```
