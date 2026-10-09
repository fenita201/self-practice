import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  return {
    plugins: [react()],
    root: "src/client",
    build: { outDir: "../../dist/public", emptyOutDir: true },
    server: {
      host: "127.0.0.1",
      port: Number(env.DEV_UI_PORT || 5173),
      strictPort: true,
      proxy: {
        "/api": `http://${env.HOST || "127.0.0.1"}:${env.PORT || 3000}`,
      },
    },
  };
});
