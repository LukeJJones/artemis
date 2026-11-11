# Artemis

A mobile-first companion for **unmodified official Hermes Bot Mode**. Artemis opens your bots’ canonical **Bot Chat** conversations using Hermes Web Access, Hermes sign-in and the host-owned gateway. It is not a Hermes fork, separate agent engine, alternate authentication service or independent history store.

**Version 0.0.3 · community plugin · not catalog-approved.** The internal plugin ID is `artemis-owner-proof`; retain it for route compatibility. The plugin lives at this repository's root: **no `subdir` is needed**. Runtime files are ready to serve; Node and a frontend build are not installation prerequisites.

> **Full-owner access, not chat-only.** Your Hermes browser sign-in retains its normal host authority. Artemis does not create a phone-only grant or per-device revocation. Merely reaching the host over LAN or Tailscale is not authorization.

## Requirements

- Unmodified official **Hermes >=0.23.0**, with Bot Mode, host-managed profiles and the supported dashboard/plugin hosting surface. Local verification used official v0.23.0; future Hermes versions still need compatibility checks.
- An existing supported Hermes sign-in method and model/provider configuration managed in Hermes, never Artemis.
- A modern JavaScript browser. **HTTPS/WSS is required outside loopback**, including private networks, with a correctly configured same-origin Web Access endpoint.

## Install from this repository

Use the intended serving profile's normal Hermes CLI. First review the source, notices and your active Hermes home/profile. This is a Git installation, not a catalog-name installation.

```sh
hermes plugins install https://github.com/LukeJJones/artemis --no-enable
hermes plugins list --user
```

For an immutable install, add `--ref` followed by the **full 40-character reviewed public commit SHA** from GitHub:

```sh
hermes plugins install https://github.com/LukeJJones/artemis --ref FULL_REVIEWED_COMMIT_SHA --no-enable
```

`FULL_REVIEWED_COMMIT_SHA` is a placeholder, not a literal argument. The installer scans the tree and handles normal dependency consent; no plugin Python requirements are declared. Do not use warning-bypass flags. Once deliberately approved:

```sh
hermes plugins enable artemis-owner-proof --no-allow-tool-override
hermes plugins list --user --enabled
```

The manifest supplies the installed ID even though the repository is named `artemis`. Do not rename route segments to match the repository slug.

**Existing local installation?** Stop before replacing it. Back up the exact plugin directory and inventory outside watched plugin directories, plus any operator-created URL/QR configuration. A fresh install command can refuse an occupied directory. Do not blindly add `--force`, merge an unchecked ZIP or assume a manual install's extra files will be carried forward. Keep host auth, providers, profiles, history and networking unchanged. Follow Hermes's normal reviewed lifecycle if activation requires it; this plugin never restarts Hermes.

The supported manual alternative is to copy the reviewed repository into the intended `<Hermes home>/plugins/artemis-owner-proof/`, preserving its structure, then review discovery and enablement normally. Determine the correct home through your own Hermes setup, not a guessed platform path.

## Open Artemis

Installing the plugin does **not** enable network access. Explicitly configure Web Access in Hermes if needed, then open your existing same-origin HTTPS endpoint:

```text
https://YOUR-HERMES-ORIGIN/dashboard-plugins/artemis-owner-proof/open.html
```

Replace the placeholder with the configured origin, including its port. Sign in through Hermes's same-origin page, return to Artemis and deliberately open it, then select a bot. Initial metadata discovery does not open history, create a conversation or send a prompt. The dashboard tab is a compatibility/authority disclosure, not the connected conversation UI.

No production hostname, QR, token or default public origin is bundled. A QR, if you create one separately, should contain only the approved HTTPS address—never credentials or tickets. No PWA manifest, service worker or offline prompt queue is shipped.

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

## Current UI and limits

