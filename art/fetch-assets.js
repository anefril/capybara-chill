// Downloads the free assets (Poly Haven, CC0; three.js water normals, MIT) and shrinks them for the web:
// glTF → one .glb with the 1k jpg textures and simplified meshes (gltf-transform), into static/assets.
//   node art/fetch-assets.js
const fs = require("fs"), path = require("path"), { execSync } = require("child_process");
const SRC = path.join(__dirname, "src"), OUT = path.join(__dirname, "..", "static", "assets");
fs.mkdirSync(SRC, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });

// id → [simplify ratio, extra flags]; sets keep their parts apart (the scene picks single rocks and flowers)
const MODELS = {
  rock_moss_set_01: [0.15, "--join false --flatten false"],
  rock_moss_set_02: [0.15, "--join false --flatten false"],
  fern_02: [0.6, ""],
  flower_gazania: [0.3, "--join false --flatten false"],
  wooden_lantern_01: [0.6, ""],
};
const TEXTURES = { aerial_grass_rock: ["Diffuse", "nor_gl"] };

async function get(url, file) {
  if (fs.existsSync(file)) return;
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + " → " + r.status);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}
const api = async p => (await fetch("https://api.polyhaven.com/" + p)).json();

(async () => {
  for (const [id, [ratio, extra]] of Object.entries(MODELS)) {
    const g = (await api("files/" + id)).gltf["1k"].gltf, dir = path.join(SRC, id);
    await get(g.url, path.join(dir, path.basename(g.url)));
    for (const [rel, f] of Object.entries(g.include || {})) await get(f.url, path.join(dir, rel));
    const out = path.join(OUT, id + ".glb");
    execSync(`npx -y @gltf-transform/cli@4.2.1 optimize "${path.join(dir, path.basename(g.url))}" "${out}" ` +
      `--compress meshopt --texture-compress false --simplify true --simplify-ratio ${ratio} --simplify-error 0.002 ${extra}`, { stdio: "inherit" });
    console.log(id, (fs.statSync(out).size / 1024).toFixed(0) + "k");
  }
  for (const [id, maps] of Object.entries(TEXTURES)) {
    const files = await api("files/" + id);
    for (const m of maps) {
      const f = files[m]["1k"].jpg || files[m]["1k"].png;
      await get(f.url, path.join(OUT, `${id}_${m.toLowerCase()}.jpg`));
    }
  }
  await get("https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/textures/waternormals.jpg", path.join(OUT, "waternormals.jpg"));
  for (const f of fs.readdirSync(OUT)) console.log(f, (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + "k");
})().catch(e => { console.error(e.message); process.exit(1) });
