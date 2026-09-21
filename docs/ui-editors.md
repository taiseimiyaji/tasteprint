# 編集画面の統一 (#16)

共通の好み、概要・方針、Foundation、Components、Patternsに同じ保存バーを使用する。プロジェクト名／適用範囲、編集対象、設計の版、未保存／保存中／保存済み／保存失敗／古い版を表示する。保存できない理由も表示し、AIの採用・見送りは同じ上部の操作位置に配置した。

競合時は最新の確定版の情報だけを取得して下書きを保持する。ユーザーが「最新の確定版を読み込む」を選ぶと下書きを置き換える。手動の編集とAI候補は仮Previewと明示し、Exportは確定版を使う。サーバーのrevision・ロック検証は維持する。

Foundationの各項目に日本語の意味・単位を表示。色や余白の不正入力は入力欄の近くに説明し、保存を止める。Components／Patternsの入力欄・チェックボックス・選択肢も共通の外観に揃えた。生の差分データは詳細を開いて確認する。

実描画を目視確認: [Foundation 1440px](ui-editors/editor-foundation-1440.png)、[Components 390px](ui-editors/editor-components-390.png)、[Patterns 768px](ui-editors/editor-patterns-768.png)、[概要 390px](ui-editors/editor-overview-390.png)。各編集画面の390/768/1440px画像を同じディレクトリに収録。

検証: E2E全19件成功、unit全84件成功、build/typecheck成功。保存失敗・入力保持・再試行、処理中の編集防止、再読み込み後の確定内容、競合保護と確定版の再読み込み、不正入力の取り消し、AI採用／見送り、サイドバーと小画面を含む。既存の画面遷移テストは描画完了を待ってから状態・位置を確認するよう修正した。
