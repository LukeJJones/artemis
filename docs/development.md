# Development and verification notes

Start with the [installation and setup guide](../README.md). This operational reference retains the release’s recovery, authority and verification details. Commands below run from the repository root. The plugin remains a companion for **unmodified official Hermes Bot Mode**, not an alternate engine, auth service or history store.

**Version 0.0.3 · community plugin.** The catalog submission pins source commit `1f2620f8ad4e54dc144c24a571fd45bb788e8215`; a submitted PR is not admission or merged catalog approval. The installed ID stays `artemis-owner-proof`. The plugin lives at the repository root, with no `subdir`. Runtime files are already built.

> **Full-owner access, not chat-only.** Your Hermes browser sign-in retains its normal host authority. Artemis does not create a phone-only grant or per-device revocation. Merely reaching the host over LAN or Tailscale is not authorization.

## Requirements

- Unmodified official **Hermes >=0.23.0**, with Bot Mode, host-managed profiles and the supported dashboard/plugin hosting surface. Local verification used official v0.23.0; future Hermes versions still need compatibility checks.
- An existing supported Hermes sign-in method and model/provider configuration managed in Hermes, never Artemis.
- A modern JavaScript browser. **HTTPS/WSS is required outside loopback**, including private networks, with a correctly configured same-origin Web Access endpoint.

## Install from this repository

Use the intended serving home/profile’s normal Hermes CLI. This is a Git installation, not a catalog-name installation. To install the immutable submitted source:

```sh
hermes plugins install https://github.com/LukeJJones/artemis --ref 1f2620f8ad4e54dc144c24a571fd45bb788e8215 --no-enable
```

The installer handles normal source scanning and consent. The plugin declares no Python requirements. Do not bypass warnings. Once deliberately approved:

```sh
hermes plugins enable artemis-owner-proof --no-allow-tool-override
hermes plugins list --user --enabled
```

The manifest supplies the installed ID even though the repository is named `artemis`. Do not rename route segments to match the repository slug.

**Existing installation:** retain the complete plugin and inventory outside watched plugin directories, including unknown/operator-owned extras. An occupied slot may refuse installation; do not blindly use `--force` or assume extras survive replacement. Keep host auth, providers, profiles, history and networking unchanged. If admission needs unexpected host dependency changes or an interrupting restart, stop for explicit approval. Do not substitute copying files for an actual Git-installer proof.

## Open Artemis

Installing the plugin does **not** enable network access. Explicitly configure Web Access in Hermes if needed, then open your existing same-origin HTTPS endpoint:

```text
https://YOUR-HERMES-ORIGIN/dashboard-plugins/artemis-owner-proof/open.html
```

Replace the placeholder with the configured origin, including its port. Sign in through Hermes's same-origin page, return to Artemis and deliberately open it, then select a bot. Initial metadata discovery does not open history, create a conversation or send a prompt. The dashboard tab is a compatibility/authority disclosure, not the connected conversation UI.

No production hostname, token or default public origin is bundled. Appearance storage is separate from page-memory drafts and host-owned history; no offline send/replay behavior is implied.

### Web Access: This network and My own URL

Manage both modes in **Hermes**, not Artemis:

- **This network + external HTTPS:** a network-accessible Hermes bind can sit behind a separately configured trusted HTTPS origin. Local credentials can work behind HTTPS. The proxy must preserve the correct host/protocol and support WebSocket upgrades. LAN reachability does not make an arbitrary external origin a valid OAuth callback target.
- **My own URL:** configure the externally visible origin through Hermes's supported setup. Its scheme, host and port must match the browser's actual URL. Certificates, proxy and DNS remain operator-managed.
- **Nous OAuth:** its callback must match the configured external HTTPS origin. A This network setup reached through a different external URL may accept local credentials but fail the OAuth callback. Correct supported origin/provider configuration; do not weaken auth/Origin checks or forward credentials.

This is configuration guidance, not a fresh remote OAuth test. Artemis does not accept platform terms, expose ports, configure DNS or change network/security policy.

## Conversations and recovery

Every bot uses its canonical conversation titled **Bot Chat**. Existing canonical chats open without creation. Missing/contradictory roster hints are not proof of absence: supported exact-title lookup and consistent root/compression-tip identity are required. Where the host supports canonical creation, only deliberate action after verified absence may create the hidden canonical chat under normal host policy, without new hook consent or an automatic first prompt.

There is **no dedicated Artemis side-thread fallback**, adoption, migration, copy or deletion of old chats. Unsupported contracts and identity/auth/registry conflicts fail closed. Opening or creating the Bot Chat in Hermes itself may be necessary on unsupported hosts. Do not repeat creation after an ambiguous outcome; use explicit check/reconnect.

Drafts and held messages remain scoped to the original host, bot and conversation. After sign-in recovery, keep the original page open, return and deliberately reconnect/verify. Reloading or closing the tab loses page-memory drafts. Unknown/failed admission is not permission for blind resend. Check delivery; restore/discard is a separate deliberate action.

## Runtime boundaries

**Selected** and **Connected** are distinct; selection alone is not conversation verification. Meaningful recovery warnings retain their actions. Safe Markdown keeps untrusted raw HTML inert and does not automatically load remote transcript images. Physical browsers, accessibility technology, remote authentication and canonical execution/history continuity require their own verification; source tests and screenshots do not certify those layers.

## Rule 13: authority, network, processes and privacy

