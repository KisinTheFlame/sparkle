import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/src/generated/**",
      ".claude/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // 类型感知 linting：仅作用于各包 src（都在各自 tsconfig include 内）。测试 / 配置
  // 文件不在 program 里，不进此 scope，避免 "file not in project" 报错。
  {
    files: ["packages/*/src/**/*.ts"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // require-await 噪声大（多为满足接口契约而声明的 async），关闭。
      "@typescript-eslint/require-await": "off",
      // no-unsafe-* 多来自 LLM / 外部无类型边界，以 warn 做棘轮：可见但不阻塞，
      // 后续逐步收紧为 error。
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
    },
  },
  {
    files: ["**/*.{ts,tsx,js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportAllDeclaration",
          message: "禁止使用 re-export，请直接导入真实实现路径。",
        },
        {
          selector: "ExportNamedDeclaration[source!=null]",
          message: "禁止使用 re-export，请直接导入真实实现路径。",
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // .cjs 是 CommonJS（如 PM2 ecosystem 配置），require 是其原生模块系统。
  {
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  prettierConfig,
);
