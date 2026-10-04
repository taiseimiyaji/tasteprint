# Tasteprint

自分のデザイン感覚を、対話と比較を通じて形式知化するローカルWebアプリ。

React + Vite + TanStack Router / Query + Hono（Node.js）で構成しています。参考の公開URL取得・画像保存・Codex分析、プロジェクト別の設計編集・実画面レビュー・確定revisionの一括出力に対応しています。Components / Patterns / Previewは同梱部品と画面で設計を確認します。

## 起動

Node.js 22.13以上が必要です（検証環境: Node.js 24.13.0）。

```sh
npm ci
npx playwright install chromium
npm run dev
```

[http://127.0.0.1:3000](http://127.0.0.1:3000) を開きます。Viteが3000、APIが3001で起動します。

ビルドしたアプリはHono単体で配信できます。

```sh
npm run build
npm start
```

通常実行も初期ポートは3000です。開発サーバーを終了してから起動してください。通常実行のポートは `PORT` で変更できます。

## 試せること

- 共通の「自分の好み」と、用途ごとの複数プロジェクトの作成・切り替え・再開・アーカイブ／解除
- 共通更新の差分選択・固有方針の維持・選択した原則の共通への追加
- プロジェクト内の8段階の画面遷移、共通／プロジェクト別の参考URL・画像と観点の登録
- 14問のTaste比較とProfile
- Foundationの8分類の詳細編集、項目ロック・適用範囲・例外・理由・出典、3画面Preview
- Codex候補の比較・採用・見送り、Foundationの保存履歴と復元
- 部品・パターンの操作例、3画面の実画像AIレビュー・アクセシビリティ検査・修正案の仮Previewと明示適用
- 確定revisionに固定したMarkdown / JSON / CSS、DTCG / React / 3画面PNGを含むZIPと、プロジェクト別のExport履歴

共通プロフィールとプロジェクトの確定データはSQLite、未保存の入力はスコープ別のlocalStorageに保存します。初回は起動ターミナルの接続コードを入力します。共通の好みを更新しても既存設計は変わらず、差分の明示採用で新revisionを作ります。旧SQLiteとブラウザ保存はバックアップ後、一度だけ既定プロジェクトへ移行します。[移行・保存・復旧の詳細](./docs/projects.md)を参照してください。DTCG / React / PNG / ZIP一括出力は実装済みです（下記参照）。Named Tunnel + Cloudflare Accessの実環境接続は未検証です（Issue #6）。

## 検証

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run test:built
```

PRとmain更新ではGitHub ActionsがNode.js 24.13.0で上記の検証を実行します。PRではhead commitをチェックアウトし、`test:built`に含まれるビルドと一時SQLiteでの起動・PNG/ZIP出力も確認します。E2EはモックAIと一時データを使用し、Codex認証や実AI送信は不要です。失敗時のPlaywrightレポート・traceは7日間保持します。

E2Eの接続状態もモックです。テストサーバーはホスト認証や実Codexへの呼び出しを拒否し、実行終了時に呼び出しが0件だったことを確認します。テスト用の接続は実行ごとに1回だけ行い、worker再起動後も同じ一時セッションを使用します。セッションファイルはGit無視対象の `test-results/.session.json` に作成し、終了時に削除します。

## ドキュメント

- [Projects / migration](./docs/projects.md) — 共通の好み・プロジェクト分離・移行と復旧
- [SPEC.md](./SPEC.md) — MVP要件と実装時点ごとの記録
- [Architecture](./docs/architecture.md) — 技術比較と採用理由
- [AI Review](./docs/review.md) — 実画面の撮影・検査範囲・修正と履歴
- [Foundation](./docs/foundation.md) — 詳細編集・保存・ロック・候補比較の仕様
- [操作ガイド](./docs/mockup.md) — 操作ガイド

## 参考URLの取得と分析

最初の接続画面で、起動ターミナルに表示されるワンタイム接続コードを入力します。コードは起動ごとに変わります。公開HTTP(S) URLを追加すると撮影ジョブが始まり、30秒以内に初期表示（1440×1000）と取得情報を保存します。取得できない場合は、同じ参考の「画像で続行」からPNG・JPEG・WebP（10MB、2500万画素まで）を登録できます。

観点ごとの「参考にする／避ける」とメモを保存し、送信対象を確認して「Codexで分析する」を押します。**選択した画像・構造情報・観点・メモがOpenAIへ送信されます。** 分析結果の観察・解釈・推奨・根拠を確認して採用すると、採用済み方針がMarkdown / JSONの参考情報に含まれます。Foundationの数値を自動変更する機能ではありません。

CodexはホストのChatGPTログインを使用します。`@openai/codex-sdk` は0.154.0に固定しています。APIキー認証へのフォールバックはありません。未ログイン・利用上限・不正な出力は失敗理由を表示し、手動で再試行できます。

```sh
# ホストでChatGPTログイン（auth.jsonを使う構成）
codex -c cli_auth_credentials_store='"file"' login
npx playwright install chromium
```

認証確認には `${CODEX_HOME:-~/.codex}/auth.json` のChatGPT認証を使用します。OS keyringのみの構成は未対応です。ジョブごとに独立した一時HOME/CODEX_HOMEを作成し、認証情報と分析対象画像だけを配置します。ユーザーの設定・MCP・フック・APIキー環境変数を継承せず、read-only sandbox、シェル無効、ツールのネットワーク無効で実行します。終了時に一時ディレクトリを削除します。

参考・採用状態・ジョブ・イベントは共通の `~/.tasteprint/profile/` または `~/.tasteprint/projects/<projectId>/` 内のSQLite、画像は各スコープの `assets/` に保存します。`TASTEPRINT_DATA_DIR` で保存先を変更できます。バックアップはサーバーを停止してデータディレクトリ全体をコピーしてください。画像は再取得前のジョブ入力を保持するため残します。参考の削除は一覧からの削除であり、過去ジョブと画像の物理消去は行いません。

captureと分析はスコープごとにそれぞれ同時1件です。中断後も処理の終了を待って実行枠を解放します。再起動時のqueued/runningジョブはinterruptedになり、自動再実行しません。参照内容が変更された場合は古い分析・撮影結果の反映を拒否します。

ジョブの作成順と状態の更新順は保存済みイベントの順序を使います。時刻が同じ・前後した場合も、古い応答で最新結果や中断状態を戻しません。APIの `createdSequence` は最初のqueuedイベント、`transitionSequence` は最新イベントの番号で、元のジョブJSONには追加しません。queuedイベントのない旧ジョブは作成順不明（0）として、表示済みの同順位の位置を保持します。旧作成順の復元は保証しません。

通信経路とテスト範囲は [URL capture architecture](./docs/url-capture.md) を参照してください。

### 同一 revision の一括出力（Issue #5）

プロジェクトの Export で「一括 ZIP を生成・再試行」を選ぶと、保存済み revision を固定して DESIGN.md、design-system.json、DTCG 2025.10 tokens、CSS、React components / patterns、一覧・設定・フォームのコードと PNG、manifest、導入用 README を生成します。出力中の保存・未採用提案は混ざりません。PNG は Preview と同じレンダラーを1440 × 1000の表示領域で初期表示し、全ページを撮影します。PNGの高さは内容によって伸びます。失敗した出力は保存されず、再試行か明示的な「画像なし ZIP」を選べます。

現在のテンプレートは Preview と共有する Button / Input / Select と3画面のパターンです。個別の Components / Patterns 仕様・全状態・実アプリでのレビューは未確認として Draft に記録します。出力時に AI は呼び出しません。ZIP には採用した参考の出典と理由のみを含め、参考画像・会話ログ・URL の認証情報やクエリは含めません。

API は `POST /api/projects/:id/exports` に `{ "baseRevision": 1, "bundle": true, "imageMode": "include" }` を指定します。画像なしは `"omit"`。応答には凍結ファイル名を返し、既存の所有関係を検証するダウンロード API で取得します。`bundle` 省略時は従来の個別出力です。ZIP のディレクトリ構造と各ファイルの SHA-256 は manifest に記録します。

`npm test` で snapshot 整合性、DTCG 参照、ZIP 内容、展開後の React 型検査を実行します。`npm run test:built` はビルド済みサーバーから3画面を実撮影し、ZIP を取得・PNG を検証します。
