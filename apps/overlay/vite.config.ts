import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const isTwitchMode = mode === "twitch";

  return {
    base: isTwitchMode ? "/overlay/" : "/",
    envDir: "../../",
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5174,
      strictPort: true,
      allowedHosts: true,
      hmr: isTwitchMode
        ? {
            path: "/overlay/__vite_ws"
          }
        : undefined
    }
  };
});
