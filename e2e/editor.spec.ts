import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const scene = (page: Page) => page.locator("[data-scene]");
const nodes = (page: Page, type: string) => scene(page).locator(`[data-node-type="${type}"]`);
const field = (page: Page, name: string) => page.getByTestId("properties").getByLabel(name, { exact: true });
const layers = (page: Page) => page.getByTestId("layers").locator("li");

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(to[0], to[1], { steps: 4 });
  await page.mouse.up();
}

async function draw(page: Page, key: string, from: [number, number], to: [number, number]) {
  await page.keyboard.press(key);
  await drag(page, from, to);
}

async function setField(page: Page, name: string, value: string) {
  await field(page, name).fill(value);
  await field(page, name).press("Enter");
}

/** Editing starts with all text selected; put the caret at the end instead. */
async function caretToEnd(page: Page) {
  await page.locator("[data-text-editor]").evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("canvas")).toBeVisible();
});

test("draws a shape and edits it from the canvas and the properties panel", async ({ page }) => {
  await draw(page, "r", [400, 200], [600, 350]);
  await expect(nodes(page, "rectangle")).toHaveCount(1);
  await expect(field(page, "Width")).toHaveValue("200");
  await expect(field(page, "Height")).toHaveValue("150");
  await expect(layers(page)).toHaveText(["Rectangle 1"]);

  // Move by dragging the shape itself.
  const x = Number(await field(page, "X position").inputValue());
  await drag(page, [500, 275], [560, 315]);
  await expect(field(page, "X position")).toHaveValue(String(x + 60));

  // Resize with the bottom-right handle (the shape now spans 460,240 → 660,390).
  await drag(page, [660, 390], [710, 420]);
  await expect(field(page, "Width")).toHaveValue("250");
  await expect(field(page, "Height")).toHaveValue("180");

  // Rotate with the knob above the shape: a quarter turn clockwise.
  const box = (await page.locator("[data-rotate]").boundingBox())!;
  await drag(page, [box.x + box.width / 2, box.y + box.height / 2], [585 + 300, 330]);
  await expect(field(page, "Rotation")).toHaveValue("90°");

  // The panel edits the same document the canvas draws.
  await setField(page, "Rotation", "0");
  await setField(page, "Fill hex", "ff0000");
  await setField(page, "Corner radius", "12");
  await setField(page, "Opacity", "50");
  const rect = nodes(page, "rectangle").locator("rect").first();
  await expect(rect).toHaveAttribute("fill", "#ff0000");
  await expect(rect).toHaveAttribute("rx", "12");
  await expect(nodes(page, "rectangle")).toHaveAttribute("opacity", "0.5");
});

test("undoes and redoes edits step by step", async ({ page }) => {
  await draw(page, "r", [400, 200], [500, 300]);
  await draw(page, "o", [600, 200], [700, 300]);
  await setField(page, "Width", "300");
  await expect(nodes(page, "ellipse").locator("ellipse").first()).toHaveAttribute("rx", "150");

  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(nodes(page, "ellipse").locator("ellipse").first()).toHaveAttribute("rx", "50");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(nodes(page, "ellipse")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(nodes(page, "rectangle")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Undo/ })).toBeDisabled();

  await page.keyboard.press("ControlOrMeta+Shift+z");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(nodes(page, "rectangle")).toHaveCount(1);
  await expect(nodes(page, "ellipse")).toHaveCount(1);
});

