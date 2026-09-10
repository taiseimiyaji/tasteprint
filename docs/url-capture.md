# URL capture / reference analysis

Issue #1の実装。既存UIがあった `taiseimiyaji/feature-design-taste-codex` のコミット `16ba4d5` を土台にする。

## 通信境界

Chromiumはジョブ専用の新規プロファイルを使用し、loopback上の専用HTTPプロキシに全ページ通信を送る。暗黙のloopback bypassを解除し、QUIC・非プロキシWebRTC・ブラウザ側のDNS解決を無効化する。Service Worker、WebSocket、ダウンロード、新規ウィンドウを禁止し、GET/HEADのみ通す。認証情報付きURL、非HTTP(S)、80/443以外のポートは拒否する。

プロキシはHTTP要求およびHTTPS CONNECTごとに全DNS回答を検査し、非公開・予約アドレスが1件でも含まれる場合は拒否する。IPv4/IPv6のloopback/private/link-local、CGNAT、マルチキャスト、IPv4-mapped IPv6、NAT64/6to4/Teredo、メタデータ用アドレスを拒否する。検証後はホスト名ではなく検証済みIPへTCP接続し、HTTPのHostおよびブラウザのTLS検証は元のホスト名を維持する。リダイレクトもサブリソースも同じ経路で検証する。単なる事前DNSチェックやPlaywrightのURLルーティングだけには依存しない。

HTTP(S)以外のページ遷移を許可せず、ページ全体のロードと撮影には合計30秒の期限を設ける。ブロックされたサブリソースがある場合も取得失敗とする。ブラウザはクリーンな状態から開始し、パスワード入力欄のあるログイン画面を失敗として扱う。各サイト固有のログイン判定・CAPTCHA回避・認証操作は行わない。

## 保存・分析

`ReferenceService`はHonoから独立する。SQLiteのrefs/jobs/eventsに入力スナップショットと状態遷移を保存する。画像はサーバー生成UUIDのPNG。入力画像はsharpで形式と画素数を検証し、メタデータを除いたPNGへ再エンコードする。

取得情報は時刻、最終URL、viewport、最大30件の見出し（各200文字）、タイトル、ランドマーク・コントロールの個数に限定する。HTML全体・フォーム値・Cookieは保存しない。分析入力はこの取得情報と選択観点・意図・メモ・画像。静止画像で観察できないMotionは材料不足を要求し、サーバーでも検証する。

結果の保存とsucceeded遷移は同一トランザクション。参照versionが変わった場合は古い結果を反映しない。明示採用したfindingのみを方針として保持し、Markdown/JSON出力の参考情報に含める。採用前にFoundation等の設計値を変更しない。

今回のAPIは単一ワークスペースの `/api/references` に集約する。起動時のワンタイムコードとHttpOnly/SameSite Cookie、許可Host/Originで保護する。Tunnelは許可していない。ジョブ開始は202とIDを返し、1秒ポーリング（待機時5秒、非表示時10秒）で追跡する。ジョブ開始のUUIDキーは再送を重複実行しない。`/jobs/:id?after=<sequence>` で状態イベントの差分を取得できる。

## Codexの固定API

[公式SDKドキュメント](https://learn.chatgpt.com/docs/codex-sdk)およびインストールした0.154.0の型・実装を確認。`local_image`、`outputSchema`、`AbortSignal`を使用。[認証・制限設定](https://learn.chatgpt.com/docs/config-file/config-reference)に従い、ChatGPT認証を固定する。ツールのネットワーク制限は、CodexがOpenAIと行う分析通信そのものを禁止するものではない。

SDK呼び出しはテストで代替し、実アカウントを使う分析通信は自動テストでは行わない。実環境ではホストのChatGPTファイル認証とモデルの利用可能量が必要。認証・モデル実行エラーはジョブに保存し、取得済み画像を維持する。

## 検証

- `npm test`: 実ChromiumでPNGサイズ・メタデータ、内部URL、数値表記IP、IPv6、内部リダイレクト、メタデータ向けサブリソース、タイムアウトを検証。CONNECTとDNS回答混在・再解決も検証。
- 公開ページfixtureはテスト内のみで検証済み公開IPの接続をローカルHTTPサーバーに置換する。製品コードに内部URL許可スイッチはない。
- SQLite統合テストで中断後の実行枠、遅延結果破棄、再起動復旧、冪等性、version競合、画像再エンコード、セッション・Origin・送信確認を検証。
- Codexアダプターは画像と正確な入力、スキーマ、シグナル、環境変数除去、認証拒否、一時認証の削除を検証。
- `npm run test:e2e`: テスト専用3100/3101ポートと一時DBで、取得失敗→画像アップロード→観点・メモ保存→分析→採用→再読み込みを確認。撮影・CodexはこのUIテストでは決定的なfixtureを使用。

全体DesignSystemのサーバー正本・複数プロジェクト・revision基盤は別スコープ。採用した参考方針を既存のブラウザ保存境界へ渡す構成であり、他の段階のモックを本実装として扱わない。

旧モックの `tasteprint.mock.v1` は上書きせず保持する。新しいブラウザ保存キーは `tasteprint.workspace.v2`。以前登録した参考はInspirationの「以前の参考を取り込む」で明示的にサーバーへ移せる。取り込みだけではサイト取得・Codex送信を開始しない。

`npm run test:built` は配布用ビルドを実際に起動し、静的アセット配信、セッション接続、captureジョブ、内部宛先の拒否まで検証する。`tsup.config.ts` の `removeNodeProtocol: false` はprefix必須の `node:sqlite` を維持するために必要。
