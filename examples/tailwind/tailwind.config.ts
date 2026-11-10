import preset from '@lynx-js/tailwind-preset';

// `content` scans `.ts` files — Angular component templates are inline
// `template:` strings in the `.ts`, so that's where Tailwind finds the utility
// class names to keep. (A project using external `templateUrl` files would add
// `'./src/**/*.html'` too.) `@lynx-js/tailwind-preset` restricts Tailwind to
// only the utilities Lynx's CSS engine supports — see docs/13-styling.md#tailwind.
//
// NOTE: kept to plain config syntax (no `satisfies`/`import type`) — Tailwind
// v3 loads this file through its own jiti/sucrase transform, which chokes on
// some newer TS-only syntax.
const config = {
  content: ['./src/**/*.ts'],
  presets: [preset],
};

export default config;
