# 共通の好みとプロジェクト（Issue #9）

共通の「自分の好み」はプロジェクト未作成でも利用できます。Tasteの14問と理由、A/Bの比較条件（taste-v1）、採用する原則・出典を「共通の好みを保存」でSQLiteの不変revisionに確定します。共通参考の分析は採用操作を行った項目だけを継承します。未回答は未確認で、具体的なトークンへ自動変換しません。

## 操作

1. 起動ターミナルの接続コードを入力します。「自分の好み」で比較・参考登録・DNA確認を進め、確定します。
2. 「プロジェクト」で名前を入力し、必要なら用途・対象ユーザー・目指す／避けたい印象を記入します。「共通の好みを使う」が初期選択で、参照版・回答数・原則数を確認できます。
3. 概要で固有方針や例外を保存します。例えば共通の「一覧は行」とは別に個人サイトの「作品一覧はカード」を記録できます。Foundation、Components / Patternsの既存操作例、Preview、Review、Exportへ進めます。Tasteの再回答は不要です。
4. 共通更新後は概要の「差分を確認」で、追加・変更・削除ごとに取り込み／維持を選びます。すべて選択した時だけ新revisionを作成します。既存の具体値は再生成しません。
5. 「共通の好みに追加」では保存済みの固有原則を選び、理由・出典を確認して追加します。brief・会話・具体値を自動で共通化しません。他プロジェクトは差分採用まで変わりません。
6. 一覧から再開・アーカイブ／解除できます。アーカイブ中も確定データ・過去Exportを参照でき、変更APIは拒否します。

原則の `target` は比較・競合判定の単位です。同一targetの固有指定、Foundationの明示指定・ロックと競合する共通変更は取り込めません。「維持」を選ぶか、先に固有指定を明示的に編集して解消してください。自由文の意味をAIに推測させた自動競合解決は行いません。

## 保存と所有関係

`TASTEPRINT_DATA_DIR`（既定 `~/.tasteprint/`）以下に保存します。

```text
workspace.sqlite                   # singleton profile revisions / project registry / migration ledger
profile/references.sqlite          # shared references, analysis jobs and events
profile/assets/                    # shared reference images
projects/<projectId>/references.sqlite
                                   # Foundation/Design revisions, proposals, request IDs,
                                   # references/jobs/events, reviews/images, conversations, exports
projects/<projectId>/assets/        # project-owned reference images
backup-before-projects/            # pre-migration SQLite/assets/browser JSON
```

DBファイルそのものが所有境界です。APIは登録済みprojectIdを検証してからそのDBを選び、参考・ジョブ・候補・レビュー・画像・ExportのIDをそのDB内で解決します。任意のホストパスは受け取りません。同一revision番号・冪等キーでも他プロジェクトとは独立しています。共通参考からプロジェクト用のFoundation・Review APIへはアクセスできません。

Foundationのrevisionを設計revisionとして拡張しました。各行の `design` と `snapshot`（brief、sourceTasteProfileRevision、採用した回答・比較条件・原則・根拠・参考画像、固有方針、維持結果）は一緒に不変保存します。Foundation保存、概要確定、共通差分の採用、復元はこの連番に新しい行を作ります。旧Foundation行は変更せず `project_snapshots` で当時の所有情報を補完します。既存Components / Patternsはこの確定designを使う操作例です。未実装の独立した部品・パターン設計エンジンを完成扱いにはしていません。

ルートは `/profile` と `/projects/:projectId/:step`。Queryのキャッシュキーと下書きのlocalStorageキーにもprojectIdを含めます。異なるプロジェクトではコンポーネントを再作成し、リクエストは開始時のスコープに固定します。Foundation・概要の下書きは元revisionを保持し、古い入力の上書きを拒否します。参考の分析・撮影には既存の参考version検証も適用します。

## API

