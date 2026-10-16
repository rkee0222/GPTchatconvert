import { test, expect } from "@playwright/test";
import { zipFixture } from "./fixtures.js";
import { execFileSync } from "node:child_process";
async function load(page, data) {
  await page.goto("/");
  await page
    .locator("#zip-file")
    .setInputFiles({
      name: "synthetic-export.zip",
      mimeType: "application/zip",
      buffer: await zipFixture(data),
    });
  await expect(page.locator("#reader")).toBeVisible();
}
async function ready(page) {
  await expect(page.locator("#print")).toBeEnabled();
}
test("ZIP → 검색 → 현재 경로 → 안전한 서식과 이미지 → 인쇄", async ({
  page,
}, info) => {
  const outside = [],
    errors = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:4173") &&
      !r.url().startsWith("blob:")
    )
      outside.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await load(page);
  await page.locator("#search").fill("한국어");
  await expect(page.locator(".conversation-item")).toHaveCount(1);
  await page.locator(".conversation-item").click();
  await ready(page);
  await expect(page.locator("#document")).not.toContainText("OLD-BRANCH");
  await expect(page.locator("#document .message")).toHaveCount(2);
  await expect(page.locator("#document .katex")).toHaveCount(5);
  await expect(page.locator("#document table")).toHaveCount(1);
  await expect(page.locator("#document pre code")).toContainText([
    '    print("안녕하세요", i)',
  ]);
  await expect(page.locator(".conversation-image")).toHaveCount(2);
  await expect(page.locator(".missing-image")).toHaveCount(2);
  await expect(page.locator(".unsupported")).toContainText([
    "unavailable-audio",
  ]);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(outside).toEqual([]);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("preview.png"),
    fullPage: true,
  });
  await page.evaluate(() => {
    window.__printed = 0;
    window.print = () => window.__printed++;
  });
  await page.locator("#print").click();
  expect(await page.evaluate(() => window.__printed)).toBe(1);
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect(page.locator(".app-header")).toBeHidden();
  await expect(page.locator(".conversation-panel")).toBeHidden();
  await expect(page.locator("#document")).toBeVisible();
  if (info.project.name === "desktop") {
    const path = info.outputPath("formatted.pdf");
    await page.pdf({ path, preferCSSPageSize: true, printBackground: true });
    const text = execFileSync("pdftotext", ["-layout", path, "-"], {
      encoding: "utf8",
    });
    expect(text).toContain("한국어");
    expect(text).toContain("END-FORMATTING");
    expect(text).not.toContain("ZIP 파일 선택");
    expect(text).not.toContain("OLD-BRANCH");
  }
});
test("current_node가 없으면 경로를 선택하며 형제 분기를 합치지 않는다", async ({
  page,
}) => {
  await load(page);
  await page.getByRole("button", { name: /합성 경로 선택/ }).click();
  await expect(page.locator("#print")).toBeDisabled();
  await page.locator("#branch").selectOption("b");
  await ready(page);
  await expect(page.locator("#document")).toContainText("ONLY-B");
  await expect(page.locator("#document")).not.toContainText("ONLY-A");
  await page.locator("#branch").selectOption("a");
  await ready(page);
  await expect(page.locator("#document")).toContainText("ONLY-A");
  await expect(page.locator("#document")).not.toContainText("ONLY-B");
});
test("긴 대화·한 페이지보다 긴 표와 코드의 마지막까지 PDF에 존재한다", async ({
  page,
}, info) => {
  await load(page);
  await page.getByRole("button", { name: /합성 긴 대화/ }).click();
  await ready(page);
  await expect(page.locator("#document .message")).toHaveCount(160);
  await expect(page.locator("#document")).toContainText("FINAL-PRINT-END");
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  const overflow = await page
    .locator("#document")
    .evaluate((el) =>
      [...el.querySelectorAll("pre,table,.math-source,img")]
        .filter(
          (n) =>
            n.getBoundingClientRect().right >
            el.getBoundingClientRect().right + 2,
        )
        .map((n) => n.tagName),
    );
  expect(overflow).toEqual([]);
  if (info.project.name === "desktop") {
    const path = info.outputPath("long.pdf");
    await page.pdf({ path, preferCSSPageSize: true, printBackground: true });
    const text = execFileSync("pdftotext", ["-layout", path, "-"], {
      encoding: "utf8",
    });
    for (let i = 0; i < 160; i++) expect(text).toContain(`메시지 ${i} ·`);
    expect(text).toContain("TABLE-99");
    expect(text).toContain("code-line-159");
    expect(text).toContain("FINAL-PRINT-END");
    expect(text.split("\f").length).toBeGreaterThan(10);
  }
});
test("알 수 없는 형식과 손상된 ZIP에서 복구 가능한 오류를 표시한다", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator("#zip-file")
    .setInputFiles({
      name: "bad.zip",
      mimeType: "application/zip",
      buffer: Buffer.from("not zip"),
    });
  await expect(page.locator("#error")).toBeVisible();
  await expect(page.locator("#zip-file")).toBeEnabled();
  await page
    .locator("#zip-file")
    .setInputFiles({
      name: "unknown.zip",
      mimeType: "application/zip",
      buffer: await zipFixture({ unknown: [] }),
    });
  await expect(page.locator("#error")).toContainText("지원하는 형식");
  await expect(page.locator("#reader")).toBeHidden();
  await load(page);
  await expect(page.locator(".conversation-item")).toHaveCount(3);
});

test("수식 글꼴이 로드되기 전에는 인쇄 버튼을 활성화하지 않는다", async ({
  page,
}) => {
  const disabled = [];
  await page.route(/\.(?:woff2?|ttf)(?:\?|$)/, async (route) => {
    disabled.push(await page.locator("#print").isDisabled());
    await new Promise((r) => setTimeout(r, 350));
    await route.continue();
  });
  await load(page);
  await page.getByRole("button", { name: /합성 한국어/ }).click();
  await ready(page);
  expect(disabled.length).toBeGreaterThan(0);
  expect(disabled.every(Boolean)).toBe(true);
});
