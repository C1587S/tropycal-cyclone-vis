/** Smoke test against a running preview server: loads the three page types,
 * captures console errors, verifies the MapLibre canvas actually painted
 * data (non-background pixels), and writes full-page screenshots.
 *
 * Usage: node scripts/smoke.mjs [baseUrl] [outDir]
 */

import puppeteer from "puppeteer-core";

const base = process.argv[2] ?? "http://localhost:4173";
const outDir = process.argv[3] ?? "/tmp";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const PAGES = [
  { name: "home", path: "/" },
  { name: "run", path: "/p/geoclaw/run/per_storm_v2" },
  { name: "storm", path: "/p/geoclaw/run/per_storm_v2/storm/2005236N23285" },
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1440,1100"],
  defaultViewport: { width: 1440, height: 1100 },
});

let failures = 0;
for (const { name, path } of PAGES) {
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + path, { waitUntil: "networkidle0", timeout: 30000 });
  await new Promise((r) => setTimeout(r, name === "storm" ? 6000 : 1500));

  const checks = { title: await page.title(), errors };
  if (name === "storm") {
    checks.mapPainted = await page.evaluate(() => {
      const canvas = document.querySelector(".maplibregl-canvas");
      if (!canvas) return "no canvas";
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (!gl) return "no gl context";
      const w = 64;
      const px = new Uint8Array(w * w * 4);
      gl.readPixels(
        (gl.drawingBufferWidth - w) / 2,
        (gl.drawingBufferHeight - w) / 2,
        w,
        w,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        px,
      );
      let colored = 0;
      for (let i = 0; i < px.length; i += 4) {
        const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
        // background is near-white #fcfcfb; count clearly-colored pixels
        if (Math.abs(r - g) + Math.abs(g - b) + Math.abs(r - b) > 30 || r < 200) colored++;
      }
      return `${colored}/${w * w} colored center pixels`;
    });
    checks.videoReady = await page.evaluate(() => {
      const v = document.querySelector("video");
      return v ? `readyState=${v.readyState} ${v.videoWidth}x${v.videoHeight}` : "no video";
    });
    checks.chartDrawn = await page.evaluate(() => {
      const c = [...document.querySelectorAll("canvas")].filter(
        (el) => !el.className.includes("maplibregl"),
      );
      return `${c.length} chart canvases`;
    });
    checks.animateMode = await page.evaluate(() => {
      const btn = [...document.querySelectorAll(".map-legend button")].find(
        (b) => b.textContent?.trim() === "animate",
      );
      if (!btn) return "no animate toggle";
      btn.click();
      return "clicked";
    });
    if (checks.animateMode === "clicked") {
      await new Promise((r) => setTimeout(r, 2000));
      checks.animFrame = await page.evaluate(() => {
        // the mp4 player owns the first slider; animate mode adds the map's
        const sliders = document.querySelectorAll(".anim-controls input[type=range]");
        if (sliders.length < 2) return `only ${sliders.length} slider(s), map slider missing`;
        const slider = sliders[sliders.length - 1];
        // React tracks the input's value internally; a plain .value write is
        // deduped, so go through the native setter to trigger onChange
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(slider, String(Math.floor(Number(slider.max) * 0.75)));
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        return `${sliders.length} sliders, map slider max=${slider.max}`;
      });
    }
  }
  await page.screenshot({ path: `${outDir}/smoke-${name}.png`, fullPage: name !== "storm" });
  const bad = errors.length > 0 || (name === "storm" && String(checks.mapPainted).startsWith("0/"));
  if (bad) failures++;
  console.log(`${bad ? "FAIL" : "ok  "} ${name}`, JSON.stringify(checks, null, 1));
  await page.close();
}

await browser.close();
process.exit(failures ? 1 : 0);
