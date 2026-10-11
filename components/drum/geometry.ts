/**
 * THE DRUM'S ARITHMETIC, AND NOTHING THAT DRAWS.
 *
 * Pure functions and plain data: the Fibonacci sphere the 112 sample tickets sit on, the seeded
 * scatter they load in from, the quaternion helpers, the easing curves, the beat table of the
 * pinned draw scene, and `simulate`, which writes one frame of every cell's position, rotation,
 * size, colour and light into flat buffers. No three.js, no DOM, no React and no directive, so
 * the three islands that read it (the drum stage, the draw scene and the braid) agree on every
 * beat because they call the same function, and components/drum/scene.ts only uploads the
 * buffers this fills.
 *
 * NOTHING HERE IS INVENTED. The drum is the 112 tickets of the five sample raffles with the cell
 * state lib/cell.ts gives each one, in raffle order, so each raffle is one latitude band with
 * raffle 0001 at the top. The scene's picks, pools and sort order are handed in from app/page.tsx,
 * where they are computed from lib/raffle.ts; there is no ticket number, index or digest below.
 *
 * WHAT THE DESIGN THIS PORTS DID THAT THIS DOES NOT. It flashed a random cell every 70ms as if
 * someone were buying, gave every cell a random kind, and sped the drum up with the scroll. None
 * of that survives: the approved sentence under the draw says there is no spin, no near miss and
 * no acceleration into a result. The drum turns at one constant rate, slows to rest before the
 * grid forms, and a winner lifts toward the reader and settles back without turning.
 */

/* ------------------------------------------------------------------------------ CAMERA */

export const FOV = 38;
export const CAMZ = 8;
export const FOCAL = 1 / Math.tan((FOV * Math.PI) / 360);

/** Idle rotation, radians a second. Constant: it never speeds up. */
export const SPIN = 0.16;

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/* ------------------------------------------------------------------------------ NUMBERS */

