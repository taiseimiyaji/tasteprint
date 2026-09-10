# Tasteprint

自分のデザイン感覚を、対話と比較を通じて形式知化するローカルWebアプリ。

現在は **操作可能なモックアップ** です。React + Vite + TanStack Router / Query + Hono（Node.js）で構成しています。Codexへの送信・API課金は発生しません。

## 起動

Node.js 22.12以上が必要です。

```sh
npm ci
npm run dev
```

[http://127.0.0.1:3000](http://127.0.0.1:3000) を開きます。Viteが3000、モックAPIが3001で起動します。

ビルドしたアプリはHono単体で配信できます。

```sh
npm run build
npm start
```

通常実行も初期ポートは3000です。開発サーバーを終了してから起動してください。通常実行のポートは `PORT` で変更できます。

## モックで試せること

- 8段階の画面遷移、参考URL・画像と観点の登録
- 14問のTaste比較とProfile
- Foundationの変更、3画面Preview、取り消し
- 定型の提案の仮反映・採用・見送り
- 部品・パターンの操作例、簡易チェック
- Markdown / JSON / CSSの個別ダウンロード

保存先はブラウザのlocalStorageです。Codex、SQLite、URL自動取得、認証、Tunnel、DTCG / React / PNG / ZIP一括出力は未実装です。

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
- [Mockup guide](./docs/mockup.md) — 操作ガイド