- `POST /api/pair`: 一度きりの接続コードによるセッション作成。Host・Origin検証、HttpOnly/SameSite Cookie、no-storeを適用。
- `GET/POST /api/profile`: 共通確定版・履歴／保存（`baseProfileRevision`）。
- `/api/profile/references/...`: 共通の参考・分析ジョブ。
- `GET/POST /api/projects`: 一覧／作成（採用する `sourceTasteProfileRevision` を検証）。
- `GET/POST /api/projects/:id`: 概要・確定snapshot／固有方針保存（`baseRevision`）。
- `POST /api/projects/:id/archive`: `baseRevision` と `archived`。
- `GET/POST /api/projects/:id/taste-diff`: 最新共通版の差分／全項目の選択適用（両方のbase版）。
- `POST /api/projects/:id/promote`: 保存済み原則IDの明示昇格（両方のbase版）。
- `/api/projects/:id/{foundation,references,reviews}/...`: 既存サービスのスコープ分離。
- `GET/POST /api/projects/:id/conversations`: 現行の提案リクエスト履歴／記録（`baseRevision`）。候補と採用理由は同じDBの提案・revision履歴に残ります。
- `GET/POST /api/projects/:id/exports`: 履歴／対象確定revisionからの生成。
- `GET /api/projects/:id/exports/:exportId/:filename`: 所有関係を検証した過去成果物のダウンロード。
- `POST /api/migration/browser`: 一度きりのブラウザ移行。

共通・プロジェクトの古いbase版は409、未知の所有IDは404です。Foundation候補の適用は候補に保存したbaseRevisionを検証します。

## Export

Markdown / JSON / CSSをサーバーで生成してSQLiteに保存します。入力は対象の確定revisionのみ。出力名は `<slug>-<projectIdの先頭8文字>-r<revision>-…`、内容にprojectId・設計revision・採用元共通revisionを記録します。同じrevisionの再要求は保存済みの同じ内容を返します。共通参考の削除後も旧snapshotに根拠・画像が残ります。DTCG / React / PNG / ZIPの一括出力はIssue #5の後続範囲です。

## 既存データの移行と復旧

サーバー初回起動時、旧 `references.sqlite` があれば、旧サービスが開く前に `VACUUM INTO` でWALを含む整合したSQLiteコピーを作成し、assetsもバックアップします。そのコピーを既定 `legacy` プロジェクトへ配置します。Foundationの全行・候補・冪等キー・参考・ジョブ・イベント・レビュー・画像を含め、旧DBのテーブルを丸ごと保持します。旧ファイルを削除しません。queued/runningジョブは移行先のスコープでinterruptedにし、自動再実行しません。

ブラウザは初回接続後、v3 → v2 → mock.v1の順で最新の既存localStorageを探し、存在する各キーを `.backup-before-projects` キーへコピーします。最新のワークスペースをAPIへ移し、ホストにも入力JSONを保存します。Taste回答だけを未確定の共通プロフィールの初期回答として取り込み、旧参考・原則は既定プロジェクト内に維持します。既存SQLiteの確定具体値を優先し、ブラウザだけにある設計はそのまま保存します。

ブラウザの完了マーカー、ホストの入力ハッシュ、プロジェクト側のインポート台帳で再実行を識別します。プロジェクト書き込みと共通プロフィールの更新の間で失敗しても、再試行で設計revisionを重複作成しません。失敗時は完了マーカーを付けず、元キーも削除しません。過去にブラウザからダウンロードした外部ファイルは元のダウンロード先に残り、今回以降のExportがアプリ内履歴に保存されます。

通常のバックアップはサーバーを停止してデータディレクトリ全体をコピーしてください。旧版へ戻す場合は新しいデータも別途バックアップし、旧版に `backup-before-projects` のコピーを専用の `TASTEPRINT_DATA_DIR` として指定します。ブラウザは元キーまたはバックアップキーから復元できます。この実装の検証では一時ディレクトリだけを使い、ユーザーの実データに移行を実行していません。

## 検証

`tests/projects.test.ts` は共通のみの永続化、2プロジェクトの分離、不変Export、差分の追加／変更／削除、固有指定・ロック、古い版、明示昇格、候補・参考・レビューの所有関係、アーカイブ、遅いAI、SQLiteとブラウザ移行の再実行を検証します。

`tests/workspace.e2e.ts` と `tests/project-journey.ts` は共通入力→2プロジェクト→片方の方針・Foundation変更→共通更新を片方だけ採用→個別Export、下書き保持、アーカイブ解除、過去Export、遅延保存と別タブ競合を実行します。既存の参考失敗→画像アップロード→分析・採用、Foundation提案・復元、実画面レビュー、390px表示も検証します。Codex応答は決定的fixtureで、実際のモデルへの新規送信は行いません。
