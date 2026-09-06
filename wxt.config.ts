import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  // No source maps or dev fixtures reach a production build or release archive.
  vite: () => ({ build: { sourcemap: false } }),
  manifest: ({ mode }) => ({
    name: "Accessibility Inspector",
    description:
      "Deterministic, local accessibility findings for the active page.",
    permissions: ["activeTab", "scripting", "sidePanel", "storage"],
    optional_host_permissions: [
      "http://127.0.0.1/*",
      "http://localhost/*",
      "http://[::1]/*",
      "https://github.com/*",
      "https://api.github.com/*",
    ],
    action: { default_title: "Open Accessibility Inspector" },
    // `connect-src` is deliberately omitted: CSP host-source grammar cannot
    // express the bracketed IPv6 loopback literal, and pinning it would
    // silently break a supported provider host. Network egress is bounded by
    // the loopback allowlist in parseAssistantSettings and by the loopback-only
    // optional host permissions below.
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
    },
    ...(mode === "test" ? { host_permissions: ["http://127.0.0.1/*"] } : {}),
  }),
});
