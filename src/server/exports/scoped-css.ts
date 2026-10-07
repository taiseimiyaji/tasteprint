import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

// Exported RuntimeTheme owns this class. The application's stylesheet stays
// unchanged; only the portable copy is localized. Zero-specificity anchors keep
// the original cascade, including rules matching the RuntimeTheme root itself.
export function scopedExportCss(css: string) {
  const sheet = postcss.parse(css);
  const scope = () =>
    selectorParser().astSync(":where(.tasteprint-runtime)").first.first.clone();
  const keyframes = new Map<string, string>();
  sheet.walkAtRules(/keyframes$/i, (rule) => {
    const name = rule.params.trim();
    keyframes.set(name, `tasteprint-export-${name}`);
    rule.params = keyframes.get(name)!;
  });
  sheet.walkDecls(/^(?:-webkit-)?animation(?:-name)?$/, (declaration) => {
    declaration.value = postcss.list
      .space(declaration.value)
      .map((part) => keyframes.get(part) ?? part)
      .join(" ");
  });
  sheet.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name))
      return;
    const selectors = selectorParser().astSync(rule.selector);
    const output = selectors.clone().removeAll();
    selectors.each((selector) => {
      const first = selector.first;
      if (
        selector.nodes.length === 1 &&
        (first.value === ":root" ||
          first.value === "body" ||
          first.value === "html")
      ) {
        const anchored = selector.clone();
        anchored.first.replaceWith(scope());
        output.append(anchored);
        return;
      }
      // Anchor the first compound to the root, or place the whole original
      // selector inside it. Do not wrap a complex selector in :is(): that could
      // allow its ancestors to match classes outside the export boundary.
      const atRoot = selector.clone();
      const boundary = atRoot.nodes.find(
        (node) =>
          node.type === "combinator" ||
          (node.type === "pseudo" && node.value.startsWith("::")),
      );
      if (boundary) atRoot.insertBefore(boundary, scope());
      else atRoot.append(scope());
      output.append(atRoot);
      const inside = selector.clone();
      inside.prepend(selectorParser.combinator({ value: " " }));
      inside.prepend(scope());
      output.append(inside);
    });
    rule.selector = output.toString();
  });
  return sheet.toString();
}
