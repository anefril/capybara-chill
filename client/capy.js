// Our own capybara: no downloaded model. The body and the head are signed-distance sculptures (smoothly blended
// ellipsoids and rounded boxes) turned into meshes with marching cubes when the page loads; fur is shell rendering —
// the same mesh drawn in thin layers pushed out along the normal, each keeping fewer strands, combed back, darker at
// the roots, flattened and dark where it's wet. Bare nose, glossy eyes that blink, ears that twitch, a yuzu on top.
// It breathes, looks around, asks for a scratch (looks at you, eyes wide), wiggles and sends hearts on a pet.
import * as THREE from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

// colours a skin can swap (paid skins later only add entries here)
export const SKINS = {
  classic: { fur: "#8b5a36", back: "#6a4027", belly: "#a87650", snout: "#5e3f2b", nose: "#2f231d", hat: "yuzu" },
};

// --- signed distances (plain numbers: millions of calls) ---
function ell(px, py, pz, cx, cy, cz, rx, ry, rz) {
  const x = (px - cx) / rx, y = (py - cy) / ry, z = (pz - cz) / rz;
  const k0 = Math.sqrt(x * x + y * y + z * z), k1 = Math.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2);
  return k1 === 0 ? -Math.min(rx, ry, rz) : k0 * (k0 - 1) / k1;
}
function rbox(px, py, pz, cx, cy, cz, hx, hy, hz, r) {
  const qx = Math.abs(px - cx) - hx + r, qy = Math.abs(py - cy) - hy + r, qz = Math.abs(pz - cz) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25 }
const sat = x => Math.min(1, Math.max(0, x));
const sstep = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t) };
function vnoise(x, y, z) {                // cheap smooth 3D noise for colour patches
  const s = Math.sin(x * 1.7 + Math.sin(y * 2.3 + z * 1.1) * 1.3) * Math.sin(z * 1.9 + Math.sin(x * 1.3) * 1.7) * Math.sin(y * 2.1 + x * 0.7);
  return 0.5 + 0.5 * s;
}

// Body, in metres: waterline at y = 0, head end toward +z. A barrel with a high round rump and a deep chest.
function bodySdf(x, y, z) {
  let d = ell(x, y, z, 0, 0.02, -0.04, 0.4, 0.37, 0.6);
  d = smin(d, ell(x, y, z, 0, 0.07, -0.4, 0.37, 0.37, 0.36), 0.18);
  d = smin(d, ell(x, y, z, 0, 0.03, 0.36, 0.31, 0.34, 0.3), 0.16);
  d = smin(d, ell(x, y, z, 0, 0.26, 0.48, 0.2, 0.24, 0.2), 0.14);                // the neck, rising out of the water
  return d;
}
// Head, around the neck pivot: a long skull, a tall blunt muzzle flat on top, full cheeks, a soft jaw
function headSdf(x, y, z) {
  let d = rbox(x, y, z, 0, 0.1, 0.17, 0.16, 0.13, 0.2, 0.1);
  d = smin(d, rbox(x, y, z, 0, 0.05, 0.43, 0.13, 0.125, 0.12, 0.085), 0.08);
  d = smin(d, ell(x, y, z, 0.095, 0.0, 0.28, 0.1, 0.12, 0.16), 0.06);
  d = smin(d, ell(x, y, z, -0.095, 0.0, 0.28, 0.1, 0.12, 0.16), 0.06);
  d = smin(d, ell(x, y, z, 0, -0.05, 0.33, 0.12, 0.09, 0.17), 0.06);
  d = smin(d, ell(x, y, z, 0, 0.0, -0.02, 0.2, 0.22, 0.2), 0.1);                 // the back of the head into the neck
  d = smin(d, ell(x, y, z, 0, 0.21, 0.12, 0.13, 0.05, 0.16), 0.05);              // brow
  return d;
}

