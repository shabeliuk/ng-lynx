import type { Routes } from '@angular/router';

import { AttributesComponent } from './attributes.component.js';
import { GestureComponent } from './gesture.component.js';
import { GestureLabComponent } from './gesture-lab.component.js';
import { HomeComponent } from './home.component.js';
import { InputComponent } from './input.component.js';
import { ListComponent } from './list.component.js';
import { MainThreadComponent } from './main-thread.component.js';
import { NetworkComponent } from './network.component.js';
import { PlatformComponent } from './platform.component.js';
import { TimingComponent } from './timing.component.js';
import { UserComponent } from './user.component.js';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'users/:id', component: UserComponent },
  { path: 'list', component: ListComponent },
  { path: 'input', component: InputComponent },
  { path: 'main-thread', component: MainThreadComponent },
  { path: 'gesture', component: GestureComponent },
  { path: 'gesture-lab', component: GestureLabComponent },
  { path: 'attributes', component: AttributesComponent },
  { path: 'platform', component: PlatformComponent },
  { path: 'timing', component: TimingComponent },
  { path: 'network', component: NetworkComponent },
  {
    // The chunk name keeps this on the path `lynx.requireModuleAsync` loads from.
    // See docs/15-routing.md.
    path: 'lazy',
    loadComponent: () =>
      import(/* webpackChunkName: "lazy-route" */ './lazy.component.js').then((m) => m.LazyComponent),
  },
];
