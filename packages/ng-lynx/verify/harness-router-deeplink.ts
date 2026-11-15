/**
 * Headless verification of `provideLynxRouter`'s deep-link and back-button
 * options (`initialUrl` / `backButtonEvent`).
 *
 *  - `initialUrl` (a literal, and the function form reading `lynxInitData()`)
 *    seeds the Router's starting route instead of always `/` — asserted by
 *    checking which component rendered *first*, with no navigation call.
 *  - `initialUrl` returning falsy falls back to the default `/`.
 *  - `backButtonEvent` wires a `GlobalEventEmitter` event (the app's own
 *    convention — no name is assumed) to `Location.back()`.
 *
 * Run with: `npm run verify:router-deeplink`.
 */
import '@angular/compiler';

import { Component, NO_ERRORS_SCHEMA } from '@angular/core';
import { Location } from '@angular/common';
import { Router, RouterOutlet, type Routes } from '@angular/router';

import { bootstrapLynxApplication, lynxInitData } from 'ng-lynx';
import { provideLynxRouter } from 'ng-lynx/router';
import 'ng-lynx/main-thread';

import { assert, emitGlobalEvent, findText, getPage, installMockPapi, tick } from './mock-papi.js';

@Component({
  selector: 'app-home',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `<text class="page">Home page</text>`,
})
class HomeComponent {}

@Component({
  selector: 'app-about',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `<text class="page">About page</text>`,
})
class AboutComponent {}

const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'about', component: AboutComponent },
];

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [RouterOutlet],
  template: `<router-outlet></router-outlet>`,
})
class TestComponent {}

async function testInitialUrlLiteral(): Promise<void> {
  console.log('\n=== initialUrl: literal string seeds the starting route ===');
  installMockPapi();
  (globalThis as Record<string, unknown> & { renderPage(d: unknown): void }).renderPage({});

  const app = await bootstrapLynxApplication(TestComponent, {
    providers: [provideLynxRouter(routes, { initialUrl: '/about' })],
  });
  await tick();
  await tick();
  const page = getPage();
  const location = app.injector.get(Location);

  assert(findText(page, 'About page') != null, "booted directly into '/about' with no navigation call");
  assert(findText(page, 'Home page') == null, 'the default root route did not also render');
  assert(location.path() === '/about', 'Location reports the seeded path');
  app.destroy();
}

async function testInitialUrlFromInitData(): Promise<void> {
  console.log('\n=== initialUrl: function form reading lynxInitData() ===');
  installMockPapi();
  (globalThis as Record<string, unknown>).lynx.__initData = { url: '/about' };
  (globalThis as Record<string, unknown> & { renderPage(d: unknown): void }).renderPage({});

  const app = await bootstrapLynxApplication(TestComponent, {
    providers: [
      provideLynxRouter(routes, {
        initialUrl: () => lynxInitData<{ url?: string }>()().url,
      }),
    ],
  });
  await tick();
  await tick();
  assert(findText(getPage(), 'About page') != null, 'the URL delivered via init data seeded the starting route');
  app.destroy();
}

async function testInitialUrlFalsyFallsBackToRoot(): Promise<void> {
  console.log('\n=== initialUrl: falsy return falls back to the default root ===');
  installMockPapi();
  (globalThis as Record<string, unknown> & { renderPage(d: unknown): void }).renderPage({});

  const app = await bootstrapLynxApplication(TestComponent, {
    providers: [provideLynxRouter(routes, { initialUrl: () => undefined })],
  });
  await tick();
  await tick();
  assert(findText(getPage(), 'Home page') != null, 'no initial URL delivered -> default root route');
  app.destroy();
}

async function testBackButtonEvent(): Promise<void> {
  console.log('\n=== backButtonEvent: host event triggers Location.back() ===');
  installMockPapi();
  (globalThis as Record<string, unknown> & { renderPage(d: unknown): void }).renderPage({});

  const app = await bootstrapLynxApplication(TestComponent, {
    providers: [provideLynxRouter(routes, { backButtonEvent: 'onHostBackPressed' })],
  });
  await tick();
  await tick();
  const router = app.injector.get(Router);
  await router.navigateByUrl('/about');
  await tick();
  await tick();
  assert(findText(getPage(), 'About page') != null, 'navigated to /about first');

  emitGlobalEvent('onHostBackPressed');
  await tick();
  await tick();
  await tick();
  assert(findText(getPage(), 'Home page') != null, "the host's back-button event popped the in-memory history");
  assert(router.url === '/', "Router's own state agrees after the back-button event");
  app.destroy();
}

async function main(): Promise<void> {
  await testInitialUrlLiteral();
  await testInitialUrlFromInitData();
  await testInitialUrlFalsyFallsBackToRoot();
  await testBackButtonEvent();
  console.log('\n✅ All deep-link / back-button assertions passed.\n');
}

main().catch((err) => {
  console.error('\n❌ Router deep-link verification failed:\n', err);
  process.exit(1);
});
