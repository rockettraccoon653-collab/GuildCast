import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);
