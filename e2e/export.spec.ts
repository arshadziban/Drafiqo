import { expect, test, type Download, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { readImageSize } from "../frontend/src/export/imageSize";

const props = (page: Page) => page.getByTestId("properties");
const dialog = (page: Page) => page.getByRole("dialog", { name: "Export" });
const output = (page: Page) => page.getByTestId("export-output");
const pressed = (locator: Locator) => expect(locator).toHaveAttribute("aria-pressed", "true");

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 5 });
  await page.mouse.up();
}

async function setProp(page: Page, name: string, value: string) {
  await props(page).getByLabel(name, { exact: true }).fill(value);
  await props(page).getByLabel(name, { exact: true }).press("Enter");
}

/** A 375 × 812 artboard holding a red ellipse, with the artboard selected. */
async function buildArtboard(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("canvas")).toBeVisible();
  await page.keyboard.press("f");
  await drag(page, [400, 150], [700, 600]);
  await setProp(page, "Width", "375");
  await setProp(page, "Height", "812");
  await page.keyboard.press("o");
  await drag(page, [430, 180], [630, 380]);
  await setProp(page, "Fill hex", "ff0000");
  await page.getByTestId("layers").getByText("Frame 1").click();
}

async function openExport(page: Page) {
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: /Export/ }).click();
  await expect(dialog(page)).toBeVisible();
}

async function runExport(page: Page): Promise<{ download: Download; bytes: Buffer }> {
  const downloadPromise = page.waitForEvent("download");
  await dialog(page).getByRole("button", { name: /^Export (PNG|JPG|WebP|SVG|PDF)$/ }).click();
  const download = await downloadPromise;
  await expect(page.getByTestId("export-status")).toContainText("Exported");
  return { download, bytes: await readFile(await download.path()) };
}

/** Decodes an exported image in the browser and reads one pixel plus the decoded size. */
async function decode(page: Page, bytes: Buffer, mime: string, x: number, y: number) {
  return page.evaluate(
    async ({ base64, mime, x, y }) => {
      const bitmap = new Image();
      bitmap.src = `data:${mime};base64,${base64}`;
      await bitmap.decode();
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      const [r, g, b, a] = context.getImageData(x, y, 1, 1).data;
      return { width: bitmap.width, height: bitmap.height, rgba: [r, g, b, a] };
    },
    { base64: bytes.toString("base64"), mime, x, y },
  );
}

test("exports PNG at 1×, 2×, 3× and 4× with matching displayed and actual dimensions", async ({ page }) => {
  await buildArtboard(page);
  await openExport(page);
  await expect(dialog(page).getByLabel("Export target")).toHaveText(/.+/);
  const expected = { 1: [375, 812], 2: [750, 1624], 3: [1125, 2436], 4: [1500, 3248] } as const;
  for (const [scale, [width, height]] of Object.entries(expected)) {
    await dialog(page).getByRole("button", { name: `${scale}×`, exact: true }).click();
    await expect(output(page)).toHaveText(`${width} × ${height} px`);
    await expect(dialog(page).getByLabel("Export width")).toHaveValue(String(width));
    const { download, bytes } = await runExport(page);
    expect(download.suggestedFilename()).toBe(scale === "1" ? "Frame 1.png" : `Frame 1@${scale}x.png`);
    expect(readImageSize(bytes)).toEqual({ width, height });
    await expect(page.getByTestId("export-status")).toContainText(`${width} × ${height} px`);
  }
  // The file really decodes at that size, and the artwork is where it should be:
  // the ellipse centre (130, 130 at 1×) is red, the frame corner is its white background.
  const { bytes } = await runExport(page);
  expect(await decode(page, bytes, "image/png", 520, 520)).toEqual({ width: 1500, height: 3248, rgba: [255, 0, 0, 255] });
  expect((await decode(page, bytes, "image/png", 4, 4)).rgba).toEqual([255, 255, 255, 255]);
});

