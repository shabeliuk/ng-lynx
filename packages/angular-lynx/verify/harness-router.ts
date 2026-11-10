/**
 * Headless verification of Angular Router on Lynx.
 *
 * `provideLynxRouter()` swaps in a DOM-free `PlatformLocation`
 * (`LynxPlatformLocation`) and a no-op `TitleStrategy` in place of
 * `provideRouter()`'s browser-only defaults (see `runtime/src/router.ts` for
 * why both are unconditionally touched at Router construction time). This
 * harness boots a real two-route app through Angular's JIT compiler, drives
 * navigation both imperatively (`Router.navigateByUrl`, the Lynx-idiomatic way
 * — there's no `<a>`/`click` for `RouterLink` to bind to) and via `Location`
 * (back/forward), and asserts `<router-outlet>` swaps the rendered component
 * and the in-memory location tracks it.
 *
 * Run with: `npm run verify:router`.
 */
import './engine-globals.js';
import '@angular/compiler';

import { Component, inject, NO_ERRORS_SCHEMA } from '@angular/core';
import { Location } from '@angular/common';
import { Router, RouterOutlet, type Routes } from '@angular/router';

import { bootstrapLynxApplication, publishEvent } from 'angular-lynx';
import 'angular-lynx/entry-background';
import { provideLynxRouter } from 'angular-lynx/router';
import 'angular-lynx/main-thread';

import { assert, findByClass, findText, getPage, installMockPapi, printTree, tick } from './mock-papi.js';

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
  {
    // Lazy route — Angular resolves the component through a dynamic import()
    // at first navigation. (In an rspack app build the plugin forces
    // dynamicImportMode: 'eager' so this never becomes an external chunk —
    // see plugin/src/index.ts; here esbuild inlines it the same way.)
    path: 'lazy',
    loadComponent: () => import('./harness-router-lazy.js').then((m) => m.LazyComponent),
  },
];

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [RouterOutlet],
  template: `
    <view class="app">
      <view class="nav" (tap)="goAbout()"><text>Go to About</text></view>
      <router-outlet></router-outlet>
    </view>
  `,
})
class TestComponent {
  private readonly router = inject(Router);
  goAbout(): void {
    this.router.navigateByUrl('/about');
  }
}

async function tap(btnClass: string): Promise<void> {
  const sign = findByClass(getPage(), btnClass)?.events['tap']?.sign;
  if (!sign) throw new Error(`no (tap) on .${btnClass}`);
  publishEvent(sign, { type: 'tap' });
  await tick();
  await tick();
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, unknown> & { renderPage(d: unknown): void }).renderPage({});

  const app = await bootstrapLynxApplication(TestComponent, {
    providers: [provideLynxRouter(routes)],
  });
  await tick();
  await tick();

  const page = getPage();
  const location = app.injector.get(Location);
  const router = app.injector.get(Router);

  console.log('\n=== Reconstructed native tree (initial route) ===');
  console.log(printTree(page).join('\n'));

  console.log('\n=== Assertions: initial navigation ===');
  assert(findText(page, 'Home page') != null, 'root route (HomeComponent) rendered into <router-outlet>');
  assert(location.path() === '/' || location.path() === '', 'Location starts at "/"');

  console.log('\n=== Navigating imperatively (router.navigateByUrl) ===');
  await tap('nav');

  console.log('\n=== Reconstructed native tree (after navigation) ===');
  console.log(printTree(page).join('\n'));

  console.log('\n=== Assertions: after navigateByUrl("/about") ===');
  assert(findText(page, 'About page') != null, "'/about' route (AboutComponent) rendered into <router-outlet>");
  assert(findText(page, 'Home page') == null, 'HomeComponent was torn down (RouterOutlet swaps, not stacks)');
  assert(location.path() === '/about', 'Location tracks the navigation (LynxPlatformLocation, no window.history)');

  console.log('\n=== Navigating back (Location.back -> popstate) ===');
  location.back();
  await tick();
  await tick();
  await tick();

  console.log('\n=== Assertions: after back() ===');
  assert(findText(page, 'Home page') != null, 'back() popped to the root route via the in-memory history stack');
  assert(router.url === '/', "Router's own state agrees (back() round-tripped through PlatformLocation.onPopState)");

  console.log('\n=== Lazy route (loadComponent + dynamic import) ===');
  await router.navigateByUrl('/lazy');
  await tick();
  await tick();
  assert(findText(page, 'Lazy page') != null, "loadComponent route resolved through import() and rendered");
  assert(location.path() === '/lazy', 'Location tracks the lazy navigation');

  console.log('\n✅ All router assertions passed — Angular Router works end-to-end on Lynx.\n');
}

main().catch((err) => {
  console.error('\n❌ Router verification failed:\n', err);
  process.exit(1);
});
