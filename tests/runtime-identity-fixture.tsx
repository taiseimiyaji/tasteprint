import { useEffect, useState } from "react";
import {
  RuntimeDialog,
  RuntimeTabs,
} from "../src/client/design-runtime/Library";

// One independent React root, with two instances of each exported widget.
export function RuntimeIdentityFixture() {
  const [open, setOpen] = useState<string>();
  useEffect(() => {
    document.documentElement.dataset.identityReady = "true";
    return () => {
      delete document.documentElement.dataset.identityReady;
    };
  }, []);
  return (
    <main>
      {["first", "second"].map((instance) => (
        <section key={instance} data-instance={`${instance}-tabs`}>
          <RuntimeTabs />
        </section>
      ))}
      {["first", "second"].map((instance) => (
        <section key={instance} data-instance={`${instance}-dialog`}>
          <button onClick={() => setOpen(instance)}>
            Open {instance} dialog
          </button>
          <RuntimeDialog
            open={open === instance}
            close={() => setOpen(undefined)}
          />
        </section>
      ))}
    </main>
  );
}
