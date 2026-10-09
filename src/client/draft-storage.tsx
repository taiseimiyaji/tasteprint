import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
export type DraftRecovery<T> = {
  blocked: boolean;
  conflict?: boolean;
  retry: () => void;
  replace: (value?: T) => void;
};
export function useStoredDraft<T>(
  key: string,
  initial: T,
  decode: (stored: unknown) => T,
  encode: (value: T) => unknown = (value) => value,
) {
  const read = () => {
    try {
      const raw = localStorage.getItem(key);
      const stored = raw === null ? null : JSON.parse(raw);
      return {
        value: stored === null ? initial : decode(stored),
        blocked: false,
        conflict: false,
        raw,
      };
    } catch {
      return { value: initial, blocked: true, conflict: false, raw: null };
    }
  };
  const [draft, setDraft] = useState(read);
  const lastStored = useRef(draft.raw);
  const overwrite = useRef(false);
  const [error, setError] = useState("");
  const block = (conflict = false) => {
    setDraft((d) => ({
      ...d,
      blocked: true,
      conflict: conflict || d.conflict,
    }));
    setError(
      conflict
        ? "別タブの下書き変更を確認しました。再読込または明示置換を選んでください。"
        : "下書きの保存前確認に失敗しました。下書きを再読込してください。",
    );
  };
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== key && event.key !== null) return;
      try {
        if (event.storageArea !== localStorage) return;
        // Read the current value: a queued event may predate our own write/recovery.
        if (localStorage.getItem(key) !== lastStored.current) block(true);
      } catch {
        block();
      }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [key]);
  useEffect(() => {
    if (draft.blocked) return;
    try {
      // Events can be delayed or absent. Check again immediately before writing.
      // This detects observed changes; localStorage has no atomic compare-and-set.
      if (
        !overwrite.current &&
        localStorage.getItem(key) !== lastStored.current
      ) {
        block(true);
        return;
      }
    } catch {
      block();
      return;
    }
    overwrite.current = false;
    try {
      const raw = JSON.stringify(encode(draft.value));
      localStorage.setItem(key, raw);
      lastStored.current = raw;
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
    conflict: draft.conflict,
    retry: () => {
      const next = read();
      if (next.blocked) {
        // A failed reread cannot replace the input we were protecting.
        setDraft((d) => ({ ...d, blocked: true }));
        setError("下書きを再読込できません。表示中の入力は保持しています。");
        return;
      }
      lastStored.current = next.raw;
      overwrite.current = false;
      setDraft(next);
    },
    replace: (value = draft.conflict ? draft.value : initial) => {
      // Existing explicit replacement is allowed even when storage is unreadable.
      overwrite.current = true;
      setDraft({
        value,
        blocked: false,
        conflict: false,
        raw: lastStored.current,
      });
    },
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
        {recovery.conflict ? (
          <>
            {label}
            の下書きが別タブ・別画面で変更されています。自動保存を停止し、この画面の入力と別タブの保存内容を保持しています。この画面の入力はまだ保存していません。移動・再読み込み前に回復操作を選んでください。再読込すると、この画面の入力を別タブの下書きで置き換えます。表示中の内容で置き換えると、別タブの下書きを上書きします。
          </>
        ) : (
          <>
            {label}
            の下書きを読み込めません。保存した下書きを保持しています。編集を始める前に再読込するか、表示中の内容で下書きを置き換えてください。
          </>
        )}
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
