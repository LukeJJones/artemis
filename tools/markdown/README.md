# Offline Markdown runtime maintenance

This is build input, not a second served module or product wiki. The approved
baseline app stays hand-authored. Only the generated region inside its
`renderBotBody()` helper is bundled; do not edit that region by hand.

- Edit `render.mjs` for the allowlisted DOM renderer.
- `vendor/markdown-it-15.0.3.mjs` is the pinned, unmodified local publisher input.
- Complete dependency notices are in `vendor/LICENSES.txt` and are embedded
  verbatim in the generated app region. `vendor/provenance.json` records the
  historical acquisition, not a current online advisory scan.
- `esbuild-pin.json` and `esbuild-LICENSE.md` pin/document the existing local build
  tool. No tool or parser download/install is automatic or authorized here.

From the repository root, with `TMPDIR` explicitly set to an existing temporary directory and receipt paths outside the checkout:

```
node scripts/build_markdown.mjs --esbuild "<existing pinned esbuild.exe>" --receipt "<temporary-directory>/build-check.json" --check
npm test
npm run check
```

The builder runs the same two-input bundle twice, requires identical bytes and
metadata, rejects external imports, verifies tool/parser/notice hashes, and
preserves every app section outside the generated region (line endings normalized
to LF in the app output). The app remains the sole served entry and keeps all
existing native imports. Source maps, parser inputs and build tools are not added
to the runtime payload or static router allowlist.

The pinned tool is esbuild0.28.2 for Windows x64 with the SHA-256 recorded in
`esbuild-pin.json`. Obtain it separately from the official publisher and check
that pin; this repository does not download or install a compiler. Other
platform binaries require separate reviewed pins before use. No executable is
committed. Checking uses two temporary builds and does not rewrite app bytes.
For an intentional renderer change, the same command without `--check` replaces
only the generated helper/parser region, normalizing the app's line endings to
LF. Review the resulting diff and rerun checks; do not run it as an installer.

The public `tests/` directory contains dependency-free, explicitly synthetic Node
tests of the real production functions, not copied Hermes core, live sessions,
private browser recordings or evidence archives. No browser/model verification
is implied by their success. Historical advisory IDs in provenance.json are not
a current vulnerability assessment.

Do not install, publish, replace live assets or change gateway configuration from
this directory. A frozen review and separate Luke approval are required.
