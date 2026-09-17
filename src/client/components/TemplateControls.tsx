import type { ComponentProps } from "react";

// Shared, versioned native controls used by Preview and the portable export.
export function Button(props: ComponentProps<"button">) {
  return <button {...props} />;
}
export function Input(props: ComponentProps<"input">) {
  return <input {...props} />;
}
export function Select(props: ComponentProps<"select">) {
  return <select {...props} />;
}
