import { designSchema, type Design } from "./design";
export function shadowValue(d: Design) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(d.shadowColor.slice(i, i + 2), 16))
    .join(", ");
  return `${d.shadowX}px ${d.shadowY}px ${d.shadowBlur}px ${d.shadowSpread}px rgba(${rgb}, ${d.shadowOpacity})`;
}
export function designVariables(input: Design): Record<string, string> {
  const d = designSchema.parse(input);
  const variables: Record<string, string> = {};
  const colors = [
    "accent",
    "canvas",
    "surface",
    "ink",
    "muted",
    "borderColor",
    "success",
    "warning",
    "danger",
    "focus",
  ] as const;
  for (const key of colors)
    variables[
      `--color-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
    ] = d[key];
  for (const key of [
    "heading1",
    "heading2",
    "heading3",
    "pagePadding",
    "sectionGap",
    "controlHeight",
    "rowHeight",
    "radiusNone",
    "radiusXs",
    "radiusSm",
    "radiusLg",
    "radiusPill",
    "borderWidth",
    "compactBreakpoint",
    "mediumBreakpoint",
    "wideBreakpoint",
  ] as const)
    variables[`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] =
      `${d[key]}px`;
  Object.assign(variables, {
    "--font-family": d.fontFamily,
    "--line-height": String(d.lineHeight),
    "--body-weight": String(d.bodyWeight),
    "--heading-weight": String(d.headingWeight),
    "--radius-md": `${d.radius}px`,
    "--space-row": `${d.spacing}px`,
    "--font-size-body": `${d.fontSize}px`,
    "--row-border": d.border
      ? `${d.borderWidth}px solid ${d.borderColor}`
      : "none",
    "--surface-shadow": d.shadow ? shadowValue(d) : "none",
    "--floating-shadow": shadowValue(d),
    "--motion-duration": `${d.duration}ms`,
    "--motion-easing": d.easing,
  });
  d.spacingScale.forEach((n, i) => (variables[`--space-${i}`] = `${n}px`));
  return variables;
}
export function designCss(d: Design) {
  return `:root {\n${Object.entries(designVariables(d))
    .map(([k, v]) => `  ${k}: ${v};`)
    .join(
      "\n",
    )}\n}\n@media (prefers-reduced-motion: reduce) {\n  :root { --motion-duration: ${d.reducedMotion === "none" ? "0ms" : "1ms"}; }\n}\n`;
}