// sdf → smooth mesh; colour and fur amount per vertex from the callbacks
function sculpt(sdf, { center, half, res }, paint) {
  const mc = new MarchingCubes(res, new THREE.MeshBasicMaterial(), false, false, 400000);
  mc.isolation = 0;
  const hs = mc.halfsize;
  for (let k = 0; k < res; k++) for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const x = center[0] + (i - hs) / hs * half, y = center[1] + (j - hs) / hs * half, z = center[2] + (k - hs) / hs * half;
    mc.field[i + j * mc.yd + k * mc.zd] = -sdf(x, y, z);                         // inside > 0
  }
  mc.update();
  const n = mc.count, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = center[0] + mc.positionArray[i * 3] * half;
    pos[i * 3 + 1] = center[1] + mc.positionArray[i * 3 + 1] * half;
    pos[i * 3 + 2] = center[2] + mc.positionArray[i * 3 + 2] * half;
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g = mergeVertices(g, 1e-5);
  g.computeVertexNormals();
  // make normals face out: the gradient of the sdf says where out is
  const p = g.attributes.position, nr = g.attributes.normal;
  let agree = 0;
  for (let i = 0; i < p.count; i += 50) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), e = 0.004;
    const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
    agree += Math.sign(gx * nr.getX(i) + gy * nr.getY(i) + gz * nr.getZ(i));
  }
  if (agree < 0) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t }
    g.computeVertexNormals();
  }
  const col = new Float32Array(p.count * 3), fur = new Float32Array(p.count), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    fur[i] = paint(p.getX(i), p.getY(i), p.getZ(i), c);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("aFur", new THREE.BufferAttribute(fur, 1));
  mc.geometry.dispose();
  return g;
}

// --- fur: shell layers on top of an opaque base ---
const LAYERS = 18;
function furMaterial(opts) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uLen: { value: opts.len }, uDensity: { value: opts.density }, uLayers: { value: LAYERS }, uWater: { value: opts.waterY } });
    sh.vertexShader = `attribute float aFur; uniform float uLen, uLayers; varying float vLayer, vFur, vWorldY; varying vec3 vBase;\n` +
      sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
        float layer = 0.0;
        #ifdef USE_INSTANCING
          layer = (float(gl_InstanceID) + 1.0) / uLayers;
        #endif
        vLayer = layer; vFur = aFur; vBase = position;
        float L = layer * uLen * aFur;
        transformed += normal * L;
        transformed.z -= layer * L * 0.9;          // combed back toward the rump
        transformed.y -= layer * L * 0.35;         // and a little down
        vWorldY = (modelMatrix * vec4(transformed, 1.0)).y;`);
    sh.fragmentShader = `uniform float uDensity, uWater; varying float vLayer, vFur, vWorldY; varying vec3 vBase;
      float hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }\n` +
      sh.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
        vec3 cell = floor(vBase * uDensity);
        float h = hash3(cell);
        float wet = smoothstep(uWater + 0.07, uWater - 0.01, vWorldY);
        if (vLayer > 0.0) {
          float keep = vFur * (1.0 - wet * 0.85);
          if (h > keep * (1.0 - vLayer * 0.92)) discard;          // fewer strands toward the tips; none where bare or wet
        }
        float tip = mix(0.5, 1.08, vLayer);                       // dark roots, light tips
        diffuseColor.rgb *= tip * (0.82 + 0.36 * hash3(cell + 7.13)) * (1.0 - wet * 0.35);`);
  };
  return m;
}
function furry(geo, opts) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(geo, furMaterial(opts));
  base.castShadow = base.receiveShadow = true;
  const shells = new THREE.InstancedMesh(geo, furMaterial(opts), LAYERS);
  for (let i = 0; i < LAYERS; i++) shells.setMatrixAt(i, new THREE.Matrix4());
  shells.receiveShadow = true;
  shells.frustumCulled = false;
  g.add(base, shells);
  return g;
}

function heartTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#ff5c8a";
  g.beginPath();
  g.moveTo(32, 56);
  g.bezierCurveTo(4, 36, 6, 10, 22, 10); g.bezierCurveTo(29, 10, 32, 16, 32, 20);
  g.bezierCurveTo(32, 16, 35, 10, 42, 10); g.bezierCurveTo(58, 10, 60, 36, 32, 56);
  g.fill();
  g.strokeStyle = "#fff"; g.lineWidth = 3; g.stroke();
  return new THREE.CanvasTexture(c);
}
function makeHearts(parent) {
  const tex = heartTexture(), list = [];
  for (let i = 0; i < 8; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
    sp.scale.setScalar(0.16); sp.userData = { age: 9 }; sp.visible = false;
    parent.add(sp); list.push(sp);
  }
  return {
    burst(y, z) { list.forEach((h, i) => { h.userData = { age: -i * 0.08, x: (Math.random() - 0.5) * 0.5, z: z + (Math.random() - 0.5) * 0.3, y } }) },
    update(dt) {
      for (const h of list) {
        const u = h.userData, a = (u.age += dt);
        h.visible = a >= 0 && a < 1.6;
        if (!h.visible) continue;
        h.position.set(u.x + Math.sin(a * 5 + u.z * 9) * 0.06, u.y + a * 0.5, u.z);
        h.material.opacity = a < 0.2 ? a / 0.2 : 1 - (a - 0.2) / 1.4;
        h.scale.setScalar(0.1 + a * 0.05);
      }
    },
  };
}

