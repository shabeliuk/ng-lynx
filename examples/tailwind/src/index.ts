import { bootstrapLynxApplication } from 'ng-lynx';

// The Tailwind entry — pluginTailwindCSS expands the @tailwind directives into
// the generated utility stylesheet, then the Lynx CSS compiler takes over.
import './tailwind.css';
import { AppComponent } from './app.component.js';

bootstrapLynxApplication(AppComponent).catch((err) => {
  console.error('[ng-lynx] bootstrap failed', err);
});
