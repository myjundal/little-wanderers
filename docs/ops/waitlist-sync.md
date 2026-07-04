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
const WAITLIST_SYNC_CURSOR_KEY = 'waitlistSyncNextResponseIndex';
const WAITLIST_SYNC_BATCH_SIZE = 50;
const WAITLIST_SYNC_RECENT_RESPONSE_COUNT = 50;
const WAITLIST_SYNC_MAX_RUNTIME_MS = 5 * 60 * 1000;

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
  'parent email',
  'parent email address',
  'guardian email',
  'guardian email address',
  'what is your email?',
  '이메일',
  '이메일 주소',
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
    return normalizedCandidates.some((candidate) => (
      title === candidate || title.indexOf(candidate) >= 0
    ));
  });

  return match ? String(match.getResponse() || '').trim() : '';
}

function isLikelyEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function findEmailInResponses(itemResponses) {
  const titledEmail = getAnswerByTitle(itemResponses, EMAIL_QUESTION_TITLES);
  if (isLikelyEmail(titledEmail)) return titledEmail;

  const match = itemResponses.find((itemResponse) => {
    const answer = itemResponse.getResponse();
    return isLikelyEmail(answer);
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
  const typedEmail = findEmailInResponses(itemResponses);

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
  if (!entries.length) return;

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

function responsesToEntries(responses) {
  return responses
    .map(formResponseToEntry)
    .filter((entry) => entry.email);
}

function syncRecentWaitlistRows(responses) {
  const startIndex = Math.max(0, responses.length - WAITLIST_SYNC_RECENT_RESPONSE_COUNT);
  const recentResponses = responses.slice(
    startIndex
  );
  const entries = responsesToEntries(recentResponses);

  Logger.log(`Syncing ${entries.length} recent waitlist emails from responses ${startIndex + 1}-${responses.length}.`);
  console.log(`Syncing ${entries.length} recent waitlist emails from responses ${startIndex + 1}-${responses.length}.`);
  syncEntries(entries);
}

function syncAllWaitlistRows() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log('Another waitlist sync is already running; skipping this run.');
    console.log('Another waitlist sync is already running; skipping this run.');
    return;
  }

  try {
    const startedAt = Date.now();
    const form = FormApp.openByUrl(FORM_EDIT_URL);
    const properties = PropertiesService.getScriptProperties();
    const responses = form.getResponses();
    const totalResponses = responses.length;
    const savedIndex = Number(properties.getProperty(WAITLIST_SYNC_CURSOR_KEY) || '0');
    let nextIndex = Math.min(Math.max(0, savedIndex), totalResponses);

    syncRecentWaitlistRows(responses);

    Logger.log(`Resuming waitlist backfill at response ${nextIndex + 1} of ${totalResponses}.`);
    console.log(`Resuming waitlist backfill at response ${nextIndex + 1} of ${totalResponses}.`);

    while (nextIndex < totalResponses) {
      if (Date.now() - startedAt > WAITLIST_SYNC_MAX_RUNTIME_MS) {
        Logger.log(`Stopping before Apps Script timeout. Next response index: ${nextIndex}.`);
        console.log(`Stopping before Apps Script timeout. Next response index: ${nextIndex}.`);
        return;
      }

      const batchEnd = Math.min(nextIndex + WAITLIST_SYNC_BATCH_SIZE, totalResponses);
      const batchResponses = responses.slice(nextIndex, batchEnd);
      const entries = responsesToEntries(batchResponses);

      Logger.log(`Syncing response batch ${nextIndex + 1}-${batchEnd}.`);
      console.log(`Syncing response batch ${nextIndex + 1}-${batchEnd}.`);
      syncEntries(entries);

      nextIndex = batchEnd;
      properties.setProperty(WAITLIST_SYNC_CURSOR_KEY, String(nextIndex));
    }

    Logger.log(`Waitlist sync complete. Synced through ${totalResponses} responses.`);
    console.log(`Waitlist sync complete. Synced through ${totalResponses} responses.`);
  } finally {
    lock.releaseLock();
  }
}

function onWaitlistFormSubmit(event) {
  if (event && event.response) {
    const entry = formResponseToEntry(event.response);
    if (entry.email) syncEntries([entry]);
    return;
  }

  syncAllWaitlistRows();
}

function resetWaitlistSyncCursor() {
  PropertiesService.getScriptProperties().deleteProperty(WAITLIST_SYNC_CURSOR_KEY);
  Logger.log('Waitlist sync cursor reset.');
  console.log('Waitlist sync cursor reset.');
}

function logRecentWaitlistEntries() {
  const form = FormApp.openByUrl(FORM_EDIT_URL);
  const responses = form.getResponses();
  const startIndex = Math.max(0, responses.length - 10);

  responses.slice(startIndex).forEach((response, offset) => {
    const entry = formResponseToEntry(response);
    const index = startIndex + offset + 1;
    Logger.log(`Recent response ${index}: email=${entry.email || '(missing)'} id=${entry.external_id}`);
    console.log(`Recent response ${index}: email=${entry.email || '(missing)'} id=${entry.external_id}`);
  });
}
```

## Triggers

In Apps Script, open **Triggers** and add:

- `onWaitlistFormSubmit`
  - Event source: From form
  - Event type: On form submit
- `syncAllWaitlistRows`
  - Event source: Time-driven
  - Run hourly while backfilling, then daily after the cursor has caught up

After setting the code, run `syncAllWaitlistRows()` once manually to backfill the existing waitlist. If the newest rows still do not appear, run `logRecentWaitlistEntries()` and confirm the newest responses show an email instead of `(missing)`. If you ever need to force a complete backfill from the beginning, run `resetWaitlistSyncCursor()` once and then run `syncAllWaitlistRows()` again.

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
