import eslint from "@eslint/js"

export default [
  eslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        URL: "readonly",
        Headers: "readonly",
      },
    },
  },
  {
    ignores: ["node_modules/", "coverage/", "dashboards/"],
  },
]
