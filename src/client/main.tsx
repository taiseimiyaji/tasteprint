import React from "react";
import ReactDOM from "react-dom/client";
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  redirect,
  notFound,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Workspace, steps } from "./workspace";
import "./styles.css";
const root = createRootRoute({
  component: Workspace,
  notFoundComponent: () => (
    <main className="not-found">
      <h1>ページが見つかりません</h1>
      <a href="/foundation">ワークスペースに戻る</a>
    </main>
  ),
});
const index = createRoute({
  getParentRoute: () => root,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/$step", params: { step: "foundation" } });
  },
});
const step = createRoute({
  getParentRoute: () => root,
  path: "/$step",
  beforeLoad: ({ params }) => {
    if (!steps.some((s) => s.id === params.step)) throw notFound();
  },
  component: () => null,
});
const router = createRouter({ routeTree: root.addChildren([index, step]) });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
