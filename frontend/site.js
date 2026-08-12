/* ===================================================================
   PUBLIC SITE  — index.html / about.html / contact.html

   Everything the three public pages need, in one file: the mobile
   navigation, the footer year, and the Contact form's validation and
   submission.

   Deliberately independent of app.js. The public pages are the part of
   the site a stranger sees, so they load no forecast data, no auth
   client and no icon CDN — a broken network leaves them fully readable.
   The only network call anywhere here is the one that posts a contact
   message, and it happens on submit, never on load.
   =================================================================== */

/* ===================================================================
   NAVIGATION
   The header nav is a normal row on desktop and a drop-down panel under
   the logo on narrow screens; which of the two is in play is decided
   entirely in CSS. This only tracks whether the panel is open.
   =================================================================== */
(function initNav() {
  const toggle = document.getElementById('site-nav-toggle');
  const nav    = document.getElementById('site-nav');
  if (!toggle || !nav) return;

  function setOpen(open) {
    nav.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
  }

  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('open')));

  /* An in-page link (Home's "See how it works") scrolls without a
     reload, so nothing else would close the panel it scrolled behind. */
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setOpen(false)));

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && nav.classList.contains('open')) {
      setOpen(false);
      toggle.focus();
    }
  });

  /* Widening past the breakpoint turns the panel back into a plain row.
     CSS handles the layout, but .open would otherwise survive the resize
     and leave the menu "open" with nothing to close. The 900 here is the
     breakpoint in style.css. */
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) setOpen(false);
  });
})();

/* Sticky header gets its shadow only once there is content behind it. */
(function initHeaderShadow() {
  const header = document.getElementById('site-header');
  if (!header) return;
  const sync = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  sync();
  window.addEventListener('scroll', sync, { passive: true });
})();

/* The copyright year is the one thing on a static page guaranteed to be
   wrong eventually, so it is filled in rather than typed. */
(function initYear() {
  const el = document.getElementById('site-year');
  if (el) el.textContent = String(new Date().getFullYear());
})();

/* ===================================================================
   CONTACT FORM

   Validation rules live in one map keyed by field id. Each returns an
   error string, or '' when the value is acceptable. Keeping them
   together means the submit handler, the live re-check and any future
   field all go through the same definition of "valid".

   The same rules are declared again as CHECK constraints in
   supabase/schema.sql. Not redundancy: the anon key can POST to the
   table directly over PostgREST without ever loading this page, so the
   database has to be able to refuse a bad row on its own.
   =================================================================== */
