# Export file recovery during history revalidation

Issue #252 reproduces a boundary separate from #190 and #250: the creation POST succeeds, the following file GET fails, and the final history GET remains pending. On main `d5b0da3190295279bdec788dd3a8fdd2537aa0d6`, all four new 1440px/390px cases fail because the file error never becomes visible while the history GET is held. The saved ZIP is already in history, but its link and generation controls stay disabled. Both existing download-recovery controls pass when history is not held. These checks use Mock AI and temporary SQLite.

The accepted receipt already commits the Export and project metadata before downloading. Run optional final history revalidation in the background, leaving query observers to report read failures. This preserves the original file error and allows an explicit saved-file retry without another creation POST. No generation or download is automatically retried; real generation and file requests still retain their pending protection.

Four regressions cover both widths and eventual history success/failure. They verify immediate file errors, enabled saved ZIP retry while the read is pending, byte-identical ZIP reuse with one POST and one saved record, separate history errors and GET-only recovery, and project switching before a late source-history reply. Destination history and downloads remain separate; returning to the source retains the same file and revision. The failure fixture stays unavailable through the existing automatic read retry until the test explicitly restores it.

Controlled HTTP errors and held browser responses do not establish physical network-outage behavior. Real AI calls, user data, authentication and publication settings are outside this change.
