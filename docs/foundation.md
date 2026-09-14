# Foundation editing and revisions (Issue #2)

> Issue #9以降、共通の好みとプロジェクトの保存先・ルートを分離しています。現行の操作・API・移行手順は [projects.md](projects.md) を参照してください。以下の旧グローバルAPI・localStorageの記述は移行前の説明です。
Foundation now has eight editable groups: semantic colors; typography families, heading levels, line height and weights; spacing scale and layout dimensions; named radii and usage; border width/color/policy; shadow geometry/color/opacity/allowed uses; motion; and breakpoints with responsive policies.

## Workflow

1. Pair in Inspiration with the startup terminal code, then open Foundation. Existing six-value browser settings are imported only if the server has no Foundation revision. Existing server data always wins.
2. Edit values to stage them in Preview. Each field has an AI lock and editable scope, exceptions, rationale and source. A lock restricts AI; the user can still change or unlock it manually.
3. Choose **変更を保存** to create one revision for the entire edit. **未保存の変更を取り消す** discards the draft; the top undo button undoes individual draft edits.
4. Ask the companion after saving. It sends the confirmed Foundation (including rules and sources) and request to Codex using the existing ChatGPT file-authentication gateway. Up to three candidates can be selected in Preview. Adoption applies the stored candidate ID; dismissing never changes the revision.
5. Expand confirmed history to restore any revision as a new revision. JSON, Markdown and CSS export use the confirmed Foundation, excluding draft values and unadopted candidates. JSON and Markdown include provenance of the latest revision's changes.

## Storage and validation

The existing `references.sqlite` database now also contains `foundation_revisions`, `foundation_proposals` and `foundation_requests`. Revisions contain `schemaVersion: 2`, the complete validated `design`, per-field `constraints`, revision number, timestamp, reason and change decisions. Foundation and reference records share the same database but have independent revision lifecycles. Other workspace data (Taste answers, etc.) remains in browser storage; this is not a complete multi-project DesignSystem implementation.

Browser state version 1 migrates to version 2 at the read boundary. `tasteprint.workspace.v3` reads the prior `tasteprint.workspace.v2` or `tasteprint.mock.v1` if necessary; the original storage keys are retained. All six legacy selections are preserved. Missing new values get explicit defaults independent of Taste scores. The server initialization endpoint never overwrites existing revisions.

The shared Zod schema rejects unknown fields, invalid colors/fonts, out-of-range dimensions/motion/weights, nonascending spacing/breakpoint values and inverted heading sizes. Invalid input stays out of Preview and cannot be saved. Saves and restores use request IDs for idempotence. Transactions atomically create revisions and update proposal adoption status; stale base revisions return 409.

Codex's structured output allows only patches to unlocked token paths. It cannot return edits to the rule metadata. The server validates complete candidate designs and locks after generation and independently at adoption. The request body for adoption only accepts a stored proposal ID; client values and client-supplied locks are not trusted. A revision changed while generation was running invalidates the result. Requests time out after 120 seconds and do not automatically retry. All Foundation routes live under `/api/references/foundation`, inheriting session pairing, Host/Origin checks and body limits.

## Preview and output scope

Preview and CSS export share `designVariables`. Semantic colors, typography, dimensions, borders, shadow, transition duration/easing and reduced-motion behavior drive the sample renderer. A ResizeObserver uses the actual sample width and user breakpoints to choose compact/medium/regular/wide layouts. Token scales and named variants are also available in CSS for consumers. All three sample screens share the settings.

Scope, exceptions, radius usage, border policy, permitted shadow targets and responsive policies are stored design instructions and Codex context, not executable CSS prose. The bundled renderer uses its predefined layout and component implementation; it does not execute arbitrary policy text. Floating shadows and heading levels not present in a particular sample remain available as output tokens. DTCG conversion, generated React/ZIP output, complete rule interpretation and whole-project revisions are separate work.

## Verification

- Unit/integration: migration, validation, persistence across database reopen, restore, idempotence, conflicts, generation-time lock checks, independently enforced adoption locks, tampered candidates, authenticated routing, and SDK text-only structured patches excluding locked paths.
- Browser: manual edits, candidate comparison/adoption, locks and rationale, reload, draft undo, revision restore, export, existing reference workflow, and narrow layout.
- Built smoke: production SPA/assets, pairing, Foundation initialization/save, and existing URL protection.

Automated tests inject a deterministic Codex implementation or mock the SDK. No real account generation is performed by the test suite.
