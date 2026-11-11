# Bundled UI assets

All fonts are self-hosted; the browser makes no font-CDN requests.

| File | Upstream source | SHA-256 |
| --- | --- | --- |
| `assets/Manrope-variable.ttf` | https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/Manrope%5Bwght%5D.ttf | `3ae11c49db0455a3cc33e37d380f20fdb8c7f8b41dc07625c177e3d87a9d6ae6` |
| `assets/CaesarDressing-Regular.ttf` | https://raw.githubusercontent.com/google/fonts/main/ofl/caesardressing/CaesarDressing-Regular.ttf | `009dea24a4d4a3a7e02d683087babb1738acc0b949cce38c485fab325c9e9295` |

The original unmodified TTF files are bundled with their complete upstream SIL Open Font License 1.1 notices at `assets/Manrope-OFL.txt` and `assets/CaesarDressing-OFL.txt`. Manrope copyright: The Manrope Project Authors, 2018. Caesar Dressing copyright: Open Window, 2011; reserved font name Caesar Dressing. No font modifications or relicensing are claimed. Upstream filenames/URLs were discovered from the Google Fonts repository API; the hashes pin the downloaded bytes despite mutable upstream branches.

`assets/artemis.png` is the unchanged custom AI-generated Artemis artwork created by Luke Jones directly using OpenAI ChatGPT; SHA-256 `1c6a08c2c5b96bd9e7e0c97dfefd3b302a39247bdd04b3b2528bb58330fd4dbf`. It is displayed in a rounded-square frame without redraw, distortion, circular cropping or dark-theme inversion. Owner-reported provenance, applicable consumer Terms ownership, limits on copyright/noninfringement assurances and the derived Apple touch-icon lineage are recorded in ../NOTICE.md. These third-party notices do not grant a project-wide license or replace those disclosures.

Navigation, composer and system-notice SVG paths use Lucide 0.468.0 icons (panel-left, ellipsis, x, house, plus, send, circle-alert, arrow-down), copied inline without a runtime library. circle-alert source: https://raw.githubusercontent.com/lucide-icons/lucide/0.468.0/icons/circle-alert.svg ; its two line segments are expressed as an equivalent inline SVG path. Jump-to-latest arrow geometry: https://raw.githubusercontent.com/lucide-icons/lucide/0.468.0/icons/arrow-down.svg . Source/version: https://github.com/lucide-icons/lucide/tree/0.468.0 ; license retrieved from https://raw.githubusercontent.com/lucide-icons/lucide/0.468.0/LICENSE . This note does not license the whole project or authorize publication.

## Locally bundled Markdown parser

The safe bot-text renderer uses the existing local markdown-it 15.0.3 browser ESM
(MIT), SHA-256 `d5432491790141da046b1197353705db03264f40b5727f3b4b591f5aba193e30`.
Its publisher bytes are preserved in the review/source tree. Only the parser and
authored safe-DOM renderer are transformed by pinned local esbuild 0.28.2 into a
self-contained generated region of `assets/app.mjs`; the rest of the app is not
rebundled. The aggregate must not be described as unmodified publisher code.

Complete markdown-it, mdurl, uc.micro, linkify-it and punycode.js MIT plus entities
BSD-2-Clause notices are included verbatim as a comment in that generated region.
The review source retains those notices, publisher provenance and the build-tool
MIT licence under `tools/markdown/`. No runtime package, remote CDN, plugin or
source map is loaded. No dependency download or installation was performed for
this change. Historical advisory/provenance metadata is not a fresh security scan.

## Lucide ISC license

Accent-selection checkmark uses the same pinned Lucide 0.468.0 set: https://raw.githubusercontent.com/lucide-icons/lucide/0.468.0/icons/check.svg . Geometry is embedded inline; no CDN or runtime dependency is added.

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

Trailing spaces in the copied license text and human-readable CLI verification logs were normalized for Git whitespace hygiene; license wording, copyright notices, test results and font/artwork bytes were not changed.
