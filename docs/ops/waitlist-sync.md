# Waitlist early-access sync

Use this flow while sign-ups are limited to Google Form waitlist emails:

Google Form responses -> Apps Script -> `/api/waitlist/sync` -> Supabase `waitlist_entries`

## Environment variables

Set these in Vercel and local `.env.local`:

```txt
NEXT_PUBLIC_WAITLIST_URL=https://forms.gle/ucr5SGqiX6A6TJ8K7
WAITLIST_SYNC_SECRET=<long random secret>
SUPABASE_SERVICE_ROLE_KEY=<already configured service role key>
```

`WAITLIST_SYNC_SECRET` is shared only between Google Apps Script and the app API.

## Google Apps Script

Keep the existing public waitlist count endpoint, then add the sync code below in the same Apps Script project.

```js
const FORM_EDIT_URL = 'https://docs.google.com/forms/d/1_udlc3I0AWFZCxZIee1uzSl-ztichCuoQObTPTMYAgs/edit';
const WAITLIST_SYNC_URL = 'https://YOUR_DOMAIN.com/api/waitlist/sync';
const WAITLIST_SYNC_SECRET = 'PASTE_THE_SAME_SECRET_HERE';

function doGet() {
  const form = FormApp.openByUrl(FORM_EDIT_URL);
  const count = Math.floor(form.getResponses().length / 10) * 10;

  return ContentService
    .createTextOutput(JSON.stringify({ count }))
    .setMimeType(ContentService.MimeType.JSON);
}

const EMAIL_QUESTION_TITLES = [
  'email',
  'email address',
  'e-mail',
  'what is your email?',
];
const FIRST_NAME_QUESTION_TITLES = [
  'first name',
  'parent first name',
  'guardian first name',
];
const LAST_NAME_QUESTION_TITLES = [
  'last name',
  'parent last name',
  'guardian last name',
];

function normalizeTitle(value) {
  return String(value || '').trim().toLowerCase();
}

function getAnswerByTitle(itemResponses, candidates) {
  const normalizedCandidates = candidates.map(normalizeTitle);
  const match = itemResponses.find((itemResponse) => {
    const title = normalizeTitle(itemResponse.getItem().getTitle());
    return normalizedCandidates.indexOf(title) >= 0;
  });

  return match ? String(match.getResponse() || '').trim() : '';
}

function formResponseToEntry(response) {
  const itemResponses = response.getItemResponses();
  const raw = {};

  itemResponses.forEach((itemResponse) => {
    raw[itemResponse.getItem().getTitle()] = itemResponse.getResponse();
  });

  const collectedEmail = response.getRespondentEmail
    ? String(response.getRespondentEmail() || '').trim()
    : '';
  const typedEmail = getAnswerByTitle(itemResponses, EMAIL_QUESTION_TITLES);

  return {
    email: collectedEmail || typedEmail,
    first_name: getAnswerByTitle(itemResponses, FIRST_NAME_QUESTION_TITLES),
    last_name: getAnswerByTitle(itemResponses, LAST_NAME_QUESTION_TITLES),
    source: 'google_form',
    external_id: response.getId(),
    raw_payload: raw,
  };
}

function syncEntries(entries) {
  const response = UrlFetchApp.fetch(WAITLIST_SYNC_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: `Bearer ${WAITLIST_SYNC_SECRET}`,
    },
    payload: JSON.stringify({ entries }),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error(`Waitlist sync failed (${code}): ${text}`);
  }

  Logger.log(text);
  console.log(text);
}

function syncAllWaitlistRows() {
  const form = FormApp.openByUrl(FORM_EDIT_URL);
  const entries = form
    .getResponses()
    .map(formResponseToEntry)
    .filter((entry) => entry.email);

  Logger.log(`Found ${entries.length} waitlist emails to sync.`);
  console.log(`Found ${entries.length} waitlist emails to sync.`);

  const batchSize = 100;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    Logger.log(`Syncing batch ${i + 1}-${i + batch.length}`);
    console.log(`Syncing batch ${i + 1}-${i + batch.length}`);
    syncEntries(batch);
  }

  Logger.log('Waitlist sync complete.');
  console.log('Waitlist sync complete.');
}

function onWaitlistFormSubmit(event) {
  if (event && event.response) {
    syncEntries([formResponseToEntry(event.response)]);
    return;
  }

  syncAllWaitlistRows();
}
```

## Triggers

In Apps Script, open **Triggers** and add:

- `onWaitlistFormSubmit`
  - Event source: From form
  - Event type: On form submit
- `syncAllWaitlistRows`
  - Event source: Time-driven
  - Run daily

After setting the code, run `syncAllWaitlistRows()` once manually to backfill the existing waitlist.

## Deployment check

After deploying the app, open this URL in a browser:

```txt
https://YOUR_DOMAIN.com/api/waitlist/sync
```

The response should be:

```json
{"ok":true,"route":"waitlist-sync"}
```

If you see a 404 page, the deployed site does not have the waitlist sync API yet. Push/deploy the latest app code before running the Apps Script again.

## Sign-up behavior

- Existing users can still sign in with phone or email.
- New early-access users must use the waitlist email first.
- After joining by email, users can add a phone number during onboarding and use phone sign-in later.
- Gmail addresses normalize dots and `+tag`.
  - `sojung.kim+kids@gmail.com` matches `sojungkim@gmail.com`
- Non-Gmail addresses keep `+tag` as-is.
