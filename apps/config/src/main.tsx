import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

console.info("[GuildCast Config] startup", {
  href: window.location.href,
  hasTwitchGlobal: Boolean((window as Window & { Twitch?: unknown }).Twitch)
});

type RootErrorBoundaryState = {
  hasError: boolean;
};

class RootErrorBoundary extends React.Component<React.PropsWithChildren, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RootErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <main style={{ padding: 16, color: "#e8efff", fontFamily: "Sora, sans-serif" }}>
          <h1 style={{ marginTop: 0 }}>GuildCast Config Error</h1>
          <p>
            The configuration UI failed to load. Check extension hosting, API URL, and browser console
            logs.
          </p>
        </main>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  console.error("[GuildCast Config] missing #root element");
  throw new Error("Missing #root element for config app");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);
