#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const TEST_ARGS = ['-m', 'unittest', 'discover', '-s', 'test', '-p', '*_test.py'];

const candidates = collectCandidates();
let lastError = '';

for (const candidate of candidates) {
  const probe = spawnSync(candidate.command, [...candidate.args, '--version'], { encoding: 'utf8' });
  if (probe.status !== 0) {
    lastError = `${candidate.label}: ${(probe.stderr || probe.stdout || '').trim()}`;
    continue;
  }

  const result = spawnSync(candidate.command, [...candidate.args, ...TEST_ARGS], {
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}

console.error('Unable to find a working Python interpreter for tests.');
if (lastError) console.error(lastError);
console.error('Set PYTHON to a valid interpreter path, then rerun npm run test:python.');
process.exit(1);

function collectCandidates() {
  const items = [];
  const seen = new Set();
  const add = (command, args = [], label = command) => {
    const key = `${command}\0${args.join('\0')}`;
    if (!command || seen.has(key)) return;
    seen.add(key);
    items.push({ command, args, label });
  };

  if (process.env.PYTHON) add(process.env.PYTHON, [], 'PYTHON');

  if (process.platform === 'win32') {
    for (const file of where('python')) {
      if (file.toLowerCase().includes('\\windowsapps\\')) continue;
      if (existsSync(file)) add(file);
    }
    add('py', ['-3']);
  } else {
    add('python3');
  }

  add('python');
  return items;
}

function where(command) {
  const result = spawnSync('where.exe', [command], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
