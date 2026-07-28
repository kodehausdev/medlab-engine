// Renders a scene HTML file to an mp4 by recording it in a headless Chromium
// tab (Playwright's built-in video capture -> webm) and transcoding with the
// bundled ffmpeg-static binary. No system ffmpeg install required.
import { chromium } from "playwright";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const WIDTH = 1080;
const HEIGHT = 1920;

async function renderScene(sceneFile, durationMs) {
  const scenePath = resolve(__dirname, "scenes", sceneFile);
  const name = basename(sceneFile, ".html");
  const rawDir = resolve(__dirname, "out", `${name}-raw`);
  const outDir = resolve(__dirname, "out");
  mkdirSync(rawDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: rawDir, size: { width: WIDTH, height: HEIGHT } },
  });
  const page = await context.newPage();
  await page.goto(pathToFileURL(scenePath).href);
  await page.waitForTimeout(durationMs);
  await context.close();
  await browser.close();

  const webmFile = readdirSync(rawDir).find((f) => f.endsWith(".webm"));
  if (!webmFile) throw new Error(`No video captured for ${sceneFile}`);
  const webmPath = join(rawDir, webmFile);
  const mp4Path = join(outDir, `${name}.mp4`);

  await new Promise((resolvePromise, reject) => {
    const ff = spawn(ffmpegPath, [
      "-y",
      "-i", webmPath,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-preset", "slow",
      "-crf", "18",
      "-movflags", "+faststart",
      mp4Path,
    ]);
    let stderr = "";
    ff.stderr.on("data", (d) => (stderr += d));
    ff.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`ffmpeg exited ${code}\n${stderr}`));
    });
  });

  rmSync(rawDir, { recursive: true, force: true });
  console.log(`Rendered ${mp4Path}`);
}

const scenes = process.argv.slice(2);
const catalog = {
  "medlab-demo.html": 14000,
  "ava-brand.html": 12000,
};
const targets = scenes.length ? scenes : Object.keys(catalog);

for (const scene of targets) {
  const duration = catalog[scene];
  if (!duration) throw new Error(`Unknown scene: ${scene}`);
  if (!existsSync(resolve(__dirname, "scenes", scene))) {
    throw new Error(`Scene file missing: scenes/${scene}`);
  }
  await renderScene(scene, duration);
}
