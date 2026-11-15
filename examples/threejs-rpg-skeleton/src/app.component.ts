import {
  ChangeDetectionStrategy,
  Component,
  NO_ERRORS_SCHEMA,
  type OnDestroy,
  signal,
} from '@angular/core';
import {
  AnimationMixer,
  Bone,
  Box3,
  type Object3D,
  PerspectiveCamera,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { lynxAssetUrl } from 'ng-lynx';

/**
 * A real animated character skeleton — loaded from `RobotExpressive.glb`, the
 * CC0 model by Tomás Laulhé (Quaternius) with changes by Don McCurdy, from the
 * [three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf/RobotExpressive)
 * — running as genuine three.js inside an Angular Lynx component.
 *
 * Lynx has no canvas/WebGL, so (as in `examples/threejs-water`) there's no
 * `THREE.WebGLRenderer` — no filled/shaded/textured triangles are possible at
 * all, on any code path; that needs a GPU rasterizer Lynx doesn't have yet.
 * Everything *up to* rasterization is real, though:
 *  - `GLTFLoader` fetches and parses the actual binary glTF asset.
 *  - `THREE.AnimationMixer` drives the *real* skeleton with its embedded clip.
 *  - Each frame, every bone's *world* position is read straight off the
 *    animated skeleton and projected through a `PerspectiveCamera` with
 *    `Vector3.project()` — three's own camera math, the same technique
 *    `examples/threejs-water` uses for its wave surface.
 *  - Bone-to-parent **segments** are drawn as thin rotated `<view>`s (the
 *    classic "div line" technique: a `width:distance` bar, translated so its
 *    un-rotated center lands on the segment's midpoint, then `rotate()`d
 *    around that same center — see {@link buildLine}) — turning the dot cloud
 *    into a recognizable stick-figure silhouette. `transform: rotate()` isn't
 *    named either way in Lynx's documented CSS support, so this was originally
 *    added as untested territory — *additively* alongside the dots, so a
 *    no-op rotation would still leave the joints visible. **It is now
 *    confirmed working on the real native engine** (iOS simulator, Lynx
 *    Explorer): the segments render at their correct angles and the figure
 *    reads as a skeleton, not as a row of unrotated horizontal bars.
 *
 * ## Why a model with no textures
 *
 * An earlier version loaded an FBX character with embedded textures. It worked
 * in Node and in a plain browser tab, and crashed on Lynx's real web target
 * (`@lynx-js/web-core`) with `Cannot read properties of undefined (reading
 * 'URL')`: the loader eagerly parses embedded textures, which calls
 * `window.URL.createObjectURL(...)`. A `TypeError` reading a *property* of
 * `window` (not a `ReferenceError` for an undeclared identifier) means `window`
 * does resolve to something — `web-core` runs the Background-Thread bundle
 * inside an `eval()`'d wrapper function that passes `window` as a **local
 * parameter**, always `undefined`, to sandbox the Worker. A parameter shadows
 * the outer scope for that name, so no `globalThis.window` polyfill installed
 * from outside can ever reach code running inside that wrapper — confirmed the
 * hard way.
 *
 * We only need the *skeleton*, never the mesh surface (we render bone joints,
 * not triangles) or textures (dot/line projection can't display pixels).
 * `RobotExpressive.glb` uses plain material colours and no images, so it never
 * touches `window`/`document`, on any target.
 *
 * The raw rig carries 43 bones, 25 of them palm/finger joints, the root and IK
 * pole targets — filtered down to the 18 that actually read as a figure, see
 * {@link isCoreBone}.
 */

/** Pixel size of the (portrait) projection stage — taller than wide, for a standing figure. */
const STAGE_W = 260;
const STAGE_H = 360;
/** Render loop interval — same proven-safe cadence range as the water example. */
const FRAME_MS = 33; // ~30 fps
/** Dot diameter in px (must match `.joint` in app.css). */
const DOT = 8;
const HALF = DOT / 2;
/** Line thickness in px (must match `.bone-line` in app.css). */
const LINE_THICK = 3;

interface JointPoint {
  /** Stable bone name — the `@for` track key, so views are reused, not churned. */
  name: string;
  style: string;
}

interface BoneLine {
  /** Stable "child→parent" key — the `@for` track key. */
  key: string;
  style: string;
}

/** Palm/finger joints, the rig's root and its IK pole targets don't read as a figure at dot scale. */
function isCoreBone(name: string): boolean {
  return !/^bone$|^palm|^thumb|^index|^middle|^ring|^poletarget/i.test(name);
}

/** The feet are IK-driven children of the rig's root, so the bone tree doesn't link them to the legs. */
const IK_LINKS: ReadonlyArray<[child: string, parent: string]> = [
  ['FootL', 'LowerLegL'],
  ['FootR', 'LowerLegR'],
];

/** Walk up the hierarchy from a bone to its nearest CORE ancestor bone (skipping any filtered ones). */
function coreParentOf(bone: Bone): Bone | null {
  let p = bone.parent;
  while (p) {
    if ((p as Bone).isBone) {
      if (isCoreBone(p.name)) return p as Bone;
      p = (p as Bone).parent;
    } else {
      return null;
    }
  }
  return null;
}

/** The classic "div line" technique: a thin bar, translated + rotated to span two points. */
function buildLine(ax: number, ay: number, bx: number, by: number): string {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const midX = (ax + bx) / 2;
  const midY = (ay + by) / 2;
  // translate() places the bar's UN-rotated center at the midpoint; rotate()
  // then turns it in place (default transform-origin: center) to align with
  // the A→B direction — the endpoints land exactly on A and B.
  return (
    `width:${length.toFixed(1)}px;height:${LINE_THICK}px;` +
    `transform:translate(${(midX - length / 2).toFixed(1)}px,${(midY - LINE_THICK / 2).toFixed(1)}px) rotate(${angle.toFixed(2)}deg);`
  );
}

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="app">
      <view class="header">
        <text class="title">3D Skeleton Viewer</text>
        <text class="load" [class.idle]="load() === 'idle'">{{ load() }}</text>
        <text class="subtitle">real glTF + AnimationMixer · rendered as Lynx views</text>
      </view>

      <view class="stage">
        @if (status() === 'loading') {
          <text class="status">Loading RobotExpressive.glb…</text>
        } @else if (status() === 'error') {
          <text class="status error">{{ errorMessage() }}</text>
        } @else {
          @for (l of lines(); track l.key) {
            <view class="bone-line" [attr.style]="l.style"></view>
          }
          @for (j of joints(); track j.name) {
            <view class="joint" [attr.style]="j.style"></view>
          }
        }
      </view>

      <view class="controls">
        <view class="btn" (tap)="togglePlay()">
          <text class="btn-label">{{ playing() ? 'Pause' : 'Play' }}</text>
        </view>
      </view>

      <text class="hint">
        {{ boneCount() }} core bones (of {{ totalBoneCount() }} in the rig) · RobotExpressive, CC0
      </text>
    </view>
  `,
})
export class AppComponent implements OnDestroy {
  protected readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly errorMessage = signal('');
  protected readonly joints = signal<JointPoint[]>([]);
  protected readonly lines = signal<BoneLine[]>([]);
  protected readonly playing = signal(true);
  protected readonly load = signal('idle');
  protected readonly boneCount = signal(0);
  protected readonly totalBoneCount = signal(0);

  private mixer: AnimationMixer | undefined;
  private coreBones: Bone[] = [];
  /** [child, parent] pairs — both guaranteed to be in `coreBones`. */
  private boneLinks: Array<[Bone, Bone]> = [];
  private camera: PerspectiveCamera | undefined;
  private animRoot: Object3D | undefined;

  private running = false;
  private destroyed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastTick = 0;
  private lastFrame = 0;
  private fpsEMA = 0;
  private opsEMA = 0;
  private prevJointStyles: Record<string, string> = {};
  private prevLineStyles: Record<string, string> = {};

  constructor() {
    this.init().catch((err: unknown) => {
      console.error('[rpg-skeleton] failed to load', err);
      this.status.set('error');
      this.errorMessage.set(err instanceof Error ? err.message : String(err));
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.running = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
  }

  private async init(): Promise<void> {
    const modelBuf = await fetch(lynxAssetUrl('/resources/robot/RobotExpressive.glb'))
      .then((r) => r.arrayBuffer());
    if (this.destroyed) return;

    const gltf = await new GLTFLoader().parseAsync(modelBuf, '');
    if (this.destroyed) return;
    const animRoot = gltf.scene;
    const idleClip = gltf.animations.find((clip) => clip.name === 'Idle');
    if (!idleClip) throw new Error('RobotExpressive.glb has no Idle clip');

    const allBones: Bone[] = [];
    animRoot.traverse((o) => {
      if ((o as Bone).isBone) allBones.push(o as Bone);
    });
    if (allBones.length === 0) throw new Error('RobotExpressive.glb has no skeleton');

    this.animRoot = animRoot;
    this.coreBones = allBones.filter((b) => isCoreBone(b.name));
    this.totalBoneCount.set(allBones.length);
    this.boneCount.set(this.coreBones.length);

    const coreSet = new Set(this.coreBones);
    this.boneLinks = [];
    for (const bone of this.coreBones) {
      const parent = coreParentOf(bone);
      if (parent && coreSet.has(parent)) this.boneLinks.push([bone, parent]);
    }
    for (const [childName, parentName] of IK_LINKS) {
      const child = this.coreBones.find((b) => b.name === childName);
      const parent = this.coreBones.find((b) => b.name === parentName);
      if (child && parent) this.boneLinks.push([child, parent]);
    }

    this.mixer = new AnimationMixer(animRoot);
    this.mixer.clipAction(idleClip).play();

    // Auto-fit the camera from the actual posed skeleton — a model's raw unit
    // scale isn't something to hardcode, so frame whatever bounding box the
    // real bones produce instead of assuming a size.
    animRoot.updateMatrixWorld(true);
    const box = new Box3();
    const p = new Vector3();
    for (const b of this.coreBones) box.expandByPoint(b.getWorldPosition(p));
    const center = box.getCenter(new Vector3());
    const radius = Math.max(box.getSize(new Vector3()).length() / 2, 0.001);

    const camera = new PerspectiveCamera(45, STAGE_W / STAGE_H, 0.01, radius * 100);
    const dist = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.15;
    camera.position.set(center.x + dist * 0.55, center.y + radius * 0.3, center.z + dist * 0.85);
    camera.lookAt(center);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    this.camera = camera;

    this.status.set('ready');
    this.render();
    this.ensureRunning();
  }

  private ensureRunning(): void {
    if (this.running || !this.playing()) return;
    this.running = true;
    this.lastTick = Date.now();
    this.timer = setTimeout(this.loop, FRAME_MS);
  }

  private readonly loop = (): void => {
    if (!this.running) return;
    const now = Date.now();
    const dt = Math.min((now - this.lastTick) / 1000, 0.1);
    this.lastTick = now;

    if (this.lastFrame !== 0) {
      const frameDt = now - this.lastFrame;
      if (frameDt > 0) {
        const inst = 1000 / frameDt;
        this.fpsEMA = this.fpsEMA === 0 ? inst : this.fpsEMA * 0.8 + inst * 0.2;
      }
    }
    this.lastFrame = now;

    this.mixer?.update(dt);
    this.render();

    if (this.playing()) {
      this.timer = setTimeout(this.loop, FRAME_MS);
    } else {
      this.running = false;
    }
  };

  private render(): void {
    const camera = this.camera;
    const root = this.animRoot;
    if (!camera || !root) return;

    root.updateMatrixWorld(true);
    const p = new Vector3();
    const screen = new Map<Bone, { x: number; y: number }>();
    let changed = 0;

    const nextJoints: JointPoint[] = new Array(this.coreBones.length);
    for (let i = 0; i < this.coreBones.length; i++) {
      const bone = this.coreBones[i];
      bone.getWorldPosition(p).project(camera);

      const sx = (p.x * 0.5 + 0.5) * STAGE_W;
      const sy = (0.5 - p.y * 0.5) * STAGE_H;
      screen.set(bone, { x: sx, y: sy });

      const style = `transform:translate(${(sx - HALF).toFixed(1)}px,${(sy - HALF).toFixed(1)}px);`;
      if (style !== this.prevJointStyles[bone.name]) changed++;
      this.prevJointStyles[bone.name] = style;
      nextJoints[i] = { name: bone.name, style };
    }

    const nextLines: BoneLine[] = new Array(this.boneLinks.length);
    for (let i = 0; i < this.boneLinks.length; i++) {
      const [child, parent] = this.boneLinks[i];
      const a = screen.get(child)!;
      const b = screen.get(parent)!;
      const key = `${child.name}->${parent.name}`;
      const style = buildLine(a.x, a.y, b.x, b.y);
      if (style !== this.prevLineStyles[key]) changed++;
      this.prevLineStyles[key] = style;
      nextLines[i] = { key, style };
    }

    this.opsEMA = this.opsEMA === 0 ? changed : this.opsEMA * 0.8 + changed * 0.2;
    this.joints.set(nextJoints);
    this.lines.set(nextLines);

    const f = Math.round(this.fpsEMA);
    const live = Math.round(this.opsEMA);
    this.load.set(
      this.playing() ? `~${live} live × ${f} fps ≈ ${fmtK(live * f)}/s real update rate` : 'idle',
    );
  }

  protected togglePlay(): void {
    this.playing.update((p) => !p);
    if (this.playing()) {
      this.ensureRunning();
    } else {
      this.load.set('idle');
    }
  }
}

/** Compact thousands: 15360 → "15.4k", 980 → "980". */
function fmtK(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
}
