import { useEffect, useRef, useState } from "react";
import { designSchema, type Design } from "../../domain/design";
import { Preview } from "./Preview";
export function PreviewRenderer() {
  const [input, setInput] = useState<{ design: Design; screen: string }>();
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        event.data?.type !== "tasteprint-preview"
      )
        return;
      const parsed = designSchema.safeParse(event.data.design);
      if (
        parsed.success &&
        ["list", "settings", "form"].includes(event.data.screen)
      )
        setInput({ design: parsed.data, screen: event.data.screen });
    };
    addEventListener("message", receive);
    document.documentElement.dataset.rendererReady = "true";
    window.parent.postMessage(
      { type: "tasteprint-preview-ready" },
      location.origin,
    );
    return () => removeEventListener("message", receive);
  }, []);
  return input ? <Preview key={input.screen} {...input} /> : null;
}
export function PreviewFrame({
  design,
  screen = "list",
}: {
  design: Design;
  screen?: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const send = () =>
    ref.current?.contentWindow?.postMessage(
      { type: "tasteprint-preview", design, screen },
      location.origin,
    );
  useEffect(() => {
    const ready = (event: MessageEvent) => {
      if (
        event.origin === location.origin &&
        event.source === ref.current?.contentWindow &&
        event.data?.type === "tasteprint-preview-ready"
      )
        send();
    };
    addEventListener("message", ready);
    send();
    return () => removeEventListener("message", ready);
  }, [design, screen]);
  return (
    <iframe
      ref={ref}
      title={`${screen} Preview`}
      src="/preview-render"
      onLoad={send}
      style={{ width: "100%", height: 800, border: 0 }}
    />
  );
}
