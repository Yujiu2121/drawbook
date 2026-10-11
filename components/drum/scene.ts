/**
 * THE DRUM, IN three.js. Loaded only by dynamic import() from components/drum/drum-stage.tsx,
 * after the first paint, and only when motion is allowed and WebGL answers. Nothing else in the
 * app imports this file, so three.js never reaches another route or the first paint of this one.
 *
 * It draws what components/drum/geometry.ts computed and decides nothing: every position, size,
 * colour and light arrives in the model's flat buffers, and this file uploads them.
 *
 * COLOUR MANAGEMENT. Current three.js treats a Color built from a hex as sRGB and converts it into
 * its linear working space, and a ShaderMaterial writes its output without converting it back. So
 * the two cell shaders take their colours as raw floats (geometry.ts P3), never as a Color, and
 * come out exactly as the approved render did. Sprite, point and line materials do convert back on
 * output, so they keep Color(hex) and round-trip. The renderer's output colour space is sRGB.
 *
 * DISPOSAL IS NOT OPTIONAL. A client navigation away from the landing unmounts the stage, and a
 * WebGL context that is not released is still counted: after a handful of round trips the browser
 * starts dropping the oldest context with a console warning. `dispose()` frees every geometry,
 * material and texture, the renderer, and then forces the context lost.
 */

import * as THREE from "three";

import { CAMZ, FOV, P3, PH, eo, sat, type DrumModel, type DrumState, type Layout } from "./geometry";

export interface DrumRenderer {
  resize(w: number, h: number): void;
  draw(frame: { t: number; layout: Layout; state: DrumState; zone: "hero" | "scene"; q: number }): void;
  dispose(): void;
}

/** A vec3 literal for a shader, from a raw float triple. */
function v3(c: readonly number[]): string {
  return `vec3(${c.map((v) => v.toFixed(3)).join(",")})`;
}

/** A white radial falloff the halos and the dust are tinted from. */
function haloCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  if (x) {
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.18, "rgba(255,255,255,.55)");
    g.addColorStop(0.45, "rgba(255,255,255,.14)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
  }
  return c;
}

/** The ring the load-in sends out once: bright at 80% of the radius, nothing inside. */
function shockCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d");
  if (x) {
    const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.62, "rgba(255,255,255,0)");
    g.addColorStop(0.8, "rgba(255,255,255,.9)");
    g.addColorStop(0.86, "rgba(255,255,255,.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 256);
  }
  return c;
}

/**
 * THE HALO BUDGET. The big wine halo is additive and reaches past the drum. In the hero the stage
 * masks the canvas to the drum's own slot (app/drum.css), so no light falls under the copy column
 * or the caption, and the halo's peak is held here so the slot itself does not glare.
 */
const BIG_HALO = 0.3;

