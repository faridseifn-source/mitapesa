import React from "react";
import ReactDOM from "react-dom/client";
import App from "./PersonalFinanceApp.jsx";
import "./index.css";

// Registers the push-notification service worker. Silently no-ops on
// browsers without support (Safari on older iOS, some in-app webviews) —
// the rest of the app works fine either way, this just means the "enable
// push notifications" option won't appear there.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
