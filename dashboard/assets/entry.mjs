import { signInTargets, checkHermesSignIn } from './signin.mjs';

const status = document.getElementById('entry-status');
const login = document.getElementById('entry-login');
const open = document.getElementById('entry-open');
const check = document.getElementById('entry-check');
let targets;
try { targets = signInTargets(location.href); }
catch { status.textContent = 'This Artemis address is not supported. No other destination was opened.'; }

async function verify() {
  if (!targets || check.disabled) return;
  check.disabled = true; login.hidden = true; open.hidden = true;
  status.textContent = 'Checking this Artemis connection. Nothing is sent.';
  try {
    if (!await checkHermesSignIn(location.origin)) {
      login.href = targets.login; login.hidden = false;
      status.textContent = 'Use Hermes Webapp sign-in, then return here. No separate Artemis account is required.';
    } else if (targets.resume) {
      status.textContent = 'Signed in. Return to your original Artemis tab and choose Reconnect or Verify original connection. This tab will not open another conversation or resend anything.';
    } else {
      open.href = targets.ui; open.hidden = false;
      status.textContent = 'Signed in. Open Artemis, then choose a bot. Nothing is sent automatically.';
    }
  } catch {
    status.textContent = 'This Artemis connection is unavailable. Ask the host owner to check its installation and Hermes Webapp access. No workspace or other profile was opened.';
  } finally { check.hidden = false; check.disabled = false; }
}
check.onclick = verify;
verify();
