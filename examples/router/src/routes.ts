import type { Routes } from '@angular/router';

import { HomeComponent } from './home.component.js';
import { UserDetailComponent } from './user-detail.component.js';
import { UsersComponent } from './users.component.js';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'users', component: UsersComponent },
  { path: 'users/:id', component: UserDetailComponent },
  {
    // Lazily-loaded route: Angular's standard code-splitting seam, exercised
    // on the Lynx pipeline. See docs/15-routing.md for how import() behaves
    // in the Lynx bundle.
    //
    // The `webpackChunkName` comment is REQUIRED, not cosmetic. Since
    // rspeedy 0.17 / template-webpack-plugin 0.13, the Lynx build engine
    // treats an *unnamed* dynamic import as a Lynx **lazy bundle**: it
    // renames the async JS chunk into the per-bundle intermediate directory
    // (`.rspeedy/lazy-bundle/<name>/background.js`), which is packed and then
    // discarded — so the chunk the bundle's own loader asks for never reaches
    // `dist/` and the route 404s at navigation time. A named chunk group opts
    // out of that mapping (`LynxTemplatePlugin.#getAsyncChunkLayout` skips any
    // group with a name), keeping the chunk on rsbuild's default
    // `static/js/async/[name].js` template — which is what angular-lynx's
    // lazy routes load through `lynx.requireModuleAsync`. See
    // docs/15-routing.md.
    path: 'lazy',
    loadComponent: () =>
      import(/* webpackChunkName: "lazy-route" */ './lazy.component.js').then(
        (m) => m.LazyComponent,
      ),
  },
];
