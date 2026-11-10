/**
 * The lazily-loaded route component for harness-router's `loadComponent`
 * check. Lives in its own module so the harness exercises a real dynamic
 * `import()` boundary.
 */
import { Component, NO_ERRORS_SCHEMA } from '@angular/core';

@Component({
  selector: 'app-lazy',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `<text class="page">Lazy page</text>`,
})
export class LazyComponent {}