test("nests shapes drawn inside a frame and organises them in the layer tree", async ({ page }) => {
  await draw(page, "f", [350, 150], [850, 650]);
  await draw(page, "r", [400, 200], [500, 300]);
  await draw(page, "o", [550, 200], [650, 300]);
  await expect(nodes(page, "frame").locator('[data-node-type="rectangle"]')).toHaveCount(1);
  await expect(layers(page)).toHaveText(["Frame 1", "Ellipse 1", "Rectangle 1"]);
  // Positions are relative to the frame.
  await page.getByTestId("layers").getByText("Rectangle 1").click();
  await expect(field(page, "X position")).toHaveValue("50");

  // Rename, hide and lock from the layers panel.
  await page.getByTestId("layers").getByText("Rectangle 1").dblclick();
  await page.getByLabel("Layer name").fill("Card");
  await page.getByLabel("Layer name").press("Enter");
  await expect(layers(page)).toHaveText(["Frame 1", "Ellipse 1", "Card"]);
  const row = layers(page).filter({ hasText: "Card" });
  await row.hover();
  await row.getByLabel("Hide").click();
  await expect(nodes(page, "rectangle")).toHaveCount(0);
  await row.getByLabel("Show").click();
  await expect(nodes(page, "rectangle")).toHaveCount(1);

  // Group the two shapes, then reorder and ungroup with shortcuts.
  await page.getByTestId("layers").getByText("Ellipse 1").click({ modifiers: ["ControlOrMeta"] });
  await page.keyboard.press("ControlOrMeta+g");
  await expect(layers(page)).toHaveText(["Frame 1", "Group 1", "Ellipse 1", "Card"]);
  await page.keyboard.press("ControlOrMeta+Shift+g");
  await expect(layers(page)).toHaveText(["Frame 1", "Ellipse 1", "Card"]);
  await page.getByTestId("layers").getByText("Card").click();
  await page.keyboard.press("]");
  await expect(layers(page)).toHaveText(["Frame 1", "Card", "Ellipse 1"]);

  // Duplicate and delete.
  await page.keyboard.press("ControlOrMeta+d");
  await expect(nodes(page, "rectangle")).toHaveCount(2);
  await page.keyboard.press("Backspace");
  await expect(nodes(page, "rectangle")).toHaveCount(1);

  // Dragging a shape out of the frame moves it to the top level.
  await drag(page, [450, 250], [1000, 250]);
  await expect(nodes(page, "frame").locator('[data-node-type="rectangle"]')).toHaveCount(0);
  await expect(layers(page)).toHaveText(["Card", "Frame 1", "Ellipse 1"]);
});

test("creates and edits text", async ({ page }) => {
  await page.keyboard.press("t");
  await page.mouse.click(450, 300);
  const editor = page.locator("[data-text-editor]");
  await expect(editor).toBeFocused();
  await page.keyboard.type("Hello Drafiqo");
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(nodes(page, "text").locator("tspan")).toHaveText(["Hello Drafiqo"]);

  // Typing shortcuts while editing must not trigger tools or delete the layer.
  await page.mouse.dblclick(470, 300);
  await expect(editor).toBeFocused();
  await caretToEnd(page);
  await page.keyboard.type(" rv");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Escape");
  await expect(nodes(page, "text").locator("tspan")).toHaveText(["Hello Drafiqo r"]);
  await expect(nodes(page, "rectangle")).toHaveCount(0);

  await setField(page, "Font size", "32");
  await expect(nodes(page, "text").locator("text")).toHaveAttribute("font-size", "32");
  await field(page, "Font weight").click();
  await page.getByRole("option", { name: "Bold", exact: true }).click();
  await expect(nodes(page, "text").locator("text")).toHaveAttribute("font-weight", "700");

  // The whole editing session is one undo step; creation is another.
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(nodes(page, "text").locator("tspan")).toHaveText(["Hello Drafiqo"]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(nodes(page, "text")).toHaveCount(0);

  // Text left empty is discarded without leaving history behind.
  await page.keyboard.press("t");
  await page.mouse.click(450, 300);
  await page.keyboard.press("Escape");
  await expect(nodes(page, "text")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Undo/ })).toBeDisabled();
});

test("keeps separate content on each page", async ({ page }) => {
  await draw(page, "r", [400, 200], [500, 300]);
  await page.getByLabel("Add page").click();
  await expect(page.getByTestId("pages").locator("li")).toHaveText(["Page 1", "Page 2"]);
  await expect(nodes(page, "rectangle")).toHaveCount(0);
  await draw(page, "o", [400, 200], [500, 300]);
  await page.getByTestId("pages").getByText("Page 1").click();
  await expect(nodes(page, "rectangle")).toHaveCount(1);
  await expect(nodes(page, "ellipse")).toHaveCount(0);
});

