// netlify/functions/generate-start.js
//
// WHY THIS FILE EXISTS
// ---------------------
// Background Functions (generate-background.js) can run for up to 15
// minutes, which fixes the original 504 timeout on long meetings. BUT
// they have their own, much smaller limit that regular functions don't:
// only 256 KB per request. A meeting transcript plus the three pasted
// dashboard screenshots easily blows past that, causing an immediate
// "413 Payload Too Large" before Claude is ever called.
//
// The fix: this is a normal, synchronous function (6 MB request limit -
// comfortably enough for transcript + screenshots). It does almost no
// work itself:
//   1. Accepts the full payload from the browser.
//   2. Writes it into Netlify Blobs under the jobId the browser generated.
//   3. Fires off generate-background.js, passing only the (tiny) jobId -
//      never the large payload - so it stays under the 256 KB limit.
//   4. Returns immediately.
// generate-background.js then reads the stashed payload back out of
// Blobs by jobId and does the actual (slow) Claude call + docx build.

const { getJobStore } = require('./qbr-lib');

const JOB_STORE = 'qbr-jobs';
const INPUT_PREFIX = 'input:';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Method Not Allowed' } }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Invalid request' } }) };
  }

  const jobId = body.jobId;
  if (!jobId) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Missing jobId' } }) };
  }
  if (!body.system || !body.messages || !body.formData) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Missing system, messages, or formData' } }) };
  }

  try {
    const store = getJobStore(JOB_STORE);

    // Stash the full (potentially large) payload for the background
    // function to pick up by jobId. This write happens in a normal
    // function, so it's covered by the 6 MB request limit, not the
    // background function's 256 KB one.
    await store.setJSON(INPUT_PREFIX + jobId, {
      system: body.system,
      messages: body.messages,
      formData: body.formData,
    });

    await store.setJSON(jobId, { status: 'pending', updatedAt: Date.now() });

    // Trigger the background function with just the jobId - a few bytes,
    // well under its 256 KB limit. This is a server-to-server call, so
    // browser CORS rules don't apply to it.
    //
    // IMPORTANT: this MUST be awaited. Serverless functions can freeze
    // their execution environment the instant they send a response back.
    // A "fire and forget" call here can get silently dropped mid-flight
    // if that freeze happens before the request is actually sent - which
    // leaves the job stuck at "pending" forever, with no error and
    // nothing for the background function to ever pick up.
    const host = event.headers['x-forwarded-host'] || event.headers.host;
    const proto = event.headers['x-forwarded-proto'] || 'https';
    const backgroundUrl = proto + '://' + host + '/.netlify/functions/generate-background';

    try {
      console.log('[generate-start] job', jobId, '- triggering generate-background at', backgroundUrl);
      const bgRes = await fetch(backgroundUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: jobId }),
      });
      console.log('[generate-start] job', jobId, '- background trigger responded with status', bgRes.status);
    } catch (triggerErr) {
      console.log('[generate-start] job', jobId, '- background trigger THREW:', triggerErr.message);
      await store.setJSON(jobId, {
        status: 'error',
        message: 'Could not start background processing: ' + triggerErr.message,
        updatedAt: Date.now(),
      });
      return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Could not trigger background processing. Please try again.' } }) };
    }

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ jobId: jobId, status: 'pending' }) };
  } catch (err) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: err.message } }) };
  }
};
