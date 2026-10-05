# Legacy Reference image media types

Issue #126: Browser migration retains original PNG/JPEG/WebP asset bytes. The Reference image endpoint and newly frozen image URI previously always declared PNG. Actual browser-import/HTTP/decode/snapshot probes confirmed that JPEG/WebP declarations differed from their bytes. Chromium displayed the images; this is a media declaration correction, not a claim of browser rendering failure.

| Actual bytes | Previous declaration | New declaration |
| --- | --- | --- |
| PNG | image/png | image/png |
| JPEG | image/png | image/jpeg |
| WebP | image/png | image/webp |

The shared server helper recognizes JPEG and RIFF/WEBP headers with exact byte comparisons. Other bytes retain the existing PNG fallback. This does not introduce a decoder, import rejection policy, re-encoding, asset rewrite or network request. Ordinary uploads still produce PNG and keep the PNG declaration.

The image endpoint changes its Content-Type while returning the same bytes. Newly imported or explicitly saved snapshots use the matching data URI prefix. Existing immutable revisions/snapshots are left intact, including historical PNG labels. Raw import JSON, backups, reference rows, asset bytes and modification times remain unchanged. Internal asset filenames and Codex image staging are unchanged; real SDK/AI execution is outside this verification.

Seven unit cases cover pre-fix SQLite snapshots across restart, exact HTTP bodies and media types, explicit new save, old raw revision rows, import/backup bytes, asset modification times, idempotent re-import, three upload formats normalized to PNG, and unknown/truncated/high-bit headers keeping their prior fallback. Six Chromium cases cover three actual formats at 1440/390px, rendering and dimensions, byte equality, image URI prefix, ordinary Foundation save, old history and repeat import. All use temporary isolated SQLite and Mock dependencies.

Initial browser checks exposed test setup errors: the mobile navigation menu needed to be opened, and a shared legacy Project already contained the test's fixed accent value. The tests now follow the menu and choose an actual change relative to the current revision. Failure/interruption traces are retained outside the repository. Production behavior was not relaxed.

PR #125's human-review-pending metadata controls are separate and are not included in this change.
