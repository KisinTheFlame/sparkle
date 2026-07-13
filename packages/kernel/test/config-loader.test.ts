import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadStaticConfig } from "../src/config/config.loader.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * 最小 secrets：config.secret.yaml 必须存在（loader secret.required）。embedding.apiKey
 * 是 schema 里唯一 non-empty 的隐私字段，放这里模拟真实用法（config.yaml.example 里是占位）。
 */
const MINIMAL_SECRET_YAML = `server:
  llm:
    embedding:
      apiKey: test-embedding-key
`;

/**
 * 用仓库里提交的 config.yaml.example + 最小 secrets 当夹具：守护「提交的 example 永远
 * 能通过 loader schema」——新 clone 照 example 起不会因 schema 漂移而失败。
 */
function createFixtureDir(mutate?: (configText: string) => string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sparkle-config-test-"));
  const configText = readFileSync(path.join(repoRoot, "config.yaml.example"), "utf8");
  writeFileSync(path.join(dir, "config.yaml"), mutate ? mutate(configText) : configText);
  writeFileSync(path.join(dir, "config.secret.yaml"), MINIMAL_SECRET_YAML);
  return dir;
}

describe("loadStaticConfig — 配置装载", () => {
  it("提交的 config.yaml.example + 最小 secrets 能通过 schema", async () => {
    const dir = createFixtureDir();
    const config = await loadStaticConfig({ configPath: path.join(dir, "config.yaml") });
    expect(config.server.publicBaseUrl).toBeTypeOf("string");
    expect(config.server.llm.timeoutMs).toBeGreaterThan(0);
    expect(Array.isArray(config.server.llm.usages.agent.attempts)).toBe(true);
  });

  it("SQLite 相对路径锚定到 config.yaml 所在目录（file: 绝对化）", async () => {
    const dir = createFixtureDir();
    const config = await loadStaticConfig({ configPath: path.join(dir, "config.yaml") });
    expect(config.server.databaseUrl.startsWith("file:")).toBe(true);
    const filePath = config.server.databaseUrl.slice("file:".length);
    expect(path.isAbsolute(filePath)).toBe(true);
    expect(filePath.startsWith(dir)).toBe(true);
  });

  it("OAuth publicBaseUrl 缺省派生自 server.publicBaseUrl", async () => {
    const dir = createFixtureDir();
    const config = await loadStaticConfig({ configPath: path.join(dir, "config.yaml") });
    expect(config.server.llm.claudeCodeAuth.publicBaseUrl).toBe(config.server.publicBaseUrl);
    expect(config.server.llm.codexAuth.publicBaseUrl).toBe(config.server.publicBaseUrl);
  });

  it("非法配置值抛 ConfigError（含出错字段路径）", async () => {
    const dir = createFixtureDir(text =>
      text.replace(/timeoutMs:\s*\d+/, 'timeoutMs: "not-a-number"'),
    );
    await expect(loadStaticConfig({ configPath: path.join(dir, "config.yaml") })).rejects.toThrow(
      "配置值不合法",
    );
  });
});
