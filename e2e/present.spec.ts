import { expect, test, type Page } from "@playwright/test";

const layers = (page: Page) => page.getByTestId("layers").locator("li");
const show = (page: Page) => page.getByTestId("presentation");
const name = (page: Page) => page.getByTestId("present-name");
const counter = (page: Page) => page.getByTestId("present-counter");
const presentButton = (page: Page) => page.locator("header").getByRole("button", { name: /^Present \(/ });
const toast = (page: Page) => page.getByTestId("toast");

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 5 });
  await page.mouse.up();
}

/**
 * Three frames drawn out of reading order: Frame 1 on the right, Frame 2 on the left
 * and Frame 3 on a second row, so reading order is 2, 1, 3.
 */
async function threeFrames(page: Page) {
  await page.keyboard.press("f");
  await drag(page, [700, 160], [940, 300]);
  await page.keyboard.press("f");
  await drag(page, [330, 170], [560, 300]);
  await page.keyboard.press("f");
  await drag(page, [400, 420], [700, 560]);
  await page.keyboard.press("Escape");
  await expect(layers(page)).toHaveCount(3);
}

/** Runs whatever starts the slideshow and returns the window it opens in. */
async function opensSlideshow(page: Page, start: () => Promise<void>): Promise<Page> {
  const opened = page.waitForEvent("popup");
  await start();
  const slideshow = await opened;
  await expect(show(slideshow)).toBeVisible();
  return slideshow;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("canvas")).toBeVisible();
});

test("opens the slideshow in a window of its own and leaves the editor as it was", async ({ page }) => {
  await threeFrames(page);
  const slideshow = await opensSlideshow(page, () => presentButton(page).click());
  expect(new URL(slideshow.url()).searchParams.get("present")).toBeTruthy();
  // A separate pop-up window, not a tab: it has no tab strip, address bar or menu of its own.
  expect(await slideshow.evaluate(() => [window.toolbar.visible, window.locationbar.visible, window.menubar.visible])).toEqual([false, false, false]);

  // The editor behind it is untouched: no overlay, no slideshow, still working.
  await expect(show(page)).toHaveCount(0);
  await expect(layers(page)).toHaveCount(3);
  await page.bringToFront();
  await page.getByTestId("layers").getByText("Frame 2").click();
  await expect(page.getByTestId("properties")).toContainText("Frame 2");

  // Esc closes the slideshow window; the editor is still there.
  await slideshow.bringToFront();
  // The key press itself ends with the page closing, so it is allowed to fail with that.
  await Promise.all([slideshow.waitForEvent("close"), slideshow.keyboard.press("Escape").catch(() => {})]);
  await expect(layers(page)).toHaveCount(3);
});

test("presents the frames in reading order and moves with keys and clicks", async ({ page }) => {
  await threeFrames(page);
  const slideshow = await opensSlideshow(page, () => presentButton(page).click());
  await expect(name(slideshow)).toHaveText("Frame 2");
  await expect(counter(slideshow)).toHaveText("1 / 3");

  await slideshow.keyboard.press("ArrowRight");
  await expect(name(slideshow)).toHaveText("Frame 1");
  await expect(counter(slideshow)).toHaveText("2 / 3");
  await slideshow.keyboard.press("Space");
  await expect(name(slideshow)).toHaveText("Frame 3");
  // The end stays the end.
  await slideshow.keyboard.press("ArrowRight");
  await expect(counter(slideshow)).toHaveText("3 / 3");
  await expect(slideshow.getByRole("button", { name: "Next slide" })).toBeDisabled();

  await slideshow.keyboard.press("ArrowLeft");
  await expect(counter(slideshow)).toHaveText("2 / 3");
  await slideshow.keyboard.press("Home");
  await expect(counter(slideshow)).toHaveText("1 / 3");
  await expect(slideshow.getByRole("button", { name: "Previous slide" })).toBeDisabled();
  await slideshow.keyboard.press("End");
  await expect(counter(slideshow)).toHaveText("3 / 3");

  // Clicking the slide moves on; Shift+click goes back; the on-screen arrows work too.
  await slideshow.keyboard.press("Home");
  await slideshow.mouse.click(700, 400);
  await expect(counter(slideshow)).toHaveText("2 / 3");
  await slideshow.keyboard.down("Shift");
  await slideshow.mouse.click(700, 400);
  await slideshow.keyboard.up("Shift");
  await expect(counter(slideshow)).toHaveText("1 / 3");
  await slideshow.getByRole("button", { name: "Next slide" }).click();
  await expect(counter(slideshow)).toHaveText("2 / 3");
  await slideshow.getByRole("button", { name: "Previous slide" }).click();
  await expect(counter(slideshow)).toHaveText("1 / 3");

  // The browser tab has a full-screen toggle; the editor does not move.
  await expect(slideshow.getByRole("button", { name: "Full screen" })).toBeVisible();
  await expect(counter(page)).toHaveCount(0);
});

