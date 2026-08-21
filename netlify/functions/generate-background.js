// netlify/functions/generate-background.js
//
// Triggered by generate-start.js with only a small { jobId } body (see
// that file for why - background functions cap requests at 256 KB, far
// too small for a meeting transcript + screenshots).
//
// This function:
//   1. Reads the full payload (system prompt, transcript, form data)
//      back out of Netlify Blobs by jobId.
//   2. Calls Claude and builds the .docx - this can now take minutes,
//      since Background Functions get up to 15 minutes instead of the
//      ~10-26s ceiling on normal Netlify Functions.
//   3. Writes the finished result (or an error) back into Blobs under
//      the same jobId, for generate-status.js to hand to the browser.

const { buildDocx, getJobStore } = require('./qbr-lib');

const JOB_STORE = 'qbr-jobs';
const INPUT_PREFIX = 'input:';
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour - don't keep finished jobs forever

exports.handler = async function (event) {
  // Background functions always answer the triggering request with an
  // immediate 202 regardless of what we return here - this return value
  // is only visible in Netlify's function logs.
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

  const store = getJobStore(JOB_STORE);

  try {
    const input = await store.get(INPUT_PREFIX + jobId, { type: 'json' });
    if (!input) {
      await store.setJSON(jobId, {
        status: 'error',
        message: 'Could not find the submitted data for this job (it may have expired). Please try generating again.',
        updatedAt: Date.now(),
      });
      return { statusCode: 200, body: 'handled' };
    }

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
        // long transcripts enough headroom.
        max_tokens: 8000,
        system: input.system,
        messages: input.messages,
      }),
    });

    if (!aiRes.ok) {
      const err = await aiRes.json().catch(() => ({ error: { message: aiRes.statusText } }));
      const message = (err.error && err.error.message) ? err.error.message : ('HTTP ' + aiRes.status);
      await store.setJSON(jobId, { status: 'error', message, updatedAt: Date.now() });
      await store.delete(INPUT_PREFIX + jobId).catch(() => {});
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
      await store.delete(INPUT_PREFIX + jobId).catch(() => {});
      return { statusCode: 200, body: 'handled' };
    }

    const d = input.formData;
    const docxBuf = await buildDocx(d, ai);
    const fname = (d.orgName || 'QBR').replace(/[^a-zA-Z0-9 _-]/g, '') + '_QBR_' + (d.meetingDate || new Date().toISOString().split('T')[0]) + '.docx';

    await store.setJSON(jobId, {
      status: 'done',
      docx: docxBuf.toString('base64'),
      filename: fname,
      updatedAt: Date.now(),
      expiresAt: Date.now() + JOB_TTL_MS,
    });

    // Clean up the (potentially large) stashed input now that we're done with it.
    await store.delete(INPUT_PREFIX + jobId).catch(() => {});

    return { statusCode: 200, body: 'handled' };
  } catch (err) {
    try {
      await store.setJSON(jobId, {
        status: 'error',
        message: err.message || 'Unknown error while generating the QBR.',
        updatedAt: Date.now(),
      });
      await store.delete(INPUT_PREFIX + jobId).catch(() => {});
    } catch (storeErr) {
      // If even the store write fails, there's nothing more we can do -
      // the browser's poll will eventually time out and show a generic error.
    }
    return { statusCode: 500, body: 'error' };
  }
};
