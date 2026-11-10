import { bootstrapLynxApplication } from 'angular-lynx';

// The optional default control theme — styles every angular-lynx/forms control
// from CSS custom properties. Import it FIRST, then app.css overrides tokens.
import 'angular-lynx/forms/theme.css';
import './app.css';
import { AppComponent } from './app.component.js';

bootstrapLynxApplication(AppComponent).catch((err) => {
  console.error('[angular-lynx] bootstrap failed', err);
});
