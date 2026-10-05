import { createElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { RuntimeIdentityFixture } from "./runtime-identity-fixture";

hydrateRoot(
  document.getElementById("identity-root")!,
  createElement(RuntimeIdentityFixture),
);
