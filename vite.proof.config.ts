import { defineConfig } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
    root: resolve(import.meta.dirname, "frontend/terminal-proof"),
    base: "./",
    plugins: [react()],
    build: { outDir: resolve(import.meta.dirname, "dist/terminal-proof"), emptyOutDir: true, target: "es2022" },
});
