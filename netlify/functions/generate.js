exports.handler = async function(event) {

  // Handle CORS preflight request from browser
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  // API key stored securely in Netlify environment variables
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: { message: 'API key not configured. Please contact MCR Systems.' } })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch(e) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: { message: 'Invalid request body' } })
    };
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: body.system,
        messages: body.messages,
      }),
    });

    const data = await response.json();

    return {
      statusCode: response.status,
      headers: corsHeaders,
      body: JSON.stringify(data),
    };

  } catch(err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: { message: 'Server error: ' + err.message } }),
    };
  }
};
