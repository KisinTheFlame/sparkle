import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const key = process.argv[2];

if (!key) {
  throw new Error("用法: node scripts/read-config.mjs <dot.path>");
}

const configPath = path.join(rootDir, "config.yaml");
if (!existsSync(configPath)) {
  throw new Error(`未找到 config.yaml（${configPath}）`);
}

const config = parse(await readFile(configPath, "utf8"));
const value = key.split(".").reduce((current, segment) => current?.[segment], config);

if (typeof value !== "string" || value.length === 0) {
  throw new Error(`config.yaml 缺少合法的 ${key}`);
}

process.stdout.write(resolveFileUrl(value, path.dirname(configPath)));

/**
 * SQLite 的 `file:` 相对路径按 config.yaml 所在目录解析为绝对路径，确保 Prisma CLI
 * 与运行时（@sparkle/config）落在同一个库文件上。其余值原样返回。
 */
function resolveFileUrl(rawValue, baseDir) {
  if (!rawValue.startsWith("file:")) return rawValue;
  const filePath = rawValue.slice("file:".length);
  if (filePath === ":memory:" || filePath.length === 0) return rawValue;
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
  return `file:${absolute}`;
}
