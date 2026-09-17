import { createContext, useContext, type ReactNode } from "react";
import { Link as RouterLink } from "@tanstack/react-router";
export type ScopeValue = {
  id: string;
  name: string;
  api: string;
  route: string;
};
export const ScopeContext = createContext<ScopeValue>({
  id: "profile",
  name: "自分の好み",
  api: "/api/profile",
  route: "/profile",
});
export const useScope = () => useContext(ScopeContext);
export async function jsonRequest<T>(
  url: string,
  body?: unknown,
  method = body ? "POST" : "GET",
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(data.message || "入力内容を確認してください。"),
      { status: response.status },
    );
  return data;
}
export function Link({
  params,
  children,
  to,
  ...props
}: {
  params?: { step: string };
  children: ReactNode;
  to: string;
  className?: string;
}) {
  const scope = useScope();
  return (
    <RouterLink
      to={
        (params?.step === "taste"
          ? "/profile"
          : `${scope.route}/${params?.step ?? "overview"}`) as "/"
      }
      {...props}
    >
      {children}
    </RouterLink>
  );
}
export const draftKey = (id: string) => `tasteprint.scope.${id}.draft.v1`;
