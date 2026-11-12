![Artemis — Hermes Bot Mode in your pocket](docs/images/artemis-banner.png)

# Artemis

**Hermes Bot Mode in your pocket.**

Artemis is a mobile-friendly community companion built on **Hermes Web Access**. Open your bots’ existing **Bot Chat** conversations from your phone, with the same Hermes-owned history—not a separate chat store or agent engine.

Pick a bot, catch up, and keep talking. Light and dark themes, accent colors and readable Markdown let you make the conversation your own.

| [Dark conversation](docs/images/conversation-dark.png) | [Home](docs/images/home.png) | [Light conversation](docs/images/conversation-light.png) |
| :---: | :---: | :---: |
| [<img src="docs/images/conversation-dark.png" width="180" alt="Conversation in dark mode with a pink accent">](docs/images/conversation-dark.png) | [<img src="docs/images/home.png" width="180" alt="Home showing the bot roster">](docs/images/home.png) | [<img src="docs/images/conversation-light.png" width="180" alt="Conversation in light mode with a lime accent">](docs/images/conversation-light.png) |

Click a screenshot to open the original, or [see all six screenshots](docs/gallery.md).

## Install

> **Upgrading from `artemis-owner-proof`?** Since 0.0.4, the installed ID is `artemis`. Read the [migration guide](docs/migration.md) before changing installations; the old identity is not replaced automatically.

Use **Hermes 0.23.1 or newer for catalog installation**, with Bot Mode, a configured model/provider and Hermes Web Access. Earlier clients can silently fall back to an outdated catalog and report that Artemis is missing; [Hermes 0.23.1 fixes this catalog-download issue](https://github.com/NousResearch/hermes-agent/releases/tag/v0.23.1). Artemis’s runtime compatibility floor remains **Hermes >=0.23.0**. Keep the Hermes host running and reachable while you use Artemis.

**Recommended: install from the Hermes plugin catalog.** Search for **Artemis** by **LukeJJones**, install it for the home/profile that serves Web Access, and confirm its switch is **On**. Then follow [Set up and open](#set-up-and-open)—installation alone does not configure remote access.

For CLI installation from the same reviewed catalog:

```sh
hermes plugins install artemis --no-enable
hermes plugins enable artemis --no-allow-tool-override
```

Already installed? Back up the plugin and any operator-owned files outside its plugin directory before replacing it; don’t blindly add `--force`. Installing `artemis` does not replace or migrate the old `artemis-owner-proof` identity automatically.

**Alternative: install directly from GitHub.**

```sh
hermes plugins install https://github.com/LukeJJones/artemis --no-enable
hermes plugins enable artemis --no-allow-tool-override
```

A direct Git URL without `--ref` follows the repository’s default branch, not necessarily the catalog’s reviewed commit. Prefer the catalog path above; for an exact direct install, add `--ref` with the full commit SHA you intend to install. Review the installer’s source warning before enabling.

## Set up and open

1. Enable Bot Mode and Web Access in **Hermes** using the [official Web Access guide](https://hermes-agent.nousresearch.com/docs/reference/cli-commands#hermes-webapp). Installing Artemis does not expose your host or configure networking.
2. Set up **HTTPS for remote access**, including private networks. **My own URL** is recommended for Nous Portal OAuth: the external HTTPS origin—including any port—must match the address in your browser and Hermes’s callback configuration.
3. Open the address below, replacing `https://YOUR-HERMES-ORIGIN` with your actual HTTPS origin, including its port. Sign in through Hermes, return to Artemis and select a bot.

```text
https://YOUR-HERMES-ORIGIN/dashboard-plugins/artemis/open.html
```

**Using Tailscale?** Connect the host and remote device to your tailnet with access between them. The host’s full MagicDNS name gives you a hostname, **not TLS or a proxy**. Supply HTTPS through [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) or another correctly configured HTTPS server/reverse proxy, with WebSocket forwarding. Tailscale is optional; Funnel is unnecessary for private tailnet access.

**This network** can also work behind HTTPS forwarding that reaches Hermes over Tailscale, using your **local Hermes username/password**. A mismatched external origin can still break Nous Portal OAuth. Network reachability and HTTPS do not replace Hermes sign-in; manage the origin and sign-in settings in Hermes, not Artemis.

### Troubleshooting: installed, but “Plugin not found”

If Artemis shows **On** but its opening URL returns `{"detail":"Plugin not found"}`, Hermes may still have an older dashboard-plugin discovery cache.

1. In the **same signed-in browser**, open the URL below using your own Hermes HTTPS origin, including any port:

   ```text
   https://YOUR-HERMES-ORIGIN/api/dashboard/plugins/rescan
   ```

2. Confirm the response includes `"ok": true`, then retry:

   ```text
   https://YOUR-HERMES-ORIGIN/dashboard-plugins/artemis/open.html
   ```

This refreshes dashboard-plugin discovery without reinstalling Artemis or restarting Hermes. If you receive `401` or a sign-in page, sign in normally through Hermes on that same origin first. If the rescan succeeds but Artemis still does not open, check that it is installed and enabled in the home/profile serving that address, then [ask for help](#help). Do not clear chats, browser storage or credentials to fix a discovery error.

## Access and privacy

- **Full-owner sign-in, not chat-only access.** Artemis does not create its own credentials, a phone-only grant or per-device revocation. Same-gateway all-browser sign-out is not a universal Desktop/other-gateway sign-out or credential rotation.
- **What it reads:** the browser accesses the host’s bot roster, identity, sign-in metadata, canonical history and execution state. The plugin backend reads its own assets only—not config, credential stores, keychains or databases directly.
- **Where requests go:** Artemis makes same-origin host requests. Hermes’s normal configured identity, model/provider and tool calls—and their costs—still apply. Artemis adds no telemetry, separate provider client or third-party CDN.
- **What runs:** Hermes hosts Artemis. The plugin runs no shell commands, separate daemon, independent server or self-updater, and makes no runtime core overrides.
- **What stays:** appearance preferences may use browser storage; drafts stay in page memory and are lost on reload/close. Hermes owns saved history. There is no private-transcript offline cache, offline send queue or automatic send replay. If delivery is unclear, check before trying again.

## Uninstall

Close Artemis after handling any draft. Back up operator-owned plugin files before removal, then run:

```sh
hermes plugins disable artemis
hermes plugins remove artemis
```

This removes the companion, **not your bots or chats**. It does not sign you out or undo networking you configured separately.

## Help

[GitHub Issues](https://github.com/LukeJJones/artemis/issues) is the place for bugs and setup questions. Include your Artemis/Hermes versions, device, browser and a sanitized error description. Never post credentials, login callback links or private conversations.

[Development and verification notes](docs/development.md) cover pinned installs, recovery contracts and test scope. Screenshots show the interface, not a certification of every browser or remote sign-in setup.

## License and credits

Code is [MIT licensed](LICENSE), copyright 2026 Luke Jones. Custom Artemis artwork was created by Luke Jones using OpenAI ChatGPT. See the [original license, artwork and third-party notices](docs/development.md#licenses-and-artwork) for all credits and terms.
