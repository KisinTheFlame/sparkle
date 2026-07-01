import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";

const TEMPLATE_PATH = join(dirname(fileURLToPath(import.meta.url)), "main-system-prompt.hbs");

/**
 * 主 system prompt 的模板变量。v1 暂无动态变量；保留入参形态，未来接飞书 /
 * 多租户时往这里加（如 botName、creator 等）。
 */
export type MainSystemPromptVars = Record<string, never>;

/**
 * 渲染主 system prompt。kagami 式：模板文件 + handlebars 渲染，便于后续注入
 * 动态变量。模板随 build 拷进 dist（见 package.json 的 build 脚本）。
 */
export function renderMainSystemPrompt(vars: MainSystemPromptVars = {}): string {
  const source = readFileSync(TEMPLATE_PATH, "utf8");
  const template = Handlebars.compile(source);
  return template(vars).trim();
}
