import { FFmpeg } from "@ffmpeg/ffmpeg";
import "./style.css";

const $ = (s) => document.querySelector(s);
const urlInput = $("#sourceUrl"), fileInput = $("#sourceFile");
const button = $("#convertBtn"), status = $("#status"), percent = $("#percent");
const bar = $("#bar"), details = $("#details"), download = $("#download");
let ffmpeg, outputUrl;

fileInput.addEventListener("change", () => {
  $("#fileName").textContent = fileInput.files[0]?.name || "MP4, TS, MOV, WebM…";
});
function progress(value, message) {
  const p = Math.max(0, Math.min(100, Math.round(value)));
  bar.style.width = p + "%"; percent.textContent = p + "%";
  if (message) status.textContent = message;
}
function cleanName(name) { return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "input.bin"; }

async function loadEngine() {
  if (ffmpeg) return;
  status.textContent = "Chargement de FFmpeg (~30 Mo)…";
  ffmpeg = new FFmpeg();
  ffmpeg.on("log", ({ message }) => { if (message) details.textContent = message.slice(-1600); });
  ffmpeg.on("progress", ({ progress: p }) => {
    if (Number.isFinite(p)) progress(8 + p * 86, "Conversion en cours…");
  });
  // Utiliser la version ESM : le worker FFmpeg peut importer le module
  // directement depuis le CDN. Les URL blob provoquaient l'erreur
  // "failed to import ffmpeg-core.js" dans certains navigateurs.
  const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
  await ffmpeg.load({
    coreURL: base + "/ffmpeg-core.js",
    wasmURL: base + "/ffmpeg-core.wasm"
  });
}

async function playlistSegments(url, depth = 0) {
  if (depth > 4) throw new Error("Trop de niveaux de playlists HLS.");
  const response = await fetch(url);
  if (!response.ok) throw new Error("Playlist inaccessible : HTTP " + response.status);
  const text = await response.text();
  if (!text.trimStart().startsWith("#EXTM3U")) throw new Error("L'URL ne renvoie pas une playlist M3U8.");
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("#EXT-X-STREAM-INF:")) {
      const bandwidth = Number((lines[i].match(/BANDWIDTH=(\d+)/) || [])[1] || 0);
      const next = lines.slice(i + 1).find(x => !x.startsWith("#"));
      if (next) variants.push({ bandwidth, url: new URL(next, url).href });
    }
  }
  if (variants.length) {
    variants.sort((a,b) => b.bandwidth-a.bandwidth);
    return playlistSegments(variants[0].url, depth + 1);
  }
  if (lines.some(x => x.startsWith("#EXT-X-KEY:") && !/METHOD=NONE/.test(x)))
    throw new Error("Playlist chiffrée détectée : les flux DRM/chiffrés ne sont pas pris en charge.");
  if (lines.some(x => x.startsWith("#EXT-X-MAP:")))
    throw new Error("Playlist HLS fMP4 non prise en charge par cette version.");
  const segments = lines.filter(x => !x.startsWith("#")).map(x => new URL(x, url).href);
  if (!segments.length) throw new Error("Aucun segment vidéo dans la playlist.");
  return segments;
}

async function run() {
  button.disabled = true; download.hidden = true; details.textContent = "";
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  progress(1, "Préparation…");
  try {
    const file = fileInput.files[0];
    const rawUrl = urlInput.value.trim();
    if (!file && !rawUrl) throw new Error("Colle une URL ou sélectionne un fichier vidéo.");
    await loadEngine();
    let inputArgs;
    if (file) {
      const name = cleanName(file.name);
      await ffmpeg.writeFile(name, new Uint8Array(await file.arrayBuffer()));
      inputArgs = ["-i", name];
    } else {
      const url = new URL(rawUrl);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("Seules les URL HTTP(S) sont acceptées.");
      if (/\.m3u8(?:$|[?#])/i.test(url.href)) {
        const segments = await playlistSegments(url.href);
        const concat = [];
        const concurrency = 6;

        // Télécharger un petit groupe de segments en parallèle.
        // Les fichiers sont ensuite écrits dans l'ordre original de la playlist.
        for (let start = 0; start < segments.length; start += concurrency) {
          const end = Math.min(start + concurrency, segments.length);
          status.textContent = `Téléchargement des segments : ${end}/${segments.length} (jusqu'à ${concurrency} simultanés)`;

          const batch = await Promise.all(
            segments.slice(start, end).map(async (segmentUrl, offset) => {
              const index = start + offset;
              const res = await fetch(segmentUrl);
              if (!res.ok) throw new Error(`Segment ${index + 1} inaccessible : HTTP ${res.status}`);
              return new Uint8Array(await res.arrayBuffer());
            })
          );

          for (let offset = 0; offset < batch.length; offset++) {
            const index = start + offset;
            const name = `segment_${String(index).padStart(5,"0")}.ts`;
            await ffmpeg.writeFile(name, batch[offset]);
            concat.push(`file '${name}'`);
          }

          progress(5 + 3 * end / segments.length);
        }
        await ffmpeg.writeFile("segments.txt", new TextEncoder().encode(concat.join("\n")));
        inputArgs = ["-f","concat","-safe","0","-i","segments.txt"];
      } else {
        status.textContent = "Téléchargement de la vidéo…";
        const res = await fetch(url.href);
        if (!res.ok) throw new Error("Vidéo inaccessible : HTTP " + res.status);
        const blob = await res.blob();
        const name = cleanName(url.pathname.split("/").pop() || "video.bin");
        await ffmpeg.writeFile(name, new Uint8Array(await blob.arrayBuffer()));
        inputArgs = ["-i", name];
      }
    }
    status.textContent = "Création du MP4…";
    await ffmpeg.exec([...inputArgs, "-map","0","-c","copy","-bsf:a","aac_adtstoasc","-movflags","+faststart","output.mp4"]);
    const data = await ffmpeg.readFile("output.mp4");
    if (!data.length) throw new Error("FFmpeg n'a produit aucun fichier.");
    outputUrl = URL.createObjectURL(new Blob([data], {type:"video/mp4"}));
    download.href = outputUrl; download.download = "video.mp4"; download.hidden = false;
    progress(100, "Conversion terminée !");
    details.textContent = `MP4 prêt : ${(data.length/1048576).toFixed(1)} Mo`;
  } catch (error) {
    progress(0, "Échec de la conversion.");
    details.textContent = error?.message || String(error);
  } finally { button.disabled = false; }
}
button.addEventListener("click", run);
