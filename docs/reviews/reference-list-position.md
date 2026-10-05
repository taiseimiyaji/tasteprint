# Reference 保存後の一覧位置

Issue #130。main `d8446b` では A/B/C の B を通常の「観点・メモを保存」で更新すると A/C/B に移動した。Profile/Project と1440/390pxの4実UIケースを Mock・隔離SQLiteで再現した。保存内容や下書きの消失は確認していない。Reference の作成順は README の明示契約ではない。

`ReferenceService.save` の INSERT OR REPLACE は既存IDの行を再作成するため、`references()` の rowid順が変わる。UPSERTで同じ行のdataを更新し、保存時点の位置を維持する。新規IDは末尾に追加する。現在の行の順を保つ変更で、以前の更新で移動済みのカードを並べ替えたり、推測した歴史的な作成順に復元したりしない。

メモ、画像upload、capture/analysis完了、採用の保存は同じ処理を使う。API形状・version・保存内容・既存キャッシュ処理は維持。DB schema/移行、共有CSS、テンプレート版、認証、実AI処理は変更しない。

共通保存のJob行にもUPSERTが適用される。新しいJobは引き続きimmutable queued eventのcreatedSequenceで並ぶ。queued eventの無い旧Jobはunknown 0のまま、その既存rowid位置を維持する。再起動で旧active行をinterruptedにした場合も位置を変えず、未更新terminal行のraw JSONは保持する。

検証は、3件の中間行についてメモ/image/capture/analysis/採用の順とrowid、version/実データ、末尾への新規追加、削除、再起動、未更新raw行、legacy行、旧active0がterminal0より先に存在する再起動ケース。実UIはProfile/Project×1440/390pxの通常保存とreload後の順・メモ内容を確認する。証跡は接続Macの `evidence/reference-order-before` と `evidence/reference-order-after` に保存。
