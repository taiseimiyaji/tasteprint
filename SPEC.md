# Tasteprint — MVP仕様書

作成日: 2026-09-10  
状態: 技術選定更新・操作可能なモックアップ作成段階。本文のMVP要件全体が実装済みであることは意味しない。モックの実装範囲は第17章を参照。

## 1. プロダクトの定義

**Tasteprintは、自分のデザイン感覚をCodexとの対話・比較・実画面での確認を通して形式知化する、個人向けローカルWebアプリである。**

参考サイトを丸ごと模倣するのではなく、「この文字組みが好き」「この余白は広すぎる」「一覧をカードに分割したくない」といった判断を蓄積する。その理由と適用範囲をDesign DNAとして構造化し、別のAI Coding Agentにも渡せる `DESIGN.md` と機械可読データに変換する。

- アプリ名: 既存リポジトリに合わせて **Tasteprint**。
- Design DNA: ユーザーの好み、設計原則、判断根拠をまとめた中間表現。
- Codexの役割: 感覚の言語化、選択肢の提示、実装可能な値への変換、整合性のレビュー。
- 人間の役割: 好き・嫌いの判断、候補の選択、提案の採用、例外の決定。
- 主成果物: `DESIGN.md`。その生成元は、確定済み設計を表す `design-system.json`。

「AIっぽさ」は固定の見た目として定義しない。丸み、カード、グラデーションなどを一律に排除せず、その人が選んだ理由のあるデザインを再現できることを目指す。

## 2. 想定ユーザーと成功条件

### 想定ユーザー

CodexなどでWebアプリを開発し、見た目の好みはあるが、具体的な設計ルールとして伝えきれない個人開発者。初期対象はデスクトップ中心の業務アプリ・管理画面とする。

### 解決する課題

1. 「いい感じに」「このサイトのように」だけでは、好みが安定して再現されない。
2. 色と角丸を決めても、一覧・設定・フォームなどの画面構成が揃わない。
3. AIとの会話で決めた理由が残らず、次のプロジェクトでやり直しになる。

### MVPの成功条件

ユーザーが参考画像を1件以上登録し、好みを比較して、実画面を見ながら最低1回修正し、理由・禁止事項・画面パターンを含む仕様を出力できる。アプリの再起動後も判断と設計を再開できる。

品質は「AIが高得点を付けたか」ではなく、「ユーザーが自分の好みを説明でき、出力した仕様から同じ判断を再現できるか」で評価する。

## 3. MVPの範囲

8段階を一巡できる薄い実装を作る。各段階は固定ウィザードではなく、後から戻って編集できる。

| 領域 | MVPで提供するもの | 後続で追加するもの |
| --- | --- | --- |
| Project | 複数プロジェクトの作成・一覧・再開・アーカイブ | 複製、インポート、プロジェクト間の好みの継承 |
| Inspiration | 公開URL取得、画像アップロード、参照する観点の選択、分析 | 認証サイト、動画、領域切り抜き、ブラウザ拡張 |
| Taste | 固定14問のA/B比較、スキップ、理由メモ、回答変更 | 適応的な質問、ユーザー独自の比較 |
| Foundation | 色・文字・余白・角丸・境界・影・動き・画面幅の編集と提案 | ダークモード、複数テーマ、高度な色生成 |
| Components | 8種の既定実装をトークンと設定で調整 | 任意コンポーネントのコード生成 |
| Patterns | 6種の既定パターンを調整 | パターンビルダー、自由な画面生成 |
| Preview | 一覧・設定・フォームの3画面、幅切り替え | Dashboard、Detail、独自アプリの取り込み |
| AI Review | 根拠付きの指摘、測定可能なルール検証、修正提案 | 適合度の高度な評価、継続レビュー |
| Export | Markdown、JSON、DTCG tokens、CSS、React例、PNGをZIP化 | Tailwind専用出力、パッケージ公開、各Agentへの直接連携 |
| 実行 | ローカル単一ユーザー、任意のTunnel接続 | SaaS、チーム共有、リアルタイム共同編集 |

課金機能、OpenAI APIキー入力、任意シェル実行UI、Figma同期、Webサイトの複製はMVPに含めない。

## 4. 中核となる操作フロー

```text
プロジェクト作成（用途・対象ユーザー・目指す印象）
  → Inspiration: 何のどこが好きかを選ぶ
  → Taste: 見比べて判断する
  → Design DNAの仮説を確認・採用する
  → Foundation: 値の候補を実画面で選ぶ
  → Components / Patterns: 振る舞いと構成を確認する
  → Preview: 「もう少し詰めたい」などを対話で調整する
  → Review: 好み・ルール・画面の不一致を確認する
  → Export: 判断理由ごと持ち出す
```