- **Authority:** normal full-owner Hermes Web Access. No restricted chat-only account or per-device revocation. Same-gateway all-browser sign-out affects the shared Webapp/browser providers and profiles, not every native Desktop or other gateway. Someone holding valid credentials may sign in again; ordinary logout is not credential rotation.
- **Network:** browser requests are same-origin assets, sign-in metadata/tickets, roster, canonical history and host gateway execution/recovery. Hermes may contact its configured identity/model/provider/tool services; their normal data handling and costs apply. Artemis adds no independent provider client, telemetry or third-party CDN. Remote use needs operator-managed HTTPS/WSS/callback origins.
- **Reads:** authenticated browser access to Hermes roster, host identity, sign-in metadata, canonical history and execution state. The plugin backend reads its own assets only. No direct config, `.env`, auth-store, keychain, database or other application's credential-store reads.
- **Processes/writes:** no plugin shell hook, daemon, independent server/engine, self-updater or runtime core override. Hermes hosts the plugin; the open page performs connection/recovery checks. Draft/view state stays page-memory, appearance preferences may use browser storage, and saved history remains Hermes-owned. No cached private transcript, silent replay or offline send queue.
- **Dependencies:** no declared plugin Python requirements; backend uses the host FastAPI surface. Fonts, artwork and readable JS are local. No executable binary, Python bytecode or Wasm is committed. Developer scripts are opt-in checks/build tools, not installer hooks; they do not install dependencies or run automatically.

## Verification and development

Recorded evidence for submitted source `1f2620f8ad4e54dc144c24a571fd45bb788e8215`, on official Hermes v0.23.0 / Windows / Python 3.14.9:

- Normal CLI validation of a fresh anonymous public clone: exit 0, all 15 emitted checks passed, security `safe`, warnings `[]`.
- 189 synthetic unit tests, syntax/JSON checks and deterministic Markdown rebuild passed for that source.
- Actual public-URL Git install at that full pin in a fresh isolated home: exit 0, installed-disabled then explicit no-override enable; all 56 tracked file hashes matched the verified public clone.
- Reused isolated HTTP harness: 32 checks, including 20 exact public assets, anonymous rejection, ephemeral-owner access and scoped process cleanup.
- A supplementary whole-core Git-diff probe was incomplete. It was retained separately, not called a clean core audit or used to replace the installer/HTTP evidence.

These are bounded historical results, **not** a fresh audit of this documentation branch, catalog CI/admission, fresh-OS, remote OAuth, physical-device or message-continuity certification. They supersede the earlier directory-copy-only installation checkpoint. Installer warnings are separate from validator warnings: the real installer warns about a custom/unreviewed source, and the live replacement also printed a skipped Node-dependency notice despite package.json containing no dependency groups. No warning was bypassed or hidden. For a later runtime change, validate its exact reviewed checkout in an isolated supported Hermes runtime:

```sh
hermes plugins validate /path/to/artemis --install-deps --json
```

The flags are supported by official v0.23.0 help; the command may install dependencies. It is not run automatically by this repository.

For dependency-free synthetic development checks, use Node >=22:

```sh
npm test
npm run check
```

No `npm install` is required. Tests use labelled synthetic state and reserved example domains; they execute actual production functions but do not access a live Hermes host, copied core fixtures, personal data, providers or a model. They are a curated unit suite, not the complete private browser replay evidence.

`tools/markdown/` contains the readable renderer and pinned licensed parser input. See its operational README for explicit offline build/check commands, esbuild version/hash and platform limits. Runtime assets are committed; never regenerate unrelated UI code or run dependency installers implicitly.

## Licenses and artwork

Project code: **MIT, copyright 2026 Luke Jones**. All original notices remain unchanged:

- [Original LICENSE](../LICENSE) and [LICENSE.md](../LICENSE.md).
- [Artwork provenance and license scope](../NOTICE.md).
- [UI assets, icons and font credits](../dashboard/LICENSE.md).
- [Manrope OFL](../dashboard/assets/Manrope-OFL.txt) and [Caesar Dressing OFL](../dashboard/assets/CaesarDressing-OFL.txt).
- [Parser and dependency MIT/BSD notices](../tools/markdown/vendor/LICENSES.txt).
- [Developer esbuild MIT notice](../tools/markdown/esbuild-LICENSE.md) and [renderer/build provenance](../tools/markdown/README.md).

Custom Artemis artwork was created by Luke Jones using OpenAI ChatGPT. The original NOTICE retains the service-level provenance, unchanged embedded C2PA metadata, derived touch-icon lineage and ownership/rights limits; no specific model-release, exclusivity or legal guarantee is added here. Project MIT licensing does not replace third-party terms.

## Updates, rollback and removal

Updates are deliberate reviewed changes, not in-app downloads. Review the next source/pin and use Hermes's normal tracked Git/plugin update or pinned reinstall workflow. Finish or preserve/discard page-only drafts before reloading; back up exact plugin/operator files. Restore a known-good package only after checking the current state. Do not silently clear browser caches, reset zoom or overwrite host config/auth/history.

To stop using Artemis, close its pages after handling drafts, then deliberately disable it:

```sh
hermes plugins disable artemis-owner-proof
```

Use `hermes plugins remove artemis-owner-proof` only after backing up operator-owned plugin files and deciding to remove it. Removal is not Hermes sign-out, credential revocation, chat deletion or reversal of independently configured network exposure.

Official references: [plugin guide](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins), [catalog rules](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins/catalog-submission), [Web Access documentation](https://hermes-agent.nousresearch.com/docs/reference/cli-commands#hermes-webapp).
