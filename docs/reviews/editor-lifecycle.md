# 設計を切り替えるときのeditor状態の監査

Issue #176。監査対象はmain `335b9b46dfe888935216812585274871601e7d40`。
[Workspace](../../src/client/workspace.tsx)、主要editor、保存・復旧処理を読み、既存仕様・回帰テストへ対応付けた。
旧入力の検証状態を正常化する処理が、子editorのmount時通知に依存する共通原因を確認した。

Foundationの不正カラー入力を1440px、Patternsの空gap入力を390pxで使い、Preview Undo、Preview AI採用、Review適用の3経路だけを実行した。
6件とも、設計の置換後も親の`validInput=false`が残った。Undo後は正しい下書きを保存できず、AI採用・Review適用後は正しいr2にも入力確認の表示が残った。
自動的な確定データの破壊は観測していない。

## 経路と保持・置換の区別

| 経路                                      | 入力・検証                                                   | 候補・Undo                           | 根拠・検証                                                     |
| ----------------------------------------- | ------------------------------------------------------------ | ------------------------------------ | -------------------------------------------------------------- |
| Foundationの有効な編集                    | 値を変更し、その項目のrawエラーだけ解消                      | 候補を解除、編集前の設計をUndoへ追加 | `FoundationEditor.edit`、`updateDesign`、category-input        |
| Foundation分類切替・Patternsのpattern切替 | 独立したエラーとraw入力を保持                                | 設計を置き換えない                   | category-input                                                 |
| Components項目切替                        | 制御された項目値を表示。gap用raw検証は使わない               | 設計を置き換えない                   | LibraryEditor、library-journey                                 |
| Workspace内の主要画面切替                 | 共有するdesign/baseを保持。表示切替だけでは設計を採用しない  | 共有する候補・Undoを保持             | ProjectArea、workspace、proposal-order                         |
| project切替・ブラウザー再読込             | scope別の保存下書きをdecode。読取失敗は編集を停止            | 新しいWorkspaceの一時状態            | draft-storage、project-journey                                 |
| 外部の確定版読取・409後の読取             | savedのみ更新し、下書きと元baseを保持                        | 入力の文脈を保持                     | Workspaceの読取・catch、既存の外部更新回帰                     |
| 下書きの明示再読込成功                    | 読み込んだ設計へ置換し、検証とraw入力を初期化                | 候補・Undoを解除                     | draft-reload-input、draft-reread-context                       |
| 再読込失敗・表示内容での明示置換          | 表示中の入力・検証を保持                                     | 候補・Undoを保持                     | 同上、draft-storage                                            |
| 取消・最新の確定版を読み込む              | saved design/baseへ置換し、入力・検証を初期化                | 候補・Undoを解除                     | category-input、editor-adoption-validation                     |
| 保存・AI採用・復元の成功                  | 応答の検証済みdesign/baseへ置換し、入力・検証を初期化        | 候補・Undoを解除                     | commit、workspace、library-journey、editor-adoption-validation |
| Undo                                      | 直前の編集設計へ置換し、raw入力・検証を初期化                | 候補を解除、Undoを1件だけ戻す        | editor-adoption-validation                                     |
| Review適用成功                            | 応答のdesign/baseへ置換し、入力・検証を初期化                | 候補・Undoを解除                     | review-completion、editor-adoption-validation                  |
| 更新の失敗                                | 表示中の入力を置き換えない。409のsaved更新とは区別           | 現在の文脈を保持                     | 既存失敗回帰、新回帰のAI/Review拒否                            |
| Referenceの方針だけの保存                 | 数値設計は変更せず、一致・正常な下書きのbaseだけ進める       | 設計編集の文脈を保持                 | commitPolicy、reference-policy                                 |
| Profile・Overview・Reference編集          | 制御されたdraft値を採用／保持。Workspaceの検証flagを使わない | 設計候補・Undoを持たない別のeditor   | projects、References、既存draft/reply回帰                      |
| 候補の選択・見送り                        | 仮Previewだけを切り替える。draftと検証を置き換えない         | 選択／解除。設計のUndoは保持         | proposal-order、workspace                                      |

`resetEditorInput`で親の検証状態とeditorVersionを明示的に初期化する。
`resetDraftContext`はそれに候補・Undoの解除を加え、成功した設計採用の4箇所で共有する。
Undoは前者だけを使い、残りの履歴を保持する。
子editorが表示されているかどうかで、設計採用の完了状態が変わらないようにする。

## 検証方法と限界

新しい`editor-adoption-validation`は3経路×上記2条件を確認し、保存・JSON・再表示の設計一致まで検証する。
代表的なAI/Reviewの拒否では候補と未変更の確定版を保持し、Undoの2条件ではPreviewでの取消とeditor表示中の復元も確認する。
分類切替・再読込・明示置換・遅い候補・Review失敗は既存回帰へ対応付け、関連範囲を再検証する。
Mock AIと隔離SQLiteを使い、実Codex呼出は0件。

これは全操作順序・全画面幅の組合せを検査した結果ではない。
Foundation/Patternsのraw不正入力は子editorの一時状態で、現在は主要画面のunmountをまたいで保存されない。
分類／pattern切替中の保持は既存契約だが、主要画面間でもraw文字列を保持する仕様上の保証は確認していない。
Overviewへ移るとWorkspace自体もunmountする。この監査では新しいraw入力の永続化仕様を追加していない。
外部読取、失敗、明示置換、方針だけの更新は設計採用と同じリセットにはまとめない。
