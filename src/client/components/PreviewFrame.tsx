import { useEffect, useRef, useState } from "react";
import { designSchema, type Design } from "../../domain/design";
import { ComponentSpecimen } from "../design-runtime/Library";
import {
  componentNames,
  patternNames,
  type ComponentName,
  type PatternName,
} from "../../domain/library";
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
        [
          "list",
          "settings",
          "form",
          ...componentNames.map((n) => `component:${n}`),
          ...patternNames.map((n) => `pattern:${n}`),
        ].includes(event.data.screen)
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
  if (!input) return null;
  if (input.screen.startsWith("component:"))
    return (
      <ComponentSpecimen
        key={input.screen}
        design={input.design}
        name={input.screen.slice(10) as ComponentName}
      />
    );
  if (input.screen.startsWith("pattern:")) {
    const pattern = input.screen.slice(8) as PatternName;
    return (
      <Preview
        key={pattern}
        design={input.design}
        pattern={pattern}
        screen={
          pattern === "SettingsSection"
            ? "settings"
            : pattern === "FormSection"
              ? "form"
              : "list"
        }
      />
    );
  }
  return <Preview key={input.screen} {...input} />;
}
export function PreviewFrame({
  design,
  screen = "list",
  width,
}: {
  design: Design;
  screen?: string;
  width?: number;
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
      style={{
        width: width ?? "100%",
        minWidth: width,
        height: 800,
        border: 0,
      }}
    />
  );
}
