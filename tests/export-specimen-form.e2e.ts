import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { downloadExportConsumer } from "./export-consumer";

test("downloaded Button specimen does not submit its consumer form", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const { directory } = await downloadExportConsumer(page);
  writeFileSync(
    `${directory}/specimen-form.tsx`,
    `import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {ComponentSpecimen,RuntimeTheme} from './ui';import {design} from './ui/design';
function Consumer(){const[count,setCount]=useState(0);return <RuntimeTheme design={design}>
<form aria-label="Consumer form" onSubmit={e=>{e.preventDefault();setCount(n=>n+1)}}>
<ComponentSpecimen design={design} name="Button"/>
<button type="submit">Actual submit</button>
<output aria-label="Consumer submits">{count}</output>
</form></RuntimeTheme>}
createRoot(document.getElementById('root')!).render(<Consumer/>);`,
  );
  writeFileSync(
    `${directory}/specimen-form.html`,
    `<!doctype html><html><head><title>Button specimen consumer</title></head><body><div id="root"></div><script type="module" src="/${directory}/specimen-form.tsx"></script></body></html>`,
  );
  await page.goto(`/${directory}/specimen-form.html`);
  const submits = page.getByLabel("Consumer submits");
  await expect(submits).toHaveText("0");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(submits).toHaveText("0");
  await page
    .getByRole("combobox", { name: "表示状態" })
    .selectOption("loading");
  await page.getByRole("button", { name: "Saving…" }).press("Enter");
  await expect(submits).toHaveText("0");
  await page.getByRole("button", { name: "Actual submit" }).click();
  await expect(submits).toHaveText("1");
  expect(
    (await (await page.request.get("/api/health")).json()).codexCalls,
  ).toBe(0);
});