参考分析やTasteの完了を待たず、初期値のPreviewは閲覧できる。未確定の項目は「初期値」「未確認」と表示し、AIが推測した値をユーザーの好みとして扱わない。

## 5. 画面とインタラクション

### 5.1 共通レイアウト

- 左: プロジェクト切り替え、8段階のナビゲーション、進捗。
- 中央: 各段階の編集・比較・プレビュー。
- 右: 開閉可能なCodex対話パネル。現在の対象、提案、根拠、適用ボタンを表示。
- 上部: プロジェクト名、保存状態、変更履歴、Export。

初期UIは日本語。変数名・コード・出力ファイル名は英語とする。画面には専門用語だけを並べず、「情報の詰まり具合」などの説明を添える。

アプリ自身のUIと編集中の設計テーマを分離する。Previewの変更でナビゲーションや保存ボタンの見た目は変えない。

### 5.2 Project / 初回設定

入力項目は名前（必須）、用途、対象ユーザー、目指す印象、避けたい印象。用途は管理画面を初期値にする。

Codex接続状態を `ready / login-required / unavailable / limit-reached / unknown` で表示する。未接続でも手動編集と既存データのExportは可能。ログインはホストのターミナルで行い、Web UIは操作案内のみを表示する。

### 5.3 Inspiration

参照ごとにURLまたはPNG/JPEG/WebP画像、タイトル、好きな点、避けたい点を保存する。画像上限は1枚10MB、1プロジェクト20参照。

観点はTypography、Navigation、Colors、Density、Spacing、Borders、Radius、Elevation、Forms、Tables、Motion、Information Architecture。複数選択でき、観点ごとに「参考にする／避ける」を指定する。

URL取得はログイン不要の公開HTTP(S)ページに限定し、1440×1000の初期表示を撮影する。取得日時、最終URL、viewportを記録する。30秒で打ち切り、失敗時は理由と画像アップロードの代替操作を表示する。

Codexには画像、取得できた限定的な構造情報、選択観点、ユーザーのメモを渡す。返却形式は観察・解釈・推奨を分離する。

```json
{
  "referenceId": "ref_01",
  "findings": [{
    "aspect": "density",
    "observation": "行間が狭く、罫線で行を区切っている",
    "interpretation": "一覧性を優先する傾向",
    "recommendation": "管理画面の一覧に採用候補",
    "certainty": "medium",
    "evidence": "画像中央の一覧領域"
  }]
}
```

スクリーンショットから正確なフォント名、px値、ホバー、動きを断定しない。Motionなど観測できない項目は「判断材料不足」とする。分析結果の採用前に設計へ反映しない。

### 5.4 Taste

7軸を各2問、計14問で比較する。A/Bは同じ内容・画面幅を使い、原則1軸だけを変える。

| 軸 | 0側 | 1側 |
| --- | --- | --- |
| density | ゆったり | 高密度 |
| roundness | 角張る | 丸い |
| decoration | 装飾を抑える | 装飾を使う |
| contrast | 控えめな差 | 強い差 |
| borderEmphasis | 境界線が弱い | 境界線が強い |
| shadowEmphasis | 影を使わない | 影を強調する |
| cardUsage | 連続した構成 | カードで分割 |

回答はA、B、どちらもよい、どちらも違う、スキップ。任意の理由メモを付けられる。各候補に固定の軸値を持たせ、有効回答の平均を軸値とする。「どちらもよい」は両候補の平均、「どちらも違う」とスキップは数値集計から除外する。未回答軸は `null` とし、0.5に決めつけない。

これは心理測定ではなく、対話のための仮説である。回答数と割れた回答を表示し、「精度94%」のような確率を作らない。質問セットのバージョン、回答、当時の比較設定を保存して再計算可能にする。

### 5.5 Design DNAの確認

Taste画面末尾に、参考分析と回答から作る「あなたの設計方針」を表示する。数値Profileと文章の原則を両方持ち、原則ごとに根拠を辿れるようにする。

例: 「一覧ではカードより行と区切り線を優先する。独立した商品や記事は例外とする」。

ユーザーは原則を編集・採用・保留できる。矛盾する参考を無理に平均化せず、「設定画面は余白広め、一覧は密にする」など用途別の適用範囲を提案する。

決定優先順位は、明示的なユーザー指定・ロック済みルール、採用済み原則、Taste回答、採用済み参考分析、初期値の順。好みの変化は履歴に残し、後から原則を変更できる。

### 5.6 Foundation