/** Park and Miller's minimal standard generator: the same drum on every load. */
export function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const sat = (v: number) => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Ease out, cubic. */
export const eo = (t: number) => 1 - Math.pow(1 - sat(t), 3);
/** Ease in and out, cubic. */
export function eio(t: number): number {
  const x = sat(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
/** Ease in, cubic. */
export const ei = (t: number) => Math.pow(sat(t), 3);
/** Where `q` sits between `a` and `b`, clamped to 0..1. */
export const seg = (q: number, a: number, b: number) => sat((q - a) / (b - a));

/* ------------------------------------------------------------------------------ QUATERNIONS
   (x, y, z, w), Hamilton product. */

export function qmul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function qrot(q: Quat, v: Vec3): Vec3 {
  const [x, y, z] = v;
  const [qx, qy, qz, qw] = q;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

export function qeuler(x: number, y: number, z: number): Quat {
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

export function qslerp(a: Quat, b: Quat, t: number): Quat {
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (cos < 0) {
    cos = -cos;
    bb = [-b[0], -b[1], -b[2], -b[3]];
  }
  if (cos > 0.9995) {
    const r: Quat = [
      lerp(a[0], bb[0], t),
      lerp(a[1], bb[1], t),
      lerp(a[2], bb[2], t),
      lerp(a[3], bb[3], t),
    ];
    const l = Math.hypot(r[0], r[1], r[2], r[3]);
    return [r[0] / l, r[1] / l, r[2] / l, r[3] / l];
  }
  const th = Math.acos(cos);
  const sn = Math.sin(th);
  const w1 = Math.sin((1 - t) * th) / sn;
  const w2 = Math.sin(t * th) / sn;
  return [
    a[0] * w1 + bb[0] * w2,
    a[1] * w1 + bb[1] * w2,
    a[2] * w1 + bb[2] * w2,
    a[3] * w1 + bb[3] * w2,
  ];
}

/** The rotation that turns +z onto the unit vector `n`: a cell lying flat on the sphere. */
export function qfromz(n: Vec3): Quat {
  const d = n[2];
  if (d < -0.9999) return [0, 1, 0, 0];
  const ax: Vec3 = [-n[1], n[0], 0];
  const w = 1 + d;
  const l = Math.hypot(ax[0], ax[1], ax[2], w);
  return [ax[0] / l, ax[1] / l, ax[2] / l, w / l];
}

export const QI: Quat = [0, 0, 0, 1];

/* ------------------------------------------------------------------------------ THE DATA
   What app/page.tsx hands the islands. Plain numbers and strings: no Raffle object crosses. */

/** One drum cell: [raffle id, ticket index, cell state from lib/cell.ts]. */
export type DrumCell = readonly [number, number, number];

export interface SceneTicket {
  /** 1-based ticket index. */
  index: number;
  /** The lib/cell.ts state the server renders for it. */
  state: number;
  /** Sold and never revealed: its bond was forfeited and it is not in the pool. */
  silent: boolean;
  /** Its place in the sorted nonce order the seed hashes them in, or -1 when silent. */
  sortPos: number;
}

export interface TraceStep {
  pick: number;
  poolBefore: number;
  winner: number;
}

export interface SceneLink {
  name: string;
  value: string;
  note: string;
  hex: boolean;
}

export interface SceneData {
  raffleId: number;
  serial: string;
  tickets: SceneTicket[];
  /** Ticket indices eligible to be drawn, in the order the draw indexes them. */
  eligible: number[];
  trace: TraceStep[];
  chainValue: string;
  seed: string;
  /** The five links of the draw chain, in order. */
  links: SceneLink[];
}

/** The pool before each pick: the eligible list with every earlier winner spliced out. */
export function poolsOf(scene: Pick<SceneData, "eligible" | "trace">): number[][] {
  const out: number[][] = [];
  let pool = [...scene.eligible];
  for (const step of scene.trace) {
    out.push(pool);
    pool = pool.filter((t) => t !== step.winner);
  }
  return out;
}

/* ------------------------------------------------------------------------------ THE BEATS
   Scroll progress q through the pinned scene, 0 when the scene's wrapper reaches the top of the
   viewport and 1 when its stage is about to scroll away. */

export const BEAT = {
  /** The drum slows to rest. */
  restFrom: 0.02,
  restTo: 0.085,
  /** The 92 tickets of the other raffles recede. */
  pushTo: 0.12,
  /** The statement leaves. */
  statementFrom: 0.06,
  statementTo: 0.085,
  /** Raffle 0004's own cells leave the drum and form the grid. */
  gatherFrom: 0.085,
  gatherTo: 0.135,
  /** The panel arrives. */
  hud: 0.1,
  /** The five links of the chain, then the two picks inside the last. */
  revealed: 0.14,
  publicData: 0.26,
  chainValue: 0.4,
  seed: 0.48,
  winners: 0.56,
  pick2: 0.74,
  rest: 0.9,
} as const;

/** The chain link a scroll position is on: -1 for the statement, then 0 to 4. */
export function beatOf(q: number): number {
  if (q >= BEAT.winners) return 4;
  if (q >= BEAT.seed) return 3;
  if (q >= BEAT.chainValue) return 2;
  if (q >= BEAT.publicData) return 1;
  if (q >= BEAT.revealed) return 0;
  return -1;
}

export interface Flight {
  /** The cursor walking the pool, 0..1. */
  sweep: number;
  /** The winner lifting toward the reader. */
  go: number;
  /** Held in front. */
  hold: number;
  /** Settling back into its place. */
  back: number;
  /** Past the point where it is shown as won. */
  won: boolean;
}

/** One pick, as a function of how far through its stretch of scroll the reader is. */
export function flight(u: number): Flight {
  return {
    sweep: seg(u, 0, 0.3),
    go: eio(seg(u, 0.3, 0.55)),
    hold: seg(u, 0.55, 0.74),
    back: eio(seg(u, 0.74, 0.96)),
    won: u > 0.42,
  };
}

export function flights(q: number): [Flight, Flight] {
  return [flight(seg(q, BEAT.winners, BEAT.pick2)), flight(seg(q, BEAT.pick2, BEAT.rest))];
}

/**
 * Where the cursor is in the pool while a pick sweeps: stepwise and monotonic, from position 0
 * to the pick and no further. No overshoot and no hesitation beside the winner. -1 when the
 * sweep has not started or has landed.
 */
export function cursorAt(f: Flight, pick: number): number {
  if (f.sweep <= 0 || f.sweep >= 1) return -1;
  return Math.min(pick, Math.floor(f.sweep * (pick + 1)));
}

/**
 * Scroll progress through a pinned wrapper. Measured on the NON-sticky wrapper, because a stuck
 * element's rectangle reports its pinned position and would read the same progress all the way
 * down. `stageH` is the sticky stage's own height, so the denominator is exactly the distance the
 * stage stays pinned for.
 */
export function pinProgress(wrapTop: number, wrapHeight: number, stageH: number): number {
  return sat(-wrapTop / Math.max(1, wrapHeight - stageH));
}

/* ------------------------------------------------------------------------------ PALETTE
   palettes.senja.three, passed to the shader as raw floats. three.js converts a Color built from
   a hex into its linear working space and a ShaderMaterial does not convert back, so a Color
   uniform would come out darker than the approved render. These go straight to the GPU. */

export const P3 = {
  cell: [0.76, 0.38, 0.4] as Vec3,
  unsold: [0.4, 0.24, 0.26] as Vec3,
  silent: [0.22, 0.12, 0.14] as Vec3,
  band: [1, 0.81, 0.66] as Vec3,
  win: [1, 0.44, 0.24] as Vec3,
  winLo: [0.7, 0.19, 0.11] as Vec3,
  winHi: [1, 0.45, 0.24] as Vec3,
  winBand: [1, 0.84, 0.68] as Vec3,
  winEdge: [1, 0.95, 0.89] as Vec3,
  edge: [1, 0.93, 0.86] as Vec3,
  winSheen: [0.16, 0.08, 0.04] as Vec3,
} as const;

/** palettes.senja.hex, for sprite and line materials, which round-trip a Color correctly. */
export const PH = {
  bigHalo: 0x7e2a40,
  coreHalo: 0xffb48c,
  shock: 0xffd2b4,
  winHalo: 0xff6b3d,
  ring: 0xd88a8f,
  ring2: 0xf2b98e,
  dust: 0xffd8c4,
} as const;

/* ------------------------------------------------------------------------------ THE DRUM */

/** Cell state values, from lib/cell.ts. */
export const UNSOLD = 0;
export const SOLD = 1;
export const REVEALED = 2;
export const WON = 3;
export const REFUNDED = 4;

/**
 * The band value that tells the shader to draw a 1px strike across the waist instead of a foot:
 * a refunded ticket on the void raffle, which keeps the sold block, as app/cell.css draws it.
 */
export const STRIKE = -1;

export interface DrumModel {
  N: number;
  base: Vec3[];
  qBase: Quat[];
  scat: Vec3[];
  delay: number[];
  /** Where each cell of the other raffles drifts while the grid holds the stage: [x, y, z, phase]. */
  deep: [number, number, number, number][];
  isDeep: Uint8Array;
  state: Uint8Array;
  raffle: Int16Array;
  /** The scene raffle's ticket index for a cell of that raffle, 0 for every other cell. */
  ticket: Int16Array;
  /** Drum index of each scene ticket, by ticket index (slot 0 unused). */
  ofTicket: Int16Array;
  /** Drum indices of the won cells: they get the solid winner body. */
  winners: number[];
  silent: Uint8Array;
  sortPos: Int16Array;
  /** Per-frame output, uploaded by scene.ts. */
  P: Float32Array;
  Q: Float32Array;
  S: Float32Array;
  COL: Float32Array;
  FX: Float32Array;
  /** Visibility of each winner's solid body, by position in `winners`. */
  WV: Float32Array;
  /** Glow of each winner's halo, by position in `winners`. */
  WH: Float32Array;
}

/**
 * Lay the tickets on a Fibonacci sphere in the order they are given (raffle 0001's first ticket
 * at the north pole), so each sample raffle is one contiguous band of latitude.
 */
export function buildDrum(cells: readonly DrumCell[], scene: SceneData | null): DrumModel {
  const N = cells.length;
  const rnd = rng(7);
  const GA = Math.PI * (3 - Math.sqrt(5));
  const base: Vec3[] = [];
  const scat: Vec3[] = [];
  const delay: number[] = [];
  for (let i = 0; i < N; i += 1) {
    const y = 1 - (2 * (i + 0.5)) / N;
    const rr = Math.sqrt(1 - y * y);
    const th = i * GA;
    base.push([rr * Math.cos(th), y, rr * Math.sin(th)]);
    const u = rnd() * Math.PI * 2;
    const v = rnd() * 2 - 1;
    const d = 7 + rnd() * 10;
    const sq = Math.sqrt(1 - v * v);
    scat.push([Math.cos(u) * sq * d, v * d * 0.7, -4 - rnd() * 14]);
    delay.push(0.05 + rnd() * 0.55 + (1 - (y + 1) / 2) * 0.25);
  }
  const deep: [number, number, number, number][] = [];
  for (let i = 0; i < N; i += 1) {
    deep.push([(rnd() - 0.5) * 26, (rnd() - 0.5) * 15, -5 - rnd() * 16, rnd() * 6.28]);
  }

  const state = new Uint8Array(N);
  const raffle = new Int16Array(N);
  const ticket = new Int16Array(N);
  const isDeep = new Uint8Array(N);
  const silent = new Uint8Array(N);
  const sortPos = new Int16Array(N).fill(-1);
  const maxTicket = scene ? Math.max(0, ...scene.tickets.map((t) => t.index)) : 0;
  const ofTicket = new Int16Array(maxTicket + 1).fill(-1);
  const winners: number[] = [];
  const byIndex = new Map(scene?.tickets.map((t) => [t.index, t]) ?? []);

  for (let i = 0; i < N; i += 1) {
    const [rid, idx, s] = cells[i];
    state[i] = s;
    raffle[i] = rid;
    if (s === WON) winners.push(i);
    if (scene && rid === scene.raffleId) {
      ticket[i] = idx;
      ofTicket[idx] = i;
      const t = byIndex.get(idx);
      if (t) {
        silent[i] = t.silent ? 1 : 0;
        sortPos[i] = t.sortPos;
      }
    } else if (i % 5 === 2) {
      isDeep[i] = 1;
    }
  }

  return {
    N,
    base,
    qBase: base.map(qfromz),
    scat,
    delay,
    deep,
    isDeep,
    state,
    raffle,
    ticket,
    ofTicket,
    winners,
    silent,
    sortPos,
    P: new Float32Array(N * 3),
    Q: new Float32Array(N * 4),
    S: new Float32Array(N),
    COL: new Float32Array(N * 3),
    FX: new Float32Array(N * 4),
    WV: new Float32Array(Math.max(1, winners.length)),
    WH: new Float32Array(Math.max(1, winners.length)),
  };
}

/* ------------------------------------------------------------------------------ PROJECTION */

export interface View {
  /** Canvas size in CSS pixels. */
  W: number;
  H: number;
}

/** World units per CSS pixel on the z = 0 plane. */
export function unitsPerPx(v: View): number {
  return (2 * CAMZ * Math.tan((FOV * Math.PI) / 360)) / v.H;
}

/** A viewport point to world coordinates on the z = 0 plane. */
export function px2w(v: View, x: number, y: number): [number, number] {
  const k = unitsPerPx(v);
  return [(x - v.W / 2) * k, -(y - v.H / 2) * k];
}

/** A world point to [x, y, pixels per world unit] in the viewport. */
export function project(v: View, x: number, y: number, z: number): Vec3 {
  let dz = CAMZ - z;
  if (dz < 0.05) dz = 0.05;
  const asp = v.W / v.H;
  return [((x * FOCAL) / asp / dz + 1) * (v.W / 2), (1 - (y * FOCAL) / dz) * (v.H / 2), (FOCAL / dz) * (v.H / 2)];
}

/* ------------------------------------------------------------------------------ ONE FRAME */

export interface Layout {
  /** Drum centre and radius, in world units. */
  cx: number;
  cy: number;
  R: number;
  /** The grid: centre, cell size and gap, in world units. */
  gx: number;
  gy: number;
  cs: number;
  gap: number;
}

export interface Pointer {
  has: boolean;
  x: number;
  y: number;
  /** -0.5..0.5 across the viewport. */
  nx: number;
  ny: number;
}

export interface DrumState {
  spin: number;
  tiltX: number;
  tiltY: number;
  /** The grid's own rotation this frame. */
  QG: Quat;
  /** Read back by the stage for the halos and the labels. */
  m: number;
  push: number;
  deep: number;
  fogN: number;
  fogF: number;
  f: [Flight, Flight];
}

export function newState(): DrumState {
  return {
    spin: 0,
    tiltX: 0,
    tiltY: 0,
    QG: [0, 0, 0, 1],
    m: 0,
    push: 0,
    deep: 0,
    fogN: 6,
    fogF: 10,
    f: [flight(0), flight(0)],
  };
}

export interface FrameInput {
  /** Seconds since the drum's first frame. */
  t: number;
  /** Seconds since the previous frame, capped. */
  dt: number;
  /** "hero" around the landing's opening, "scene" inside the pinned draw. */
  zone: "hero" | "scene";
  /** Progress through the pinned scene, 0 in the hero. */
  q: number;
  layout: Layout;
  ptr: Pointer;
  view: View;
  /** True on a narrow screen: a smaller grid lean. */
  narrow: boolean;
}

function setCell(
  d: DrumModel,
  i: number,
  x: number,
  y: number,
  z: number,
  q: Quat,
  s: number,
  col: Vec3,
  fill: number,
  band: number,
  gl: number,
  al: number,
) {
  d.P[i * 3] = x;
  d.P[i * 3 + 1] = y;
  d.P[i * 3 + 2] = z;
  d.Q[i * 4] = q[0];
  d.Q[i * 4 + 1] = q[1];
  d.Q[i * 4 + 2] = q[2];
  d.Q[i * 4 + 3] = q[3];
  d.S[i] = s;
  d.COL[i * 3] = col[0];
  d.COL[i * 3 + 1] = col[1];
  d.COL[i * 3 + 2] = col[2];
  d.FX[i * 4] = fill;
  d.FX[i * 4 + 1] = band;
  d.FX[i * 4 + 2] = gl;
  d.FX[i * 4 + 3] = al;
}

function mixc(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** A scene ticket's place in the 5-wide grid, in the grid's own plane. */
export function gridLocal(L: Layout, t: number): Vec3 {
  const col = (t - 1) % 5;
  const row = Math.floor((t - 1) / 5);
  const st = L.cs + L.gap;
  return [(col - 2) * st, (1.5 - row) * st, 0];
}

function gridPos(L: Layout, QG: Quat, t: number): Vec3 {
  const r = qrot(QG, gridLocal(L, t));
  return [L.gx + r[0], L.gy + r[1], r[2]];
}

/**
 * One frame of every cell, written into the model's buffers. Pure apart from the buffers and the
 * smoothed tilt and spin carried in `s`.
 *
 * `scene` is the scene raffle's pools and picks; without it the drum is the hero alone.
 */
export function simulate(
  d: DrumModel,
  s: DrumState,
  f: FrameInput,
  scene: { pools: number[][]; trace: TraceStep[] } | null,
): void {
  const { t, dt, q, layout: L, ptr } = f;
  const hero = f.zone === "hero";

  // The lean toward a fine pointer, smoothed. In the scene the drum is at rest and does not lean.
  const tx = hero && ptr.has ? ptr.ny * 0.55 : 0;
  const ty = hero && ptr.has ? ptr.nx * 0.8 : 0;
  const k = Math.min(1, dt * 3);
  s.tiltX += (tx - s.tiltX) * k;
  s.tiltY += (ty - s.tiltY) * k;

  // ONE CONSTANT RATE, SLOWING TO REST BEFORE THE GRID FORMS. Never faster than SPIN.
  const rest = hero ? 0 : eio(seg(q, BEAT.restFrom, BEAT.restTo));
  s.spin += dt * SPIN * (1 - rest);
  const qd = qeuler(0.32 + s.tiltX, s.spin + s.tiltY, 0.14);

  const push = hero ? 0 : ei(seg(q, 0, BEAT.pushTo));
  const m = hero ? 0 : eio(seg(q, BEAT.gatherFrom, BEAT.gatherTo));
  const dp = hero ? 0 : eio(seg(q, BEAT.restFrom, BEAT.pushTo));
  s.push = push;
  s.m = m;
  s.deep = dp;

  // The grid keeps a resting lean and follows the pointer a little. It does not breathe.
  s.QG = qeuler(-0.2 + s.tiltX * 0.38, (f.narrow ? 0.09 : 0.15) + s.tiltY * (f.narrow ? 0.14 : 0.26), 0);
  const QG = s.QG;

  const R = L.R;
  const csz = R * 0.205;
  const wave = (t - 1.35) * 2.4 - 1.2;
  const pxr = Math.max(80, Math.min(f.view.W, f.view.H) * 0.16);

  const bR = seg(q, BEAT.revealed, BEAT.publicData - 0.02);
  const bP = seg(q, BEAT.publicData, BEAT.chainValue);
  const bC = seg(q, BEAT.chainValue, BEAT.seed);
  const bS = seg(q, BEAT.seed, BEAT.winners);
  const F = flights(q);
  s.f = F;
  const bE = seg(q, BEAT.rest, 1);
  const trace = scene?.trace ?? [];
  const winT = trace.map((st) => st.winner);

  for (let w = 0; w < d.winners.length; w += 1) {
    d.WV[w] = 0;
    d.WH[w] = 0;
  }

  for (let i = 0; i < d.N; i += 1) {
    const b = d.base[i];
    const rv = qrot(qd, b);
    const e = eo((t - d.delay[i]) / 1.15);
    const tk = d.ticket[i];
    const st = d.state[i];
    let rad = R * (tk ? 1 : 1 + push * 7.5);

    let bul = 0;
    if (hero && ptr.has && rv[2] > -0.2 && e > 0.9) {
      const pp = project(f.view, L.cx + rv[0] * rad, L.cy + rv[1] * rad, rv[2] * rad);
      const dx = pp[0] - ptr.x;
      const dy = pp[1] - ptr.y;
      bul = Math.exp(-(dx * dx + dy * dy) / (2 * pxr * pxr));
      rad *= 1 + bul * 0.12;
    }

    let wx = lerp(d.scat[i][0], L.cx + rv[0] * rad, e);
    let wy = lerp(d.scat[i][1], L.cy + rv[1] * rad, e);
    let wz = lerp(d.scat[i][2], rv[2] * rad, e);
    let qo = qmul(qd, d.qBase[i]);

    // THE CELL'S OWN STATE, from lib/cell.ts. Nothing here is random.
    const col: Vec3 = st === UNSOLD ? P3.unsold : P3.cell;
    let fill = st === UNSOLD ? 0 : 0.7;
    const band = st === REVEALED || st === WON ? 1 : st === REFUNDED ? STRIKE : 0;
    let gl = 0.05;
    gl += Math.exp(-Math.pow((b[1] - wave) * 4, 2)) * 0.9;
    if (bul > 0) {
      gl += bul * 1.5;
      fill = Math.max(fill, bul * 0.9);
    }
    let al = (0.25 + 0.75 * e) * (tk ? 1 : 1 - sat((push - 0.55) / 0.45));
    let size = csz * (0.6 + 0.4 * e);

    if (d.isDeep[i] && dp > 0) {
      const dpp = d.deep[i];
      const ph = dpp[3];
      wx = lerp(L.cx + rv[0] * R, dpp[0] + Math.sin(t * 0.07 + ph) * 1.4, dp);
      wy = lerp(L.cy + rv[1] * R, dpp[1] + Math.cos(t * 0.05 + ph * 1.3) * 1.1, dp);
      wz = lerp(rv[2] * R, dpp[2], dp);
      qo = qslerp(qo, qeuler(t * 0.11 + ph, t * 0.13 + ph * 2, ph), dp);
      al = (0.25 + 0.75 * e) * lerp(1, 0.75, dp);
      size = lerp(size, csz * 1.5, dp);
      gl = lerp(gl, 0.04, dp);
    }

    // THE FAR SIDE RECEDES. With a hundred-odd large cells, many drawn as outlines only, the back
    // hemisphere's frames would read through the front at full strength and the sphere would
    // turn into a tangle. Cells facing away fade to 30% by halfway down the back; the whole front
    // half keeps its alpha. The fade lets go as the scene's grid forms, where every ticket is read.
    al *= lerp(1, lerp(0.3, 1, sat((rv[2] + 0.5) / 0.5)), 1 - Math.max(m, dp));

    // A won cell carries the solid winner body in the drum. It fades as the scene's grid forms,
    // because the scene replays the draw from before anyone had won.
    const wi = st === WON ? d.winners.indexOf(i) : -1;
    if (wi >= 0) {
      d.WV[wi] = 1 - m;
      d.WH[wi] = 0.3 * (1 - m) * e;
    }

    if (tk && m > 0 && scene) {
      const g = gridPos(L, QG, tk);
      let x = lerp(wx, g[0], m);
      let yy = lerp(wy, g[1], m);
      let z = lerp(wz, g[2], m);
      let qq = m >= 1 ? QG : qslerp(qo, QG, m);
      let sz = lerp(size, L.cs, m);
      let c2: Vec3 = col;
      let fil = lerp(fill, 0.55, m);
      let bnd = lerp(band, 0, m);
      let g2 = lerp(gl, 0.12, m);
      let a2 = 1;
      const sil = d.silent[i] === 1;

      if (m >= 1) {
        c2 = P3.cell;
        fil = 0.55;
        g2 = 0.12;
        // Revealed tickets: the bands rise, ticket by ticket; the silent tickets go dark.
        const rt = seg(bR * 1.5 - (tk - 1) / 30, 0, 0.4);
        if (sil) {
          c2 = mixc(P3.cell, P3.silent, rt);
          fil = lerp(fil, 0.08, rt);
          a2 = lerp(1, 0.55, rt);
          g2 = lerp(g2, 0, rt);
        } else {
          bnd = rt;
        }
        // Public data: light runs through the tickets in sorted nonce order.
        if (!sil && bP > 0 && bP < 1) {
          g2 += Math.exp(-Math.pow((bP * 1.2 - 0.1 - d.sortPos[i] / 17) * 9, 2)) * 1.2;
        }
        // The chain value, then the seed: the pool lifts once, together.
        if (!sil) g2 += Math.sin(Math.PI * bC) * 0.22 + Math.sin(Math.PI * bS) * 0.32;

        for (let p = 0; p < trace.length && p < 2; p += 1) {
          const Fp = F[p];
          const pool = scene.pools[p] ?? [];
          const cur = cursorAt(Fp, trace[p].pick);
          if (cur >= 0 && pool[cur] === tk) g2 += 1.1;
          if (tk === winT[p] && Fp.sweep >= 1) {
            // THE FLIGHT. Toward the reader and back, and the only rotation is the grid's own
            // lean easing toward square-on: no spin.
            const lift = Fp.go * (1 - Fp.back);
            const zz = g[2] + 2.6 * lift + 0.35 * Fp.back;
            const kz = (CAMZ - zz) / (CAMZ - g[2]);
            // Scaled toward the camera axis by kz, so it stays over its own place on screen
            // while it comes closer.
            x = lerp(g[0], L.gx, lift) * kz;
            yy = lerp(g[1], L.gy, lift) * kz;
            z = zz;
            sz = L.cs * (1 + 1.5 * lift + 0.1 * Fp.back) * kz;
            qq = qslerp(QG, QI, sat(Fp.go * 1.6) * (1 - Fp.back));
            c2 = mixc(P3.cell, P3.win, sat(Fp.go * 2));
            fil = lerp(fil, 0.85, sat(Fp.go * 2));
            bnd = sat(Fp.go * 2);
            g2 = 0.3 + lift * 0.55;
            if (wi >= 0) {
              d.WV[wi] = sat(Fp.go * 4);
              d.WH[wi] = 0.3 + lift * 0.55;
            }
          }
        }
        // A winner stays lit once it has settled back.
        for (let p = 0; p < trace.length && p < 2; p += 1) {
          if (tk === winT[p] && F[p].back >= 1) {
            const kz2 = (CAMZ - g[2] - 0.35) / (CAMZ - g[2]);
            c2 = P3.win;
            fil = 0.85;
            bnd = 1;
            z = g[2] + 0.35;
            x = g[0] * kz2;
            yy = g[1] * kz2;
            sz = L.cs * 1.1 * kz2;
            qq = QG;
            g2 = 0.35;
            if (wi >= 0) {
              d.WV[wi] = 1;
              d.WH[wi] = 0.32;
            }
          }
        }
        // The rest of the grid steps back while a winner is out, and after the second pick.
        const flying = Math.max(
          F[0].sweep >= 1 ? F[0].go * (1 - F[0].back) : 0,
          F[1].sweep >= 1 ? F[1].go * (1 - F[1].back) : 0,
        );
        const isFlying = (tk === winT[0] && F[0].sweep >= 1) || (tk === winT[1] && F[1].sweep >= 1);
        if (!isFlying) a2 *= 1 - 0.6 * flying;
        if (bE > 0 && !winT.includes(tk)) a2 *= lerp(1, 0.55, bE);
      }
      setCell(d, i, x, yy, z, qq, sz, c2, fil, bnd, g2, al * a2);
    } else {
      setCell(d, i, wx, wy, wz, qo, size, col, fill, band, gl, al);
    }
  }

  const dc = CAMZ;
  const mix = Math.max(m, dp);
  s.fogN = lerp(dc - R * 0.25, dc - 0.2, mix);
  s.fogF = lerp(dc + R * 1.05, dc + 22, mix);
}

/**
 * The viewport position of a scene ticket's label: just inside its cell's top left corner, and
 * the scale its cell is drawn at relative to a grid cell at rest.
 */
export function labelAt(d: DrumModel, L: Layout, v: View, i: number): [number, number, number] {
  const sz = d.S[i];
  const q: Quat = [d.Q[i * 4], d.Q[i * 4 + 1], d.Q[i * 4 + 2], d.Q[i * 4 + 3]];
  const off = qrot(q, [-0.5 * sz + sz * 0.1, 0.5 * sz - sz * 0.09, 0]);
  const z = d.P[i * 3 + 2] + off[2];
  const p = project(v, d.P[i * 3] + off[0], d.P[i * 3 + 1] + off[1], z);
  const sc = (sz * FOCAL) / (CAMZ - d.P[i * 3 + 2]) / ((L.cs * FOCAL) / CAMZ);
  return [p[0], p[1], sc];
}
