import type { ReactNode } from "react";
export function EditorActions({
  scope,
  target,
  revision,
  dirty,
  busy,
  stale,
  error,
  notice,
  preview,
  invalid,
  disabledReason,
  children,
}: {
  scope: string;
  target: string;
  revision: number;
  dirty: boolean;
  busy?: boolean;
  stale?: boolean;
  error?: string;
  notice?: string;
  preview?: boolean;
  invalid?: boolean;
  disabledReason?: string;
  children: ReactNode;
}) {
  const status = busy
    ? "保存中"
    : stale
      ? "古い版・確認が必要"
      : error
        ? "保存失敗"
        : invalid
          ? "入力の確認が必要"
          : dirty
            ? "下書き・未保存"
            : "保存済み";
  return (
    <div className="editor-actions" aria-label={`${target}の保存操作`}>
      <div className="editor-status" role="status" aria-live="polite">
        <strong>
          {scope} · {target}
        </strong>
        <span>
          {status} · {target === "共通の好み" ? "共通" : "設計"} r{revision}
        </span>
        {preview && <span>仮Preview · 出力は確定版を使用</span>}
        {notice && !dirty && !busy && !error && <span>{notice}</span>}
      </div>
      <div className="editor-buttons">{children}</div>
      {disabledReason && <p className="editor-help">{disabledReason}</p>}
      {error && (
        <p className="editor-error" role="alert">
          {error} 入力は保持しています。
        </p>
      )}
    </div>
  );
}
