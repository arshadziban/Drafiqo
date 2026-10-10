import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const scene = (page: Page) => page.locator("[data-scene]");
const props = (page: Page) => page.getByTestId("properties");
const layers = (page: Page) => page.getByTestId("layers").locator("li");
const pictures = (page: Page) => scene(page).locator("image");
const toast = (page: Page) => page.getByTestId("toast");

type Upload = { name: string; mimeType: string; buffer: Buffer };

/** A solid-colour picture, drawn in the browser so the tests need no binary files. */
async function makeImage(page: Page, width: number, height: number, color: string, name = "picture.png"): Promise<Upload> {
  const base64 = await page.evaluate(
    ({ width, height, color }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      context.fillStyle = color;
      context.fillRect(0, 0, width, height);
      return canvas.toDataURL("image/png").split(",")[1]!;
    },
    { width, height, color },
  );
  return { name, mimeType: "image/png", buffer: Buffer.from(base64, "base64") };
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 5 });
  await page.mouse.up();
}

/** File ▸ Place image…, answered with the given files. */
async function placeFromMenu(page: Page, files: Upload | Upload[]) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: /Place image/ }).click();
  await (await chooser).setFiles(files);
}

async function dropFiles(page: Page, upload: Upload, at: { x: number; y: number }, phase: "over" | "drop") {
  await page.evaluate(
    ({ upload, at, phase }) => {
      const bytes = Uint8Array.from(atob(upload.base64), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], upload.name, { type: upload.mimeType }));
      const target = document.querySelector('[data-testid="canvas"]')!;
      const init = { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, dataTransfer: transfer };
      if (phase === "over") {
        target.dispatchEvent(new DragEvent("dragenter", init));
        target.dispatchEvent(new DragEvent("dragover", init));
      } else {
        target.dispatchEvent(new DragEvent("drop", init));
      }
    },
    { upload: { name: upload.name, mimeType: upload.mimeType, base64: upload.buffer.toString("base64") }, at, phase },
  );
}

async function save(page: Page) {
  const downloaded = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+s");
  const download = await downloaded;
  return { path: await download.path(), project: JSON.parse(await readFile(await download.path(), "utf8")) };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("canvas")).toBeVisible();
});

test("places a picture from the menu as a selected image layer, sized to the file, and undoes it", async ({ page }) => {
  await placeFromMenu(page, await makeImage(page, 120, 80, "#ff0000", "Sunset.PNG"));
  await expect(layers(page)).toHaveText(["Sunset"]);
  await expect(pictures(page)).toHaveCount(1);
  await expect(pictures(page).first()).toHaveAttribute("href", /^data:image\/png;base64,/);
  // Selected, at its own size, with the picture fill in the panel.
  await expect(props(page).getByLabel("Width", { exact: true })).toHaveValue("120");
  await expect(props(page).getByLabel("Height", { exact: true })).toHaveValue("80");
  await expect(props(page).getByRole("button", { name: "Replace image" })).toBeVisible();
  await expect(props(page).getByRole("combobox", { name: "Image scale mode" })).toHaveText("Fill");
  // A picture layer has a picture icon in the Layers panel.
  await expect(layers(page).first().locator("svg.lucide-image")).toHaveCount(1);

  // One undo step removes it, and redo brings it back.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(layers(page)).toHaveCount(0);
  await expect(pictures(page)).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(layers(page)).toHaveText(["Sunset"]);
  await expect(pictures(page)).toHaveCount(1);
});

test("opens the picker from the shortcut and from the dock's shape menu", async ({ page }) => {
  const picture = await makeImage(page, 60, 60, "#00ff00");
  let chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("ControlOrMeta+Shift+k");
  await (await chooser).setFiles(picture);
  await expect(layers(page)).toHaveCount(1);

  chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "More shape tools" }).click();
  await page.getByRole("menuitem", { name: /Image/ }).click();
  await (await chooser).setFiles(picture);
  await expect(layers(page)).toHaveCount(2);
  // The dock keeps showing the drawing tool that was in use; placing a picture is not a tool.
  await expect(page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: /^Rectangle/ })).toBeVisible();
});