(function initContactForm() {
  const form = document.getElementById('contact-form');
  if (!form) return;                    /* not the Contact page */

  const TOPICS = ['quote', 'shipment', 'platform', 'partnership', 'other'];
  const MESSAGE_MIN = 20;
  const MESSAGE_MAX = 1000;

  const VALIDATORS = {
    'cf-name': v => {
      if (!v) return 'Please enter your name.';
      if (v.length < 2) return 'That is too short to be a name.';
      if (v.length > 80) return 'Please keep this under 80 characters.';
      /* Letters from any alphabet, plus the punctuation real names carry
         — O'Brien, Mary-Jane, A/P Rajan, Jr. Digits are the giveaway
         that something other than a name has been pasted in. */
      if (!/^[\p{L}][\p{L}\s.'\/-]*$/u.test(v)) {
        return 'Use letters, spaces, hyphens and apostrophes only.';
      }
      return '';
    },

    'cf-email': v => {
      if (!v) return 'Please enter your email address.';
      if (v.length > 120) return 'Please keep this under 120 characters.';
      /* Deliberately loose. The only address that truly validates is one
         that accepts a message, so this catches typing mistakes and
         leaves the rest to the reply. */
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
        return 'That does not look like an email address.';
      }
      return '';
    },

    'cf-company': v => {
      if (v.length > 80) return 'Please keep this under 80 characters.';
      return '';
    },

    'cf-phone': v => {
      if (!v) return '';                /* optional */
      const digits = v.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) {
        return 'Enter a phone number with 7 to 15 digits, or leave it blank.';
      }
      if (!/^[+(]?[\d\s()+-]+$/.test(v)) {
        return 'Use digits, spaces, and + ( ) - only.';
      }
      return '';
    },

    'cf-topic': v => {
      if (!v) return 'Please choose what this is about.';
      if (!TOPICS.includes(v)) return 'Please choose one of the listed options.';
      return '';
    },

    'cf-message': v => {
      if (!v) return 'Please write a message.';
      if (v.length < MESSAGE_MIN) {
        return `Please give us a little more to go on (at least ${MESSAGE_MIN} characters).`;
      }
      if (v.length > MESSAGE_MAX) {
        return `That is ${v.length - MESSAGE_MAX} characters over the limit.`;
      }
      return '';
    },

    'cf-consent': checked => {
      if (!checked) return 'We need your agreement before we can store your details.';
      return '';
    },
  };

  const FIELD_IDS = Object.keys(VALIDATORS);

  /* False until the first submit: nobody wants to be told their email is
     invalid while they are still on the second character of it. After
     that, errors clear live as they are fixed. */
  let attempted = false;

  const el = id => document.getElementById(id);
  const valueOf = input => (input.type === 'checkbox' ? input.checked : input.value.trim());

  function setFieldError(id, message) {
    const input = el(id);
    const slot  = el(id + '-error');
    if (!input || !slot) return;

    input.classList.toggle('is-invalid', !!message);
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    slot.textContent = message;
    slot.classList.toggle('hidden', !message);
  }

  function validateField(id) {
    const input = el(id);
    if (!input) return '';
    const message = VALIDATORS[id](valueOf(input));
    setFieldError(id, message);
    return message;
  }

  /* Live re-check, but only once the user has been told there is a
     problem — see `attempted`. */
  FIELD_IDS.forEach(id => {
    const input = el(id);
    if (!input) return;
    const event = input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input';
    input.addEventListener(event, () => { if (attempted) validateField(id); });
  });

  /* Character counter. Turns red at the limit rather than silently
     truncating what was pasted in. */
  const message = el('cf-message');
  const counter = el('cf-message-count');
  if (message && counter) {
    const syncCount = () => {
      const n = message.value.trim().length;
      counter.textContent = `${n} / ${MESSAGE_MAX}`;
      counter.classList.toggle('is-over', n > MESSAGE_MAX);
    };
    message.addEventListener('input', syncCount);
    syncCount();
  }

  function showFormError(html) {
    const box = el('cf-form-error');
    box.innerHTML = html;
    box.classList.remove('hidden');
  }

  function clearFormError() {
    el('cf-form-error').classList.add('hidden');
  }

  function showSuccess() {
    form.classList.add('hidden');
    const ok = el('cf-success');
    ok.classList.remove('hidden');

    /* Focus first, so the confirmation is what a screen reader reads next
       — but without the scroll focus() would do on its own, which parks
       the panel's own top edge at the viewport top and therefore under
       the sticky header. Scrolling the whole card instead (with the
       scroll-margin in style.css clearing the header) shows the
       confirmation in one piece. */
    ok.focus({ preventScroll: true });
    document.querySelector('.contact-form-card')
            ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /* ── Submission ──
     Posts straight to PostgREST rather than through the supabase-js
     client, matching how the rest of this project writes rows (see
     insertHistoryRecord in app.js) and keeping the public pages free of
     the auth SDK they otherwise have no use for.

     `return=minimal` is not an optimisation: contact_messages has an
     insert policy but deliberately no select policy, so nobody holding
     the public anon key can read the inbox back. Asking for the inserted
     row would therefore be refused. */
  async function postMessage(payload) {
    if (typeof SUPABASE_URL === 'undefined' || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('Supabase is not configured');
    }
    const res = await fetch(`${SUPABASE_URL}/rest/v1/contact_messages`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${await res.text()}`);
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    attempted = true;
    clearFormError();

    const firstBad = FIELD_IDS.map(id => ({ id, message: validateField(id) }))
                              .find(r => r.message);
    if (firstBad) {
      const input = el(firstBad.id);
      input.focus();
      input.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    /* Honeypot: a value here means a bot filled every input on the page.
       Reporting the rejection would only teach it to skip the field, so
       the submission is dropped behind the ordinary success screen. */
    if (el('cf-website').value.trim()) {
      showSuccess();
      return;
    }

    const btn = el('cf-submit');
    btn.disabled = true;
    btn.textContent = 'Sending…';

    try {
      await postMessage({
        full_name:     el('cf-name').value.trim(),
        email:         el('cf-email').value.trim().toLowerCase(),
        company:       el('cf-company').value.trim() || null,
        phone:         el('cf-phone').value.trim() || null,
        topic:         el('cf-topic').value,
        message:       el('cf-message').value.trim(),
        consent_given: true,
      });
      showSuccess();
    } catch (err) {
      console.error('Contact form submission failed:', err);
      /* The message was typed and is now stuck in a form. Give them the
         address to send it to instead of only an apology. */
      showFormError(
        'We could not send that just now. Please try again, or email us directly at ' +
        '<a href="mailto:hello@goodfortune.com">hello@goodfortune.com</a>.'
      );
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send message';
    }
  });

  el('cf-reset')?.addEventListener('click', () => {
    form.reset();
    attempted = false;
    FIELD_IDS.forEach(id => setFieldError(id, ''));
    clearFormError();
    if (counter) counter.textContent = `0 / ${MESSAGE_MAX}`;
    counter?.classList.remove('is-over');
    el('cf-success').classList.add('hidden');
    form.classList.remove('hidden');
    el('cf-name').focus();
  });
})();
