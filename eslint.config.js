import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import wxt from "./.wxt/eslint-auto-imports.mjs";

export default tseslint.config(
  {
    ignores: [
      ".output/**",
      ".wxt/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  wxt,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, chrome: "readonly" },
    },
  },
);
