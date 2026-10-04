import { describe, expect, it } from "vitest";
import {
  createElement as h,
  Fragment,
  isValidElement,
  type ReactNode,
  type ReactElement,
} from "react";
import { Pattern } from "../src/client/design-runtime/Library";
import { defaultDesign } from "../src/domain/design";

type SlotProps = { "data-testid": string; "data-slot": string };
const button = (id: string, slot: string, key?: string) =>
  h(
    "button",
    {
      "data-testid": id,
      "data-slot": slot,
      ...(key === undefined ? {} : { key }),
    },
    id,
  );
const children = (optional = false) => [
  button("root", "title"),
  optional ? button("optional", "action", "optional") : null,
  h(
    Fragment,
    { key: "group/.$:" },
    button("first", "action", "same"),
    h(
      Fragment,
      { key: "nested/.$:" },
      button("nested-title", "title", "same"),
      null,
      button("nested-action", "action", "/:$"),
    ),
  ),
  h(
    Fragment,
    { key: "other/.$:" },
    button("sibling-title", "title", "same"),
    button("sibling-action", "action", "/:$"),
  ),
  "plain text",
];
function render(nodes: ReactNode, reverse = false) {
  const design = structuredClone(defaultDesign);
  if (reverse) design.patterns.PageHeader.structure.reverse();
  const result: ReactElement = Pattern({
    design,
    name: "PageHeader",
    children: nodes,
  });
  const output = (result.props as { children: ReactNode[] }).children;
  const elements = output.filter((node): node is ReactElement<SlotProps> =>
    isValidElement<SlotProps>(node),
  );
  return {
    output,
    elements,
    identities: Object.fromEntries(
      elements.map((node) => [node.props["data-testid"], node.key]),
    ),
  };
}

describe("Pattern child identity across structural ordering", () => {
  it("keeps root, sibling and nested Fragment controls distinct while ordering their actual slots", () => {
    const result = render(children());
    expect(result.elements.map((node) => node.props["data-testid"])).toEqual([
      "root",
      "nested-title",
      "sibling-title",
      "first",
      "nested-action",
      "sibling-action",
    ]);
    expect(new Set(Object.values(result.identities)).size).toBe(6);
    expect(Object.values(result.identities).every((key) => key !== null)).toBe(
      true,
    );
    expect(result.output.at(-1)).toBe("plain text");
  });
  it("preserves each existing control identity after reordering and conditionally inserting a sibling", () => {
    const before = render(children());
    const reordered = render(children(), true);
    expect(reordered.elements.map((node) => node.props["data-testid"])).toEqual(
      [
        "first",
        "nested-action",
        "sibling-action",
        "root",
        "nested-title",
        "sibling-title",
      ],
    );
    expect(reordered.identities).toEqual(before.identities);
    const inserted = render(children(true), true);
    const { optional, ...existing } = inserted.identities;
    expect(existing).toEqual(before.identities);
    expect(optional).not.toBeNull();
    expect(new Set(Object.values(inserted.identities)).size).toBe(7);
  });
});