test("a reloaded slideshow window gets its slides again", async ({ page }) => {
  await threeFrames(page);
  const slideshow = await opensSlideshow(page, () => presentButton(page).click());
  await slideshow.keyboard.press("End");
  await expect(counter(slideshow)).toHaveText("3 / 3");
  await slideshow.reload();
  await expect(show(slideshow)).toBeVisible({ timeout: 10_000 });
  await expect(counter(slideshow)).toHaveText("1 / 3");
});

test("starts from the selected frame, or from the start when asked", async ({ page }) => {
  await threeFrames(page);
  await page.getByTestId("layers").getByText("Frame 1").click();
  let slideshow = await opensSlideshow(page, () => page.keyboard.press("ControlOrMeta+Alt+Enter"));
  await expect(name(slideshow)).toHaveText("Frame 1");
  await expect(counter(slideshow)).toHaveText("2 / 3");
  await slideshow.close();

  // Anything inside a frame counts as being on it.
  await page.bringToFront();
  await page.keyboard.press("r");
  await drag(page, [740, 190], [800, 240]);
  slideshow = await opensSlideshow(page, () => presentButton(page).click());
  await expect(name(slideshow)).toHaveText("Frame 1");
  await slideshow.close();

  await page.bringToFront();
  const options = page.getByRole("button", { name: "Presentation options" });
  slideshow = await opensSlideshow(page, async () => {
    await options.click();
    await page.getByRole("menuitem", { name: "Present from start" }).click();
  });
  await expect(name(slideshow)).toHaveText("Frame 2");
  await expect(counter(slideshow)).toHaveText("1 / 3");
  await slideshow.close();

  await page.bringToFront();
  slideshow = await opensSlideshow(page, async () => {
    await options.click();
    await page.getByRole("menuitem", { name: "Present from selected frame" }).click();
  });
  await expect(name(slideshow)).toHaveText("Frame 1");
  await slideshow.close();

  // With nothing selected there is no "selected frame" to start from.
  await page.bringToFront();
  await page.mouse.click(1000, 800);
  await options.click();
  await expect(page.getByRole("menuitem", { name: "Present from selected frame" })).toBeDisabled();
});

test("says so when there is nothing to present, and opens no window", async ({ page }) => {
  let opened = false;
  page.context().on("page", () => (opened = true));
  await presentButton(page).click();
  await expect(toast(page)).toContainText("Nothing to present");
  await expect(toast(page)).toContainText("Add a frame");
  await page.waitForTimeout(300);
  expect(opened).toBe(false);
});

test("a page with no frames is presented as one slide", async ({ page }) => {
  await page.keyboard.press("r");
  await drag(page, [400, 200], [560, 300]);
  await page.keyboard.press("o");
  await drag(page, [700, 300], [800, 400]);
  const slideshow = await opensSlideshow(page, () => presentButton(page).click());
  await expect(name(slideshow)).toHaveText("Page 1");
  await expect(counter(slideshow)).toHaveText("1 / 1");
  await expect(slideshow.getByRole("button", { name: "Next slide" })).toBeDisabled();
  await expect(slideshow.getByRole("button", { name: "Previous slide" })).toBeDisabled();
  await slideshow.keyboard.press("ArrowRight");
  await expect(counter(slideshow)).toHaveText("1 / 1");
});