test("custom width and height, aspect lock, and switching back to a preset", async ({ page }) => {
  await buildArtboard(page);
  await openExport(page);
  const width = dialog(page).getByLabel("Export width");
  const height = dialog(page).getByLabel("Export height");
  const lock = dialog(page).getByRole("button", { name: "Lock aspect ratio" });
  const custom = dialog(page).getByRole("button", { name: "Custom", exact: true });

  // Locked: typing one dimension updates the other and selects Custom.
  await pressed(lock);
  await width.fill("500");
  await expect(height).toHaveValue("1083");
  await pressed(custom);
  await height.fill("406");
  await expect(width).toHaveValue("188");
  await expect(output(page)).toHaveText("188 × 406 px");

  // Unlocked: independent dimensions, with an explicit choice of how the artwork fits.
  await lock.click();
  await width.fill("600");
  await height.fill("400");
  await expect(output(page)).toHaveText("600 × 400 px");
  await expect(dialog(page).getByText("These proportions differ from the artwork")).toBeVisible();
  await pressed(dialog(page).getByRole("button", { name: "Fit inside" }));
  let exported = await runExport(page);
  expect(exported.download.suggestedFilename()).toBe("Frame 1.png");
  // Fit inside: the artwork is centred and the leftover area stays transparent, not stretched.
  expect(await decode(page, exported.bytes, "image/png", 5, 200)).toEqual({ width: 600, height: 400, rgba: [0, 0, 0, 0] });
  expect((await decode(page, exported.bytes, "image/png", 300, 200)).rgba[3]).toBe(255);

  await dialog(page).getByRole("button", { name: "Stretch" }).click();
  exported = await runExport(page);
  expect((await decode(page, exported.bytes, "image/png", 5, 200)).rgba[3]).toBe(255);

  // Back to a preset: recalculated from the source, the fit question goes away.
  await dialog(page).getByRole("button", { name: "2×", exact: true }).click();
  await expect(width).toHaveValue("750");
  await expect(height).toHaveValue("1624");
  await expect(dialog(page).getByText("These proportions differ from the artwork")).toHaveCount(0);

  // Re-locking restores the artwork's proportions.
  await width.fill("300");
  await height.fill("300");
  await lock.click();
  await expect(height).toHaveValue("650");
});

test("PNG and WebP keep transparency; JPG uses the chosen background", async ({ page }) => {
  await buildArtboard(page);
  await page.getByTestId("layers").getByText("Ellipse 1").click();
  await openExport(page);
  await expect(output(page)).toHaveText("200 × 200 px");

  // Outside the ellipse the corner pixel is transparent; its centre is opaque red.
  let { bytes, download } = await runExport(page);
  expect(download.suggestedFilename()).toBe("Ellipse 1.png");
  expect(await decode(page, bytes, "image/png", 2, 2)).toEqual({ width: 200, height: 200, rgba: [0, 0, 0, 0] });
  expect((await decode(page, bytes, "image/png", 100, 100)).rgba).toEqual([255, 0, 0, 255]);

  await dialog(page).getByRole("button", { name: "WebP", exact: true }).click();
  await expect(dialog(page).getByLabel("Quality")).toHaveValue("100");
  await expect(dialog(page).getByLabel("Transparent background")).toBeChecked();
  ({ bytes, download } = await runExport(page));
  expect(download.suggestedFilename()).toBe("Ellipse 1.webp");
  expect(bytes.subarray(8, 12).toString()).toBe("WEBP");
  expect(readImageSize(bytes)).toEqual({ width: 200, height: 200 });
  const webp = await decode(page, bytes, "image/webp", 2, 2);
  expect(webp).toMatchObject({ width: 200, height: 200 });
  expect(webp.rgba[3]).toBe(0);

  // Turning transparency off composites over the chosen colour.
  await dialog(page).getByLabel("Transparent background").uncheck();
  await dialog(page).getByLabel("Export background hex").fill("0000ff");
  await dialog(page).getByLabel("Export background hex").press("Enter");
  await dialog(page).getByRole("button", { name: "PNG", exact: true }).click();
  ({ bytes } = await runExport(page));
  expect((await decode(page, bytes, "image/png", 2, 2)).rgba).toEqual([0, 0, 255, 255]);

  // JPG always has a background.
  await dialog(page).getByRole("button", { name: "JPG", exact: true }).click();
  await expect(dialog(page).getByLabel("Transparent background")).toHaveCount(0);
  await dialog(page).getByLabel("Export background hex").fill("00ff00");
  await dialog(page).getByLabel("Export background hex").press("Enter");
  await dialog(page).getByRole("button", { name: "2×", exact: true }).click();
  ({ bytes, download } = await runExport(page));
  expect(download.suggestedFilename()).toBe("Ellipse 1@2x.jpg");
  expect(readImageSize(bytes)).toEqual({ width: 400, height: 400 });
  const jpg = await decode(page, bytes, "image/jpeg", 3, 3);
  expect(jpg).toMatchObject({ width: 400, height: 400 });
  expect(jpg.rgba[0]).toBeLessThan(20);
  expect(jpg.rgba[1]).toBeGreaterThan(235);
  expect(jpg.rgba[2]).toBeLessThan(20);
});

