# Late project creation list reconciliation

Issue #142. On main `b87a13c`, a real creation POST was committed while its reply was held. After Back to Profile, return to Projects and a newer unsent draft, the late success preserved both draft keys (PR141) but omitted the committed project from the cached list and its name search. Both 1440/390px UI regressions failed. The database still contained the project; reload recovered it, and focus/reconnection may also refresh it. This was list/restart inconsistency, not data loss.

Only the unmounted creation screen branch now invalidates the exact shared `projects` query and returns. Its active observer reads the current server collection. No stale creation DTO is inserted into the cache, so the old reply does not restore its old archive state, metadata, revision or Export summary. Existing cancellation/order protections remain in use. The old handler returns after this asynchronous read and never cleans a new draft or navigates it. Current-instance creation and unknown-result/candidate/resend behavior are unchanged.

The existing lifetime regression now covers both widths and successful/failed collection refresh. It checks newer form values and both storage keys, one original POST, immediate name search and row resume without reload, unique row identity, GET-only recovery after refresh failure, returning to the newer draft, and explicit normal second creation with cleanup/navigation. Mock AI and temporary SQLite only, real Codex calls 0.

Adjacent update/archive/unarchive/Overview/Export response handling was reviewed with existing Issues #47/#77/#107 and their tests. No additional concrete adjacent bug was found. Authentication, naming, AI protection and existing immutable records are unchanged.
