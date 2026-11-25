// The inline 'main thread' transform on its own (plugin/src/inline-main-thread.cts):
// what it captures and imports, the lines it keeps, and the uses it rejects with a
// message pointing at the source. harness-inline-main-thread.ts runs the result.
// Run `npm run build` first: this reads the built plugin.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const core = createRequire(import.meta.url)('../plugin/dist/inline-main-thread.cjs');
const ts = core.loadTypeScript(pkg);

let passed = 0;
function assert(cond, label) {
  if (!cond) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`✓ ${label}`);
}

const bg = (text) => core.transformForBackground(ts, 'x.ts', text, 'src/x.ts');
const mt = (text) => core.extractForMainThread(ts, 'x.ts', text, 'src/x.ts');
const failure = (text) => {
  try {
    mt(text);
    return '';
  } catch (err) {
    return err.message;
  }
};

console.log('— files without one');
assert(bg('const a = 1;') === undefined, 'no marker: left alone');
assert(bg("const s = 'main thread';") === undefined, 'the marker as a plain string: left alone');
assert(mt('const a = 1;') === '', 'no Main-Thread half');

console.log('— what a function uses');
const component = `import { Component } from '@angular/core';
import { lynxAnimate, type WorkletContext } from 'ng-lynx/worklet';
import type { Shape } from './types';
import * as easing from './easing';
const SPEED = 2;
let shared = 0;
export class A {
  readonly fn = (ctx: WorkletContext, shape: Shape) => {
    'main thread';
    const SPEED = 3; // shadows the module const: its own
    const inner = () => { 'main thread'; return shared; };
    lynxAnimate(ctx.element, {}, { easing: easing.out, speed: SPEED });
    return this.size + inner() + (shape as Shape).length;
  };
}`;
const out = bg(component);
assert(out.split('\n').length === component.split('\n').length, 'the Background form keeps every line');
assert(out.startsWith("import { ɵinlineMainThread as __ngInlineMainThread } from 'ng-lynx'; import { Component }"), 'its import goes on the first line');
assert(/"__ngInline:src\/x\.ts:8:\d+", \(\) => \(\{ shared, "this": \{ "size": this\.size \} \}\)/.test(out), 'captures the module let (used by a nested function) and this.size, not the shadowed const');
const half = mt(component);
assert(half.includes('import { lynxAnimate } from "ng-lynx/worklet";') && half.includes('import * as easing from "./easing";'), 'imports what the body uses as values');
assert(!half.includes('WorkletContext') || !/import[^;]*WorkletContext/.test(half), 'not what it uses only as types');
assert(!half.includes("from './types'") && !half.includes('from "./types"'), 'not a type-only import');
const lineOf = (text, needle) => text.slice(0, text.indexOf(needle)).split('\n').length;
assert(lineOf(half, "'main thread';") === lineOf(component, "'main thread';"), 'the Main-Thread half keeps the function on its line');

console.log('— ids');
const two = "const a = () => { 'main thread'; }; const b = () => { 'main thread'; };";
const ids = [...bg(two).matchAll(/"(__ngInline:[^"]+)"/g)].map((m) => m[1]);
const mtIds = [...mt(two).matchAll(/"(__ngInline:[^"]+)"/g)].map((m) => m[1]);
assert(ids.length === 2 && ids[0] !== ids[1], 'two functions on one line get different ids');
assert(JSON.stringify(ids) === JSON.stringify(mtIds), 'both threads use the same ids');

console.log('— methods and declarations');
const method = `class A { protected async load(x: number): Promise<number> { 'main thread'; return x * this.k; } }`;
assert(bg(method).includes('protected readonly load = __ngInlineMainThread('), 'a method becomes a readonly field');
assert(bg(method).includes('async (x: number): Promise<number> => {'), 'keeping async, its parameters and return type');
const decl = `export function clamp(v: number) { 'main thread'; return v; }`;
assert(bg(decl).startsWith("import { ɵinlineMainThread as __ngInlineMainThread } from 'ng-lynx'; export const clamp = __ngInlineMainThread("), 'an exported declaration becomes an exported const');
assert(mt(decl).includes('(function clamp(v: number) {') && mt(decl).includes('.bind(this)'), 'and stays a named function on the Main Thread');

console.log('— what it rejects');
const rejects = [
  ["class A { f = () => { 'main thread'; this.x = 1; }; }", 'assigns to `this.x`'],
  ["class A { f = () => { 'main thread'; return this; }; }", 'can only read `this.name`'],
  ["let n = 0; const f = () => { 'main thread'; n = 1; };", 'assigns to `n`'],
  ["class Helper {} const f = () => { 'main thread'; return new Helper(); };", '`Helper` is a class in this file'],
  ["function helper() {} const f = () => { 'main thread'; helper(); };", '`helper` is a function in this file'],
  ["import { signal } from '@angular/core'; const f = () => { 'main thread'; signal(1); };", "comes from '@angular/core'"],
  ["import { mainThreadRef } from 'ng-lynx'; const f = () => { 'main thread'; mainThreadRef(); };", "comes from 'ng-lynx', which runs on the Background Thread"],
  ["class A { get x() { 'main thread'; return 1; } }", 'only a function, an arrow function or a method'],
  ["export default function () { 'main thread'; }", 'needs a name'],
  ["class A { @Dec() m() { 'main thread'; } }", "can't have decorators"],
  ["class B extends A { f = () => { 'main thread'; return super.x; }; }", "can't use `super`"],
  ["const o = { m() { 'main thread'; return this.x; } };", 'object literal'],
];
for (const [source, message] of rejects) {
  const got = failure(source);
  assert(got.includes(message) && /^x\.ts:\d+:\d+: /.test(got), `rejects with "${message}" at its position`);
}
assert(failure("import { mainThreadRef } from 'ng-lynx'; const f = () => { 'main thread'; }; mainThreadRef();") === '', "an import used only outside the function is fine");
assert(failure("function helper() { 'main thread'; } const f = () => { 'main thread'; helper(); };") === '', "a function marked 'main thread' can be called");

console.log(`\ninline-main-thread-transform: all ${passed} assertions passed`);