| 分類 | MVPの編集項目 |
| --- | --- |
| Color | 背景、面、本文、補助文字、境界、アクセント、成功、警告、危険、フォーカス |
| Typography | システムフォント系統、本文サイズ、見出し段階、行高、ウェイト |
| Spacing | 基本スケール、ページ余白、セクション間隔、コントロール・行の高さ |
| Radius | none、xs、sm、md、lg、pillと使用箇所 |
| Border | 太さ、色、区切り線の使用方針 |
| Shadow | なし、浮遊要素用、使用許可対象 |
| Motion | duration、easing、reduced-motion時の挙動 |
| Breakpoints | compact、medium、wideの境界とレイアウト方針 |

Codexは最大3候補を理由とともに提示する。候補は一時Previewで比較でき、「適用」で保存する。手動の数値編集も提供し、入力中の値は即時表示、確定操作でrevisionを作る。変更をまとめて取り消せる。

Tasteの数値からpx値への変換は決定的な唯一解ではない。初期マッピングとCodex提案を出発点とし、確定した具体値を保存する。ロックした項目はAI提案の変更対象から除外する。

### 5.7 Components

MVP対象はButton、Input、Select、Checkbox、Tabs、Dialog、Table、Badge。アプリに同梱したReact実装を共有トークンと許可済み設定で描画する。

各詳細画面に用途、variant、size、状態、利用ルール、根拠を表示する。少なくとも適用可能なdefault・hover・focus・disabled・error・loadingを確認できる。Dialogはフォーカス移動、Escape、閉じた後のフォーカス復帰を実装する。

MVPではCodexが返したTSXを実行しない。AIは既定の設定スキーマへの変更を提案する。「生成」は既定実装の設定生成を意味する。

### 5.8 Patterns

6種を提供する: PageHeader、FilterBar、ListPage、SettingsSection、FormSection、EmptyState。

各パターンは使用場面、構造、参照コンポーネント、余白、レスポンシブ動作、避ける構成を持つ。ListPageはPageHeader・FilterBar・Table・EmptyStateを組み合わせる。SettingsSectionには破壊的操作の領域を通常設定と分ける例を含める。

パターンはデザイン方針を画面構造へつなぐ必須成果物であり、MVPから省略しない。

### 5.9 Application Preview

同じ架空のプロジェクト管理アプリを使い、次の3画面を表示する。

- 一覧: 見出し、検索、状態フィルタ、テーブル、空状態。
- 設定: セクション、設定行、保存操作、危険な操作。
- フォーム: ラベル、補助文、必須項目、エラー、送信中状態。

幅は390 / 768 / 1440pxを選択できる。狭い画面ではナビゲーションを畳み、テーブルは横スクロール可能にする。検索・フィルタ・入力検証・Dialogはローカルのサンプルデータで動作する。

対話例: 「一覧だけ少し詰めたい」「角丸を弱くしたい」「カードを減らして」。変更対象、before/after、理由、影響画面を提示する。曖昧な指示は候補比較に変換する。

Previewは専用ルートとiframeでテーマを分離し、エクスポート時の画像にも同じレンダラーを使う。

### 5.10 AI Review

確定revisionのDNA・ルール・設定・3画面の画像を入力としてレビューする。

指摘は `ruleId / targetPath / severity / evidence / explanation / suggestedChange` を持つ。決定的に検証できる項目と、AIの解釈による指摘を区別する。

- ルール検証: 未解決トークン、禁止対象の影、最大角丸、必要な状態の欠落など。
- AIレビュー: 階層、密度、カード分割、ユーザーが選んだ印象とのずれなど。

MVPでは根拠のない総合点や百分率を表示しない。「検証済みルール数」「違反数」「要判断の指摘数」を表示する。問題なしの断定には検証範囲を添える。

「修正案を作成」→一時Preview→「まとめて適用」の順に操作する。指摘を見送る際は任意の理由を記録できる。revision変更後のレビューは古い結果と表示する。

### 5.11 Export

出力前に確定revisionと未確認項目を表示する。未採用の提案は含めない。構造が不正な場合は中止し、未確認項目がある有効な設計は「Draft」として出力できる。

```text
tasteprint-<project-slug>-r<revision>/
├── DESIGN.md
├── design-system.json
├── tokens/
│   ├── tokens.json
│   └── variables.css
├── ui/                       # 確認済みテンプレートから出力
│   ├── components/
│   ├── patterns/
│   └── index.ts
├── examples/
│   ├── ListPage.tsx
│   ├── SettingsPage.tsx
│   ├── FormPage.tsx
│   ├── list.png
│   ├── settings.png
│   └── form.png
├── manifest.json             # revision、schema/template version、依存情報
└── README.md                 # 導入方法、必要な依存関係、確認した利用環境
```

