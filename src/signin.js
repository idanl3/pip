import { signIn, getSession } from './lib/auth.js';
import { routeAfterSignIn } from './lib/routing.js';

const form = document.querySelector('#signin');
const notice = document.querySelector('#notice');
const submit = document.querySelector('#submit');

// Already signed in? Don't make them do it again — sessions here are
// deliberately long-lived, so arriving at the sign-in page usually means
// someone just typed the address.
getSession()
  .then((session) => {
    if (session) routeAfterSignIn();
  })
  .catch(() => {
    /* No session to find. Showing the form is the right outcome. */
  });

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  notice.textContent = '';
  submit.disabled = true;
  submit.textContent = 'Signing in…';

  try {
    await signIn(form.email.value, form.password.value);
    await routeAfterSignIn();
  } catch (error) {
    notice.textContent = error.message;
    submit.disabled = false;
    submit.textContent = 'Sign in';
    form.password.select();
  }
});
