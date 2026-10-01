import { createAccount, signIn, redeemInvite, getSession } from './lib/auth.js';

const form = document.querySelector('#join');
const notice = document.querySelector('#notice');
const submit = document.querySelector('#submit');
const codeField = document.querySelector('#code-field');
const passwordError = document.querySelector('#password-error');

// The code arrives in the link. Fill it in and get it out of the way — a
// parent should not have to copy a twelve-character string by hand, and
// leaving it on screen as an editable field invites them to "fix" it.
const codeFromLink = new URLSearchParams(location.search).get('code');
if (codeFromLink) {
  form.code.value = codeFromLink.trim().toUpperCase();
  codeField.classList.add('hidden');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  notice.textContent = '';
  passwordError.textContent = '';

  const code = form.code.value.trim().toUpperCase();
  const email = form.email.value.trim();
  const password = form.password.value;

  if (!code) {
    reveal('Please enter the invitation code from your link.');
    return;
  }
  if (password.length < 6) {
    passwordError.textContent = 'Please use at least 6 characters.';
    form.password.setAttribute('aria-invalid', 'true');
    return;
  }

  busy(true);

  try {
    // The account may already exist — a parent who got halfway and came back,
    // or who typed the address before. Signing them in is the right move, not
    // telling them off.
    let session = await getSession();

    if (!session) {
      try {
        session = await createAccount(email, password);
      } catch (error) {
        if (/already an account/i.test(error.message)) {
          session = await signIn(email, password);
        } else {
          throw error;
        }
      }
    }

    // Claiming the invitation is separate from having an account, and this is
    // the step that actually grants anything: without it the database will not
    // let a family profile exist at all. Doing it after sign-in means a wrong
    // code costs a retry rather than a lost account.
    const claimed = await redeemInvite(code);

    if (!claimed) {
      codeField.classList.remove('hidden');
      reveal(
        'That invitation code did not work. It may have been used already, or ' +
          'expired. Check the link, or ask Idan for a new one — your account ' +
          'is set up, so you only need the code.',
      );
      busy(false);
      form.code.focus();
      return;
    }

    location.replace('/onboarding.html');
  } catch (error) {
    reveal(error.message);
    busy(false);
  }
});

function busy(state) {
  submit.disabled = state;
  submit.textContent = state ? 'Setting things up…' : 'Create my account';
}

function reveal(message) {
  notice.textContent = message;
  notice.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
