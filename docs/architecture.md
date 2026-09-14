# Architecture decision: React SPA + local Node service

Status: accepted, 2026-09-10

## 採用構成

React + Vite + TanStack Router + TanStack Query + Hono / Node.js。APIの型共有はHono RPC、実行時検証はZodを使用する。

編集途中の状態と未採用候補はReact側で扱う。本実装では確定設計とジョブ状態をサーバーの正本とし、Queryで取得する。共通プロフィールはworkspace.sqliteの不変revision、プロジェクトは所有スコープごとのSQLiteに保存する。localStorageはprojectId付きの下書きと旧データの移行・バックアップに限定し、確定設計の正本にはしない。詳細は [projects.md](projects.md)。

Codex・PlaywrightのジョブはHTTP要求から独立した寿命を持つ。Honoの役割は要求の検証とサービス呼び出しに限定する。ジョブの中断、永続化、復旧をHTTPフレームワークの機能と混同しない。

## 比較

| 候補 | 評価 | 今回採用しない理由 |
| --- | --- | --- |
| Hono + React/Vite | 小さなHTTP層、Zod連携、RPC型推論、明示的なNode起動 | 採用。開発起動・同一origin配信をプロジェクトで整える |
| TanStack Start | サーバー関数・型共有・ルーティングの統合が有力 | 今回は独立したローカルサービスの管理を重視。サーバー関数のビルド機構を必須にしない |
| Fastify + React/Vite | 検証・プラグイン・ライフサイクルが充実 | 現在の規模ではHono RPC + Zodの型共有を優先 |
| React Router Framework Mode | 画面単位の取得・更新をまとめやすい | 編集・ジョブ中心の構成では明示APIとTanStack Router/Queryを選ぶ |
| Next.js | フルスタックReactとSSRに強み | 今回の中心要件に対し採用機能が少ない |
| Elysia | 型推論と検証の統合に魅力 | 実行環境と周辺依存の追加検証を選ぶ決め手がない |
| Express | 自由に構成できる | 新規開発では型共有・検証の接続が明確なHonoを優先 |

速度ベンチマークによる優劣ではなく、責務と実装の対応に基づく判断。SSR不要だけを理由にStartを除外していない。

## 実行構成

開発時: Vite 127.0.0.1:3000 → /api proxy → Hono 127.0.0.1:3001。
通常実行時: Hono 127.0.0.1:3000 → API + dist/clientの静的配信。
Node.js 22.12以上を前提とし、検証にはNode.js 24を使用。依存バージョンはpackage-lock.jsonで固定する。

フロントはサーバーの型だけをimportし、サーバーの実装や秘密情報をバンドルしない。

## 公式資料

- [Hono RPC](https://hono.dev/docs/guides/rpc)
- [Hono Node.js](https://hono.dev/docs/getting-started/nodejs)
- [TanStack Start server functions](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions)
- [TanStack Router](https://tanstack.com/router/latest/docs/quick-start)
- [Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