test("shows the frame as it is exported, scaled to fill the window", async ({ page }) => {
  await page.keyboard.press("f");
  await drag(page, [400, 200], [640, 320]); // 240 × 120
  const slideshow = await opensSlideshow(page, () => presentButton(page).click());
  const picture = show(slideshow).getByRole("img", { name: "Frame 1" });
  await expect(picture).toBeVisible();
  expect(await picture.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
  expect(await picture.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([240, 120]);
  // The picture's box fills the window (the slide is centred inside it, keeping its 2 : 1 shape),
  // so a 240 px wide frame is shown at well over 1000 px.
  const box = (await picture.boundingBox())!;
  expect(box.width).toBeGreaterThan(1200);
  expect(await picture.evaluate((img: HTMLImageElement) => getComputedStyle(img).objectFit)).toBe("contain");
});

test("the controls fade away when the mouse is still, and return when it moves", async ({ page }) => {
  await threeFrames(page);
  const slideshow = await opensSlideshow(page, () => presentButton(page).click());
  const controls = show(slideshow).locator("[data-present-controls]");
  await expect(controls).toHaveCSS("opacity", "1");
  await slideshow.mouse.move(700, 300);
  await expect(controls).toHaveCSS("opacity", "0", { timeout: 6000 });
  await expect(show(slideshow)).toHaveCSS("cursor", "none");
  await slideshow.mouse.move(720, 320);
  await expect(controls).toHaveCSS("opacity", "1");
  await expect(show(slideshow)).toHaveCSS("cursor", "default");
  // The exit button closes the window.
  const closed = slideshow.waitForEvent("close");
  await controls.getByRole("button", { name: "Exit presentation" }).click();
  await closed;
});

test("presents pictures", async ({ page }) => {
  await page.keyboard.press("f");
  await drag(page, [330, 120], [900, 520]);
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 60;
    canvas.height = 60;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, 60, 60);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: /Place image/ }).click();
  await (await chooser).setFiles({ name: "red.png", mimeType: "image/png", buffer: Buffer.from(base64, "base64") });
  await expect(page.locator('[data-scene] [data-node-type="frame"] image')).toHaveCount(1);

  await page.getByTestId("layers").getByText("Frame 1").click();
  const slideshow = await opensSlideshow(page, () => page.keyboard.press("ControlOrMeta+Alt+Enter"));
  const picture = show(slideshow).getByRole("img", { name: "Frame 1" });
  const hasRed = await picture.evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(img, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < data.length; i += 4) if (data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 255) return true;
    return false;
  });
  expect(hasRed).toBe(true);
});

test("a slideshow window with no editor behind it explains itself", async ({ page }) => {
  await page.goto("/?present=not-a-real-token");
  await expect(page.getByTestId("presentation-waiting")).toHaveText("Opening presentation…");
  await expect(page.getByTestId("presentation-waiting")).toContainText("no longer available", { timeout: 9000 });
});

test("when no window can be opened the slideshow covers the editor instead, and the editor is inert behind it", async ({ page }) => {
  await threeFrames(page);
  // A blocked pop-up: window.open hands back nothing.
  await page.evaluate(() => {
    window.open = () => null;
  });
  await page.getByTestId("layers").getByText("Frame 3").click();
  await presentButton(page).click();
  await expect(show(page)).toBeVisible();
  await expect(name(page)).toHaveText("Frame 3");
  await expect(counter(page)).toHaveText("3 / 3");

  // Delete, a tool key, undo and select-all do nothing to the document.
  await page.keyboard.press("Delete");
  await page.keyboard.press("r");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(show(page)).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(counter(page)).toHaveText("2 / 3");
  await page.keyboard.press("Escape");
  await expect(show(page)).toHaveCount(0);
  await expect(layers(page)).toHaveCount(3);
  await expect(page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: /^Select/ })).toHaveAttribute("aria-pressed", "true");
});
