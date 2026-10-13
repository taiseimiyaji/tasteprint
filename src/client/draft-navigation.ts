import { useEffect, useState } from "react";
import { useBlocker } from "@tanstack/react-router";

export function useDraftWriteExitGuard(
  active: boolean,
  message: string,
  options: {
    remainsMounted?: (nextPath: string) => boolean;
    exitAllowed?: () => boolean;
  } = {},
) {
  const [notice, setNotice] = useState("");
  const blocked = () => active && !options.exitAllowed?.();
  const navigation = useBlocker({
    shouldBlockFn: ({ next }) =>
      blocked() && !options.remainsMounted?.(next.pathname),
    withResolver: true,
    enableBeforeUnload: blocked,
  });
  useEffect(() => {
    if (navigation.status === "blocked") {
      navigation.reset();
      setNotice(message);
    }
  }, [navigation.status]);
  useEffect(() => {
    if (!active) setNotice("");
  }, [active]);
  return notice;
}
