// netlify/functions/generate-background.js
//
// WHY THIS FILE EXISTS
// ---------------------
// The old netlify/functions/generate.js ran synchronously and called the
// Anthropic API directly inside the request/response cycle. Netlify's
// synchronous Functions have a hard execution ceiling (10s on the free
// tier, up to 26s on paid tiers) that CANNOT be raised. For a normal
// meeting this usually finished in time (20-40s was already close to the
// limit!), but for the 3-hour meeting the much longer transcript pushed
// the Claude call + docx build past that ceiling, so Netlify's edge gave
// up and returned "504 Gateway Timeout" before generate.js could finish -
// even though Claude itself would eventually have answered.
//
// THE FIX
// -------
// Background Functions (any function file ending in "-background") are
// allowed to run for up to 15 minutes. The trade-off is that Netlify
// always responds to the triggering request immediately with an empty
// 202 Accepted - it does not wait for the handler to finish, and it does
// not let the handler set the response body/headers. So this function:
//   1. Is invoked with a client-generated jobId.
//   2. Calls Claude, builds the docx (this part can now take minutes).
//   3. Writes the finished result into Netlify Blobs, keyed by jobId.
// The browser (see index.html) polls generate-status.js with that jobId
// until the result is ready, instead of waiting on a single long request.

const { getStore } = require('@netlify/blobs');
const { buildDocx } = require('./qbr-lib');

const JOB_STORE = 'qbr-jobs';
// Blobs are cheap but not free/unlimited - don't keep finished jobs forever.
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour

exports.handler = async function (event) {
  // Background functions always return 202 immediately regardless of what
  // we return here - this return value only shows up in Netlify's function
  // logs, it is never seen by the browser. We still return sensible codes
  // for local testing / log clarity.
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid request' };
  }

  const jobId = body.jobId;
  if (!jobId) {
    return { statusCode: 400, body: 'Missing jobId' };
  }

  const store = getStore(JOB_STORE);

  try {
    await store.setJSON(jobId, { status: 'processing', updatedAt: Date.now() });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('API key not configured.');
    }

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        // Long meetings produce more key updates / points raised / action
        // items than a short one, so the JSON Claude has to return is
        // bigger too. 4000 was tight even for normal meetings; 8000 gives
        // long transcripts enough headroom without a meaningful cost
        // increase (output tokens are still capped, not unlimited).
        max_tokens: 8000,
        system: body.system,
        messages: body.messages,
      }),
    });

    if (!aiRes.ok) {
      const err = await aiRes.json().catch(() => ({ error: { message: aiRes.statusText } }));
      const message = (err.error && err.error.message) ? err.error.message : ('HTTP ' + aiRes.status);
      await store.setJSON(jobId, { status: 'error', message, updatedAt: Date.now() });
      return { statusCode: 200, body: 'handled' };
    }

    const aiData = await aiRes.json();
    const txt = aiData.content.map((c) => c.text || '').join('');
    const clean = txt.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

    let ai;
    try {
      ai = JSON.parse(clean);
    } catch (parseErr) {
      await store.setJSON(jobId, {
        status: 'error',
        message: "Could not parse Claude's response. Please try again.",
        updatedAt: Date.now(),
      });
      return { statusCode: 200, body: 'handled' };
    }

    const d = body.formData;
    const docxBuf = await buildDocx(d, ai);
    const fname = (d.orgName || 'QBR').replace(/[^a-zA-Z0-9 _-]/g, '') + '_QBR_' + (d.meetingDate || new Date().toISOString().split('T')[0]) + '.docx';

    await store.setJSON(jobId, {
      status: 'done',
      docx: docxBuf.toString('base64'),
      filename: fname,
      updatedAt: Date.now(),
      expiresAt: Date.now() + JOB_TTL_MS,
    });

    return { statusCode: 200, body: 'handled' };
  } catch (err) {
    try {
      await store.setJSON(jobId, {
        status: 'error',
        message: err.message || 'Unknown error while generating the QBR.',
        updatedAt: Date.now(),
      });
    } catch (storeErr) {
      // If even the store write fails, there is nothing more we can do -
      // the browser's poll will eventually time out and show a generic error.
    }
    return { statusCode: 500, body: 'error' };
  }
};
