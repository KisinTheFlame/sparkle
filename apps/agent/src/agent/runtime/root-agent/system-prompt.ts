import { renderServerStaticTemplate } from "@sparkle/kernel/runtime/read-static-text";
import { escapeContextText } from "../context/escape-context-text.js";

export function createAgentSystemPrompt({
  employerName,
  apps,
  skillsDirectory,
  skills = [],
}: {
  employerName: string;
  apps: ReadonlyArray<{ id: string; displayName: string; description: string }>;
  skillsDirectory?: string;
  skills?: ReadonlyArray<{ name: string; description: string }>;
}): string {
  // App 集合在进程内不可变；Skill 目录可变，但调用方只在启动/reset/成功压缩后
  // 渲染并冻结此字符串。文件监听只追加通知，不能触发这里重新渲染。
  return renderServerStaticTemplate(import.meta.url, "prompts/main-engine-system.hbs", {
    employerName,
    apps,
    hasApps: apps.length > 0,
    skillsDirectory: skillsDirectory === undefined ? undefined : escapeContextText(skillsDirectory),
    skills: skills.map(skill => ({
      name: escapeContextText(skill.name),
      description: escapeContextText(skill.description),
    })),
    hasSkills: skills.length > 0,
  }).trim();
}
