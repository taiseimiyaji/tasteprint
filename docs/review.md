# 実画面レビュー（Issue #4）

> Issue #9以降、共通の好みとプロジェクトの保存先・ルートを分離しています。現行の操作・API・移行手順は [projects.md](projects.md) を参照してください。以下の旧グローバルAPI・localStorageの記述は移行前の説明です。
Inspirationで接続してFoundationを保存した後、AI Reviewの「3画面を撮影してレビュー」を実行する。確定revisionの設定・constraints・決定履歴と、Foundation保存時に確定したTaste集計（DNA）を使用する。未回答はnull、DNA保存以前のrevisionは未確認として扱う。保存後のTaste回答や未保存の編集は入力に含まない。

Previewと撮影は `/preview-render` の同じReactレンダラーを使用する。編集画面はiframeで分離し、同一originの準備完了通知後に検証済み設定を送信する。内部撮影はサーバーが指定する固定loopback originだけに接続する。参考URL取得の外部サイト用プロキシとは別経路で、リクエストから撮影URLは指定できない。

一覧・設定・フォームを1440×1000で撮影し、PNG、入力スナップショット、検査範囲と指摘をSQLiteに保存する。3画像を順序付きでCodexに渡す。画像取得が途中で失敗した場合は取得済みの機械検証だけを「検証未完了」として残し、AIは実行しない。AIの認証・出力失敗も機械検証結果を残す。手動で再実行できる。

## 検証範囲

- axe-coreのWCAG 2 A/AAおよび2.1 AA対象ルール（コントラスト、フォームのラベルなど）。incompleteは手動確認が必要と表示する。
- 未解決トークン: 対象に適用されるCSS宣言の、フォールバックなしの `var(--name)` を検査する。複雑なfallback・擬似要素・条件付きルールの完全なCSS解析ではない。
- 影: shadow=falseでは影を禁止する。Preview面の影はshadowAllowedのカンマ・読点・改行区切りの列挙に `Preview` がある場合のみ許可する。既定のDialog、Popoverは静的Preview面を許可しない。
- 最大角丸: 面・コントロールの左上角丸がradius/radiusSm/radiusLgの最大値を超えないこと。バッジ・アバター等の円形要素は対象外。
- 状態不足: ボタン・入力・選択欄にhover/focus-visible/disabled、必須入力にinvalidのCSS定義があるかを検査する。ブラウザ標準の状態表示がある場合も、テーマの状態定義不足として報告する。
- フォーカス: 入力とボタンのoutline・影・境界・背景の変化を比較する。状態定義の有無と実際のフォーカス変化は別の検査。

390px、hover/disabled/error/loadingの実操作、Dialog、支援技術での操作は未検証。自由記述ルールはAIが解釈し、機械的に証明したとは扱わない。総合点・百分率は出さず、ユニークな検証済みルール数、機械違反の指摘数、AIの要判断指摘数を表示する。各ルールが適用された画面はscopeを参照する。

## 修正・履歴

指摘にはruleId、targetPath、severity、evidence、explanation、suggestedChange、sourceを保存し、画面から関連ルールを参照できる。見送りは任意理由を保存する。修正案を作成するとFoundation候補が生成され、差分と3画面の仮Previewを表示し、「まとめて適用」で初めてrevisionを作成する。設定では修正できないDOM/CSSの指摘もあるため、候補適用が違反解消を保証するわけではない。適用後に再レビューする。

実行中・実行後を問わずrevisionが変わると古い結果になる。古い結果の候補作成と適用はサーバーでも拒否する。ロックとconstraintsは既存Foundationの保護を引き継ぐ。レビュー履歴と画像は参考情報と同じSQLiteに保存する。レビューの同時実行は1件、タイムアウトは5分。

## テスト

`npm test` は画像取得失敗、入力・画像・指摘・理由の保存、AIとの区別、実行中revision変更、古い候補拒否と明示適用を検証する。`npm run test:e2e` は実Chromium/axeによる3画面の低コントラストと状態不足、既知のDOM違反（ラベル・トークン・影・角丸）、および撮影→レビュー→見送り→仮Preview→明示適用→古い結果のUIを検証する。Codex応答はテスト用fixtureで、実Codex通信は自動テストでは実行しない。
