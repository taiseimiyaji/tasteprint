import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
export type DraftRecovery<T> = {
  blocked: boolean;
  retry: () => void;
  replace: (value?: T) => void;
};
export function useStoredDraft<T>(
  key: string,
  initial: T,
  decode: (stored: unknown) => T = (stored) => stored as T,
  encode: (value: T) => unknown = (value) => value,
) {
  const read = () => {
    try {
      const raw = localStorage.getItem(key);
      const stored = raw === null ? null : JSON.parse(raw);
      return {
        value: stored === null ? initial : decode(stored),
        blocked: false,
      };
    } catch {
      return { value: initial, blocked: true };
    }
  };
  const [draft, setDraft] = useState(read);
  const [error, setError] = useState("");
  useEffect(() => {
    if (draft.blocked) return;
    try {
      localStorage.setItem(key, JSON.stringify(encode(draft.value)));
      setError("");
    } catch {
      setError("下書きを保存できません。空き容量を確認してください。");
    }
  }, [key, draft]);
  const setValue: Dispatch<SetStateAction<T>> = (update) =>
    setDraft((d) => ({
      ...d,
      value:
        typeof update === "function"
          ? (update as (value: T) => T)(d.value)
          : update,
    }));
  const recovery: DraftRecovery<T> = {
    blocked: draft.blocked,
    retry: () => setDraft(read()),
    replace: (value = initial) => setDraft({ value, blocked: false }),
  };
  return [draft.value, setValue, error, recovery] as const;
}
export function DraftReadRecovery<T>({
  label,
  recovery,
  disabled = false,
}: {
  label: string;
  recovery: DraftRecovery<T>;
  disabled?: boolean;
}) {
  if (!recovery.blocked) return null;
  return (
    <div role="alert" className="editor-error">
      <p>
        {label}
        の下書きを読み込めません。保存した下書きを保持しています。編集を始める前に再読込するか、表示中の内容で下書きを置き換えてください。
      </p>
      <button
        className="button"
        type="button"
        disabled={disabled}
        onClick={recovery.retry}
      >
        {label}の下書きを再読込
      </button>
      <button
        className="button"
        type="button"
        disabled={disabled}
        onClick={() => recovery.replace()}
      >
        {label}の下書きを表示中の内容で置き換える
      </button>
    </div>
  );
}
