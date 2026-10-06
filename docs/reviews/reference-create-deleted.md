# Delayed initial Reference reply after deletion

Issue #144: a Project URL/image create can commit while its initial receipt is delayed. A collection read reveals it, Foundation/Inspiration navigation remounts References, and an ordinary delete removes it. The late receipt used to append that deleted ID again; a failed collection read retained the ghost card although SQLite no longer contained it.

Observe IDs only in the exact scope cache while the initial POST/receipt commit is pending, and unsubscribe in `finally` on success or failure. If that ID has appeared and the current collection now omits it, preserve the absence. An initial create that was never observed may still insert its receipt. Keep newer versions, other references/jobs, the existing unknown-result handling and follow-up failure behavior.

Four Mock/temporary-SQLite browser cases cover URL/image entry at 1440/390px: genuine commit and read, ordinary navigation/delete, late receipt with GET503, retained draft bytes and unrelated Reference/job, GET-only retry and reload. The baseline URL probe reproduced one ghost card with POST1/DELETE1 and real Codex calls 0. Existing initial-response, unknown-result, newer-version and deleted-read regressions cover related behavior.