test("saves a .drafiqo project and reopens it with everything still editable", async ({ page }) => {
  await draw(page, "f", [350, 150], [850, 650]);
  await draw(page, "r", [400, 200], [500, 300]);
  await setField(page, "Fill hex", "00aa55");
  await page.keyboard.press("t");
  await page.mouse.click(420, 400);
  await page.keyboard.type("Saved text");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("save-status")).toHaveText("Unsaved changes");

  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+s");
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Untitled.drafiqo");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  const path = await download.path();
  const saved = JSON.parse(await readFile(path, "utf8"));
  expect(saved.format).toBe("drafiqo");
  expect(saved.schemaVersion).toBe(3);
  expect(Object.keys(saved.pages[0].nodes)).toHaveLength(3);

  // Start over, then open the file that was just written.
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: /New project/ }).click();
  await expect(scene(page).locator("[data-node-id]")).toHaveCount(0);

  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: /Open/ }).click();
  await (await chooserPromise).setFiles({ name: "My design.drafiqo", mimeType: "application/json", buffer: await readFile(path) });

  await expect(page.getByTestId("project-name")).toHaveText("My design");
  await expect(layers(page)).toHaveText(["Frame 1", "Text 1", "Rectangle 1"]);
  await expect(nodes(page, "text").locator("tspan")).toHaveText(["Saved text"]);
  await expect(nodes(page, "frame").locator('[data-node-type="rectangle"] rect').first()).toHaveAttribute("fill", "#00aa55");
  await expect(page.getByTestId("save-status")).toHaveText("Not saved yet");

  // Reopened content is live document data, not a picture of it.
  await page.getByTestId("layers").getByText("Rectangle 1").click();
  await setField(page, "Width", "240");
  await expect(nodes(page, "rectangle").locator("rect").first()).toHaveAttribute("width", "240");
  await page.mouse.dblclick(440, 400);
  await caretToEnd(page);
  await page.keyboard.type("!");
  await page.keyboard.press("Escape");
  await expect(nodes(page, "text").locator("tspan")).toHaveText(["Saved text!"]);
  await expect(page.getByTestId("save-status")).toHaveText("Unsaved changes");
});

test("refuses a damaged project file and keeps the current document", async ({ page }) => {
  await draw(page, "r", [400, 200], [500, 300]);
  await page.keyboard.press("ControlOrMeta+s");
  page.once("dialog", (dialog) => void dialog.accept());
  const messages: string[] = [];
  page.on("dialog", (dialog) => messages.push(dialog.message()));

  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: /Open/ }).click();
  await (await chooserPromise).setFiles({ name: "broken.drafiqo", mimeType: "application/json", buffer: Buffer.from('{"format":"drafiqo","schemaVersion":1,"pages":[]}') });
  await expect.poll(() => messages.join("\n")).toContain("at least one page");
  await expect(nodes(page, "rectangle")).toHaveCount(1);
});

test("renames a frame by double-clicking its name on the canvas", async ({ page }) => {
  await draw(page, "f", [400, 250], [700, 450]);
  const label = page.locator("[data-label-id]").first();
  const editor = page.getByLabel("Frame name");
  await expect(label).toHaveText("Frame 1");

  await label.dblclick();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("Frame 1");
  // Typing letters edits the name; it does not switch tools.
  await page.keyboard.type("Hero rofl");
  await page.keyboard.press("Enter");
  await expect(editor).toHaveCount(0);
  await expect(label).toHaveText("Hero rofl");
  await expect(layers(page)).toHaveText(["Hero rofl"]);

  // Escape and an empty name both keep the current name.
  await label.dblclick();
  await page.keyboard.type("Discarded");
  await page.keyboard.press("Escape");
  await expect(label).toHaveText("Hero rofl");
  await label.dblclick();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Enter");
  await expect(label).toHaveText("Hero rofl");

  // Clicking away keeps what was typed, and the rename is one undo step.
  await label.dblclick();
  await page.keyboard.type("Landing");
  await page.mouse.click(1000, 700);
  await expect(label).toHaveText("Landing");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(label).toHaveText("Hero rofl");
});