test("places several pictures staggered, and says which files could not be used", async ({ page }) => {
  const first = await makeImage(page, 100, 100, "#ff0000", "one.png");
  const second = await makeImage(page, 100, 100, "#0000ff", "two.png");
  const text: Upload = { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a picture") };
  await placeFromMenu(page, [first, text, second]);

  await expect(layers(page)).toHaveText(["two", "one"]);
  await expect(toast(page)).toContainText("Placed 2 of 3 images");
  await expect(toast(page)).toContainText('"notes.txt" is not a supported image');
  // Staggered, so the second does not sit exactly on the first.
  const [a, b] = await Promise.all([pictures(page).nth(0).boundingBox(), pictures(page).nth(1).boundingBox()]);
  expect(Math.abs(a!.x - b!.x)).toBeGreaterThan(10);

  // Nothing usable at all: nothing is placed and the toast explains.
  await page.getByTestId("toast").getByRole("button", { name: "Dismiss" }).click();
  await placeFromMenu(page, text);
  await expect(toast(page)).toContainText("No image placed");
  await expect(layers(page)).toHaveCount(2);
});

test("shrinks a big picture to fit the view, and stores very large ones at 4096 px", async ({ page }) => {
  await placeFromMenu(page, await makeImage(page, 5000, 3000, "#336699", "huge.png"));
  const width = Number(await props(page).getByLabel("Width", { exact: true }).inputValue());
  const height = Number(await props(page).getByLabel("Height", { exact: true }).inputValue());
  expect(width).toBeLessThan(1000);
  expect(width / height).toBeCloseTo(5 / 3, 1);

  const { project } = await save(page);
  const [asset] = Object.values(project.assets) as { width: number; height: number; mime: string }[];
  expect(asset).toMatchObject({ width: 4096, height: 2458, mime: "image/png" });
});

test("places a dropped file where it lands, with a hint while dragging", async ({ page }) => {
  const picture = await makeImage(page, 100, 60, "#ff00ff", "dropped.png");
  await dropFiles(page, picture, { x: 600, y: 400 }, "over");
  await expect(page.getByTestId("drop-hint")).toBeVisible();
  await dropFiles(page, picture, { x: 600, y: 400 }, "drop");
  await expect(page.getByTestId("drop-hint")).toHaveCount(0);
  await expect(layers(page)).toHaveText(["dropped"]);

  // Centred on the drop point (the canvas starts at the window's left edge plus the sidebar).
  const canvas = (await page.getByTestId("canvas").boundingBox())!;
  const box = (await pictures(page).first().boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - 600)).toBeLessThan(3);
  expect(Math.abs(box.y + box.height / 2 - 400)).toBeLessThan(3);
  expect(canvas.x).toBeLessThan(600);

  // A drag that carries no file shows nothing.
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "hello");
    document.querySelector('[data-testid="canvas"]')!.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(page.getByTestId("drop-hint")).toHaveCount(0);
});

test("pastes a picture from the clipboard, and Ctrl+V still pastes copied layers", async ({ page }) => {
  const picture = await makeImage(page, 80, 50, "#ffaa00", "clip.png");
  await page.evaluate(
    ({ name, mimeType, base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type: mimeType }));
      document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
    },
    { name: picture.name, mimeType: picture.mimeType, base64: picture.buffer.toString("base64") },
  );
  await expect(layers(page)).toHaveText(["clip"]);
  await expect(pictures(page)).toHaveCount(1);

  // Copy and paste of layers goes through the same paste event and still works.
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+v");
  await expect(layers(page)).toHaveCount(2);
  await expect(pictures(page)).toHaveCount(2);

  // Typing in a field keeps the system's text paste: nothing is placed.
  await page.getByTestId("project-name").click();
  await page.getByLabel("Project name").press("ControlOrMeta+v");
  await expect(layers(page)).toHaveCount(2);
});

test("fills a shape with a picture from its colour picker, then changes how it sits and replaces it", async ({ page }) => {
  await page.keyboard.press("r");
  await drag(page, [400, 200], [600, 320]);
  await expect(layers(page)).toHaveText(["Rectangle 1"]);

  const red = await makeImage(page, 50, 50, "#ff0000", "red.png");
  const blue = await makeImage(page, 50, 50, "#0000ff", "blue.png");

  // Fill ▸ colour picker ▸ Image.
  await props(page).getByRole("button", { name: "Fill colour" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("dialog", { name: /colour picker/ }).getByRole("button", { name: "Image", exact: true }).click();
  await (await chooser).setFiles(red);
  await expect(pictures(page)).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: /colour picker/ })).toHaveCount(0);
  await expect(props(page).getByRole("button", { name: "Replace image" })).toContainText("red");
  await expect(pictures(page).first()).toHaveAttribute("preserveAspectRatio", "xMidYMid slice");
  const redHref = await pictures(page).first().getAttribute("href");

  // How it sits in the shape.
  const mode = props(page).getByRole("combobox", { name: "Image scale mode" });
  await mode.click();
  await page.getByRole("option", { name: "Fit" }).click();
  await expect(pictures(page).first()).toHaveAttribute("preserveAspectRatio", "xMidYMid meet");
  await mode.click();
  await page.getByRole("option", { name: "Stretch" }).click();
  await expect(pictures(page).first()).toHaveAttribute("preserveAspectRatio", "none");

  // Replacing keeps the scale mode and opacity.
  const replacing = page.waitForEvent("filechooser");
  await props(page).getByRole("button", { name: "Replace image" }).click();
  await (await replacing).setFiles(blue);
  await expect(props(page).getByRole("button", { name: "Replace image" })).toContainText("blue");
  await expect(pictures(page).first()).not.toHaveAttribute("href", redHref!);
  await expect(pictures(page).first()).toHaveAttribute("preserveAspectRatio", "none");

  // Take it away again: the shape has no fill, and the whole change history is undoable.
  await props(page).getByRole("button", { name: "Remove fill" }).click();
  await expect(pictures(page)).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(pictures(page)).toHaveCount(1);
});

