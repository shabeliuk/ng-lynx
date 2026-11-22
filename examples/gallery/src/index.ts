import { bootstrapLynxApplication } from 'ng-lynx';

import './app.css';
import { GalleryComponent } from './gallery.component.js';

bootstrapLynxApplication(GalleryComponent).catch((err) => {
  console.error('[ng-lynx] bootstrap failed', err);
});
