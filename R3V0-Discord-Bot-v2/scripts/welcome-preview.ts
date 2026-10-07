import { mkdirSync, writeFileSync } from 'node:fs';
import { renderWelcome } from '../src/services/welcome.js';
mkdirSync('docs', { recursive: true });
writeFileSync('docs/goat-welcome-preview.png', await renderWelcome('B3sttiee | GOAT', 248));
console.log('GOAT preview written to docs/goat-welcome-preview.png');
