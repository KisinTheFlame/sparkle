import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * 测试直接走 workspace 包的 src（而非 dist），避免依赖"先 build 再 test"的顺序。
 * agent-runtime 自身的 vitest 也是 `.js`→`.ts` 解析，这里复用同一行为。
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      "@sparkle/agent-runtime": fileURLToPath(
        new URL("../../packages/agent-runtime/src/index.ts", import.meta.url),
      ),
      "@sparkle/llm": fileURLToPath(new URL("../../packages/llm/src/index.ts", import.meta.url)),
    },
  },
});
