// netlify/functions/generate-status.js
//
// Lightweight, synchronous (normal) function that the browser polls every
// few seconds after kicking off netlify/functions/generate-background.js.
// Reads the job's current state out of Netlify Blobs and returns it.

const { getJobStore } = require('./qbr-lib');

const JOB_STORE = 'qbr-jobs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Method Not Allowed' } }) };
  }

  const jobId = event.queryStringParameters && event.queryStringParameters.jobId;
  if (!jobId) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Missing jobId' } }) };
  }

  try {
    const store = getJobStore(JOB_STORE);
    const job = await store.get(jobId, { type: 'json' });

    if (!job) {
      // Either the background function hasn't started writing yet
      // (race right after the initial POST) or the jobId is unknown/expired.
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ status: 'pending' }) };
    }

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(job) };
  } catch (err) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: err.message } }) };
  }
};