`DESIGN.md`の章は、Design Philosophy、Decision Priorities、Visual Hierarchy、Colors、Typography、Spacing、Radius、Borders and Shadows、Motion、Responsive Behavior、Components、Application Patterns、Do / Don't、Exceptions、Open Questionsとする。

原則には理由・適用範囲・具体例を添える。文章は保存された確定データからテンプレートで生成し、出力時のAI呼び出しで意味を変えない。JSON、CSS、React例、画像はすべて同じrevisionを使う。

ZIPに参考サイト画像・認証情報・Codex会話ログは含めない。参考の出典はURLと採用理由として記載する。画像生成失敗時は完全な出力として扱わず、再試行または明示的な「画像なし出力」を選べるようにする。

## 6. データ設計

### 6.1 正本と保存先

稼働中の正本はSQLite内の確定した `DesignSystem` スナップショット。`design-system.json` はその同一構造の可搬表現とする。JSONとDBを別々に編集する二重の正本は作らない。

画像・ジョブ入力・出力ZIPはファイルシステムに保存する。パスはサーバーがIDから生成し、ユーザーが任意のホストパスを指定する機能は設けない。

| エンティティ | 主なデータ |
| --- | --- |
| Project | id、name、brief、activeRevision、archivedAt、timestamps |
| Reference | projectId、source、aspects、notes、captureMetadata、assetIds、analysis |
| TasteAnswer | projectId、questionSetVersion、questionId、choice、reason、candidateValues |
| DesignRevision | projectId、revision、schemaVersion、snapshot、changeReason、createdAt |
| Proposal | projectId、baseRevision、summary、changes、evidence、status |
| Conversation | projectId、codexThreadId、contextVersion |
| Message | conversationId、role、text、jobId、createdAt |
| Job / JobEvent | projectId、type、state、inputRevision、sequence、result、error |
| Review | projectId、revision、findings、coverage、status |
| Export | projectId、revision、manifest、artifactPath、status |

### 6.2 DesignSystemの論理構造

以下は型設計の骨格。実装では各型をZodで定義し、入出力の境界で検証する。

```ts
type DesignSystem = {
  schemaVersion: 1;
  projectId: string;
  revision: number;
  brief: ProjectBrief;
  dna: {
    profile: Record<TasteAxis, number | null>;
    principles: Principle[]; // id, statement, rationale, scope, evidence, status
    rules: DesignRule[];    // id, target, constraint, exceptions, locked
  };
  foundations: Foundations;
  components: ComponentConfig[];
  patterns: PatternConfig[];
  decisions: Decision[];    // 対象パス、理由、出典、user/ai/default、確認状態
};
```

色・余白などは意味上の名前で参照し、各コンポーネントに同じ値をコピーしない。DTCG形式のtokensはこの構造から変換する。採用するDTCG版を固定し、色・寸法・参照のシリアライズを検証する。

### 6.3 変更と競合

AI提案は `baseRevision` と許可されたパスへの変更一覧を返す。サーバーは型・範囲・ロック・参照整合性を検証し、適用時に新revisionを1トランザクションで作る。

古いrevision向け提案は409として拒否し、再提案を案内する。再送には冪等キーを使い、二重適用を防ぐ。「元に戻す」は以前のスナップショットを新revisionとして復元する。入力ミスやAI失敗で最後の有効な設計を失わない。

## 7. Codex連携

### 7.1 実行方式と認証

HonoをHTTP窓口とするNode.jsサービス側からTypeScript Codex SDKを利用する。公式SDKはローカルthreadの開始・継続・IDによる再開を提供する。[O1]

ホストでChatGPTログインしたCodexを利用する。CodexはChatGPTによるサブスクリプションアクセスとAPIキーによる従量アクセスを区別するため、MVPではChatGPT認証を前提とし、APIキーへの自動フォールバックを禁止する。[O2]

「無料・無制限」は表示しない。利用可能量は契約・アカウントの状態に従い、上限時は処理を止めて編集内容を保持する。認証方式を確認できなければAI処理を開始せず、セットアップ案内を表示する。SDK子プロセスにはAPIキーや意図しないprovider設定が混入しないよう設定を検証する。

### 7.2 アダプターの責務

`CodexGateway` に `checkConnection / analyzeReference / synthesizeDNA / proposeChange / review / cancel` を集約する。UIやドメイン層からSDKを直接呼ばない。

プロジェクト単位でthread IDを保存するが、thread履歴を正本にしない。毎回、対象revision・確定ルール・必要な根拠を渡す。再開不能なら新threadを作り、確定データと会話要約で継続する。他プロジェクトの入力を共有しない。

