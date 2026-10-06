# Project creation reply lifetime (Issue #140)

A successful create reply could arrive after browser Back unmounted its ProjectList. If the user reopened Projects and entered another draft, the old handler deleted both creation storage keys and hard-navigated to the already committed project. A real POST with only its reply delayed reproduced the lost newer draft and unwanted navigation on main.

ProjectList now checks its own mounted lifetime after validating the successful reply and before synchronous cleanup/navigation. An unmounted instance skips those browser effects. The committed project remains in SQLite and is available through the normal list/resume path after an ordinary reload. A current instance still performs its existing successful cleanup and navigation. Cached list refresh behavior is unchanged.

The effect sets the ref true on setup and false on cleanup, including StrictMode effect replay. No request cancellation, rollback, automatic resend, unknown-result persistence or server/API behavior is added. Naming policy, authentication, AI protection and confirmed revisions are unchanged.

Two browser regressions cover 1440/390px: actual committed POST, delayed receipt, Back/reentry, different name and use-Taste draft, no stale redirect or storage deletion, one committed original project, and ordinary successful creation from the newer dialog with cleanup. Fixtures use Mock AI and temporary SQLite; real Codex calls remain zero.
