# Third-party software

The licence of ng-lynx itself is in [`LICENSE`](LICENSE), and the code derived from other
projects is credited in [`NOTICE`](NOTICE). This page lists what it depends on, and what
the examples use. Every package here allows use in an Apache-2.0 project, and in closed-source
apps. The media files at the end are checked.

**If you ship an app built with ng-lynx,** its bundle contains these packages, so your
app has to carry their notices. Angular's MIT notice and the Apache-2.0 notice of `@lynx-js/*`
are the ones that always apply.

## What the package depends on

These install from npm with their own licences. None of them is copied into the
`ng-lynx` tarball.

| Package | Licence | Used for |
|---|---|---|
| `@angular/*` (`core`, `compiler`, `common`, `forms`, `router`, `localize`, `compiler-cli`), `@ngtools/webpack`, `@angular-devkit/*` | MIT | The framework, and the AOT compile. Peer dependencies |
| `@lynx-js/rspeedy`, `@lynx-js/template-webpack-plugin`, `@lynx-js/runtime-wrapper-webpack-plugin`, other `@lynx-js/*` build tools | Apache-2.0 | The build |
| `@lynx-js/genui` | Apache-2.0 | `ng-lynx/genui`. Optional peer, which needs `@lynx-js/react` as a peer of its own |
| `@openuidev/lang-core` | MIT | `ng-lynx/openui`. Optional peer |
| `typescript` | Apache-2.0 | Peer dependency |
| `tslib` | 0BSD | Helpers used by compiled code |
| `@babel/core`, `babel-loader`, `esbuild` | MIT | The build |

Their own dependency tree, as `pnpm licenses list --prod` reports it, is MIT (about 200
packages), Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause and 0BSD, plus `argparse` (PSF-2.0),
`caniuse-lite` (CC-BY-4.0), `mdn-data` (CC0-1.0) and `dompurify` (MPL-2.0 OR Apache-2.0, your
choice). None of them is copyleft in a way that reaches your code. The Rsbuild and Rspack
toolchain is MIT.

## What only the examples use

The examples aren't published to npm.

| Package | Licence | Example |
|---|---|---|
| `three` | MIT | `threejs-water`, `threejs-rpg-skeleton` |
| `zod` | MIT | `genui` |
| `@rsbuild/plugin-sass` | MIT | `styling` |
| `tailwindcss`, `rsbuild-plugin-tailwindcss` | MIT | `tailwind` |
| `@lynx-js/tailwind-preset` | Apache-2.0 | `tailwind` |
| `sparkling-*` | MIT | `genui`, as a native app |

## Media in the examples

Checked on 2026-11-09 against each file's download page, which macOS recorded with the
original in the local `assets/` folder (gitignored). The photos are still from Pexels, whose
licence allows use in an app with no attribution, but not reselling the files as they are or
putting them on another stock site. Everything else is public domain, CC0, or drawn for this
project.

| File | Source | Licence | Status |
|---|---|---|---|
| `examples/ui-gallery/public/media/cat-alert.jpg`, `examples/accessibility/public/media/avatar.jpg` (the same file) | ["tabby cat"](https://www.pexels.com/photo/27153320/) by Erwin Salas, Pexels, resized | [Pexels License](https://www.pexels.com/license/) | ✅ Confirmed |
| `examples/ui-gallery/public/media/cat-asleep.jpg` | ["Gray Tabby Cat Sleeping On Leather Sofa"](https://www.pexels.com/photo/762986/) by FOX (`@fox-58267`), Pexels, resized | Pexels License | ✅ Confirmed |
| `examples/ui-gallery/public/media/cat-white.jpg` | ["Close-up of Relaxed White Cat Indoors"](https://www.pexels.com/photo/29196411/) by Nastia Ligrain, Pexels, resized | Pexels License | ✅ Confirmed |
| `examples/media/public/media/earth-from-iss.mp4`, `examples/primitives/public/media/earth-from-iss.mp4` (the same file) | NASA, ["Earth Views from the International Space Station"](https://images.nasa.gov/details/Earth%20Views%20from%20the%20International%20Space%20Station) (HDEV camera, 2019). Seconds 40 to 48, scaled to 640×360, audio removed: 1.1 MB | NASA media is ["generally not subject to copyright in the United States"](https://www.nasa.gov/nasa-brand-center/images-and-media/). Courtesy credit to NASA; no NASA logo is used, and nothing implies NASA endorses this project | ✅ Confirmed. The audio was dropped because the original's soundtrack may be third-party music |
| `examples/media/public/media/goldberg-variation-4.mp3` | J.S. Bach, Goldberg Variations BWV 988, Variation 4, played by Kimiko Ishizaka, from the "Open Goldberg Variations" ([Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Kimiko_Ishizaka_-_J.S._Bach-_-Open-_Goldberg_Variations,_BWV_988_(Piano)_-_05_Variatio_4_a_1_Clav.mp3)), unchanged: 69 s, 2.8 MB | CC0 1.0 | ✅ Confirmed |
| `examples/primitives/public/media/mountain-range.svg` | ["Mountain peaks"](https://freesvg.org/mountain-peaks) (FreeSVG ID 206548), from publicdomainvectors.org | Public domain (CC0) | ✅ Confirmed |
| `examples/primitives/public/media/lynx-classes.svg`, `lynx-inline.svg` (one drawing, coloured two ways) | Drawn for this project on 2026-11-09 | This project's licence | ✅ |
| `examples/threejs-rpg-skeleton/public/resources/robot/RobotExpressive.glb` | Model by Tomás Laulhé ([Quaternius](https://www.patreon.com/quaternius)), with changes by Don McCurdy, from the [three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf/RobotExpressive) | CC0 1.0, stated in that folder's README | ✅ Confirmed |
| `packages/device-tests/public/square.png` | Made for the tests | This project's licence | ✅ |

Three files were replaced on 2026-11-09. Git history still holds them until the repository is
recreated before going public:

- A capybara drawing in the primitives example, from freesvgdownload.com, licensed for personal
  use only (from `144fd51`).
- `wonders.mp3` in the media example, from Pixabay, whose licence forbids distributing its files
  on their own (from `a7bb818`).
- `nature.mp4` in the media and primitives examples, from Pexels (from `a7bb818`).

`examples/threejs-rpg-skeleton/public/resources/robot/RobotExpressive.glb` stays: the three.js
folder's README gives it as "CC0 1.0", and asks you to consider supporting the creator's Patreon.

`examples/threejs-water` reimplements the physics of
[threejs-water](https://github.com/jeantimex/threejs-water) (MIT; Evan Wallace, Yong Su) on
the CPU. It contains none of that project's code.
