const DEFAULT_API_BASE = 'https://api.deepseek.com';

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

async function readRequestBody(request) {
  if (request.body !== undefined && request.body !== null) {
    if (typeof request.body === 'string') return request.body;
    if (Buffer.isBuffer(request.body)) return request.body.toString('utf8');
    return JSON.stringify(request.body);
  }

  if (typeof request[Symbol.asyncIterator] !== 'function') return '{}';

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8').trim() || '{}';
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    sendJson(response, 500, { error: 'LLM proxy is not configured.' });
    return;
  }

  try {
    const body = await readRequestBody(request);
    const upstream = await fetch(`${process.env.DEEPSEEK_API_BASE || DEFAULT_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    const text = await upstream.text();
    response.statusCode = upstream.status;
    response.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    response.end(text);
  } catch {
    sendJson(response, 502, { error: 'LLM upstream request failed.' });
  }
}