役割プロンプトには、模倣せず抽象化する、観測と推測を分ける、ユーザー判断を優先する、根拠を示す、ロックを守る、不明点を捏造しない、指定スキーマで返す、を含める。

SDKの具体的なオプション名や画像入力、構造化出力、中断方式は実装開始時の固定バージョンで確認する。公式資料では認証・履歴・承認などを扱うカスタムクライアント向けにApp Serverも案内されているが、MVPは限定タスクのSDK連携とする。[O1] 必須機能に不足が判明した場合はアダプター内部の切り替えとして設計判断を記録する。

### 7.3 実行境界

Codexにはジョブ専用の入力スナップショットを渡し、正本DB・アプリソースへの書き込みを許可しない。読み取り専用sandboxとネットワーク制限を適用し、MCP・外部ツール・ユーザーの自動フック等の不要な継承を無効化する。作業ディレクトリ指定だけをアクセス制限とみなさない。

参考ページ中の文章は分析対象のデータであり、命令として扱わない。Codexの返却値は常に検証し、命令文・コード・任意パスを直接実行しない。

### 7.4 ジョブと進捗

```text
queued → running → succeeded
                → failed
                → canceled
                → interrupted（プロセス再起動）
```

HTTP要求内で完了を待たず、202とjob IDを返す。ローカルの常駐workerがSQLiteキューを処理し、ブラウザは約1秒間隔の短いポーリングでイベントを取得する。待機時は間隔を伸ばし、非表示タブでは頻度を落とす。

AIジョブは全体で同時1件、captureも同時1件。AIタイムアウトは初期値5分。中断要求後は子プロセス停止を確認するまで実行枠を解放せず、到着が遅れた結果を適用しない。上限・認証エラーは自動再試行しない。異常終了は明示的な再試行を提供する。

SDK内部のイベントとブラウザへの通信方式は分離する。Quick TunnelはSSE非対応のため、MVPはSSEを必須にしない。[C1]

## 8. 技術構成

| 用途 | 採用方針 |
| --- | --- |
| Frontend | React + Vite + TypeScript。クライアント側で編集・比較・Previewを描画 |
| Routing / Server state | TanStack Router / TanStack Query |
| API | Hono + Node.js adapter、Hono RPCによる入力・レスポンス型共有 |
| UI | React、CSS、テーマ用CSS変数、アクセシブルな既定部品。モックではCSSを直接記述 |
| AI | `@openai/codex-sdk`、ホストのCodex認証 |
| Capture / PNG | Playwright Chromium |
| Persistence | SQLite + マイグレーション + ローカルファイル |
| Schema | Zod、schemaVersion付きJSON |
| Export | 決定的なMarkdown / CSS / Reactテンプレート、DTCG変換、ZIP |
| Tests | 単体・DB統合テスト、Playwright E2E |
| 外部接続 | 任意のCloudflare Named Tunnel + Access |

アプリサーバーとworkerは同一リポジトリ・同一言語で管理し、起動コマンド1つで起動する。開発時はViteから `/api` をHonoへプロキシし、通常実行時はHonoがビルド済みフロントも同一originから配信する。Codex CLIやChromiumは子プロセスになるため、OS上の「単一プロセス」は要件にしない。サーバーレス・Edge runtimeへの配置は対象外。

## 9. ディレクトリ構成

モックでは単一packageを使用する。フロント、共有ドメイン、サーバーを分離し、必要になった段階でworkerや永続化を追加する。

```text
tasteprint/
├── README.md
├── SPEC.md
├── package.json / package-lock.json
├── index.html
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── client/
│   │   ├── main.tsx                # TanStack Router / Queryの初期化
│   │   ├── workspace.tsx           # 8段階のモック画面
│   │   ├── state.ts                # モック保存境界
│   │   ├── api.ts                  # Hono RPCクライアント
│   │   ├── styles.css              # ワークスペース・テーマ分離
│   │   └── components/Preview.tsx  # 同じ設定を共有する3画面
│   ├── domain/design.ts           # Zod・Taste集計・Markdown変換
│   └── server/
│       ├── app.ts                 # Honoルートとモック提案
│       └── index.ts               # Node起動・静的配信・終了処理
├── tests/                         # ドメイン/APIテストと操作E2E
├── docs/
│   ├── architecture.md
│   └── mockup.md
└── dist/                          # Git管理外のビルド出力
    ├── client/
    └── server/
```

本実装では `src/server/services/`、`repositories/`、`codex/`、`capture/`、`jobs/` と `workers/`、`migrations/` を追加する。Codex・保存・Exportの処理にHonoのContextを渡さず、HTTP層に依存しないサービスにする。Preview実装は `design-runtime/` へ抽出し、出力用テンプレートと共用する。

