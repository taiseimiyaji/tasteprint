# Reused widget ARIA ownership

Issue #134 concerns two exported RuntimeTabs or RuntimeDialog instances within one React root on an independent application page. Fixed tab/panel/title IDs collide; actual React SSR plus Chromium confirms the second Tabs' controls and label resolve outside its instance. The current workspace's separate Preview iframes do not reproduce that collision.

Each widget now calls React useId at its top level and shares that ID among its own related elements. Visible content, props, styling, selection, keyboard handlers and dialog behavior stay the same. Independent React roots still require the caller's identifierPrefix configuration; this change does not guarantee arbitrary mixing of exported pages or template CSS.

Two permanent E2E cases use the same real fixture for SSR and Vite hydration at 1440/390px. They verify unique and hydration-stable IDs, own tab/panel/title references, independent tab selection, arrow-key focus and both Dialogs' native open/close paths. SSR runs through a normal Node/tsx loader because Playwright's imported JSX is serialized for component testing. Fixture files belong only to tests.

The shared Library source is included in new portable ZIPs, so the template advances from preview-6 to preview-7. A seeded frozen preview-6 ZIP with the former fixed-ID behavior remains byte-for-byte unchanged, as do its export row and Foundation history; a new export includes the current Library source and is reused on repeated requests. Existing portable React typecheck and built PNG/ZIP smoke also remain in place.

All validation uses local Chromium, Mock gateways and temporary SQLite. No real AI, external hosting, user data migration or authentication change is involved.
