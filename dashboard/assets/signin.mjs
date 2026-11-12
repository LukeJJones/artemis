// Hermes owns authentication. Never consume login_url/next from an API error.
export const ENTRY_PATH = '/dashboard-plugins/artemis/open.html';
export const UI_PATH = '/api/plugins/artemis/ui';
export const CONNECTION_PATH = '/api/plugins/artemis/connection';
export const OPEN_CONFIG_PATH = '/dashboard-plugins/artemis/open-config.json';
export const OPEN_QR_PATH = '/dashboard-plugins/artemis/open-qr.svg';

function page(value) {
  if (typeof value !== 'string' || /[\\\u0000-\u0020\u007f]/.test(value)) throw new Error('Unsupported Artemis URL');
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || !(url.protocol === 'https:' || url.protocol === 'http:' && loopback) ||
      ![ENTRY_PATH, UI_PATH].includes(url.pathname)) throw new Error('Unsupported Artemis URL');
  const allowed = url.pathname === ENTRY_PATH ? ['artemis_profile', 'resume'] : ['artemis_profile'];
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw new Error('Unsupported Artemis selection');
  }
  const profile = url.searchParams.get('artemis_profile');
  if (profile !== null && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile)) throw new Error('Unsupported Artemis profile');
  const resume = url.searchParams.get('resume');
  if (resume !== null && resume !== '1') throw new Error('Unsupported Artemis return');
  if (url.hash && !['#view=home', '#view=chat'].includes(url.hash)) throw new Error('Unsupported Artemis view');
  return url;
}

export function signInTargets(value) {
  const current = page(value);
  const landing = new URL(ENTRY_PATH, current.origin);
  const ui = new URL(UI_PATH, current.origin);
  const profile = current.searchParams.get('artemis_profile');
  if (profile !== null) { landing.searchParams.set('artemis_profile', profile); ui.searchParams.set('artemis_profile', profile); }
  landing.hash = ui.hash = current.hash;
  // A new sign-in tab must not open another chat or try to transfer memory pins.
  const resume = current.pathname === UI_PATH || current.searchParams.get('resume') === '1';
  if (resume) landing.searchParams.set('resume', '1');
  const login = new URL('/login', current.origin);
  login.searchParams.set('next', landing.pathname + landing.search + landing.hash);
  return Object.freeze({ login: login.href, ui: ui.href, resume });
}

export async function checkHermesSignIn(origin, fetcher = fetch) {
  const response = await fetcher(new URL(CONNECTION_PATH, origin), {
    credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' }
  });
  if (response.status === 401) return false;
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Artemis connection unavailable');
  const settings = await response.json();
  if (settings.protocol !== 'artemis-owner-routing-v1' || settings.authority !== 'owner') throw new Error('Unsupported Artemis connection');
  return true;
}

export function configuredOpenURL(config, origin) {
  const url = page(config?.url);
  if (url.protocol !== 'https:' || url.origin !== origin || url.pathname !== ENTRY_PATH || url.search || url.hash || config?.version !== 1) {
    throw new Error('Scan-to-open is not configured for this HTTPS origin');
  }
  return url.href;
}
