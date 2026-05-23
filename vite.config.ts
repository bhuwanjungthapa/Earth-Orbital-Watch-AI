import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          three: ["three", "@react-three/fiber", "@react-three/drei"],
          orbit: ["satellite.js"]
        }
      }
    }
  },
  server: {
    port: 5173
  },
  preview: {
    port: 4173
  }
});