test("renames the project by clicking its name", async ({ page }) => {
  const name = page.getByTestId("project-name");
  const input = page.getByLabel("Project name");
  await expect(name).toHaveText("Untitled");

  await name.click();
  await expect(input).toBeFocused();
  await input.fill("Landing page");
  await input.press("Enter");
  await expect(name).toHaveText("Landing page");
  // Renaming is not an edit to the design.
  await expect(page.getByTestId("save-status")).toHaveText("Not saved yet");
  await expect(page.getByRole("button", { name: /^Undo/ })).toBeDisabled();

  // Escape and an empty name both leave it alone; typing there does not trigger tools.
  await name.click();
  await input.fill("rrr");
  await input.press("Escape");
  await expect(name).toHaveText("Landing page");
  await name.click();
  await input.fill("   ");
  await input.press("Enter");
  await expect(name).toHaveText("Landing page");
  await expect(page.getByRole("button", { name: /^Select/ })).toHaveAttribute("aria-pressed", "true");

  // Names that cannot be file names are refused with a reason.
  const messages: string[] = [];
  page.on("dialog", (dialog) => {
    messages.push(dialog.message());
    void dialog.accept();
  });
  await name.click();
  await input.fill("a/b");
  await input.press("Enter");
  await expect.poll(() => messages.join()).toContain("cannot contain");
  await expect(name).toHaveText("Landing page");

  // The new name is what the project is saved as.
  await draw(page, "r", [400, 200], [500, 300]);
  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+s");
  expect((await downloadPromise).suggestedFilename()).toBe("Landing page.drafiqo");
  await expect(name).toHaveText("Landing page");
});

test("picks tools from the dock, including flyouts and the hand tool", async ({ page }) => {
  const dock = page.getByRole("toolbar", { name: "Tools" });

  // A grouped button offers its other tools in a flyout and remembers the choice.
  await dock.getByRole("button", { name: "More shape tools" }).click();
  await page.getByRole("menuitem", { name: /Ellipse/ }).click();
  await expect(dock.getByRole("button", { name: /^Ellipse/ })).toHaveAttribute("aria-pressed", "true");
  await drag(page, [400, 200], [500, 300]);
  await expect(nodes(page, "ellipse")).toHaveCount(1);
  // Drawing returns to Select; the shape button still shows the ellipse.
  await expect(dock.getByRole("button", { name: /^Select/ })).toHaveAttribute("aria-pressed", "true");
  await dock.getByRole("button", { name: /^Ellipse/ }).click();
  await drag(page, [600, 200], [700, 300]);
  await expect(nodes(page, "ellipse")).toHaveCount(2);

  // A shortcut for another tool in the group updates the button too.
  await page.keyboard.press("r");
  await expect(dock.getByRole("button", { name: /^Rectangle/ })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  // The hand tool pans the canvas without selecting or moving anything.
  await page.getByTestId("layers").getByText("Ellipse 1").click();
  const x = await field(page, "X position").inputValue();
  const before = (await nodes(page, "ellipse").first().boundingBox())!;
  await page.keyboard.press("h");
  await expect(dock.getByRole("button", { name: /^Hand/ })).toHaveAttribute("aria-pressed", "true");
  await drag(page, [450, 250], [520, 310]);
  const after = (await nodes(page, "ellipse").first().boundingBox())!;
  expect(Math.round(after.x - before.x)).toBe(70);
  expect(Math.round(after.y - before.y)).toBe(60);
  await expect(field(page, "X position")).toHaveValue(x);
  await expect(page.getByRole("button", { name: /^Undo/ })).toBeEnabled();
  await page.keyboard.press("v");
  await expect(dock.getByRole("button", { name: /^Select/ })).toHaveAttribute("aria-pressed", "true");
});