実行データはGit管理外の `~/.tasteprint/` を初期値とし、`TASTEPRINT_DATA_DIR` で変更できる。

```text
~/.tasteprint/
├── tasteprint.sqlite
└── projects/<project-id>/
    ├── references/
    ├── jobs/<job-id>/
    └── exports/<revision>/
```

## 10. APIの境界

すべてプロジェクト所有関係をサーバーで検証する。変更APIはrevisionまたは冪等キーを受け取る。

| Method / Path | 責務 |
| --- | --- |
| GET / POST `/api/projects` | 一覧・作成 |
| GET / PATCH `/api/projects/:id` | 基本情報・アーカイブ |
| GET / POST `/api/projects/:id/references` | 参照一覧・登録 |
| PATCH / DELETE `/api/projects/:id/references/:refId` | メモ・観点変更・参照除外 |
| PUT `/api/projects/:id/taste/:questionId` | 回答の保存・変更 |
| GET `/api/projects/:id/design` | 確定スナップショット |
| POST `/api/projects/:id/changes` | 手動変更の検証と確定 |
| POST `/api/projects/:id/jobs` | capture / analyze / synthesize / propose / review / export |
| GET `/api/projects/:id/jobs/:jobId?after=:sequence` | 状態・増分イベント |
| POST `/api/projects/:id/jobs/:jobId/cancel` | 中断要求 |
| GET `/api/projects/:id/conversation` | 保存済み会話 |
| POST `/api/projects/:id/proposals/:proposalId/apply` | 提案の確定 |
| POST `/api/projects/:id/proposals/:proposalId/reject` | 提案の見送り |
| GET `/api/projects/:id/revisions` | 変更履歴 |
| POST `/api/projects/:id/revisions/:revision/restore` | 復元revision作成 |
| GET `/api/projects/:id/reviews` | revision別レビュー |
| GET `/api/projects/:id/exports/:exportId` | 完成済み成果物のダウンロード |
| GET `/api/connection` | 秘密情報を含まない接続診断 |

エラーは `code / message / retryable / jobId?` を返す。認証切れ、利用上限、取得失敗、モデル返却値不正、revision競合、ディスク容量不足を識別し、既存の設計は保持する。

## 11. ローカル運用・外部接続・データ保護

### ローカル標準モード

`127.0.0.1:3000` にbindし、許可Host・Originを検証する。状態変更と機密データ取得にはアプリセッションを要求し、初回起動時にホストに表示したワンタイムコードでブラウザを紐付ける。セッションはHttpOnly・SameSite Cookieで管理する。

URL入力はSSRF対策としてloopback、private、link-local、メタデータ宛先などを拒否する。リダイレクト・サブリソースも対象にし、DNS検証だけに頼らずブラウザの通信経路でも内部宛先を遮断する。内部Preview撮影は別の固定URL専用経路を使う。

画像は形式・実サイズを検証し、安全な画像形式に再エンコードする。HTMLやSVGはアップロード対象外。秘密情報・生の認証データをDBやログ、Exportに保存しない。

保存と編集はローカルだが、Codex分析時には選択した画像・文章・設計情報がOpenAI側へ送信される。AI処理前に送信対象を画面で確認できるようにし、完全オフラインのアプリとは説明しない。

### 外部接続

通常利用はNamed Tunnelで公開hostnameをlocalhostへ接続し、Cloudflare Accessで本人だけを許可する構成とする。[C2] アプリ側でもAccessトークンの署名・issuer・audience・有効期限と許可ユーザーを検証し、未認証のAI実行を拒否する。

Quick Tunnelは開発時の一時確認に限定する。ランダムURLは認証にならないため、アプリ側の紐付けとセッションを必須にし、SSE依存も避ける。[C1] Tunnel作成・DNS設定・Accessの管理画面操作はMVPアプリに組み込まず、セットアップ文書で案内する。

## 12. 非機能要件

- 初期対象: macOSホスト、デスクトップの最新安定版Chrome。その他OS・ブラウザは後続検証。
- Previewは390px以上、編集UIは1280px以上で快適に操作できることを優先する。
- トークン変更からPreview反映まで通常操作で100ms以内を目標にする。AI待ち時間とは分けて測定する。
- キーボードで主要フローを操作でき、可視フォーカス、入力ラベル、エラー関連付けを提供する。
- オフラインでは手動編集・保存・コード出力を利用でき、CodexとURL取得だけが利用不可になる。
- DBはマイグレーション方式とし、変更前にバックアップする。スナップショット復元と画像を含むデータディレクトリのバックアップ手順を用意する。
- 再起動時の実行中ジョブはinterruptedへ移し、自動でAI処理を再実行しない。
- ログにはジョブID、処理時間、エラー分類を残し、認証情報や分析入力全文を標準で残さない。

