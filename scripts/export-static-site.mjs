// Exports this app as a plain static site for GitHub Pages, at dist/gh-pages/.
//
// Why this exists: `vinext build --prerender-all` is the framework's normal
// static-export path, but as of vinext 1.0.0-beta.5 it silently fails to
// prerender the root route once NEXT_PUBLIC_BASE_PATH is set (needed because
// GitHub Pages serves this repo from /UTP2027/, not a domain root) - only
// the 404 route comes out. The route renders correctly through the real
// server, though, so this script builds normally, boots the production
// server (the same `wrangler dev` used by `npm start`), captures its actual
// rendered HTML for / and a 404 path via plain HTTP requests, and assembles
// that alongside the client JS/CSS/asset output into a directory GitHub
// Pages can serve as-is. Re-check this workaround against new vinext
// releases - a fixed --prerender-all would let this script go away.
//
// Usage: node scripts/export-static-site.mjs

import { spawn } from "node:child_process";
import { mkdirSync, cpSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_PATH = "/UTP2027";
const PORT = 8787;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientDir = path.join(rootDir, "dist/client");
const outDir = path.join(rootDir, "dist/gh-pages");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: true, ...options });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
  });
}

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

function localBin(name) {
  return path.join(rootDir, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
}

// On Windows, spawning a .cmd needs shell: true, which runs it under a
// cmd.exe wrapper - child.kill() only terminates that wrapper, leaving the
// actual wrangler/workerd process (and its file locks on dist/) orphaned.
// taskkill's /T tree-kill reaches the real process; elsewhere plain kill is fine.
function killServer(child) {
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", shell: true });
  } else {
    child.kill();
  }
}

// wrangler's underlying Workers runtime (workerd) has occasionally crashed
// on startup in testing (a native "std::terminate" abort, unrelated to this
// app) - retry once before giving up.
async function startServerAndCapture(attempt = 1) {
  const server = spawn(
    localBin("wrangler"),
    ["dev", "--config", "dist/server/wrangler.json", "--port", String(PORT)],
    { stdio: "inherit", shell: true, cwd: rootDir },
  );

  try {
    await waitForServer(`${ORIGIN}${BASE_PATH}/`);
    return {
      indexHtml: await (await fetch(`${ORIGIN}${BASE_PATH}/`)).text(),
      notFoundHtml: await (await fetch(`${ORIGIN}${BASE_PATH}/this-page-does-not-exist`)).text(),
    };
  } catch (error) {
    if (attempt >= 2) {
      throw error;
    }
    console.warn(`Server didn't come up (attempt ${attempt}), retrying...`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return startServerAndCapture(attempt + 1);
  } finally {
    killServer(server);
  }
}

async function main() {
  console.log(`Building with NEXT_PUBLIC_BASE_PATH=${BASE_PATH}...`);
  await run(localBin("vinext"), ["build"], {
    cwd: rootDir,
    env: { ...process.env, NEXT_PUBLIC_BASE_PATH: BASE_PATH },
  });

  console.log("Starting production server to capture rendered HTML...");
  const { indexHtml, notFoundHtml } = await startServerAndCapture();

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  writeFileSync(path.join(outDir, "index.html"), indexHtml);
  writeFileSync(path.join(outDir, "404.html"), notFoundHtml);
  // GitHub Pages runs content through Jekyll by default, which silently
  // drops any file/directory starting with "_" (like _next/) unless this
  // marker is present.
  writeFileSync(path.join(outDir, ".nojekyll"), "");

  // The build nests framework assets under a literal "UTP2027/" directory
  // (mirroring the basePath) - strip that nesting here, since GitHub Pages
  // itself adds the /UTP2027/ prefix when serving this repo's Pages site.
  const nestedNext = path.join(clientDir, "UTP2027", "_next");
  if (existsSync(nestedNext)) {
    cpSync(nestedNext, path.join(outDir, "_next"), { recursive: true });
  }

  // Everything else in dist/client (public/ passthrough assets like
  // favicon.svg, the logo, and the two GeoJSON files) is already
  // unnested and copies straight across.
  for (const entry of readdirSync(clientDir, { withFileTypes: true })) {
    if (entry.name === "UTP2027" || entry.name.startsWith(".")) {
      continue;
    }
    cpSync(path.join(clientDir, entry.name), path.join(outDir, entry.name), { recursive: true });
  }

  console.log(`\nStatic site exported to ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
