#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const TOOL_DIR = path.resolve(ROOT, 'tools/concept-review');
const DATA_DIR = path.resolve(ROOT, 'data/frontend/concept_graph');
const PORT = Number(process.env.PORT || process.argv.find((arg) => arg.startsWith('--port='))?.split('=')[1] || 5174);

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
]);

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || `127.0.0.1:${PORT}`}`);
    const filePath = resolveRequestPath(url.pathname);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      sendText(response, 404, 'Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': MIME_TYPES.get(path.extname(filePath)) || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    const status = error?.code === 'ENOENT' ? 404 : 500;
    sendText(response, status, status === 404 ? 'Not found' : String(error?.message || error));
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Concept review frontend: http://127.0.0.1:${PORT}`);
});

function resolveRequestPath(pathname) {
  const decodedPath = decodeURIComponent(pathname);
  if (decodedPath === '/' || decodedPath === '/index.html') {
    return path.join(TOOL_DIR, 'index.html');
  }
  if (decodedPath.startsWith('/data/concept_graph/')) {
    return safeResolve(DATA_DIR, decodedPath.replace('/data/concept_graph/', ''));
  }
  return safeResolve(TOOL_DIR, decodedPath.replace(/^\/+/, ''));
}

function safeResolve(baseDir, requestPath) {
  const target = path.resolve(baseDir, requestPath);
  if (target !== baseDir && !target.startsWith(`${baseDir}${path.sep}`)) {
    const error = new Error('Forbidden path');
    error.code = 'EACCES';
    throw error;
  }
  return target;
}

function sendText(response, status, text) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(text);
}