- Verified bot roster; **Selected** and **Connected** are distinct. Selection alone is not live conversation verification.
- Compact, structured Home connection/recovery toast with safe-area/reduced-motion treatment; no reserved layout gap or routine choosing/ready chatter. Unresolved actionable conditions retain recovery/Details access.
- Safe bot Markdown, scoped drafts, keyboard navigation, light/dark themes and accent preferences. Untrusted raw HTML remains inert; remote transcript images do not load automatically.
- **Uploads are not implemented**; attachment control is hidden. Initials are the avatar fallback; real profile portraits are deferred. There is no production Stop action, working Rooms UI or promised PWA/offline installation support.
- Physical browsers, accessibility technology, remote authentication and canonical execution/history continuity require their own verification. Local source tests are not inference or production-readiness proof.

## Rule 13: authority, network, processes and privacy

- **Authority:** normal full-owner Hermes Web Access. No restricted chat-only account or per-device revocation. Same-gateway all-browser sign-out affects the shared Webapp/browser providers and profiles, not every native Desktop or other gateway. Someone holding valid credentials may sign in again; ordinary logout is not credential rotation.
- **Network:** browser requests are same-origin assets, sign-in metadata/tickets, roster, canonical history and host gateway execution/recovery. Hermes may contact its configured identity/model/provider/tool services; their normal data handling and costs apply. Artemis adds no independent provider client, telemetry or third-party CDN. Remote use needs operator-managed HTTPS/WSS/callback origins.
- **Reads:** authenticated browser access to Hermes roster, host identity, sign-in metadata, canonical history and execution state. The plugin backend reads its own assets only. No direct config, `.env`, auth-store, keychain, database or other application's credential-store reads.
- **Processes/writes:** no plugin shell hook, daemon, independent server/engine, self-updater or runtime core override. Hermes hosts the plugin; the open page performs connection/recovery checks. Draft/view state stays page-memory, appearance preferences may use browser storage, and saved history remains Hermes-owned. No cached private transcript, silent replay or offline send queue.
- **Dependencies:** no declared plugin Python requirements; backend uses the host FastAPI surface. Fonts, artwork and readable JS are local. No executable binary, Python bytecode or Wasm is committed. Developer scripts are opt-in checks/build tools, not installer hooks; they do not install dependencies or run automatically.

## Verification and development

Local official CLI admission with `--install-deps --json` passed all 15 emitted checks, security `safe`, warnings empty. Isolated local-directory discovery/enable/loopback HTTP hosting also passed. These are not catalog CI/admission, fresh-OS, public-install, remote OAuth, physical-device or message-continuity certificates. After any change, validate the exact reviewed checkout in an isolated supported Hermes runtime:

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

## License and artwork

Project code: **MIT, copyright 2026 Luke Jones**, in the original `LICENSE` and `LICENSE.md`. Third-party font/parser/icon terms remain separate in `dashboard/LICENSE.md`, bundled font notices and `tools/markdown/vendor/LICENSES.txt`; MIT code licensing does not replace them.

Custom AI-generated Artemis artwork was created by Luke Jones directly using OpenAI ChatGPT on Pro. No particular model release is independently verified or claimed here. OpenAI consumer Terms Content ownership applies as between the user and OpenAI to the extent permitted by law; it does not guarantee copyrightability, uniqueness, noninfringement or Pro-exclusive copyright. The 180px touch-icon lineage is recorded in `NOTICE.md`. No further generation-service confirmation is requested or blanket third-party rights clearance asserted.

## Updates, rollback and removal

Updates are deliberate reviewed changes, not in-app downloads. Review the next source/pin and use Hermes's normal tracked Git/plugin update or pinned reinstall workflow. Finish or preserve/discard page-only drafts before reloading; back up exact plugin/operator files. Restore a known-good package only after checking the current state. Do not silently clear browser caches, reset zoom or overwrite host config/auth/history.

To stop using Artemis, close its pages after handling drafts, then deliberately disable it:

```sh
hermes plugins disable artemis-owner-proof
```

Use `hermes plugins remove artemis-owner-proof` only after backing up operator-owned plugin files and deciding to remove it. Removal is not Hermes sign-out, credential revocation, chat deletion or reversal of independently configured network exposure.

Official references: [plugin guide](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins), [catalog rules](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins/catalog-submission), [Web Access documentation](https://hermes-agent.nousresearch.com/docs/reference/cli-commands#hermes-webapp).