test("the quality setting reaches the JPG and WebP encoders", async ({ page }) => {
  await buildArtboard(page);
  await openExport(page);
  const quality = dialog(page).getByLabel("Quality");
  const sizes: Record<string, number> = {};
  for (const format of ["JPG", "WebP"]) {
    await dialog(page).getByRole("button", { name: format, exact: true }).click();
    for (const value of ["100", "10"]) {
      await quality.fill(value);
      sizes[`${format}-${value}`] = (await runExport(page)).bytes.length;
    }
  }
  expect(sizes["JPG-10"]).toBeLessThan(sizes["JPG-100"]! * 0.8);
  expect(sizes["WebP-10"]).toBeLessThan(sizes["WebP-100"]!);

  // Lossless is its own mode and reproduces pixels exactly.
  await dialog(page).getByLabel("Lossless").check();
  await expect(quality).toBeDisabled();
  const { bytes } = await runExport(page);
  expect(bytes.subarray(12, 16).toString()).toMatch(/VP8L|VP8X/);
  expect((await decode(page, bytes, "image/webp", 130, 130)).rgba).toEqual([255, 0, 0, 255]);
});

test("exports SVG and PDF with format-appropriate options", async ({ page }) => {
  await buildArtboard(page);
  await openExport(page);

  await dialog(page).getByRole("button", { name: "SVG", exact: true }).click();
  await expect(dialog(page).getByRole("button", { name: "2×", exact: true })).toHaveCount(0);
  await expect(dialog(page).getByLabel("Export width")).toHaveCount(0);
  await expect(page.getByTestId("export-extension")).toHaveText(".svg");
  let { bytes, download } = await runExport(page);
  expect(download.suggestedFilename()).toBe("Frame 1.svg");
  const svg = bytes.toString("utf8");
  expect(svg).toMatch(/^<\?xml/);
  expect(svg).toContain('width="375" height="812"');
  expect(svg).toContain("<ellipse");
  expect(svg).toContain('fill="#ff0000"');
  // It is a valid, renderable image of the right size.
  expect(await decode(page, bytes, "image/svg+xml", 130, 130)).toEqual({ width: 375, height: 812, rgba: [255, 0, 0, 255] });

  await dialog(page).getByRole("button", { name: "PDF", exact: true }).click();
  await expect(output(page)).toHaveText("375 × 812 pt");
  ({ bytes, download } = await runExport(page));
  expect(download.suggestedFilename()).toBe("Frame 1.pdf");
  let pdf = bytes.toString("latin1");
  expect(pdf.startsWith("%PDF-1.4")).toBe(true);
  expect(pdf).toContain("/MediaBox [0 0 375 812]");
  expect(pdf).toContain("1 0 0 rg");
  expect(pdf).not.toContain("/DCTDecode");

  await dialog(page).getByRole("button", { name: "Image", exact: true }).click();
  ({ bytes } = await runExport(page));
  pdf = bytes.toString("latin1");
  expect(pdf).toContain("/Filter /DCTDecode");
  expect(pdf).toContain("/Width 750 /Height 1624");
});

test("explains invalid sizes and file names and blocks the export", async ({ page }) => {
  await buildArtboard(page);
  await openExport(page);
  const status = page.getByTestId("export-status");
  const button = dialog(page).getByRole("button", { name: "Export PNG" });
  const width = dialog(page).getByLabel("Export width");

  await width.fill("0");
  await expect(status).toContainText("Width must be at least 1 px.");
  await expect(button).toBeDisabled();
  await width.fill("");
  await expect(status).toContainText("Width must be a number.");
  await width.fill("20000");
  await expect(status).toContainText("Width cannot be larger than 16,384 px.");
  await width.fill("7000");
  await expect(status).toContainText("the limit is 100,000,000");
  await expect(button).toBeDisabled();

  await dialog(page).getByRole("button", { name: "1×", exact: true }).click();
  await expect(button).toBeEnabled();
  await dialog(page).getByLabel("File name").fill("bad/name");
  await expect(status).toContainText("A file name cannot contain");
  await expect(button).toBeDisabled();
  await dialog(page).getByLabel("File name").fill("Home screen");
  const { download } = await runExport(page);
  expect(download.suggestedFilename()).toBe("Home screen.png");

  // Editor shortcuts do not leak through the modal dialog.
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('[data-scene] [data-node-type="frame"]')).toHaveCount(1);
});
