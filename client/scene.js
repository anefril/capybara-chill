// The world: a valley with a lake and mountains, a hot spring in the middle. Physically based sky (three's Sky) with
// drifting clouds, the sky lighting everything (PMREM environment), a reflecting lake (three's Water), Poly Haven
// rocks / ferns / flowers / lantern (CC0), textured ground, grass in the wind, a sakura, fireflies and steam.
// The sky follows the viewer's own clock (?t=19.5 forces an hour).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Sky } from "three/addons/objects/Sky.js";
import { Water } from "three/addons/objects/Water.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createCapy } from "./capy.js";

// --- value noise (deterministic: everyone sees the same valley) ---
function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s) }
function noise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, oct = 4) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * noise(x * f, z * f); f *= 2.03; a *= 0.5 } return s }
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) };
let seeded = 1;
const rnd = () => (seeded = (seeded * 16807) % 2147483647) / 2147483647;   // fixed layout of trees and rocks

const POOL_R = 2.15, LAKE_Y = -0.18;
// the spring's outline: a lumpy circle, the same for the water, the basin in the ground and the ring of stones
const poolR = a => POOL_R * (1 + 0.075 * Math.sin(3 * a + 1) + 0.05 * Math.sin(5 * a + 2.3) + 0.025 * Math.sin(9 * a + 0.7));
// the lake: an ellipse behind the spring with a wobbly shore (bays and points)
const lakeE = (x, z) => ((x / 30) ** 2 + ((z + 21) / 15) ** 2) * (1 + 0.42 * (noise(x * 0.075 + 3.1, z * 0.075 - 1.7) - 0.5) + 0.12 * (noise(x * 0.2, z * 0.2) - 0.5));
function height(x, z) {
  const d = Math.hypot(x, z);
  let h = 0.18 + 0.35 * (fbm(x * 0.12, z * 0.12) - 0.5) * smooth(3.5, 8, d);
  h += 2.6 * fbm(x * 0.07 + 9, z * 0.07) * smooth(7, 18, Math.abs(x)) * smooth(-6, 2, z + 4);   // hills left and right
  const e = lakeE(x, z);
  if (e < 1.25) h = h + (-2.2 - h) * smooth(1.2, 0.72, e);
  const r = Math.hypot(x, (z + 18) * 0.85);
  const ridge = 1 - Math.abs(fbm(x * 0.028, z * 0.028, 5) * 2 - 1);                               // ridged peaks
  h += smooth(58, 112, r) * (ridge * ridge * 24 + fbm(x * 0.05, z * 0.05) * 7 + 2);
  if (d < 3.3) h = h + (0.2 - h) * smooth(3.3, 2.6, d);                                          // flat ground round the spring
  if (d < POOL_R * 1.5) {
    const edge = d - poolR(Math.atan2(z, x));
    if (edge < 0.14) h = -0.7;                                                                  // the basin itself
    else h = h + (0.05 - h) * smooth(0.7, 0.14, edge);                                          // the bank runs down to the waterline
  }
  return h;
}

// --- night and haze colours by hour (the day sky itself is the Sky shader) ---
const KEYS = [
  [0, { top: "#070b22", hor: "#18244a", fog: "#1a2444", night: 1 }],
  [5, { top: "#121840", hor: "#4a3f6e", fog: "#3d3a5c", night: 0.85 }],
  [6.5, { top: "#4d6fb5", hor: "#f6b38a", fog: "#d9b9a4", night: 0 }],
  [9, { top: "#5aa6ee", hor: "#cfe6f7", fog: "#c4d8e6", night: 0 }],
  [16, { top: "#5aa6ee", hor: "#d6ebf8", fog: "#c9dbe6", night: 0 }],
  [18.3, { top: "#5d8fd6", hor: "#ffd7a0", fog: "#e8c3a0", night: 0 }],
  [19.4, { top: "#3c4f9a", hor: "#ff8a5c", fog: "#a8708a", night: 0.2 }],
  [20.6, { top: "#0f1640", hor: "#4a3566", fog: "#2c2a4c", night: 0.9 }],
  [24, null],
];
KEYS[KEYS.length - 1][1] = KEYS[0][1];
const COL = {};
for (const [, k] of KEYS) for (const n of ["top", "hor", "fog"]) COL[k[n]] = COL[k[n]] || new THREE.Color(k[n]);
function palette(h) {
  let i = 0;
  while (KEYS[i + 1][0] <= h) i++;
  const [h0, a] = KEYS[i], [h1, b] = KEYS[i + 1], t = (h - h0) / (h1 - h0);
  const c = n => COL[a[n]].clone().lerp(COL[b[n]], t);
  return { top: c("top"), hor: c("hor"), fog: c("fog"), night: a.night + (b.night - a.night) * t };
}

function dotTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "#fff"); r.addColorStop(0.35, "rgba(255,255,255,.6)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
// soft round points with their own size and alpha (steam, fireflies)
function softPoints(n, { color, additive }) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(n), 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: dotTexture() }, uColor: { value: new THREE.Color(color) }, uScale: { value: 300 } },
    vertexShader: `attribute float aSize; attribute float aAlpha; varying float vA; uniform float uScale;
      void main(){ vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D uTex; uniform vec3 uColor; varying float vA;
      void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(uColor, t.a * vA); }`,
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

