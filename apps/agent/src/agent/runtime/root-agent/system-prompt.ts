import { renderServerStaticTemplate } from "@sparkle/kernel/runtime/read-static-text";

export function createAgentSystemPrompt({
  employerName,
  apps,
}: {
  employerName: string;
  apps: ReadonlyArray<{ id: string; displayName: string; description: string }>;
}): string {
  // 各平台的场景与行为说明下沉到对应 App 的 help，主 system prompt
  // 只保留与平台无关的身份与手机 OS 说明。App 名单（id + 名称 + 功能）每轮由主循环重新渲染进 prompt，
  // 让 Sparkle 天然知道自己有哪些 App。这依赖一条不变量：App 集合在进程内不可变（所有 register 集中
  // 在启动期），故相同入参每轮渲染字节恒定 → 稳定前缀不漂移 → KV 命中。名单只在增删 App 时变，
  // 而那必然伴随进程重启。（若将来引入会话中途热插拔 App，这条前缀稳定性会被打破，须重新设计。）
  return renderServerStaticTemplate(import.meta.url, "prompts/main-engine-system.hbs", {
    employerName,
    apps,
    hasApps: apps.length > 0,
  }).trim();
}
