/**
 * Headless verification of `templateSourceMap` (docs/26-debugging.md): each
 * element of a template is created with the `nodeIndex` Lynx DevTool maps back to
 * its template, and the build records the same indexes for `debug-metadata.json`.
 *
 * The harness compiles templates JIT, which has no source locations, so the
 * component here is written the way AOT compiles one with them on: its template
 * function ends with `ɵɵattachSourceLocations(templatePath, [[slot, offset, line,
 * column], …])`, the call Angular's compiler adds. `plugin/src/template-source-map.cts`
 * is then run over that same call, as the build's loader runs it over ngtsc's
 * output, and both sides have to agree on every index.
 *
 * Run with `npm run verify:template-source-map` (a development build:
 * `TEMPLATE_SOURCE_MAP=true`) and `npm run verify:template-source-map-off` (a
 * production one).
 */
import '@angular/compiler';

import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  ɵɵattachSourceLocations,
  ɵɵdefineComponent,
  ɵɵelementEnd,
  ɵɵelementStart,
  ɵɵtext,
} from '@angular/core';

import { decodeOps, OP, SOURCE_LOCATION_ATTR, sourceLocationNodeIndex, splitSourceMap } from 'ng-lynx/internal/ops';

import { bootstrapLynxApplication } from 'ng-lynx';
import 'ng-lynx/main-thread';

import { assert, findByClass, getPage, installMockPapi, type MockEl, opsLogMark, opsSince, tick } from './mock-papi.js';

const ON = process.env.TEMPLATE_SOURCE_MAP === 'true';
const TEMPLATE_PATH = 'src/app/card.component.html';

// `<view class="card">\n  <text class="title">Hi</text>\n</view>`, as AOT compiles it.
const LOCATIONS: [number, number, number, number][] = [
  [0, 0, 0, 0], // <view class="card">: slot 0, offset 0, line 0, column 0
  [1, 22, 1, 2], // <text class="title">: slot 1, offset 22, line 1, column 2
];

class CardComponent {
  static ɵfac = (): CardComponent => new CardComponent();
  static ɵcmp = ɵɵdefineComponent({
    type: CardComponent,
    selectors: [['app-root']],
    decls: 3,
    vars: 0,
    consts: [['class', 'card'], ['class', 'title']],
    template: (rf: number) => {
      if (rf & 1) {
        ɵɵelementStart(0, 'view', 0);
        ɵɵelementStart(1, 'text', 1);
        ɵɵtext(2, 'Hi');
        ɵɵelementEnd();
        ɵɵelementEnd();
        ɵɵattachSourceLocations(TEMPLATE_PATH, LOCATIONS);
      }
    },
    encapsulation: 2,
  });
}

const location = ([, offset, line, column]: number[]): string =>
  `${TEMPLATE_PATH}@o:${offset},l:${line},c:${column}`;

