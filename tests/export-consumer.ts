import { expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { unzipSync } from "fflate";

// Use the downloaded archive, never the workspace runtime imports. The test
// consumer has its own React root and follows the ZIP's independent-page advice.
export async function openExportConsumer(page: Page, screen = "widgets") {
  const created = await page.request.post("/api/projects", {
    data: { brief: { name: "Export consumer" }, useTaste: false },
  });
  expect(created.ok()).toBe(true);
  const project = await created.json();
  const exported = await page.request.post(
    `/api/projects/${project.id}/exports`,
    {
      data: { baseRevision: 1, bundle: true, imageMode: "omit" },
    },
  );
  expect(exported.ok()).toBe(true);
  const record = await exported.json();
  const zipName = Object.keys(record.files).find((name) =>
    name.endsWith(".zip"),
  )!;
  const downloaded = await page.request.get(
    `/api/projects/${project.id}/exports/${record.id}/${zipName}`,
  );
  expect(downloaded.ok()).toBe(true);
  const entries = unzipSync(await downloaded.body());
  const directory = `test-results/export-consumer-${project.id}`;
  for (const [path, bytes] of Object.entries(entries)) {
    const relative = path.split("/").slice(1).join("/");
    const destination = join(directory, relative);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
  }
  writeFileSync(
    `${directory}/client.tsx`,
    `import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Button,Input,Select,RuntimeTabs,RuntimeDialog,RuntimeTheme,ComponentSpecimen,ListPage,SettingsPage,FormPage} from './ui';
import {design} from './ui/design';
function Consumer() {
  const [submits,setSubmits]=useState(0), [open,setOpen]=useState(false), [disabled,setDisabled]=useState(false), [view,setView]=useState('All projects');
  return <RuntimeTheme design={design}><main style={{padding:16,minWidth:0,width:'100%'}}>
    <h1>Independent form consumer</h1>
    <form aria-label="Consumer form" onSubmit={e=>{e.preventDefault();setSubmits(n=>n+1)}}>
      <label>Name<Input required defaultValue="日本語プロジェクト" data-component="Input" /></label>
      <label>Status<Select data-component="Select"><option>Planned</option><option>Done</option></Select></label>
      <label><Input type="checkbox" defaultChecked data-component="Checkbox" />Notify me</label>
      <label><input type="checkbox" checked={disabled} onChange={e=>setDisabled(e.target.checked)} />Disable tabs</label>
      <RuntimeTabs disabled={disabled} onChange={setView} />
      <output aria-label="Selected view">{view}</output>
      <Button type="button" data-component="Button" onClick={()=>setOpen(true)}>Open confirmation</Button>
      <RuntimeDialog open={open} close={()=>setOpen(false)}><label>Confirmation note<Input defaultValue="Keep my draft" /></label></RuntimeDialog>
      {screen==='specimen' && <ComponentSpecimen design={design} name="Dialog"/>}
      <Button type="submit" data-component="Button">Save form</Button>
      <output aria-label="Submit count">{submits}</output>
    </form>
  </main></RuntimeTheme>;
}
const screen=new URL(import.meta.url).searchParams.get('screen');
const Page=screen==='list'?ListPage:screen==='settings'?SettingsPage:screen==='form'?FormPage:Consumer;
createRoot(document.getElementById('consumer-root')!).render(<Page/>);
document.documentElement.dataset.consumerReady='true';
`,
  );
  // setContent keeps this page outside the Tasteprint application root.
  await page.goto("/preview-render");
  await page.setContent(
    `<!doctype html><html lang="en"><head><title>Export consumer</title></head><body><div id="consumer-root"></div><script type="module" src="/${directory}/client.tsx?screen=${screen}"></script></body></html>`,
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-consumer-ready",
    "true",
  );
  return { project, record, directory };
}
