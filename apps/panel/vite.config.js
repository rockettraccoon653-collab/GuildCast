import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
    const isTwitchMode = mode === "twitch";
    return {
        base: isTwitchMode ? "/panel/" : "/",
        envDir: "../../",
        plugins: [react()],
        server: {
            host: "0.0.0.0",
            port: 5173,
            strictPort: true,
            allowedHosts: true,
            hmr: isTwitchMode
                ? {
                    path: "/panel/__vite_ws"
                }
                : undefined
        }
    };
});
//# sourceMappingURL=vite.config.js.map