async function main(): Promise<void> {
  console.log(`\n=== A template with source locations (${ON ? 'development' : 'production'} build) ===`);
  installMockPapi();
  (globalThis as Record<string, any>).renderPage({});
  const mark = opsLogMark();
  await bootstrapLynxApplication(CardComponent as never);
  await tick();
  await tick();

  const page = getPage();
  const card = findByClass(page, 'card') as MockEl;
  const title = findByClass(page, 'title') as MockEl;
  assert(card != null && title != null, 'the template rendered (Angular asked ShadowElement.hasAttribute and got an answer)');

  assert(
    card.attrs[SOURCE_LOCATION_ATTR] === location(LOCATIONS[0]!)
      && title.attrs[SOURCE_LOCATION_ATTR] === location(LOCATIONS[1]!),
    `each element has its location as an attribute, which DevTool's Elements panel shows ("${location(LOCATIONS[1]!)}")`,
  );
  assert(
    card.dataset?.['ngSourceLocation'] === undefined && card.dataset?.['ng-source-location'] === undefined,
    'and not as a dataset entry, which every event on it would carry',
  );

  const records = decodeOps(opsSince(mark));
  const creates = records.filter((r) => r.code === OP.CREATE || r.code === OP.CREATE_MAPPED);
  if (ON) {
    assert(
      creates.every((r) => r.code === OP.CREATE_MAPPED),
      `every element is sent as CREATE_MAPPED (${creates.length} of them)`,
    );
    const expected = LOCATIONS.map((l) => sourceLocationNodeIndex(location(l)));
    assert(
      card.nodeIndex === expected[0] && title.nodeIndex === expected[1],
      `the engine created each element with the nodeIndex of its location (${card.nodeIndex}, ${title.nodeIndex})`,
    );
  } else {
    assert(
      creates.length > 0 && creates.every((r) => r.code === OP.CREATE),
      'a production build sends plain CREATE ops, with no index slot',
    );
    assert(card.nodeIndex === undefined && title.nodeIndex === undefined, 'and creates elements without a nodeIndex');
  }

  if (ON) {
    console.log('\n=== A first-screen snapshot is compared without the mapping ===');
    const batch = opsSince(mark);
    const { plain, locations } = splitSourceMap(batch);
    const plainRecords = decodeOps(plain);
    assert(
      plainRecords.every((r) => r.code !== OP.CREATE_MAPPED)
        && plainRecords.filter((r) => r.code === OP.CREATE).length === creates.length,
      'the plain form has a plain CREATE for every CREATE_MAPPED',
    );
    assert(
      plainRecords.every((r) => !(r.code === OP.SET_ATTR && r.args[1] === SOURCE_LOCATION_ATTR))
        && decodeOps(locations).length === LOCATIONS.length,
      'and the location attributes are split out, to set on the snapshot\'s elements after a match',
    );

    console.log('\n=== The build side agrees with the runtime ===');
    const require = createRequire(import.meta.url);
    const plugin = require('../plugin/dist/template-source-map.cjs') as {
      collectRecords: (source: string, resourcePath: string) => {
        uiSourceMap: number;
        filename: string;
        lineNumber: number;
        columnNumber: number;
      }[];
      sourceLocationNodeIndex: (location: string) => number;
    };

    const samples = ['a', 'src/app/app.component.ts@o:0,l:0,c:0', location(LOCATIONS[1]!), 'é ɵ 😀'];
    assert(
      samples.every((s) => plugin.sourceLocationNodeIndex(s) === sourceLocationNodeIndex(s)),
      'the loader\'s copy of the index hash matches the runtime\'s',
    );
    assert(
      samples.every((s) => {
        const n = sourceLocationNodeIndex(s);
        return Number.isInteger(n) && n > 0 && n < 2 ** 31;
      }),
      'indexes are positive 31-bit integers, never 0',
    );

    // A project with an external template, laid out as ngtsc names it: relative to the root dir.
    const root = mkdtempSync(path.join(tmpdir(), 'ng-lynx-source-map-'));
    mkdirSync(path.join(root, 'src/app'), { recursive: true });
    const html = path.join(root, TEMPLATE_PATH);
    const ts = path.join(root, 'src/app/card.component.ts');
    writeFileSync(html, '<view class="card">\n  <text class="title">Hi</text>\n</view>\n');
    writeFileSync(ts, '');
    const emitted = `function CardComponent_Template(rf, ctx) { if (rf & 1) {
      i0.ɵɵelementStart(0, "view", 0)(1, "text", 1);
      i0.ɵɵtext(2, "Hi");
      i0.ɵɵelementEnd()();
      i0.ɵɵattachSourceLocations("${TEMPLATE_PATH}", [[0, 0, 0, 0], [1, 22, 1, 2]]);
    } }`;
    const external = plugin.collectRecords(emitted, ts);
    assert(external.length === 2, 'the loader finds one record per element in ngtsc\'s output');
    assert(
      external[0]!.uiSourceMap === card.nodeIndex && external[1]!.uiSourceMap === title.nodeIndex,
      'with the same indexes the elements were created with',
    );
    assert(
      external.every((r) => r.filename === html),
      'an external template resolves to its .html file, found from the component\'s folder',
    );
    assert(
      external[1]!.lineNumber === 2 && external[1]!.columnNumber === 3,
      'lines and columns become 1-based, as debug-metadata.json has them (line 2, column 3)',
    );

    const inline = plugin.collectRecords(
      'i0.\\u0275\\u0275attachSourceLocations("src/app/card.component.ts", [[0, 410, 12, 4]]);',
      ts,
    );
    assert(
      inline.length === 1 && inline[0]!.filename === ts && inline[0]!.lineNumber === 13,
      'an inline template resolves to the component file, and an escaped call name is read too',
    );
    assert(plugin.collectRecords('i0.ɵɵelementStart(0, "view");', ts).length === 0, 'a module without the call gives no records');
  }

  console.log(`\n✅ templateSourceMap (${ON ? 'on' : 'off'}) verified.\n`);
}

main().catch((err) => {
  console.error('\n❌ templateSourceMap verification failed:\n', err);
  process.exit(1);
});