export function createWorld(canvas) {
  let forcedHour = parseFloat(new URLSearchParams(location.search).get("t"));
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.6;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#c4d8e6", 35, 260);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 3000);
  camera.position.set(0.6, 1.55, 6.0);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.8, -3.5);
  Object.assign(controls, {
    enablePan: false, enableDamping: true, dampingFactor: 0.08, rotateSpeed: 0.45, zoomSpeed: 0.6,
    minDistance: 4.5, maxDistance: 13, minPolarAngle: 1.1, maxPolarAngle: 1.53, minAzimuthAngle: -0.95, maxAzimuthAngle: 0.95,
  });
  controls.update();

  const tex = new THREE.TextureLoader();
  const loadTex = (url, srgb, repeat) => {
    const t = tex.load(url);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat) }
    t.anisotropy = 4;
    return t;
  };
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const loadModel = url => new Promise((ok, no) => gltf.load(url, g => ok(g.scene), undefined, no));

  // --- light: the sun, a little hemisphere fill; the sky itself lights everything through the environment map ---
  const hemi = new THREE.HemisphereLight("#cfe6ff", "#4d6a35", 0.25);
  const sun = new THREE.DirectionalLight("#fff", 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 80 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(hemi, sun, sun.target);

  // --- sky: Preetham daylight, a night dome over it, stars, the moon, a layer of clouds ---
  const sky = new Sky();
  sky.scale.setScalar(2000);
  const su = sky.material.uniforms;
  su.turbidity.value = 4; su.rayleigh.value = 1.6; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.86;
  scene.add(sky);
  const nightMat = new THREE.ShaderMaterial({
    uniforms: { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uNight: { value: 0 }, uMoonDir: { value: new THREE.Vector3() } },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uTop, uHor, uMoonDir; uniform float uNight; varying vec3 vD;
      void main(){
        vec3 d = normalize(vD);
        vec3 col = mix(uHor, uTop, pow(smoothstep(-0.05, 0.6, d.y), 0.7));
        float m = max(dot(d, uMoonDir), 0.0);
        col += vec3(0.9, 0.92, 1.0) * (smoothstep(0.99955, 0.9998, m) * 1.6 + pow(m, 80.0) * 0.15);
        gl_FragColor = vec4(col, uNight);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, transparent: true, depthWrite: false, fog: false, toneMapped: false,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), nightMat));
  const starGeo = new THREE.BufferGeometry(), starPos = [];
  seeded = 7;
  for (let i = 0; i < 1800; i++) {
    const u = rnd() * Math.PI * 2, v = Math.acos(rnd() * 0.95);
    starPos.push(Math.sin(v) * Math.cos(u) * 1400, Math.cos(v) * 1400, Math.sin(v) * Math.sin(u) * 1400);
  }
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: "#fff", size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false, toneMapped: false });
  scene.add(new THREE.Points(starGeo, starMat));

  // clouds: a big plane high up, fbm noise drifting; lit warm at sunset, grey-blue at night
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLit: { value: new THREE.Color("#fff") }, uShade: { value: new THREE.Color("#9fb0c8") }, uAlpha: { value: 1 } },
    vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime, uAlpha; uniform vec3 uLit, uShade; varying vec2 vUv; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(h(i), h(i+vec2(1,0)), u.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), u.x), u.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++){ s += a * n(p); p = p * 2.03 + 3.1; a *= 0.5; } return s; }
      void main(){
        vec2 p = vW.xz * 0.004 + vec2(uTime * 0.004, uTime * 0.0015);
        float c = fbm(p * 3.0);
        float cov = smoothstep(0.48, 0.78, c);
        float thick = smoothstep(0.55, 0.95, fbm(p * 3.0 + 0.7));
        float dist = length(vW.xz) / 1400.0;
        float a = cov * (1.0 - smoothstep(0.55, 1.0, dist)) * uAlpha;
        vec3 col = mix(uLit, uShade, thick * 0.8);
        gl_FragColor = vec4(col, a * 0.9);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const cloudPlane = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(Math.PI / 2), cloudMat);
  cloudPlane.position.y = 160;
  scene.add(cloudPlane);

  // the environment map comes from the sky alone, re-baked when the light changes
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(), envSky = new Sky();
  envSky.scale.setScalar(1000);
  envScene.add(envSky);
  const envNight = new THREE.Mesh(new THREE.SphereGeometry(500, 16, 8), nightMat);
  envScene.add(envNight);
  let envRT = null;
  function bakeEnv() {
    for (const k of ["turbidity", "rayleigh", "mieCoefficient", "mieDirectionalG", "sunPosition"]) {
      const v = su[k].value; envSky.material.uniforms[k].value = v.clone ? v.clone() : v;
    }
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(envScene, 0.04);
    scene.environment = envRT.texture;
  }

  // --- terrain: grass texture tinted by vertex colour (sand at the shore, rock on slopes, snow on top) ---
  const SEG = 180, SIZE = 240;
  const tg = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  tg.rotateX(-Math.PI / 2);
  const tp = tg.attributes.position, colors = new Float32Array(tp.count * 3);
  const cGrass = new THREE.Color("#b9e07a"), cGrass2 = new THREE.Color("#8fc45a"), cSand = new THREE.Color("#f2e2b8"),
    cRock = new THREE.Color("#b0aaa0"), cSnow = new THREE.Color("#ffffff"), cBed = new THREE.Color("#7b8a6a"), tmp = new THREE.Color();
  const tint = (x, z, h, out) => {
    const slope = Math.abs(height(x + 0.6, z) - h) + Math.abs(height(x, z + 0.6) - h);
    if (h < LAKE_Y + 0.25 && lakeE(x, z) < 1.4) return out.copy(h < LAKE_Y - 0.5 ? cBed : cSand);
    out.copy(cGrass).lerp(cGrass2, fbm(x * 0.15, z * 0.15) * 0.8);
    out.lerp(cRock, Math.min(1, smooth(0.9, 2.2, slope) * 0.85 + smooth(7, 17, h) * 0.9));
    return out.lerp(cSnow, smooth(19, 26, h + fbm(x * 0.1, z * 0.1) * 5));
  };
  // round the spring the big grid (1.33 m cells) can't follow the basin's edge: its triangles there sag into a pit
  // between the water and the stones. A fine patch (8 cm) covers that square; the big grid's vertices inside it sink
  // out of sight. The patch's edges lie on the big grid's lines, so the two meet without a step
  const PATCH = 4 * (SIZE / SEG);
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), z = tp.getZ(i), h = height(x, z);
    const inside = Math.abs(x) < PATCH - 0.01 && Math.abs(z) < PATCH - 0.01;
    tp.setY(i, inside ? -3 : h);
    tint(x, z, h, tmp);
    colors.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  tg.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  tg.computeVertexNormals();
  // the ground as drawn: the grid's own triangles (a cell is ~1.3 m, so by the spring it sags below height(),
  // and things set by height() would hang in the air). Cell corners a (ix, iy), b (ix, iy+1), c (ix+1, iy+1), d (ix+1, iy),
  // faces abd and bcd — PlaneGeometry's order
  const G1 = SEG + 1, gx0 = tp.getX(0), gz0 = tp.getZ(0), gdx = tp.getX(1) - gx0, gdz = tp.getZ(G1) - gz0;
  const ground = (x, z) => {
    if (Math.abs(x) < PATCH && Math.abs(z) < PATCH) return height(x, z);    // the fine patch follows height() closely
    const fx = (x - gx0) / gdx, fz = (z - gz0) / gdz;
    const ix = Math.min(SEG - 1, Math.max(0, Math.floor(fx))), iy = Math.min(SEG - 1, Math.max(0, Math.floor(fz)));
    const u = fx - ix, v = fz - iy, Y = (cx, cy) => tp.getY(cy * G1 + cx);
    const ha = Y(ix, iy), hb = Y(ix, iy + 1), hc = Y(ix + 1, iy + 1), hd = Y(ix + 1, iy);
    return u + v <= 1 ? ha + (hd - ha) * u + (hb - ha) * v : hc + (hb - hc) * (1 - u) + (hd - hc) * (1 - v);
  };
  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, metalness: 0,
    map: loadTex("assets/aerial_grass_rock_diffuse.jpg", true, 70),
    normalMap: loadTex("assets/aerial_grass_rock_nor_gl.jpg", false, 70),
  });
  terrainMat.normalScale.set(0.8, 0.8);
  terrainMat.color.setRGB(1.7, 1.7, 1.5);                 // the texture is dark aerial ground: lift it, the vertex tint gives the hue
  const terrain = new THREE.Mesh(tg, terrainMat);
  terrain.receiveShadow = true;
  scene.add(terrain);
  {
    const n = 134, pg = new THREE.PlaneGeometry(PATCH * 2, PATCH * 2, n, n).rotateX(-Math.PI / 2);
    const pp = pg.attributes.position, uv = pg.attributes.uv, pc = new Float32Array(pp.count * 3);
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i), z = pp.getZ(i), h = height(x, z);
      pp.setY(i, h);
      uv.setXY(i, (x + SIZE / 2) / SIZE, 1 - (z + SIZE / 2) / SIZE);     // the big terrain's UVs: the texture runs on seamlessly
      tint(x, z, h, tmp);
      pc.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    pg.setAttribute("color", new THREE.BufferAttribute(pc, 3));
    pg.computeVertexNormals();
    const patch = new THREE.Mesh(pg, terrainMat);
    patch.receiveShadow = true;
    scene.add(patch);
  }

  // --- the lake reflects the sky and the valley; the spring is milky and steaming ---
  const waterNormals = loadTex("assets/waternormals.jpg", false);
  waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;
  const lake = new Water(new THREE.PlaneGeometry(84, 36), {   // only over the lake bed (z −39…−3): a bigger sheet showed under the spring
    textureWidth: 512, textureHeight: 512, waterNormals, sunDirection: new THREE.Vector3(0, 1, 0),
    sunColor: 0xffffff, waterColor: 0x1d4a55, distortionScale: 1.6, fog: true, alpha: 1,
  });
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(0, LAKE_Y, -21);
  lake.material.uniforms.size.value = 3;
  scene.add(lake);

  const springMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uNormals: { value: waterNormals }, uDeep: { value: new THREE.Color("#2f9c96") },
      uSky: { value: new THREE.Color("#dff3f0") }, uSun: { value: new THREE.Color("#fff") }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uDim: { value: 1 },
    }]),
    vertexShader: `attribute float aEdge; varying vec3 vW; varying float vEdge;
      #include <fog_pars_vertex>
      void main(){ vEdge = aEdge; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime, uDim; uniform sampler2D uNormals; uniform vec3 uDeep, uSky, uSun, uSunDir; varying vec3 vW; varying float vEdge;
      #include <fog_pars_fragment>
      void main(){
        vec2 p = vW.xz * 0.35;
        vec3 n1 = texture2D(uNormals, p + vec2(uTime * 0.02, uTime * 0.013)).xzy * 2.0 - 1.0;
        vec3 n2 = texture2D(uNormals, p * 1.7 - vec2(uTime * 0.017, -uTime * 0.021)).xzy * 2.0 - 1.0;
        vec3 N = normalize(vec3(0.0, 1.0, 0.0) + (n1 + n2) * vec3(0.18, 0.0, 0.18));
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
        float depth = 1.0 - smoothstep(0.35, 1.0, vEdge);                      // 1 in the middle, 0 at the rim
        vec3 water = mix(uDeep * 1.35 + vec3(0.06, 0.08, 0.05), uDeep * 0.62, depth);
        float caustic = pow(max(0.0, 1.0 - abs(n1.x + n2.z) * 2.2), 6.0) * (0.6 - depth * 0.4);
        water += vec3(0.9, 1.0, 0.95) * caustic * 0.18;
        vec3 col = mix(water, uSky, clamp(0.1 + fres * 0.8, 0.0, 1.0));
        col = mix(col, vec3(0.86, 0.9, 0.82), smoothstep(0.9, 1.0, vEdge) * 0.35);   // the wet, pale rim
        col *= uDim;
        vec3 R = reflect(-V, N);
        col += uSun * pow(max(dot(R, uSunDir), 0.0), 160.0) * 1.5;
        gl_FragColor = vec4(col, mix(0.97, 0.85, smoothstep(0.93, 1.0, vEdge)));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true, fog: true, depthWrite: false,
  });
  // the water surface: a fan over the outline, aEdge = 0 in the middle … 1 at the rim
  const springGeo = (() => {
    const N = 120, RINGS = 6, pos = [0, 0, 0], edge = [0], idx = [];
    for (let r = 1; r <= RINGS; r++) for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, k = r / RINGS, R = (poolR(a) + 0.16) * k;
      pos.push(Math.cos(a) * R, 0, Math.sin(a) * R); edge.push(k);
    }
    const at = (r, i) => r === 0 ? 0 : 1 + (r - 1) * N + (i % N);
    for (let i = 0; i < N; i++) idx.push(0, at(1, i + 1), at(1, i));
    for (let r = 1; r < RINGS; r++) for (let i = 0; i < N; i++) idx.push(at(r, i), at(r, i + 1), at(r + 1, i), at(r, i + 1), at(r + 1, i + 1), at(r + 1, i));
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aEdge", new THREE.Float32BufferAttribute(edge, 1));
    g.setIndex(idx);
    return g;
  })();
  const spring = new THREE.Mesh(springGeo, springMat);
  spring.position.y = 0.04;
  scene.add(spring);
  // the spring's own bed: a smooth bowl of pale stone under the water, so it isn't the grassy ground showing through
  {
    const bed = springGeo.clone(), p = bed.attributes.position, e = bed.attributes.aEdge, col = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const k = e.getX(i), x = p.getX(i), z = p.getZ(i);
      p.setY(i, -0.62 * (1 - k * k) + 0.02);                 // deep in the middle, up to the waterline at the rim
      c.set("#a9bdb3").lerp(new THREE.Color("#d9d2bf"), k * 0.8).multiplyScalar(0.85 + 0.3 * noise(x * 3.1 + 7, z * 3.1));
      col.set([c.r, c.g, c.b], i * 3);
    }
    bed.setAttribute("color", new THREE.BufferAttribute(col, 3));
    bed.computeVertexNormals();
    const bowl = new THREE.Mesh(bed, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    bowl.receiveShadow = true;
    scene.add(bowl);
  }

  // --- grass blades swaying in the wind ---
  const blade = new THREE.PlaneGeometry(0.06, 1, 1, 4);
  {
    const p = blade.attributes.position, col = new Float32Array(p.count * 3), nor = blade.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) + 0.5;                               // 0 at the root, 1 at the tip
      p.setY(i, y);
      p.setX(i, p.getX(i) * (1 - y * 0.85));                   // taper
      p.setZ(i, y * y * 0.12);                                  // a slight bend
      nor.setXYZ(i, 0, 1, 0.3);                                 // lit like a lawn, not like flat cards
      tmp.set("#2f5a1e").lerp(new THREE.Color("#b7d36a"), y);
      col.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    blade.setAttribute("color", new THREE.BufferAttribute(col, 3));
  }
  const windU = { value: 0 };
  const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 });
  grassMat.onBeforeCompile = sh => {
    sh.uniforms.uWind = windU;
    sh.vertexShader = "uniform float uWind;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float sway = sin(uWind * 1.6 + wp.x * 0.5 + wp.z * 0.3) * 0.6 + sin(uWind * 2.7 + wp.x * 1.7 - wp.z) * 0.3;
      transformed.x += sway * position.y * position.y * 0.18;
      transformed.z += sway * position.y * position.y * 0.07;`);
  };
  const GRASS = 14000;
  const grass = new THREE.InstancedMesh(blade, grassMat, GRASS);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  let gi = 0;
  seeded = 23;
  for (let tries = 0; tries < 60000 && gi < GRASS; tries++) {
    const a = rnd() * Math.PI * 2, r = POOL_R + 0.35 + Math.sqrt(rnd()) * 22, x = Math.cos(a) * r, z = Math.sin(a) * r - 3;
    const h = height(x, z);
    if (lakeE(x, z) < 1.1 || h < 0.02 || h > 6 || Math.hypot(x, z) < POOL_R + 0.35 || (z > 0.8 && Math.abs(x) < 4.5)) continue;
    if (fbm(x * 0.3, z * 0.3) < 0.36) continue;                  // patches, not a carpet
    const tall = 0.12 + rnd() * 0.22 * (0.6 + fbm(x * 0.2 + 5, z * 0.2));
    m4.compose(v3.set(x, ground(x, z) - 0.02, z), q.setFromEuler(e3.set((rnd() - 0.5) * 0.3, rnd() * 6.28, (rnd() - 0.5) * 0.3)), s3.set(1 + rnd(), tall, 1));
    grass.setMatrixAt(gi, m4);
    grass.setColorAt(gi++, tmp.setHSL(0.24 + (rnd() - 0.5) * 0.05, 0.5, 0.45 + rnd() * 0.2));
  }
  grass.count = gi;
  grass.receiveShadow = true;
  scene.add(grass);

  // --- firs and leafy trees, instanced: a trunk plus foliage on alpha cards (fir branches drawn needle by needle,
  // clusters of leaves), so they read as trees, not cones and balls ---
  const paint = (g, c) => {
    if (g.index) g = g.toNonIndexed();
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    return g;
  };
  const cardTex = (w, h, draw) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  // a fir branch: a stem with needles on both sides, shorter toward the tip, dark at the base and fresh at the end
  const firTex = cardTex(128, 64, (g, w, h) => {
    g.lineCap = "round";
    for (let x = 4; x < w - 4; x += 2.2) {
      const t = x / w, len = 22 * (1 - t * 0.75), y = h / 2 + t * t * 6;
      g.strokeStyle = `rgb(${30 + t * 50}, ${70 + t * 70}, ${40 + t * 35})`;
      g.lineWidth = 1.6;
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + len * 0.55, y + s * len * (0.75 + Math.random() * 0.25)); g.stroke() }
    }
    g.strokeStyle = "#3b2c1e"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(2, h / 2); g.quadraticCurveTo(w / 2, h / 2 + 2, w - 4, h / 2 + 6); g.stroke();
  });
  // a cluster of leaves: oval leaves with a midrib, lit on one side
  const leafTex = cardTex(128, 128, (g, w, h) => {
    const leaf = (x, y, a, L) => {
      g.save(); g.translate(x, y); g.rotate(a);
      const gr = g.createLinearGradient(-L * 0.3, 0, L * 0.3, 0);
      gr.addColorStop(0, "#2f6b2a"); gr.addColorStop(0.5, "#5d9e45"); gr.addColorStop(1, "#86bf5e");
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(-L * 0.42, -L * 0.3, -L * 0.3, -L * 0.85, 0, -L); g.bezierCurveTo(L * 0.3, -L * 0.85, L * 0.42, -L * 0.3, 0, 0); g.fill();
      g.strokeStyle = "rgba(30,70,25,.5)"; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -2); g.lineTo(0, -L * 0.9); g.stroke();
      g.restore();
    };
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + Math.random() * 0.4;
      leaf(64 + Math.cos(a) * 10, 64 + Math.sin(a) * 10, a + Math.PI / 2, 30 + Math.random() * 20);
    }
  });
  const barkMat = new THREE.MeshStandardMaterial({ color: "#4a3a2e", roughness: 0.95 });
  const foliage = map => new THREE.MeshStandardMaterial({ map, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 });
  seeded = 5;
  // the fir, 2.6 m: eleven tiers of drooping branches, two crossed cards each, a spire on top
  const firGeo = (() => {
    const parts = [], c = new THREE.Color();
    const TIERS = 11;
    for (let i = 0; i < TIERS; i++) {
      const t = i / (TIERS - 1), y = 0.5 + t * 1.95, R = 0.95 * (1 - t) + 0.14, nb = Math.round(7 - t * 3);
      for (let k = 0; k < nb; k++) {
        const ang = (k / nb) * Math.PI * 2 + i * 0.9 + rnd() * 0.35, droop = 0.3 + (1 - t) * 0.2 + rnd() * 0.1;
        c.setRGB(0.62 + t * 0.45, 0.62 + t * 0.45, 0.62 + t * 0.4);
        for (const cross of [0, Math.PI / 2]) {
          parts.push(paint(new THREE.PlaneGeometry(R, R * 0.5).translate(R / 2, 0, 0)
            .rotateX(cross + (rnd() - 0.5) * 0.4).rotateZ(-droop).rotateY(ang).translate(0, y, 0), c));
        }
      }
    }
    c.setRGB(1.1, 1.1, 1.05);
    for (const a of [0, Math.PI / 2]) parts.push(paint(new THREE.PlaneGeometry(0.42, 0.22).translate(0.21, 0, 0).rotateZ(Math.PI / 2).rotateY(a).translate(0, 2.4, 0), c));
    return mergeGeometries(parts);
  })();
  const firTrunk = new THREE.CylinderGeometry(0.045, 0.12, 2.5, 7).translate(0, 1.2, 0);
  // the leafy tree, ~2.4 m: a forked trunk, leaf clusters round the branch ends
  const [oakWood, oakLeaves] = (() => {
    const wood = [], spots = [], UP = new THREE.Vector3(0, 1, 0);
    const limb = (from, dir, len, rad, depth) => {
      const end = from.clone().addScaledVector(dir, len);
      const mid = from.clone().lerp(end, 0.5).add(new THREE.Vector3(rnd() - 0.5, 0, rnd() - 0.5).multiplyScalar(len * 0.2));
      wood.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([from, mid, end]), 5, rad, 6, false));
      if (depth >= 1) spots.push(mid.clone().lerp(end, 0.6));
      if (depth >= 3) { spots.push(end); return }
      for (let k = 0; k < (depth === 0 ? 3 : 2); k++) {
        const nd = dir.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0).applyAxisAngle(UP, rnd() * 6.28), 0.55 + rnd() * 0.35);
        nd.y = Math.max(nd.y, 0.25);
        limb(end, nd.normalize(), len * 0.68, rad * 0.62, depth + 1);
      }
    };
    limb(new THREE.Vector3(0, -0.1, 0), UP.clone(), 1.0, 0.09, 0);
    const cards = [], c = new THREE.Color();
    for (const sp of spots) for (let k = 0; k < 14; k++) {
      const u = rnd() * 6.28, w = Math.acos(rnd() * 2 - 1), r = 0.1 + Math.cbrt(rnd()) * 0.42;
      c.setRGB(0.7 + 0.45 * Math.min(1, r / 0.4) * (0.6 + 0.4 * (sp.y / 2.4)), 0.72 + 0.45 * Math.min(1, r / 0.4), 0.7 + 0.35 * Math.min(1, r / 0.4));
      cards.push(paint(new THREE.PlaneGeometry(0.55, 0.55).rotateX(rnd() * 6.28).rotateY(rnd() * 6.28).rotateZ(rnd() * 6.28)
        .translate(sp.x + Math.sin(w) * Math.cos(u) * r, sp.y + Math.cos(w) * r * 0.75, sp.z + Math.sin(w) * Math.sin(u) * r), c));
    }
    return [mergeGeometries(wood), mergeGeometries(cards)];
  })();
  const firs = new THREE.InstancedMesh(firGeo, foliage(firTex), 520), firTrunks = new THREE.InstancedMesh(firTrunk, barkMat, 520);
  const oaks = new THREE.InstancedMesh(oakLeaves, foliage(leafTex), 160), oakTrunks = new THREE.InstancedMesh(oakWood, barkMat, 160);
  let pi = 0, oi = 0;
  seeded = 11;
  for (let tries = 0; tries < 6000 && pi < 520; tries++) {
    const x = (rnd() - 0.5) * 170, z = (rnd() - 0.75) * 150, d = Math.hypot(x, z);
    if (d < 7.5 || (z > 3 && Math.abs(x) < 7)) continue;
    if (z < -8 && Math.abs(x) < 30 + (z + 8) * -0.4 && rnd() < 0.8) continue;   // a thin far shore: the mountains stay in view
    const h = height(x, z);
    if (lakeE(x, z) < 1.12 || h < 0.1 || h > 22 || fbm(x * 0.05 + 3, z * 0.05) < 0.42) continue;
    const sc = 0.8 + rnd() * 1.1 + smooth(10, 40, d) * 0.6;
    m4.compose(v3.set(x, ground(x, z) - 0.05, z), q.setFromEuler(e3.set(0, rnd() * 6, 0)), s3.set(sc * (0.85 + rnd() * 0.3), sc, sc * (0.85 + rnd() * 0.3)));
    tmp.setHSL(0.3 + (rnd() - 0.5) * 0.06, 0.2 + rnd() * 0.15, 0.42 + rnd() * 0.12).multiplyScalar(1.7);
    if (rnd() < 0.3 && oi < 160 && h < 8) { oaks.setMatrixAt(oi, m4); oakTrunks.setMatrixAt(oi, m4); oaks.setColorAt(oi++, tmp.multiplyScalar(0.8)) }
    else { firs.setMatrixAt(pi, m4); firTrunks.setMatrixAt(pi, m4); firs.setColorAt(pi++, tmp.multiplyScalar(0.95)) }
  }
  firs.count = firTrunks.count = pi; oaks.count = oakTrunks.count = oi;
  for (const m of [firs, firTrunks, oaks, oakTrunks]) { m.castShadow = true; m.receiveShadow = true }
  scene.add(firs, firTrunks, oaks, oakTrunks);

  // --- sakura by the spring: a bent, branching trunk; clouds of small five-petal blossoms at the branch ends;
  // petals falling into the water ---
  const sakura = new THREE.Group();
  sakura.position.set(-3.6, ground(-3.6, -2.4), -2.4);
  const bloomSpots = [];                                   // where the blossom clouds sit (tree-local)
  {
    seeded = 31;
    const limbs = [], UP = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
    const RING = 7, LEN = 8;
    const limb = (from, dir, len, rad, depth) => {
      // three points, the middle pushed aside: no limb is straight
      const side = new THREE.Vector3(rnd() - 0.5, (rnd() - 0.5) * 0.4, rnd() - 0.5).multiplyScalar(len * 0.28);
      const mid = from.clone().addScaledVector(dir, len * 0.5).add(side);
      const end = from.clone().addScaledVector(dir, len).add(side.clone().multiplyScalar(0.4));
      const curve = new THREE.CatmullRomCurve3([from, mid, end]);
      const g = new THREE.TubeGeometry(curve, LEN, 1, RING, false);
      const p = g.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
      for (let i = 0; i <= LEN; i++) {                     // taper: each ring pulled in toward the curve
        curve.getPointAt(i / LEN, c);
        const r = rad * (1 - 0.38 * i / LEN);
        for (let j = 0; j <= RING; j++) {
          const k = i * (RING + 1) + j;
          v.fromBufferAttribute(p, k).sub(c).multiplyScalar(r).add(c);
          p.setXYZ(k, v.x, v.y, v.z);
        }
      }
      limbs.push(g);
      if (depth >= 2) bloomSpots.push(mid.clone().lerp(end, 0.5));
      if (depth >= 4) { bloomSpots.push(end.clone()); return }
      const n = depth === 0 ? 3 : 2 + (rnd() < 0.45 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2 + rnd() * 1.2;
        const perp = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) > 0.9 ? X : UP).normalize().applyAxisAngle(dir, ang);
        const nd = dir.clone().applyAxisAngle(perp, 0.5 + rnd() * 0.4);
        nd.y = Math.max(nd.y, depth >= 2 ? -0.2 : 0.3);   // reach up and out; the thin tips may droop
        limb(end, nd.normalize(), len * (0.62 + rnd() * 0.15), rad * 0.6, depth + 1);
      }
    };
    limb(new THREE.Vector3(0, -0.25, 0), new THREE.Vector3(0.16, 1, 0.08).normalize(), 1.3, 0.15, 0);
    const wood = new THREE.Mesh(mergeGeometries(limbs), new THREE.MeshStandardMaterial({ color: "#3d2b24", roughness: 0.92 }));
    wood.castShadow = wood.receiveShadow = true;
    sakura.add(wood);

    // a card of a few blossoms: five notched petals, white at the heart, pink at the rim, a dark-pink eye with stamens
    const cv = document.createElement("canvas"); cv.width = cv.height = 128;
    const g = cv.getContext("2d");
    const flower = (x, y, R, rot) => {
      for (let i = 0; i < 5; i++) {
        const a = rot + i * Math.PI * 2 / 5;
        g.save(); g.translate(x, y); g.rotate(a);
        const grad = g.createRadialGradient(0, 0, R * 0.1, 0, 0, R);
        grad.addColorStop(0, "#fff7fa"); grad.addColorStop(0.55, "#ffd6e4"); grad.addColorStop(1, "#f59bbd");
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(0, 0);
        g.bezierCurveTo(-R * 0.55, -R * 0.25, -R * 0.5, -R * 0.95, -R * 0.14, -R);
        g.lineTo(0, -R * 0.84);                               // the notch at the tip
        g.lineTo(R * 0.14, -R);
        g.bezierCurveTo(R * 0.5, -R * 0.95, R * 0.55, -R * 0.25, 0, 0);
        g.fill();
        g.restore();
      }
      const eye = g.createRadialGradient(x, y, 0, x, y, R * 0.3);
      eye.addColorStop(0, "#f06d99"); eye.addColorStop(1, "rgba(240,109,153,0)");
      g.fillStyle = eye; g.beginPath(); g.arc(x, y, R * 0.3, 0, 7); g.fill();
      g.fillStyle = "#fff2c4";
      for (let i = 0; i < 5; i++) { const a = i * 1.26 + rot; g.beginPath(); g.arc(x + Math.cos(a) * R * 0.2, y + Math.sin(a) * R * 0.2, R * 0.035, 0, 7); g.fill() }
    };
    [[44, 46, 26, 0.2], [86, 40, 22, 1.1], [64, 84, 28, 0.7], [30, 88, 17, 1.9], [98, 86, 18, 2.6]].forEach(f => flower(...f));
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const bloomMat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75,
      emissive: "#ff9ec2", emissiveMap: tex, emissiveIntensity: 0.18 });
    const PER = 20, cards = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.28, 0.28), bloomMat, bloomSpots.length * PER);
    const shades = ["#ffffff", "#fff0f5", "#ffe1ec", "#ffd0e0", "#ffc2d6"];
    let ci = 0;
    for (const sp of bloomSpots) for (let k = 0; k < PER; k++) {
      const u = rnd() * Math.PI * 2, w = Math.acos(rnd() * 2 - 1), r = 0.08 + Math.cbrt(rnd()) * 0.38;
      v3.set(sp.x + Math.sin(w) * Math.cos(u) * r, sp.y + Math.cos(w) * r * 0.7 + 0.05, sp.z + Math.sin(w) * Math.sin(u) * r);
      cards.setMatrixAt(ci, m4.compose(v3, q.setFromEuler(e3.set(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28)), s3.setScalar(0.75 + rnd() * 0.5)));
      cards.setColorAt(ci++, tmp.set(shades[(rnd() * shades.length) | 0]).multiplyScalar(0.72 + 0.28 * Math.min(1, r / 0.34)));
    }
    cards.castShadow = true;
    sakura.add(cards);
    sakura.userData.bloom = cards;
  }
  scene.add(sakura);
  const PETALS = 90;
  const petalShape = new THREE.Shape();
  petalShape.moveTo(0, 0);
  petalShape.bezierCurveTo(-0.024, 0.012, -0.022, 0.04, -0.006, 0.046);
  petalShape.lineTo(0, 0.04);
  petalShape.lineTo(0.006, 0.046);
  petalShape.bezierCurveTo(0.022, 0.04, 0.024, 0.012, 0, 0);
  const petalMesh = new THREE.InstancedMesh(new THREE.ShapeGeometry(petalShape, 6),
    new THREE.MeshStandardMaterial({ color: "#ffb6cc", emissive: "#ff8fb4", emissiveIntensity: 0.15, side: THREE.DoubleSide, roughness: 0.6 }), PETALS);
  const petals = [];
  const spawnPetal = (p, anywhere) => {
    const sp = bloomSpots[(rnd() * bloomSpots.length) | 0];
    p.x = sakura.position.x + sp.x + (rnd() - 0.5) * 0.6; p.z = sakura.position.z + sp.z + (rnd() - 0.5) * 0.6;
    p.y = sakura.position.y + sp.y - (anywhere ? rnd() * sp.y : 0);
    p.vy = 0.18 + rnd() * 0.15; p.ph = rnd() * 6; p.rot = rnd() * 6; p.spin = (rnd() - 0.5) * 3; p.land = -1;
  };
  for (let i = 0; i < PETALS; i++) { const p = {}; spawnPetal(p, true); petals.push(p) }
  scene.add(petalMesh);

  // --- Poly Haven models: mossy rocks round the spring, ferns, flowers, a wooden lantern ---
  const lampLight = new THREE.PointLight("#ffb35c", 0, 8, 1.6);
  lampLight.position.set(2.55, 0.9, -1.0);
  scene.add(lampLight);
  // a small warm lamp on the rim by the capybara's face: at night it lights the capybara up
  const CAPY_LAMP = [-2.55, 0.75];
  const capyLight = new THREE.PointLight("#ffa94d", 0, 6.5, 1.1);
  capyLight.position.set(CAPY_LAMP[0], 0.85, CAPY_LAMP[1]);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), color: "#ffb45e", transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  halo.scale.setScalar(1.1);
  halo.position.copy(capyLight.position);
  scene.add(capyLight, halo);
  let lampGlow = null;
  // every mesh of a model baked to its own transform and set on the ground — each part on its own spot (a set of
  // rocks), or with `together` all parts keep their places round the model's centre (a clump of flowers)
  // meshopt stores positions and normals as normalised int16/int8: baking a transform into those arrays truncates it
  const toFloat = g => {
    for (const [name, a] of Object.entries(g.attributes)) {
      if (a.array instanceof Float32Array && !a.isInterleavedBufferAttribute) continue;
      const f = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) f[i * a.itemSize + k] = a.getComponent(i, k);
      g.setAttribute(name, new THREE.BufferAttribute(f, a.itemSize));
    }
    return g;
  };
  const parts = (root, together = false) => {
    const out = [];
    root.updateMatrixWorld(true);
    const all = new THREE.Box3().setFromObject(root), ac = all.getCenter(new THREE.Vector3());
    root.traverse(o => {
      if (!o.isMesh) return;
      const g = toFloat(o.geometry.clone()).applyMatrix4(o.matrixWorld);
      g.computeBoundingBox();
      const b = together ? all : g.boundingBox, c = together ? ac : b.getCenter(new THREE.Vector3());
      g.translate(-c.x, -b.min.y, -c.z);
      g.computeBoundingBox();
      out.push({ geo: g, mat: o.material, size: g.boundingBox.getSize(new THREE.Vector3()) });
    });
    return out;
  };
  (async () => {
    const [r1, r2] = await Promise.all([loadModel("assets/rock_moss_set_01.glb"), loadModel("assets/rock_moss_set_02.glb")]);
    const rocks = [...parts(r1), ...parts(r2)];
    seeded = 3;
    const putRock = (x, z, size, y = null) => {
      if (z > 1.5 && Math.abs(x - 0.3) < 1.2) size = Math.min(size, 0.32);   // the near shore, right under the camera: no big stones in the view
      const r = rocks[(rnd() * rocks.length) | 0], k = size / Math.max(r.size.x, r.size.z);
      const m = new THREE.Mesh(r.geo, r.mat);
      m.position.set(x, y ?? ground(x, z) - 0.05, z);
      m.rotation.y = rnd() * 6.28;
      m.scale.set(k, k * (0.75 + rnd() * 0.35), k);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    };
    for (let i = 0; i < 30; i++) {                     // on the shoreline, half in the water, big and small by turns
      const a = (i / 30) * Math.PI * 2 + rnd() * 0.08, r = poolR(a) + 0.1 + rnd() * 0.06;
      putRock(Math.cos(a) * r, Math.sin(a) * r, (i % 3 ? 0.45 : 0.68) + rnd() * 0.2, -0.1 - rnd() * 0.05);
    }
    for (let i = 0; i < 20; i++) {                     // a looser row behind, on the bank
      const a = ((i + 0.5) / 20) * Math.PI * 2 + rnd() * 0.15, r = poolR(a) + 0.5 + rnd() * 0.15;
      if (rnd() < 0.75) putRock(Math.cos(a) * r, Math.sin(a) * r, 0.3 + rnd() * 0.25, ground(Math.cos(a) * r, Math.sin(a) * r) - 0.06);
    }
    for (let i = 0; i < 18; i++) {
      const a = rnd() * Math.PI * 2, r = 3.5 + rnd() * 9, x = Math.cos(a) * r, z = Math.sin(a) * r - 3;
      if (lakeE(x, z) > 1.0 && lakeE(x, z) < 1.5 || rnd() < 0.5) putRock(x, z, 0.4 + rnd() * 1.4);
    }
  })().catch(e => console.warn("rocks:", e.message));
  (async () => {
    const fern = parts(await loadModel("assets/fern_02.glb"));
    seeded = 51;
    const spots = [[-2.7, -1.2], [-2.2, 1.6], [2.9, 0.4], [1.9, -2.6], [-1.4, -2.9], [3.4, -2.2], [-3.6, 0.3], [-4.6, -2.9]];
    for (const [x, z] of spots) for (const f of fern) {
      const k = (0.9 + rnd() * 0.6) / Math.max(f.size.x, f.size.z);
      const m = new THREE.Mesh(f.geo, f.mat);
      m.position.set(x, ground(x, z) - 0.03, z); m.rotation.y = rnd() * 6.28; m.scale.setScalar(k);
      m.castShadow = true;
      scene.add(m);
    }
  })().catch(e => console.warn("fern:", e.message));
  (async () => {
    const fl = parts(await loadModel("assets/flower_gazania.glb"), true);
    // the whole clump per spot, each part instanced
    seeded = 61;
    const spots = [];
    for (let tries = 0; tries < 400 && spots.length < 26; tries++) {
      const a = rnd() * Math.PI * 2, r = POOL_R + 0.9 + rnd() * 9, x = Math.cos(a) * r, z = Math.sin(a) * r - 1.5;
      if (lakeE(x, z) > 1.12 && height(x, z) > 0.05 && !(z > 1.5 && Math.abs(x) < 2.5)) spots.push([x, z, rnd() * 6.28, 0.7 + rnd() * 0.6]);
    }
    for (const f of fl) {
      const im = new THREE.InstancedMesh(f.geo, f.mat, spots.length);
      spots.forEach(([x, z, ry, k], i) => {
        im.setMatrixAt(i, m4.compose(v3.set(x, ground(x, z) - 0.02, z), q.setFromEuler(e3.set(0, ry, 0)), s3.setScalar(k)));
      });
      im.castShadow = true;
      scene.add(im);
    }
  })().catch(e => console.warn("flowers:", e.message));
  (async () => {
    const lantern = await loadModel("assets/wooden_lantern_01.glb");
    lantern.traverse(o => { if (o.isMesh) { o.castShadow = true; if (o.material.emissiveMap || /glass|light|candle|flame/i.test(o.material.name)) lampGlow = o.material } });
    const box = new THREE.Box3().setFromObject(lantern), k = 1.1 / (box.max.y - box.min.y);
    lantern.scale.setScalar(k);
    lantern.position.set(2.55, ground(2.55, -1.0) - box.min.y * k, -1.0);
    scene.add(lantern);
    lampLight.position.set(2.55, lantern.position.y + 0.55, -1.0);
    const small = lantern.clone(), [x, z] = CAPY_LAMP;
    small.scale.setScalar(k * 0.7);
    small.position.set(x, ground(x, z) - box.min.y * k * 0.7, z);
    small.rotation.y = 0.8;
    scene.add(small);
    capyLight.position.y = halo.position.y = small.position.y + 0.42;
  })().catch(e => console.warn("lantern:", e.message));

  // --- steam over the spring, fireflies at night ---
  const STEAM = 46, steam = softPoints(STEAM, { color: "#ffffff" }), steamP = [];
  const sPos = steam.geometry.attributes.position, sSize = steam.geometry.attributes.aSize, sAlpha = steam.geometry.attributes.aAlpha;
  const spawnSteam = (p, age) => { const a = Math.random() * 6.28, r = Math.random() * POOL_R * 0.95; p.x = Math.cos(a) * r; p.z = Math.sin(a) * r; p.age = age; p.life = 4 + Math.random() * 3 };
  for (let i = 0; i < STEAM; i++) { const p = {}; spawnSteam(p, Math.random() * 6); steamP.push(p) }
  scene.add(steam);
  const FLIES = 46, flies = softPoints(FLIES, { color: "#ffe27a", additive: true }), flyP = [];
  for (let i = 0; i < FLIES; i++) {
    const a = Math.random() * 6.28, r = 2.6 + Math.random() * 8;
    flyP.push({ x: Math.cos(a) * r, z: Math.sin(a) * r - 1, y: 0.4 + Math.random() * 1.8, ph: Math.random() * 100, sp: 0.3 + Math.random() * 0.5 });
  }
  scene.add(flies);

  // --- the capybara (our own, sculpted and furred in code: capy.js) ---
  const world = { onPet: null, onFrame: null, capy: null, camera, controls, renderer, night: () => night };
  const pivot = new THREE.Group();
  pivot.rotation.y = -0.62;
  scene.add(pivot);
  const capy = createCapy();
  pivot.add(capy.root);
  world.capy = capy;
  world.setHour = h => { forcedHour = h == null ? NaN : h; lastHourCheck = -1 };   // the player's own time of day; null = their clock
  // a duckling paddling round, ripples
  const duck = new THREE.Group();
  const yel = new THREE.MeshStandardMaterial({ color: "#ffd84a", roughness: 0.5 });
  const dBody = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 12).scale(1.25, 0.8, 1), yel);
  const dHead = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), yel);
  dHead.position.set(0.1, 0.1, 0);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.07, 8).rotateZ(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#ff8a2a", roughness: 0.5 }));
  beak.position.set(0.18, 0.09, 0);
  const dEye = new THREE.MeshBasicMaterial({ color: "#222" });
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), dEye); e.position.set(0.15, 0.12, s * 0.045); duck.add(e) }
  duck.add(dBody, dHead, beak);
  duck.traverse(o => { o.castShadow = true });
  scene.add(duck);
  const ringMat = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false });
  const rings = [0, 1, 2].map(i => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 48).rotateX(-Math.PI / 2), ringMat.clone());
    m.position.y = 0.05; m.userData.ph = i / 3; scene.add(m); return m;
  });

  // --- time of day ---
  const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3(), warm = new THREE.Color(), white = new THREE.Color("#fff6e8");
  let night = 0, lampsOn = 0, lastHour = -99, lastHourCheck = -1;
  function applyHour(h) {
    const p = palette(h);
    const a = ((h - 6) / 12) * Math.PI;
    sunDir.set(0.45 * Math.cos(a), Math.sin(a), 0.35 * Math.sin(a) + 0.75 * Math.cos(a)).normalize();   // lights the scene by day, sets over the lake
    moonDir.set(-0.35 * Math.cos(a), -Math.sin(a) * 0.8 + 0.05, -0.6 - 0.3 * Math.cos(a)).normalize();
    night = p.night;
    su.sunPosition.value.copy(sunDir);
    su.rayleigh.value = 1.2 + (1 - smooth(0, 0.35, sunDir.y)) * 1.8;     // redder, deeper sky near sunset
    nightMat.uniforms.uTop.value.copy(p.top);
    nightMat.uniforms.uHor.value.copy(p.hor);
    nightMat.uniforms.uNight.value = night;
    nightMat.uniforms.uMoonDir.value.copy(moonDir);
    starMat.opacity = night;
    const low = 1 - smooth(0.02, 0.4, sunDir.y);
    warm.set("#ff9a55").lerp(white, 1 - low);
    const moonLit = sunDir.y < -0.03;
    const lightDir = moonLit ? moonDir : sunDir;
    sun.position.copy(lightDir).multiplyScalar(30);
    sun.color.copy(moonLit ? new THREE.Color("#9fb4ff") : warm);
    sun.intensity = moonLit ? 0.35 : 3.2 * smooth(-0.02, 0.12, sunDir.y);
    hemi.intensity = 0.2 + night * 0.25;
    hemi.color.copy(p.top);
    scene.fog.color.copy(p.fog);
    renderer.toneMappingExposure = 0.55 + night * 0.35;
    cloudMat.uniforms.uLit.value.set("#ffffff").lerp(new THREE.Color("#ffb07a"), low).lerp(new THREE.Color("#3a4166"), night);
    cloudMat.uniforms.uShade.value.set("#a9b6c9").lerp(new THREE.Color("#c27a7a"), low * 0.7).lerp(new THREE.Color("#1c2140"), night);
    const lu = lake.material.uniforms;
    lu.sunDirection.value.copy(lightDir);
    lu.sunColor.value.copy(moonLit ? new THREE.Color("#556080") : warm);
    lu.waterColor.value.set("#1d4a55").multiplyScalar(1 - night * 0.7);
    springMat.uniforms.uSunDir.value.copy(lightDir);
    springMat.uniforms.uSun.value.copy(warm).multiplyScalar(moonLit ? 0.2 : 1);
    springMat.uniforms.uSky.value.copy(p.hor).lerp(new THREE.Color("#e8f6f3"), 0.6);
    springMat.uniforms.uDim.value = 1 - night * 0.7;
    lampsOn = Math.max(night, 1 - smooth(-0.02, 0.2, sunDir.y));      // the lamps come on as the sun goes down
    if (lampGlow) { lampGlow.emissive = lampGlow.emissive || new THREE.Color(); lampGlow.emissive.set("#ffb347"); lampGlow.emissiveIntensity = lampsOn * 3 }
    lampLight.intensity = lampsOn * 7;
    halo.material.opacity = lampsOn * 0.55;
    if (Math.abs(h - lastHour) > 0.05) { lastHour = h; bakeEnv() }      // re-light from the sky every ~3 minutes
  }
  const hourNow = () => {
    if (!isNaN(forcedHour)) return forcedHour % 24;
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  };

  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 1 ? 55 : 40;                  // a phone held upright: wider, so the capybara still fits
    camera.updateProjectionMatrix();
    steam.material.uniforms.uScale.value = flies.material.uniforms.uScale.value = h * renderer.getPixelRatio() * 0.9;
  }
  addEventListener("resize", resize);
  resize();

  // --- petting: a tap on the capybara (not a drag of the camera) ---
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  const hit = e => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObject(capy.hitbox, false).length > 0;
  };
  canvas.addEventListener("pointerdown", e => { down = { x: e.clientX, y: e.clientY } });
  canvas.addEventListener("pointerup", e => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 && hit(e)) { capy.pet(); world.onPet && world.onPet() }
    down = null;
  });
  canvas.addEventListener("pointermove", e => { if (!down) canvas.style.cursor = hit(e) ? "pointer" : "grab" });

  // --- loop ---
  const clock = new THREE.Clock();
  const headPos = new THREE.Vector3();
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;
    if (lastHourCheck < 0 || t - lastHourCheck > 1) { lastHourCheck = t; applyHour(hourNow()) }
    controls.update();
    lake.material.uniforms.time.value = t * 0.35;
    springMat.uniforms.uTime.value = t;
    cloudMat.uniforms.uTime.value = t;
    windU.value = t;
    sakura.userData.bloom.rotation.set(Math.sin(t * 0.7) * 0.006, 0, Math.sin(t * 0.5 + 1) * 0.008);
    const flick = 1 + Math.sin(t * 7.3) * 0.04 + Math.sin(t * 12.9) * 0.03;
    capyLight.intensity = lampsOn * 13 * flick;
    halo.scale.setScalar(1.1 * flick);
    capy.update(t, dt, camera, night);

    for (let i = 0; i < PETALS; i++) {
      const p = petals[i];
      if (p.land >= 0) { p.land += dt; if (p.land > 6) spawnPetal(p) }
      else {
        p.y -= p.vy * dt; p.x += Math.sin(t * 1.3 + p.ph) * 0.25 * dt + 0.08 * dt; p.z += Math.cos(t * 1.1 + p.ph) * 0.15 * dt;
        p.rot += p.spin * dt;
        const ground = Math.hypot(p.x, p.z) < POOL_R ? 0.05 : height(p.x, p.z) + 0.02;
        if (p.y <= ground) { p.y = ground; p.land = 0 }
      }
      petalMesh.setMatrixAt(i, m4.compose(v3.set(p.x, p.y, p.z), q.setFromEuler(e3.set(p.land >= 0 ? -Math.PI / 2 : p.rot, p.rot * 0.7, 0)), s3.setScalar(1)));
    }
    petalMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < STEAM; i++) {
      const p = steamP[i];
      p.age += dt;
      if (p.age > p.life) spawnSteam(p, 0);
      const k = p.age / p.life;
      sPos.setXYZ(i, p.x + Math.sin(t * 0.6 + i) * 0.15 * k, 0.1 + k * 1.6, p.z + 0.2 * k);
      sSize.setX(i, 0.35 + k * 1.1);
      sAlpha.setX(i, Math.sin(k * Math.PI) * (0.14 + night * 0.06));
    }
    sPos.needsUpdate = sSize.needsUpdate = sAlpha.needsUpdate = true;

    const fP = flies.geometry.attributes.position, fS = flies.geometry.attributes.aSize, fA = flies.geometry.attributes.aAlpha;
    for (let i = 0; i < FLIES; i++) {
      const f = flyP[i], tt = t * f.sp + f.ph;
      fP.setXYZ(i, f.x + Math.sin(tt) * 0.8, f.y + Math.sin(tt * 1.7) * 0.3, f.z + Math.cos(tt * 0.8) * 0.8);
      fS.setX(i, 0.12);
      fA.setX(i, night * (0.5 + 0.5 * Math.sin(tt * 3.1)) ** 2);
    }
    fP.needsUpdate = fS.needsUpdate = fA.needsUpdate = true;
    flies.visible = night > 0.05;

    const da = t * 0.16;
    duck.position.set(Math.cos(da) * 1.6, 0.06 + Math.sin(t * 2.2) * 0.012, Math.sin(da) * 1.6);
    duck.rotation.y = Math.atan2(-Math.cos(da), -Math.sin(da));      // beak (+x) along the circle

    for (const r of rings) {
      const k = (t * 0.28 + r.userData.ph) % 1;
      r.scale.setScalar(0.55 + k * 1.3);
      r.material.opacity = (1 - k) * 0.18;
    }

    renderer.render(scene, camera);
    capy.headWorld(headPos);
    if (world.onFrame) world.onFrame(headPos.project(camera));
    requestAnimationFrame(frame);
  }
  applyHour(hourNow());
  requestAnimationFrame(frame);
  return world;
}
