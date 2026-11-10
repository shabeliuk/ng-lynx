import type { Routes } from '@angular/router';

import { AboutComponent } from './about.component.js';
import { HomeComponent } from './home.component.js';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'about', component: AboutComponent },
  {
    // Lazy route: the plugin keeps import() in-bundle (deferred evaluation,
    // no external chunk the device can't load).
    //
    // The `webpackChunkName` comment does nothing in this default mode, but it
    // is required the moment you turn on `asyncChunks: true` in lynx.config.ts
    // — an unnamed dynamic import() is packed into a Lynx lazy bundle whose JS
    // chunk never reaches dist/ in production. The build fails with an
    // explanation if you forget. See docs/15-routing.md.
    path: 'lazy',
    loadComponent: () =>
      import(/* webpackChunkName: "lazy-route" */ './lazy.component.js').then(
        (m) => m.LazyComponent,
      ),
  },
];
