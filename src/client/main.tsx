import React from "react";
import ReactDOM from "react-dom/client";
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./styles.css";
import { PreviewRenderer } from "./components/PreviewFrame";
import { ProjectsApp } from "./projects";
const root = createRootRoute({ component: ProjectsApp });
const index = createRoute({
  getParentRoute: () => root,
  path: "/",
  component: () => null,
});
const all = createRoute({
  getParentRoute: () => root,
  path: "/$",
  component: () => null,
});
const router = createRouter({ routeTree: root.addChildren([index, all]) });
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
      {location.pathname === "/preview-render" ? (
        <PreviewRenderer />
      ) : (
        <RouterProvider router={router} />
      )}
    </QueryClientProvider>
  </React.StrictMode>,
);