export function createDrumRenderer(canvas: HTMLCanvasElement, d: DrumModel): DrumRenderer | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
  } catch {
    return null;
  }
  if (!renderer.getContext()) return null;

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(FOV, 1, 0.1, 120);
  cam.position.set(0, 0, CAMZ);

  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  /* ---- THE CELLS. One instanced quad per ticket, additive, drawn from its state. */
  const plane = keep(new THREE.PlaneGeometry(1, 1));
  const geo = keep(plane.clone());
  const aCol = new THREE.InstancedBufferAttribute(d.COL, 3);
  const aFx = new THREE.InstancedBufferAttribute(d.FX, 4);
  aCol.setUsage(THREE.DynamicDrawUsage);
  aFx.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("aCol", aCol);
  geo.setAttribute("aFx", aFx);

  /* aFx: x fill, y band (1 a foot, -1 a strike across the waist), z light, w alpha. */
  const mat = keep(
    new THREE.ShaderMaterial({
      uniforms: {
        uBand: { value: new THREE.Vector3(...P3.band) },
        uFogN: { value: 6 },
        uFogF: { value: 10 },
      },
      vertexShader: [
        "attribute vec3 aCol; attribute vec4 aFx; uniform float uFogN; uniform float uFogF;",
        "varying vec2 vUv; varying vec3 vCol; varying vec4 vFx; varying float vFog;",
        "void main(){ vUv=uv; vCol=aCol; vFx=aFx;",
        " vec4 mv = modelViewMatrix * instanceMatrix * vec4(position,1.0);",
        " vFog = smoothstep(uFogN, uFogF, -mv.z);",
        " gl_Position = projectionMatrix * mv; }",
      ].join("\n"),
      fragmentShader: [
        "uniform vec3 uBand; varying vec2 vUv; varying vec3 vCol; varying vec4 vFx; varying float vFog;",
        "void main(){ vec2 p=vUv;",
        " float d=min(min(p.x,1.0-p.x),min(p.y,1.0-p.y));",
        " float edge=1.0-smoothstep(0.03,0.075,d);",
        " float inner=smoothstep(0.07,0.1,d);",
        " float foot=max(vFx.y,0.0);",
        " float band=(1.0-smoothstep(0.35,0.37,p.y))*inner*foot;",
        // The strike: one pixel across the waist, whatever size the cell is drawn at.
        " float px=fwidth(p.y);",
        " float strike=step(vFx.y,-0.5)*(1.0-smoothstep(px*0.5,px*1.5,abs(p.y-0.5)))*inner;",
        " float halo=exp(-d*9.0);",
        " vec3 c = vCol*(edge*(0.6+vFx.z*0.9) + inner*vFx.x*0.5 + halo*vFx.z*0.35);",
        ` c += uBand*band*0.8 + ${v3(P3.edge)}*(edge*vFx.z*0.45 + strike*0.75);`,
        " c *= (1.0 - vFog*0.86);",
        " c *= vFx.w;",
        " gl_FragColor = vec4(c, clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0)); }",
      ].join("\n"),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    }),
  );
  const mesh = new THREE.InstancedMesh(geo, mat, d.N);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  scene.add(mesh);

  /* ---- THE WINNERS. A solid body, so a won ticket reads as one ticket and not a sum of light. */
  const nWin = Math.max(1, d.winners.length);
  const sgeo = keep(plane.clone());
  const aVis = new THREE.InstancedBufferAttribute(d.WV, 1);
  aVis.setUsage(THREE.DynamicDrawUsage);
  sgeo.setAttribute("aVis", aVis);
  const smat = keep(
    new THREE.ShaderMaterial({
      vertexShader:
        "attribute float aVis; varying vec2 vUv; varying float vVis; void main(){ vUv=uv; vVis=aVis; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position,1.0); }",
      fragmentShader: [
        "varying vec2 vUv; varying float vVis;",
        "void main(){ vec2 p=vUv; float d=min(min(p.x,1.0-p.x),min(p.y,1.0-p.y));",
        " float edge=1.0-smoothstep(0.018,0.04,d);",
        " float band=1.0-smoothstep(0.355,0.365,p.y);",
        ` vec3 c=mix(${v3(P3.winLo)}, ${v3(P3.winHi)}, p.y);`,
        ` c=mix(c, ${v3(P3.winBand)}, band);`,
        ` c+=${v3(P3.winSheen)}*smoothstep(0.5,1.0,p.y)*(1.0-p.x);`,
        ` c=mix(c, ${v3(P3.winEdge)}, edge*0.9);`,
        " gl_FragColor=vec4(c*vVis, vVis); }",
      ].join("\n"),
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    }),
  );
  const smesh = new THREE.InstancedMesh(sgeo, smat, nWin);
  smesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  smesh.frustumCulled = false;
  smesh.renderOrder = 5;
  smesh.count = d.winners.length;
  scene.add(smesh);

  /* ---- THE LIGHT. Halos, the load-in shock, three rings and the dust. */
  const haloTex = keep(new THREE.CanvasTexture(haloCanvas()));
  const shockTex = keep(new THREE.CanvasTexture(shockCanvas()));
  const sprite = (color: number, opacity: number, map = haloTex) => {
    const m = keep(
      new THREE.SpriteMaterial({
        map,
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const s = new THREE.Sprite(m);
    scene.add(s);
    return s;
  };
  const bigHalo = sprite(PH.bigHalo, 0);
  const coreHalo = sprite(PH.coreHalo, 0);
  const shock = sprite(PH.shock, 0, shockTex);
  bigHalo.renderOrder = -2;
  coreHalo.renderOrder = -1;
  const winHalos = d.winners.map(() => sprite(PH.winHalo, 0));

  const rings: THREE.Line[] = [];
  for (let r = 0; r < 3; r += 1) {
    const pts: THREE.Vector3[] = [];
    for (let a = 0; a <= 128; a += 1) {
      const an = (a / 128) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(an), Math.sin(an), 0));
    }
    const lg = keep(new THREE.BufferGeometry().setFromPoints(pts));
    const lm = keep(
      new THREE.LineBasicMaterial({
        color: r === 1 ? PH.ring2 : PH.ring,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const ln = new THREE.Line(lg, lm);
    scene.add(ln);
    rings.push(ln);
  }

  /* 900 grains of dust in a shell around the drum, seeded so every load is the same sky. */
  const SN = 900;
  const sp = new Float32Array(SN * 3);
  let seed = 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < SN; i += 1) {
    const u = rnd() * Math.PI * 2;
    const v = rnd() * 2 - 1;
    const dd = 1.25 + rnd() * 1.75;
    const sq = Math.sqrt(1 - v * v);
    sp[i * 3] = Math.cos(u) * sq * dd;
    sp[i * 3 + 1] = v * dd;
    sp[i * 3 + 2] = Math.sin(u) * sq * dd;
  }
  const sg = keep(new THREE.BufferGeometry());
  sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  const starMat = keep(
    new THREE.PointsMaterial({
      size: 0.1,
      map: haloTex,
      color: PH.dust,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    }),
  );
  const stars = new THREE.Points(sg, starMat);
  scene.add(stars);

  const M4 = new THREE.Matrix4();
  const V = new THREE.Vector3();
  const QQ = new THREE.Quaternion();
  const SC = new THREE.Vector3();

  return {
    resize(w, h) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      cam.aspect = w / Math.max(1, h);
      cam.updateProjectionMatrix();
    },

    draw({ t, layout: L, state, zone, q }) {
      // The winners' solid bodies ride on their cells, and dim the light quad under them.
      for (let w = 0; w < d.winners.length; w += 1) {
        const i = d.winners[w];
        const vis = d.WV[w];
        d.FX[i * 4 + 3] *= 1 - vis * 0.55;
        V.set(d.P[i * 3], d.P[i * 3 + 1], d.P[i * 3 + 2] + 0.01);
        QQ.set(d.Q[i * 4], d.Q[i * 4 + 1], d.Q[i * 4 + 2], d.Q[i * 4 + 3]);
        SC.setScalar(d.S[i] * 0.97);
        M4.compose(V, QQ, SC);
        smesh.setMatrixAt(w, M4);
        const wh = winHalos[w];
        wh.position.set(d.P[i * 3], d.P[i * 3 + 1], d.P[i * 3 + 2] - 0.05);
        wh.scale.setScalar(d.S[i] * (3 + d.WH[w] * 1.6));
        wh.material.opacity = d.WH[w];
      }
      smesh.instanceMatrix.needsUpdate = true;
      aVis.needsUpdate = true;

      for (let i = 0; i < d.N; i += 1) {
        V.set(d.P[i * 3], d.P[i * 3 + 1], d.P[i * 3 + 2]);
        QQ.set(d.Q[i * 4], d.Q[i * 4 + 1], d.Q[i * 4 + 2], d.Q[i * 4 + 3]);
        SC.setScalar(d.S[i]);
        M4.compose(V, QQ, SC);
        mesh.setMatrixAt(i, M4);
      }
      mesh.instanceMatrix.needsUpdate = true;
      aCol.needsUpdate = true;
      aFx.needsUpdate = true;
      mat.uniforms.uFogN.value = state.fogN;
      mat.uniforms.uFogF.value = state.fogF;

      const m = state.m;
      const intro = eo(t / 1.6);
      bigHalo.position.set(L.cx, L.cy, -2);
      bigHalo.scale.setScalar(L.R * 5.2 * (1 + state.push * 0.8));
      bigHalo.material.opacity = BIG_HALO * intro * (1 - m * 0.45);

      // The load-in flare and the shock ring: once, at the start, and only in the opening.
      const flare = Math.exp(-Math.pow((t - 1.25) * 2.6, 2));
      coreHalo.position.set(L.cx, L.cy, -1);
      coreHalo.scale.setScalar(L.R * (2.6 + flare * 0.8));
      coreHalo.material.opacity = (0.14 + flare * 0.4) * intro * (1 - m);
      const sk = (t - 1.05) / 1.5;
      shock.position.set(L.cx, L.cy, 0);
      shock.scale.setScalar(L.R * (2.1 + 4.2 * eo(sk)));
      shock.material.opacity = sk <= 0 || sk >= 1 || zone !== "hero" ? 0 : 0.6 * Math.pow(1 - sk, 1.6);

      for (let r = 0; r < 3; r += 1) {
        const rg = rings[r];
        rg.position.set(L.cx, L.cy, 0);
        rg.scale.setScalar(L.R * (1.32 + r * 0.2) * (1 + state.push * 3));
        rg.rotation.set(1.15 + r * 0.35, t * (0.06 + r * 0.03) * (r % 2 ? -1 : 1), r * 0.6);
        (rg.material as THREE.LineBasicMaterial).opacity = 0.2 * intro * (1 - sat(state.push * 1.6)) * (1 - m);
      }

      stars.position.set(L.cx, L.cy, 0);
      stars.scale.setScalar(L.R);
      stars.rotation.y = t * 0.012 + q * 0.6;
      stars.rotation.x = q * 0.3;
      starMat.opacity = 0.7 * intro;
      starMat.size = Math.max(0.05, L.R * 0.03);

      renderer.render(scene, cam);
    },

    dispose() {
      scene.clear();
      mesh.dispose();
      smesh.dispose();
      for (const x of disposables) x.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
