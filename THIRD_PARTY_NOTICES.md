# Third-party notices

Foldnano is released under the MIT License (see `LICENSE`). It builds on the
work of other projects, listed below with their licenses.

## cadnano

Foldnano reads and writes the cadnano JSON design format and follows many of
cadnano's design conventions. cadnano is distributed under the BSD 3-Clause
License:

```
Copyright (c) 2018, Wyss Institute at Harvard University and University of California San Francisco.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## UI components

The UI components in `src/lib/components/ui/` are copied into this repository
from component registries, then adapted, rather than installed as packages:

- [shadcn-svelte](https://shadcn-svelte.com), the Svelte port of
  [shadcn/ui](https://ui.shadcn.com): every component except `file-drop-zone`.
- [shadcn-svelte-extras](https://www.shadcn-svelte-extras.com): `file-drop-zone`
  and `src/lib/utils/utils.ts`.

Both are distributed under the MIT License:

```
Copyright (c) 2023 Hunter Johnston <https://github.com/huntabyte>
Copyright (c) 2023 CokaKoala <https://github.com/adriangonz97>
Copyright (c) 2023 shadcn
(shadcn-svelte)

Copyright (c) 2024 Aidan Bleser
(shadcn-svelte-extras)

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

## npm dependencies

Runtime dependencies are installed from npm and keep their own licenses. Every
production build generates `third-party-licenses.txt` (served at
`/third-party-licenses.txt` and linked from the About dialog) with the name,
version, license and full license text of each package bundled into the app.
See `scripts/vite-third-party-licenses.ts`. Notable ones:

| Package            | License    | Copyright                           |
| ------------------ | ---------- | ----------------------------------- |
| SvelteKit / Svelte | MIT        | Svelte contributors                 |
| Konva.js           | MIT        | Anton Lavrenov                      |
| Three.js           | MIT        | three.js authors                    |
| Tailwind CSS       | MIT        | Tailwind Labs Inc.                  |
| bits-ui            | MIT        | Huntabyte                           |
| Lucide             | ISC        | Lucide contributors                 |
| Dexie.js           | Apache-2.0 | David Fahlander, Dexie contributors |

## Pyodide

The Python plugin runtime loads Pyodide (MPL-2.0) and its packages at runtime.
Each package keeps its own license.

## Plugins

Each plugin is an independent project with its own licensing terms.

## Test fixtures

Some design files under `test_files/fixtures/` and `test_files/published_cadnano_designs/`
come from published work and remain the property of their original authors.
They are included only to test file-format compatibility.
