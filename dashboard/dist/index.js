// Supported dashboard SDK entry, only a visible compatibility disclosure.
(() => {
  const sdk = window.__HERMES_PLUGIN_SDK__;
  const registry = window.__HERMES_PLUGINS__;
  if (!sdk || !registry) return;
  function ArtemisEntry() {
    return sdk.React.createElement("section", null,
      sdk.React.createElement("h1", null, "Artemis"),
      sdk.React.createElement("p", null, "Owner-level host access, not chat-only or device-restricted."),
      sdk.React.createElement("p", null, "No conversation connected. Dashboard UI registration is not a Messaging platform."));
  }
  registry.register("artemis", ArtemisEntry);
})();