## 13. 実装順序

### M0: 技術検証

ホストのChatGPT認証を使ったSDK呼び出し、画像入力、構造化結果、thread再開、中断、権限制限を小さな検証で確認する。SDK・CLI・Node.jsの採用バージョンを固定し、接続手順を記録する。API従量課金経路へのフォールバックがないことを確認する。

### M1: AIなしで一巡する基盤

Project、SQLite、DesignSystemスキーマ、revision、手動Foundation編集、3画面Preview、JSON・Markdown出力を実装する。

### M2: 好みを蓄積する体験

参考画像・公開URL取得、観点選択、14問のTaste、根拠を持つDNA、Codex分析と採用操作を実装する。

### M3: 対話で整える体験

提案の差分・一時Preview・適用・復元、Components、Patterns、AI Review、ジョブ復旧を実装する。

### M4: 持ち出して使える品質

DTCG・CSS・React例・PNG・ZIP、出力の整合性検証、接続認証、Tunnel手順、E2Eを仕上げる。

MVP完成はM4までとする。途中段階のデモを、全仕様の完成として扱わない。

## 14. 受け入れ条件

| ID | 操作・条件 | 合格条件 |
| --- | --- | --- |
| AC01 | プロジェクト作成→編集→再起動 | 同じ設計・回答・参照・会話に戻れる |
| AC02 | 異なる参照からTypographyとColorsを選択 | 観点と出典が混ざらず、採用理由を辿れる |
| AC03 | URL取得が失敗 | 理由が分かり、画像アップロードで続行できる |
| AC04 | Tasteの回答変更・スキップ | 固定ルールで再計算され、未回答は未確定になる |
| AC05 | 「角丸を弱く」と依頼 | before/afterと影響範囲が表示され、採用前に正本は変わらない |
| AC06 | 提案生成中に手動編集 | 古い提案の適用を拒否し、手動変更を保持する |
| AC07 | 候補適用→元に戻す | 3画面と確定データが以前の内容へ一貫して戻る |
| AC08 | ロックした項目を含むAI出力 | サーバーで拒否し、値を保持する |
| AC09 | AI停止・上限・不正JSON・再起動 | 保存内容を失わず、状態と再試行方法が分かる |
| AC10 | ComponentsとPatternsを編集 | Preview・DESIGN.md・出力コードに同じ設定が反映される |
| AC11 | Review後にrevision変更 | 古い結果と表示され、根拠付きで再レビューできる |
| AC12 | ZIPを出力 | 全ファイルが同じrevisionを指し、JSONとCSSが整合する |
| AC13 | 出力React例を用意した検証用アプリに配置 | 記載依存関係で型チェック・ビルドでき、3画面が表示される |
| AC14 | 外部から認証なしでアクセス | 設計・画像・ジョブ・AI実行にアクセスできない |
| AC15 | 内部URL・内部宛リダイレクトを参照登録 | アクセスを遮断し、他のジョブへ影響しない |
| AC16 | Quick Tunnel経由でAI処理 | ポーリングで進捗・完了を取得できる |
| AC17 | 390px Previewとキーボード操作 | 横幅方針・フォーカス・Dialog・フォームが機能する |

単体テストはTaste集計、変更検証、出力変換に集中する。統合テストはrevision競合・ジョブ中断・保存復旧・認証・URL取得制限を検証する。E2Eは「画像登録→Taste→提案採用→Preview→Review→Export」をモックCodexで再現し、実Codexの接続確認は明示実行のsmoke testに分ける。

## 15. 実装時に確定する事項

プロダクト範囲は本書を初期決定とする。次の事項だけはM0または各実装段階で証拠を残して確定する。

1. 使用するSDK・CLIの正確なバージョンと、画像入力・中断・制限設定の具体API。
2. 利用アカウントでの認証方式の検出方法と、選択可能なモデル。モデル名をUIやスキーマへ固定しない。
3. DTCGの採用版、トークン変換の検証方法、React出力の依存バージョン。
4. Named Tunnelで使用するドメイン、Accessのaudience、本人の許可ID。ローカルMVP開発をこれらの未設定で止めない。

## 16. 参考資料

以下の外部仕様を確認した日: 2026-09-10。本文のMVP範囲、画面数、上限、データ構造、実装順序はTasteprintの設計判断である。

