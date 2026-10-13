/*
 * TypeScript target=ES5 checks syntax. This lightweight second guard catches
 * accidental use of modern collection/global APIs that target=ES5 would not
 * polyfill. It deliberately runs on the shipped artifact, not just source.
 */
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../nanofox.js', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n\r]*/g, '');
const banned = [
  ['ES2015 declaration syntax', /\b(?:const|let|class)\b/],
  ['arrow function syntax', /=>/],
  ['template literal syntax', /`/],
  ['modern collection/global', /\b(?:WeakMap|Map|Set|Promise|globalThis)\b/],
  ['Object.assign', /Object\.assign/],
  ['Number static helper', /Number\.is/],
  ['Array/String includes', /\.includes\s*\(/],
  ['String startsWith', /\.startsWith\s*\(/],
  ['URL constructor', /new\s+URL\s*\(/]
];
for (const [name, expression] of banned) {
  if (expression.test(source)) {
    process.stderr.write(`nanofox.js uses forbidden ${name}. Choose an ES5-safe alternative.\n`);
    process.exitCode = 1;
  }
}