export function createCapy(skinName = "classic") {
  const skin = SKINS[skinName] || SKINS.classic;
  const C = k => new THREE.Color(skin[k]);
  const cFur = C("fur"), cBack = C("back"), cBelly = C("belly"), cSnout = C("snout"), cNose = C("nose");
  const furOpts = { len: 0.028, density: 260, waterY: 0 };

  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);
  const bodyGeo = sculpt(bodySdf, { center: [0, 0.02, -0.02], half: 0.8, res: 72 }, (x, y, z, c) => {
    c.copy(cFur).lerp(cBelly, sstep(0.05, -0.3, y) * 0.8).lerp(cBack, sstep(0.2, 0.38, y) * 0.6);
    c.multiplyScalar(0.88 + 0.24 * vnoise(x * 6, y * 6, z * 6));
    return 1;
  });
  bodyPivot.add(furry(bodyGeo, furOpts));

  // head on a neck pivot, so a nod turns it rather than slides it
  const neck = new THREE.Group();
  neck.position.set(0, 0.34, 0.54);
  root.add(neck);
  const head = new THREE.Group();
  neck.add(head);
  const NOSE = [0, 0.13, 0.54];
  const headGeo = sculpt(headSdf, { center: [0, 0.07, 0.2], half: 0.42, res: 64 }, (x, y, z, c) => {
    const muzzle = sstep(0.3, 0.5, z);
    c.copy(cFur).lerp(cSnout, muzzle * 0.85).lerp(cBack, sstep(0.18, 0.28, y) * (1 - muzzle) * 0.5);
    c.lerp(cBelly, sstep(0.0, -0.1, y) * (1 - muzzle) * 0.6);
    const dn = Math.hypot((x - NOSE[0]) / 0.12, (y - NOSE[1]) / 0.07, (z - NOSE[2]) / 0.1);
    const bare = sstep(1.0, 0.55, dn);                                         // the nose pad: dark, no fur
    c.lerp(cNose, bare * 0.9);
    const lip = sstep(0.04, 0.0, Math.abs(x)) * sstep(0.5, 0.56, z) * sstep(0.02, -0.04, y);   // the split lip
    c.lerp(cNose, lip * 0.7);
    c.multiplyScalar(0.9 + 0.2 * vnoise(x * 9, y * 9, z * 9));
    return sat(1 - bare - lip) * (0.55 + 0.45 * (1 - muzzle));               // short fur on the muzzle
  });
  head.add(furry(headGeo, { ...furOpts, len: 0.018 }));

  // nostrils: two dark slits on the top front of the muzzle
  const darkM = new THREE.MeshStandardMaterial({ color: "#120c09", roughness: 0.4 });
  for (const s of [-1, 1]) {
    const n = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8).scale(0.018, 0.007, 0.01), darkM);
    n.position.set(s * 0.045, 0.158, 0.515); n.rotation.set(-0.6, 0, s * 0.45);
    head.add(n);
  }
  // eyes: glossy black, high on the sides; blinking squashes them shut
  const eyeM = new THREE.MeshStandardMaterial({ color: "#0b0706", roughness: 0.08, metalness: 0 });
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.034, 20, 14).scale(1, 0.85, 1), eyeM);
    e.position.set(s * 0.146, 0.2, 0.25);
    head.add(e); eyes.push(e);
  }
  // ears: small, round, dark, with short fur
  const ears = [];
  for (const s of [-1, 1]) {
    const p = new THREE.Group(); p.position.set(s * 0.12, 0.26, 0.06);
    const eg = sculpt((x, y, z) => ell(x, y, z, 0, 0.035, 0, 0.042, 0.045, 0.018), { center: [0, 0.035, 0], half: 0.07, res: 24 },
      (x, y, z, c) => { c.copy(cBack).multiplyScalar(0.75); return 0.5 });
    const ear = furry(eg, { ...furOpts, len: 0.008 });
    ear.rotation.set(-0.2, s * 0.5, -s * 0.35);
    p.add(ear); head.add(p); ears.push(p);
  }
  // the yuzu (the hat slot: skins may swap it)
  const hat = new THREE.Group();
  hat.position.set(0, 0.27, 0.16);
  const yuzuMat = new THREE.MeshStandardMaterial({ color: "#f28a12", roughness: 0.45 });
  const yuzu = new THREE.Mesh(new THREE.SphereGeometry(0.065, 24, 16).scale(1, 0.88, 1), yuzuMat);
  yuzu.position.y = 0.055; yuzu.castShadow = true;
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 6).scale(1, 0.18, 0.5), new THREE.MeshStandardMaterial({ color: "#3f8f3a", roughness: 0.6 }));
  leaf.position.set(0.025, 0.118, 0); leaf.rotation.z = 0.5;
  hat.add(yuzu, leaf);
  head.add(hat);

  // taps: an invisible box round the whole capybara
  const hitbox = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 1.6), new THREE.MeshBasicMaterial({ visible: false }));
  hitbox.position.set(0, 0.25, 0.15);
  root.add(hitbox);
  const hearts = makeHearts(root);

  // --- behaviour ---
  let nextBlink = 2, blinkT = -1, nextLook = 3, lookYaw = 0, lookPitch = 0, yaw = 0, pitch = 0;
  let happy = 0, wiggle = 0, eyeOpen = 0.6, wantPet = false;
  const earT = [5, 7], earA = [0, 0];
  const tmpV = new THREE.Vector3();

  function update(t, dt, camera, night) {
    const breath = Math.sin(t * 1.4);
    bodyPivot.scale.set(1 + breath * 0.01, 1 + breath * 0.016, 1);
    root.position.y = Math.sin(t * 0.9) * 0.01;

    nextLook -= dt;
    if (wantPet) {
      root.worldToLocal(tmpV.copy(camera.position)).sub(neck.position);
      lookYaw = Math.max(-0.8, Math.min(0.8, Math.atan2(tmpV.x, tmpV.z)));
      lookPitch = -0.1;
    } else if (nextLook < 0) {
      nextLook = 3 + Math.random() * 6;
      lookYaw = (Math.random() - 0.45) * 0.8; lookPitch = (Math.random() - 0.3) * 0.12;
    }
    yaw += (lookYaw - yaw) * Math.min(1, dt * 1.6);
    pitch += (lookPitch - pitch) * Math.min(1, dt * 1.6);
    happy = Math.max(0, happy - dt);
    wiggle = Math.max(0, wiggle - dt * 1.4);
    neck.rotation.set(pitch + Math.sin(t * 0.7) * 0.025 - (happy > 0 ? 0.15 : 0), yaw + Math.sin(t * 13) * 0.1 * wiggle, Math.sin(t * 9) * 0.06 * wiggle);
    hat.position.y = 0.27 + Math.abs(Math.sin(t * 10)) * 0.04 * wiggle;
    hat.rotation.z = Math.sin(t * 7) * 0.2 * wiggle;

    // relaxed half-open eyes; sleepier at night; wide when asking; shut when happy; blinks
    const target = happy > 0 ? 0.1 : wantPet ? 1 : 0.6 - night * 0.2;
    eyeOpen += (target - eyeOpen) * Math.min(1, dt * 6);
    nextBlink -= dt;
    if (nextBlink < 0) { blinkT = 0; nextBlink = 2.5 + Math.random() * 4 }
    let k = eyeOpen;
    if (blinkT >= 0) { blinkT += dt; k *= Math.abs(Math.cos(Math.min(1, blinkT / 0.18) * Math.PI)); if (blinkT > 0.18) blinkT = -1 }
    for (const e of eyes) e.scale.y = 0.85 * Math.max(0.1, k);

    for (let i = 0; i < 2; i++) {
      earT[i] -= dt;
      if (earT[i] < 0) { earT[i] = 3 + Math.random() * 7; earA[i] = 1 }
      earA[i] = Math.max(0, earA[i] - dt * 4);
      ears[i].rotation.x = Math.sin(earA[i] * 18) * 0.35 * earA[i];
    }
    hearts.update(dt);
  }

  return {
    root, hitbox, update,
    pet() { happy = 2.2; wiggle = 1; hearts.burst(0.75, 0.6) },
    setWantPet: v => { wantPet = !!v },
    get wantPet() { return wantPet },
    headWorld: v => v.set(0, 0.5, 0.2).applyMatrix4(head.matrixWorld),
  };
}
