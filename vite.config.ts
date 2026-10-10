import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  root: "frontend",
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  // The WebP encoder ships its own WebAssembly, which must not be pre-bundled.
  optimizeDeps: { exclude: ["@jsquash/webp"] },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "safari15",
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
