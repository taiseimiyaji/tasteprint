# Distinct same-URL browser References

Issue #138 concerns distinct legacy Reference IDs sharing a URL within one browser migration payload. Legacy and current Reference creation permit this: different observations or selected aspects can refer to the same page. The importer previously matched later entries against rows it had just inserted, so one record and its adopted findings were omitted even in a fresh workspace. The original JSON backup was still retained, but the import was marked complete.

For new imports, URL matching now uses only nonempty URLs stored before processing that payload. Original and imported ID matching still includes newly inserted rows, so repeated IDs remain deduplicated. Existing SQLite URL matches retain the existing record and its notes. Distinct incoming IDs sharing a newly introduced URL keep their own order, selected aspects and adopted findings in both live rows and the frozen revision.

Two unit cases exercise fresh and pre-existing SQLite migration, repeated IDs, empty and distinct URLs, adopted evidence, saved radius priority, original backup bytes, old row IDs and revision data, and identical-payload replay across restart. Both fail on the previous implementation due to the omitted second record. Two browser cases use actual localStorage migration at 1440/390px, showing both cards and their separate accepted findings, then checking API replay/reload, original browser backup, Profile isolation and no duplicate UI import.

This affects future imports only. Already completed markers and prior rows/history remain unchanged; previously omitted records are not automatically repaired. Their original backup remains available for a separately reviewed recovery decision. No authentication, AI protection, current Reference UI, export projection or real user data changes.

Validation uses temporary SQLite, local Chromium and Mock gateways with a real SDK denial guard.
