import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import assert from "node:assert/strict";
import { zipFixture } from "./fixtures.js";
const origin = "http://127.0.0.1:4174",
  base = origin + "/GPTchatconvert/";
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    "4174",
    "--strictPort",
    "--base",
    "/GPTchatconvert/",
  ],
  { stdio: "pipe" },
);
let browser;
try {
  let available = false;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(base)).ok) {
        available = true;
        break;
      }
    } catch {}
    await setTimeout(100);
  }
  assert.ok(available, "Preview server did not start");
  browser = await chromium.launch(
    process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
  );
  const page = await browser.newPage(),
    requests = [],
    errors = [];
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(base);
  await page.screenshot({
    path: "test-results/production-landing.png",
    fullPage: true,
  });
  await page
    .locator("#zip-file")
    .setInputFiles({
      name: "synthetic-export.zip",
      mimeType: "application/zip",
      buffer: await zipFixture(),
    });
  await page.getByRole("button", { name: /합성 한국어/ }).click();
  await page.locator("#print:not([disabled])").waitFor();
  assert.equal(await page.locator(".katex").count(), 5);
  assert.equal(await page.locator(".conversation-image").count(), 2);
  assert.deepEqual(errors, []);
  assert.ok(
    requests.every((url) => url.startsWith(base) || url.startsWith("blob:")),
    `Unexpected destination: ${requests}`,
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
  );
  console.log(
    "Production subpath verified: HTML, JS, CSS, local KaTeX fonts, ZIP parsing, rendering; no external requests.",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