test("keeps pictures in the project file, reopens them, and exports them", async ({ page }) => {
  await placeFromMenu(page, await makeImage(page, 40, 40, "#ff0000", "Red square.png"));
  await expect(layers(page)).toHaveText(["Red square"]);

  const first = await save(page);
  expect(first.project.schemaVersion).toBe(3);
  const stored = Object.values(first.project.assets) as { name: string; url: string; width: number }[];
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ name: "Red square", width: 40 });
  expect(stored[0]!.url).toMatch(/^data:image\/png;base64,/);

  // Pictures nothing uses any more are not written.
  await page.keyboard.press("Delete");
  await expect(layers(page)).toHaveCount(0);
  const second = await save(page);
  expect(second.project.assets).toEqual({});

  // Open the first file again: the picture is back, drawn from the file's own bytes.
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: /New project/ }).click();
  await expect(pictures(page)).toHaveCount(0);
  const opening = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: /Open/ }).click();
  await (await opening).setFiles({ name: "Pictures.drafiqo", mimeType: "application/json", buffer: await readFile(first.path) });
  await expect(layers(page)).toHaveText(["Red square"]);
  await expect(pictures(page)).toHaveCount(1);

  // Exporting draws the picture into the file.
  await page.getByTestId("layers").getByText("Red square").click();
  await page.keyboard.press("ControlOrMeta+Shift+e");
  const dialog = page.getByRole("dialog", { name: "Export" });
  await expect(dialog).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await dialog.getByRole("button", { name: /^Export PNG$/ }).click();
  const png = await readFile(await (await downloaded).path());
  const pixel = await page.evaluate(
    async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return { size: [image.width, image.height], rgba: [...context.getImageData(20, 20, 1, 1).data] };
    },
    png.toString("base64"),
  );
  expect(pixel).toEqual({ size: [40, 40], rgba: [255, 0, 0, 255] });
});

test("stores a picture once however many layers use it", async ({ page }) => {
  const picture = await makeImage(page, 30, 30, "#123456", "same.png");
  await placeFromMenu(page, picture);
  await placeFromMenu(page, picture);
  await expect(layers(page)).toHaveCount(2);

  const { project } = await save(page);
  expect(Object.keys(project.assets)).toHaveLength(1);
  const nodes = Object.values(project.pages[0].nodes) as { fills: { assetId: string }[] }[];
  expect(new Set(nodes.map((n) => n.fills[0]!.assetId)).size).toBe(1);
});

test("a vector PDF says it leaves pictures out, and an image PDF keeps them", async ({ page }) => {
  await page.keyboard.press("f");
  await drag(page, [300, 100], [900, 600]);
  await placeFromMenu(page, await makeImage(page, 60, 60, "#00aa00", "inside.png"));
  await expect(scene(page).locator('[data-node-type="frame"] image')).toHaveCount(1);
  await page.getByTestId("layers").getByText("Frame 1").click();

  await page.keyboard.press("ControlOrMeta+Shift+e");
  const dialog = page.getByRole("dialog", { name: "Export" });
  await dialog.getByRole("button", { name: "PDF", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await dialog.getByRole("button", { name: /^Export PDF$/ }).click();
  await downloaded;
  await expect(toast(page)).toContainText("Images are not included in a vector PDF");
  await toast(page).getByRole("button", { name: "Dismiss" }).click();

  // As an image, the PDF holds a picture of the whole artwork, so nothing is left out.
  await page.keyboard.press("ControlOrMeta+Shift+e");
  await dialog.getByRole("button", { name: "PDF", exact: true }).click();
  await dialog.getByRole("button", { name: "Image", exact: true }).click();
  const imageDownload = page.waitForEvent("download");
  await dialog.getByRole("button", { name: /^Export PDF$/ }).click();
  const pdf = (await readFile(await (await imageDownload).path())).toString("latin1");
  expect(pdf).toContain("/Filter /DCTDecode");
  await expect(toast(page)).toContainText("Exported Frame 1.pdf");
  await expect(toast(page)).not.toContainText("not included");
});

test("puts a picture inside the frame it lands on, and leaves one dropped beside it on the page", async ({ page }) => {
  await page.keyboard.press("f");
  await drag(page, [400, 200], [800, 500]);
  const picture = await makeImage(page, 100, 60, "#ff0000", "inside.png");

  await dropFiles(page, picture, { x: 600, y: 350 }, "drop");
  await expect(scene(page).locator('[data-node-type="frame"] [data-node-type="rectangle"] image')).toHaveCount(1);

  await dropFiles(page, { ...picture, name: "outside.png" }, { x: 1000, y: 700 }, "drop");
  await expect(pictures(page)).toHaveCount(2);
  // Only the first is a child of the frame.
  await expect(scene(page).locator('[data-node-type="frame"] image')).toHaveCount(1);
  await expect(page.getByTestId("layers").getByText("outside")).toBeVisible();

  // Its position is kept in page terms: it still sits where it was dropped, now relative to the frame.
  const box = (await scene(page).locator('[data-node-type="frame"] image').first().boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - 600)).toBeLessThan(3);
  expect(Math.abs(box.y + box.height / 2 - 350)).toBeLessThan(3);
});
