// Runs before CSS: only two validated, nonsecret appearance preferences.
(() => {
  const ACCENTS = {
    lime: { solid: '#b8ed57', light: ['#3d5f0d', '#f0f7e6'], dark: ['#c7ed96', '#202a18'] },
    blue: { solid: '#609af8', light: ['#174e9c', '#eaf1fc'], dark: ['#a8caff', '#182438'] },
    cyan: { solid: '#53d4e1', light: ['#075d68', '#e5f6f8'], dark: ['#8ee3ed', '#132c30'] },
    green: { solid: '#62cf92', light: ['#145c35', '#e8f5ec'], dark: ['#96e5b5', '#172d21'] },
    yellow: { solid: '#f2d45c', light: ['#665100', '#fcf5da'], dark: ['#f0dc8a', '#302a13'] },
    orange: { solid: '#f3a35f', light: ['#813b0d', '#fceddf'], dark: ['#f6c69b', '#342315'] },
    pink: { solid: '#ef9bbe', light: ['#853858', '#fbeaf1'], dark: ['#f4bcd4', '#321e28'] },
    magenta: { solid: '#d991e8', light: ['#763184', '#f5e9f8'], dark: ['#e8b5f3', '#2e1c33'] },
    purple: { solid: '#aa96ef', light: ['#513591', '#f0ecfa'], dark: ['#d0c2fa', '#261f36'] },
    neutral: { solid: null, light: ['#111214', '#f2f3f5'], dark: ['#f5f5f6', '#1b1d21'] }
  };
  const root = document.documentElement, media = matchMedia('(prefers-color-scheme: dark)');
  let override = null, accent = 'lime', storageAvailable = true;
  try {
    const saved = localStorage.getItem('artemis.theme.v1');
    if (['light', 'dark'].includes(saved)) override = saved;
    const savedAccent = localStorage.getItem('artemis.accent.v1');
    if (Object.hasOwn(ACCENTS, savedAccent)) accent = savedAccent;
  } catch { storageAvailable = false; }
  let theme = override || (media.matches ? 'dark' : 'light');
  const listeners = new Set();
  function foreground(hex) {
    const rgb = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    const l = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
    return (l + .05) / .05 >= 1.05 / (l + .05) ? '#000000' : '#ffffff';
  }
  function apply() {
    root.dataset.theme = theme; root.dataset.accent = accent;
    const [ink, soft] = ACCENTS[accent][theme], solid = ACCENTS[accent].solid || ink;
    for (const [name, value] of [['solid', solid], ['on', foreground(solid)], ['ink', ink], ['ink-on', foreground(ink)], ['soft', soft]]) root.style.setProperty('--accent-' + name, value);
    for (const listener of listeners) listener();
  }
  function persist(key, value) { try { localStorage.setItem(key, value); } catch { storageAvailable = false; } }
  window.artemisAppearance = Object.freeze({
    ACCENTS, foreground,
    snapshot: () => ({ theme, accent, storageAvailable }),
    setTheme(value) { if (!['light', 'dark'].includes(value)) return; theme = override = value; persist('artemis.theme.v1', value); apply(); },
    setAccent(value) { if (!Object.hasOwn(ACCENTS, value)) return; accent = value; persist('artemis.accent.v1', value); apply(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  });
  media.addEventListener('change', () => { if (override === null) { theme = media.matches ? 'dark' : 'light'; apply(); } });
  apply();
})();
