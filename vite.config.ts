import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // The API server loads .env with dotenv; load only PORT here so Vite's
  // browser build never receives unrelated server-side settings.
  const env = loadEnv(mode, process.cwd(), "PORT");
  const apiPort = process.env.PORT?.trim() || env.PORT?.trim() || "3001";

  return {
    plugins: [react()],
    server: {
      watch: {
        // Windows watcher handles block BMAD's atomic staging-folder rename.
        ignored: ["**/_bmad/**", "**/_bmad.setup-*/**", "**/_bmad.old-*/**", "**/_bmad-output/**", "**/backups/**"],
      },
      proxy: {
        "/api": `http://localhost:${apiPort}`,
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
  };
});
