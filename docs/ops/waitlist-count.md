# Live waitlist count

The homepage rounds the private response count down to the nearest ten. For example, 354 responses display as `350+`, and the card flips to `360+` when the 360th response arrives.

## Google Form connection

Create a Google Apps Script owned by the same Google account as the waitlist form and add:

```js
function doGet() {
  const form = FormApp.openById('YOUR_GOOGLE_FORM_ID');
  const count = Math.floor(form.getResponses().length / 10) * 10;

  return ContentService
    .createTextOutput(JSON.stringify({ count }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

Deploy it as a web app that executes as the form owner and can be accessed by anyone. Add the resulting `/exec` URL to the production environment as `WAITLIST_COUNT_ENDPOINT`.

`WAITLIST_COUNT_FALLBACK` is shown if that endpoint is missing or temporarily unavailable. The site checks for a new count every 60 seconds. Only the rounded count is public; the exact total and form response data stay private.
