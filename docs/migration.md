# Moving from the proof ID to Artemis

[Back to setup](../README.md)

## Preview status and version

This local candidate changes the installed identity from `artemis-owner-proof` (0.0.3) to **`artemis` (0.0.4)**. The pre-1.0 patch increment records a packaging/URL migration, not new functionality or a1.0 stability claim. Author attribution and the Hermes >=0.23.0 floor are unchanged.

**The candidate is not published.** Public main and catalog PR #154018 still reference submitted commit `1f2620f8ad4e54dc144c24a571fd45bb788e8215`. Nothing here updates that PR or its pin. Do not run the new-ID instructions against that old commit and expect a rename. New public-URL installation must be rechecked after approved publication.

Hermes derives the installed identity from the manifest. Installing the new manifest creates a **separate plugin**, not an update/rename of the old slot. Do not leave both identities enabled or assume an installer will preserve/remove the other one for you.

## Before changing an existing installation

1. Finish the current reply. Copy any unsent draft somewhere safe before closing/reloading the page; drafts are page-memory, not a migration payload. Do not resend a delivery with an unknown outcome.
2. Confirm the Hermes home/profile that actually serves Artemis. Back up the complete old plugin directory and inventory **outside watched plugin directories**, including operator-owned extras. Removal deletes plugin files; it is not a backup operation.
3. Keep the submitted full pin above and the exact backup as rollback references. Do not rename folders/manifests in place or merge old compiled assets/bytecode into the new package.
4. Review the new source/pin and normal installer warnings. Stop if admission needs unexpected host dependency updates or an interrupting restart. No proxy, sign-in, provider, profile or credential change is part of this procedure.

## Supported manual lifecycle

Only after the renamed source has been approved and published, install it disabled and check that discovery actually lists the new `artemis` identity. Use --ref with the reviewed new full commit when pinning; the old1f2620f commit is not that commit.

```sh
hermes plugins install https://github.com/LukeJJones/artemis --no-enable
hermes plugins list --user
hermes plugins disable artemis-owner-proof
hermes plugins remove artemis-owner-proof
hermes plugins enable artemis --no-allow-tool-override
hermes plugins list --user
```

The initial new install can coexist **disabled** while the old plugin stays enabled. Disable/remove the old ID only after preserving its files and verifying the new candidate; then enable the new ID deliberately. Do not use --force to make one identity replace another. These commands use supported Hermes plugin lifecycle; no custom automatic migration script is shipped.

For this unpublished candidate, local verification uses the normal Git installer against an immutable **local file:// Git URL**, not a manual copy. That demonstrates local Git/manifest/lifecycle behavior, not public GitHub availability of the new commit. No dependency downloads or core source changes are permitted for that proof.

## Bookmarks, history and browser state

The supported new opening page is:

```text
https://YOUR-HERMES-ORIGIN/dashboard-plugins/artemis/open.html
```

The protected UI/API namespace is `/api/plugins/artemis/`; the SDK tab uses `/artemis`. Old bookmarks/open pages point at the old namespace and are not silently redirected. Update bookmarks and any operator-owned opening-URL settings to the new path, retaining the exact same approved HTTPS origin/port. Neither `/dashboard-plugins/artemis` nor its trailing-slash variant is an automatic index route; use **open.html**.

Hermes still owns the same canonical Bot Chats. This change does not copy, delete, adopt, rewrite or automatically create chat/history/profile records. No side-thread fallback or first send is added. Existing appearance keys remain unchanged and may be shared on the same browser origin; drafts are not transferred. Do not clear site data or sign out to perform this rename.

Already-running host modules/discovery caches can outlive file changes. Supported lifecycle messages and fresh route checks must determine whether a rescan/restart is required on a real installation; source files alone do not prove activation. If an interrupting restart is needed, obtain separate approval. Disposable fresh-process HTTP checks are not a live hot-migration certificate.

## Rollback

If the candidate cannot be admitted or hosted, preserve the failure evidence and disable/remove only `artemis` through the supported lifecycle before restoring the reviewed old package/ID from the exact backup or old full pin. Restore the prior enabled state deliberately, and use the old bookmark again. Keep operator extras safe outside removal targets. Do not restore whole-host auth/config/history or rewind unrelated plugins. No personal-data rollback or browser cache clearing is involved.
