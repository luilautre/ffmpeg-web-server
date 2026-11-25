const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");

const HOST = "127.0.0.1"; // Interface locale uniquement
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DOWNLOADS = path.join(ROOT, "downloads");

fs.mkdirSync(DOWNLOADS, { recursive: true });

const jobs = new Map();
let activeJob = null;

function send(res, status, data, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "X-Content-Type-Options": "nosniff" });
  res.end(type.startsWith("application/json") ? JSON.stringify(data) : data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 16_384) {
        reject(new Error("Requête trop volumineuse."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch { reject(new Error("JSON invalide.")); }
    });
    req.on("error", reject);
  });
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    message: job.message,
    elapsedSeconds: Math.floor((Date.now() - job.startedAt) / 1000),
    downloadUrl: job.status === "done" ? `/api/download/${job.id}` : null
  };
}

function serveStatic(req, res) {
  const pathname = new URL(req.url, `http://${HOST}:${PORT}`).pathname;
  const files = {
    "/": ["public/index.html", "text/html; charset=utf-8"],
    "/index.html": ["public/index.html", "text/html; charset=utf-8"]
  };
  const item = files[pathname];
  if (!item) return send(res, 404, "Introuvable.", "text/plain; charset=utf-8");
  const file = path.join(PUBLIC, item[0]);
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 500, "Impossible de lire l'interface.", "text/plain; charset=utf-8");
    send(res, 200, data, item[1]);
  });
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${HOST}:${PORT}`).pathname;

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    return serveStatic(req, res);
  }

  if (req.method === "POST" && pathname === "/api/convert") {
    if (activeJob) return send(res, 409, { error: "Une conversion est déjà en cours." });

    let body;
    try { body = await readJson(req); }
    catch (e) { return send(res, 400, { error: e.message }); }

    let input;
    try { input = new URL(String(body.url || "")); }
    catch { return send(res, 400, { error: "URL invalide." }); }

    if (!["http:", "https:"].includes(input.protocol)) {
      return send(res, 400, { error: "Seules les URL HTTP et HTTPS sont acceptées." });
    }
    if (input.username || input.password) {
      return send(res, 400, { error: "Les URL contenant des identifiants sont refusées." });
    }

    const id = randomUUID();
    const output = path.join(DOWNLOADS, `${id}.mp4`);
    const job = {
      id, output, status: "running", message: "Démarrage de FFmpeg…",
      startedAt: Date.now(), process: null
    };
    jobs.set(id, job);
    activeJob = id;

    // spawn avec tableau d'arguments : aucune interprétation par un shell.
    const args = [
      "-hide_banner", "-nostdin", "-y",
      "-i", input.href,
      "-map", "0",
      "-c", "copy",
      "-movflags", "+faststart",
      output
    ];

    let stderr = "";
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    job.process = child;

    child.stderr.on("data", chunk => {
      stderr = (stderr + chunk.toString()).slice(-6000);
      const lines = stderr.trim().split(/\r?\n/);
      job.message = lines.slice(-1)[0] || "Conversion en cours…";
    });

    child.on("error", err => {
      job.status = "error";
      job.message = err.code === "ENOENT"
        ? "FFmpeg est introuvable. Installe FFmpeg puis relance le serveur."
        : `Erreur de démarrage : ${err.message}`;
      activeJob = null;
    });

    child.on("close", code => {
      if (job.status === "error") return;
      if (code === 0 && fs.existsSync(output) && fs.statSync(output).size > 0) {
        job.status = "done";
        job.message = "Conversion terminée.";
      } else {
        job.status = "error";
        job.message = "Échec FFmpeg. Vérifie l'URL, l'accès au flux et les éventuelles protections. " +
          (stderr.trim().split(/\r?\n/).slice(-3).join(" ") || `Code de sortie : ${code}`);
        try { fs.unlinkSync(output); } catch {}
      }
      activeJob = null;
    });

    return send(res, 202, publicJob(job));
  }

  if (req.method === "GET" && pathname.startsWith("/api/status/")) {
    const id = pathname.slice("/api/status/".length);
    const job = jobs.get(id);
    if (!job) return send(res, 404, { error: "Conversion inconnue." });
    return send(res, 200, publicJob(job));
  }

  if (req.method === "GET" && pathname.startsWith("/api/download/")) {
    const id = pathname.slice("/api/download/".length);
    const job = jobs.get(id);
    if (!job || job.status !== "done" || !fs.existsSync(job.output)) {
      return send(res, 404, { error: "Fichier indisponible." });
    }
    res.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": fs.statSync(job.output).size,
      "Content-Disposition": 'attachment; filename="video.mp4"',
      "X-Content-Type-Options": "nosniff"
    });
    return fs.createReadStream(job.output).pipe(res);
  }

  send(res, 404, { error: "Route inconnue." });
});

server.listen(PORT, HOST, () => {
  console.log(`Interface FFmpeg : http://${HOST}:${PORT}`);
  console.log("Serveur limité à cet ordinateur (127.0.0.1).");
});
