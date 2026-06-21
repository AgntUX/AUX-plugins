// Plain config object — intentionally NO `import ... from "vitest/config"`.
// Vitest runs from the harness install; the project tree has no local
// node_modules, so importing "vitest/config" here fails ESM resolution when
// the config is compiled to a temp module. A plain default export loads fine.
export default {
  test: {
    include: ["__tests__/**/*.test.{ts,mjs}"],
  },
};
