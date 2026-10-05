import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import netlify from "@netlify/vite-plugin";

export default defineConfig({
    plugins: [react(), netlify({ edgeFunctions: { enabled: false } })],
    server: {
      watch: {
        // Windows watcher handles block BMAD's atomic staging-folder rename.
        ignored: ["**/_bmad/**", "**/_bmad.setup-*/**", "**/_bmad.old-*/**", "**/_bmad-output/**", "**/backups/**"],
      },
    },
    build: {
      rolldownOptions: {
        output: {
          // Keep framework dependencies separate from app code without changing
          // their module execution order.
          strictExecutionOrder: true,
          codeSplitting: {
            groups: [
              {
                name: "react-vendor",
                test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
                minSize: 20_000,
              },
            ],
          },
        },
      },
    },
});
