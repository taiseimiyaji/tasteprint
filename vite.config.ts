import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.TASTEPRINT_WEB_PORT || 3000),
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.TASTEPRINT_API_PORT || 3001}`,
        changeOrigin: false,
      },
    },
  },
  build: { outDir: "dist/client" },
});