- [O1: OpenAI — Codex SDK](https://learn.chatgpt.com/docs/codex-sdk): TypeScript SDK、threadの開始・再開、SDKとApp Serverの位置づけ。
- [O2: OpenAI — Authentication](https://learn.chatgpt.com/docs/auth): ChatGPT認証とAPIキー認証、CLIのログイン状態確認、認証情報の扱い。
- [C1: Cloudflare — Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/): 一時公開、開発用途、SSE非対応。
- [C2: Cloudflare — Routing](https://developers.cloudflare.com/tunnel/routing/): 公開hostnameとローカルサービスの接続。


## 17. モックアップの実装範囲

2026-09-10時点で、React + Vite + TanStack Router / Query + Hono（Node.js）を採用。比較・判断理由は [docs/architecture.md](./docs/architecture.md) に記録する。

### 動作するもの

- 8段階の画面遷移。初期画面はFoundation。
- 参考URLと画像の登録・削除、参考にする観点の切り替え。初期参照はサンプル。
- 7軸×2問のTaste比較、回答保存、未回答をnullにしたProfile表示。
- 色、文字サイズ、余白、角丸、区切り線、影の変更と取り消し。
- 一覧・設定・フォームのPreview、検索、状態フィルタ、サンプルプロジェクト追加。
- 既定コンポーネントと6パターンの表示例。
- Hono RPCへの要求による定型モック提案、Preview仮反映、採用・見送り。
- 現在の設定の簡易チェックとDraftのMarkdown / JSON / CSS個別ダウンロード。

### 本実装と区別するもの

- 保存先はブラウザのlocalStorage。単一サンプルワークスペースのみ。サーバー保存・SQLite・revision永続化・複数プロジェクトは未実装。
- 画像はモックのブラウザ保存容量に合わせて2MB以下。MVPの10MB要件への対応はfilesystem導入後。
- Codexを呼ばない。ルールベースの提案であることをUIに表示し、未対応の依頼には対応していないと返す。
- URLの内容取得・スクリーンショット撮影は行わない。参考一覧の初期画像はCSSによる説明用の図。
- 認証・Tunnel・バックグラウンドジョブは未実装。開発サーバーはloopbackで起動する。
- Previewは同じReactコンポーネントのCSS変数でテーマを分離。iframe隔離と固定1440pxの画像出力は本実装で追加する。現段階の幅切り替えは利用可能な領域内での表示。
- 原則生成、DTCG変換、React / PNG / ZIPの一括出力、完全なAIレビューは未実装。
- M0〜M4の完了ではなく、操作と視覚設計を検証する先行モックと位置づける。

起動方法と検証方法は [README.md](./README.md)、操作ガイドは [docs/mockup.md](./docs/mockup.md) を参照する。

## 18. 参考URL取得・分析の実装状況（Issue #1）

第17章は初期モック時点の記録。現在のInspirationは公開URLの撮影、取得情報・限定構造情報、10MB画像アップロード、観点ごとの意図とメモ、Codex分析、根拠付き結果の明示採用に対応する。

参考とジョブはSQLite・ファイルに保存し、実行中断、タイムアウト、再起動によるinterrupted、古い入力の反映拒否を扱う。専用プロキシで接続先IPを固定し、内部アドレスへのリダイレクト・サブリソースも遮断する。運用・制約・自動テストの詳細は [docs/url-capture.md](./docs/url-capture.md) を参照。

プロジェクトは既存の単一ワークスペースを使用する。他の段階のサーバー保存・全体revision・複数プロジェクト・Tunnel対応まで完成したものではない。

## 19. Foundation拡充の実装状況（Issue #2）

Foundationは8分類の詳細トークン、項目ロック、適用範囲・例外・理由・出典の編集に対応する。確定スナップショットと変更理由をSQLiteへ保存し、Codex候補の比較・採用、履歴復元、確定revisionからのMarkdown / JSON / CSS出力を接続した。ロックは生成対象スキーマとサーバー適用時の両方で保護し、古いrevisionの候補を拒否する。既存6項目のブラウザデータは初回のみ移行する。

Foundation単位のrevisionを追加した段階であり、全プロジェクトのDesignSystem正本への統合、DTCG・React・PNG・ZIP出力は引き続き別実装。自由記述の適用方針は保存・AI文脈として扱い、任意の文章をPreviewコードとして実行しない。操作・データ・検証範囲は [Foundation](./docs/foundation.md) を参照。

## 20. 実画面レビューの実装状況（Issue #4）

§5.10の実画面レビューを実装。確定Foundation revisionのDNA・設定・ルールと、独立したPreviewレンダラーによる3画面PNGを保存し、機械検証とCodex解釈を区別する。根拠・関連ルール・検証範囲、候補の仮Preview／明示適用、見送り理由と古いrevisionの保護に対応する。§17の簡易チェック・iframe未対応の記載はこの実装で置き換える。検査対象と制約、テストは [AI Review](./docs/review.md) を参照。
