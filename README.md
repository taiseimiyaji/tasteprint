# Tasteprint

自分のデザイン感覚を、対話と比較を通じて形式知化するローカルWebアプリ。

React + Vite + TanStack Router / Query + Hono（Node.js）で構成しています。Inspirationは公開URL取得・画像保存・Codex分析に対応しています。その他の画面にはモック機能が含まれます。

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

- 8段階の画面遷移、参考URL・画像と観点の登録
- 14問のTaste比較とProfile
- Foundationの8分類の詳細編集、項目ロック・適用範囲・例外・理由・出典、3画面Preview
- Codex候補の比較・採用・見送り、Foundationの保存履歴と復元
- 部品・パターンの操作例、簡易チェック
- Markdown / JSON / CSSの個別ダウンロード

参考情報とFoundationの確定履歴はサーバーのSQLiteに保存します。FoundationはInspirationで接続後に編集できます。Taste回答などはブラウザのlocalStorageです。対話パネルは確定したFoundationと要求をCodexへ送信し、候補を明示採用します。複数プロジェクト、Tunnel、DTCG / React / PNG / ZIP一括出力は未実装です。

## 検証

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
```

## ドキュメント

- [SPEC.md](./SPEC.md) — MVP仕様と現在のモック範囲
- [Architecture](./docs/architecture.md) — 技術比較と採用理由
- [Foundation](./docs/foundation.md) — 詳細編集・保存・ロック・候補比較の仕様
- [Mockup guide](./docs/mockup.md) — 操作ガイド

## 参考URLの取得と分析

Inspirationで、起動ターミナルに表示されるワンタイム接続コードを入力します。コードは起動ごとに変わります。公開HTTP(S) URLを追加すると撮影ジョブが始まり、30秒以内に初期表示（1440×1000）と取得情報を保存します。取得できない場合は、同じ参考の「画像で続行」からPNG・JPEG・WebP（10MB、2500万画素まで）を登録できます。

観点ごとの「参考にする／避ける」とメモを保存し、送信対象を確認して「Codexで分析する」を押します。**選択した画像・構造情報・観点・メモがOpenAIへ送信されます。** 分析結果の観察・解釈・推奨・根拠を確認して採用すると、採用済み方針がMarkdown / JSONの参考情報に含まれます。Foundationの数値を自動変更する機能ではありません。

CodexはホストのChatGPTログインを使用します。`@openai/codex-sdk` は0.154.0に固定しています。APIキー認証へのフォールバックはありません。未ログイン・利用上限・不正な出力は失敗理由を表示し、手動で再試行できます。

```sh
# ホストでChatGPTログイン（auth.jsonを使う構成）
codex -c cli_auth_credentials_store='"file"' login
npx playwright install chromium
```

認証確認には `${CODEX_HOME:-~/.codex}/auth.json` のChatGPT認証を使用します。OS keyringのみの構成は未対応です。ジョブごとに独立した一時HOME/CODEX_HOMEを作成し、認証情報と分析対象画像だけを配置します。ユーザーの設定・MCP・フック・APIキー環境変数を継承せず、read-only sandbox、シェル無効、ツールのネットワーク無効で実行します。終了時に一時ディレクトリを削除します。

参考・採用状態・ジョブ・イベントは `~/.tasteprint/references.sqlite`、画像は `~/.tasteprint/assets/` に保存します。`TASTEPRINT_DATA_DIR` で保存先を変更できます。バックアップはサーバーを停止してデータディレクトリ全体をコピーしてください。画像は再取得前のジョブ入力を保持するため残します。参考の削除は一覧からの削除であり、過去ジョブと画像の物理消去は行いません。

captureと分析はそれぞれ同時1件です。中断後も処理の終了を待って実行枠を解放します。再起動時のqueued/runningジョブはinterruptedになり、自動再実行しません。参照内容が変更された場合は古い分析・撮影結果の反映を拒否します。

通信経路とテスト範囲は [URL capture architecture](./docs/url-capture.md) を参照してください。
