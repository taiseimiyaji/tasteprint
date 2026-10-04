# Components / Patterns / Preview

ComponentsとPatternsはFoundationと同じプロジェクトの確定設計・SQLite revisionに保存する。旧revisionは書き換えず、読み出し時に既定設定を補完する。手動編集の保存、履歴復元、JSON / DESIGN.md出力、Reviewは同じ設定を使用する。

- Components: Button、Input、Select、Checkbox、Tabs、Dialog、Table、Badge。variant（solid / outline / subtle）、size（sm / md / lg）、適用する状態、用途、利用ルール、根拠を編集する。状態の選択は詳細プレビューの確認対象で、ネイティブ要素のフォーカスや入力検証を無効化しない。
- Patterns: PageHeader、FilterBar、ListPage、SettingsSection、FormSection、EmptyState。既定スロットの並び順、余白、参照コンポーネント、狭幅での縦積み／折り返し、用途、避ける構成、根拠を編集する。参照は設計文書のメタデータであり、任意部品を挿入するビルダーではない。
- Codex: 許可された設定だけを提案し、項目ごとのbefore/after、理由、影響画面を確認して採用する。提案作成はrevisionを更新しない。Components / Patterns単位のAIロック、プロジェクト固有方針、型・値・状態・参照・構造検証、古いrevisionの拒否、採用の冪等性はサーバーで保証する。TSXや任意CSSは受け取らず実行しない。
- Preview: `/preview-render`をiframeで表示。編集画面からは同一originの検証済み設定をpostMessageで渡す。390 / 768 / 1440pxの実寸を表示し、親の表示領域を超える場合は横スクロールする。狭幅ではナビゲーションを畳み、テーブルは内部で横スクロールできる。
- 同梱の `design-runtime/Library.tsx` と `Preview.tsx` は詳細プレビュー、3画面、Review画像で共用。`reviewCapture(origin, width)` は3種の幅でPNGを撮影可能（既定1440）。確定revisionのPNG/React/ZIP一括Exportも実装済み。範囲と制約は [READMEの一括出力](../README.md#同一-revision-の一括出力issue-5) を参照。
- サンプル操作はローカルのみ。検索・フィルタ・Tabs、Dialogによるプロジェクト追加、必須入力・メール検証、保存中状態、通常設定と分離した危険操作の確認を提供する。

Inputの最小高さはFoundationの`controlHeight`を基準に、smは8px小さく、mdは同じ、lgは8px大きくなる。文字や余白に必要な高さが上回る場合は、その内容に合わせて広がる。詳細プレビューと3画面、`preview-6`以降の同梱ZIPで同じ設定を使用し、保存済みの旧ZIPは保持する。

## 検証

`npm test` は保存・再起動・旧データ補完・復元、スキーマ拒否、提案の採用・競合・ロックを検証。`npm run test:e2e` は設定の保存と復元、編集UIとの分離、3画面×3幅、全適用状態、Tabsの矢印キー、Dialogの初期フォーカス・Tab循環・Escape・閉じた後の復帰を確認する。画面画像は `test-results/library-*.png` に生成する。実Codexへの接続はこの自動テストでは行わず、既存の注入可能な生成サービスを使用する。
