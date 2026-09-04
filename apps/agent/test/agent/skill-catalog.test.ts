import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkillCatalog } from "../../src/agent/capabilities/skills/skill-catalog.js";
import { SkillCatalogNotificationDraft } from "../../src/agent/capabilities/skills/skill-catalog-notification-draft.js";
import { NotificationCenter } from "../../src/agent/runtime/root-agent/notification/notification-center.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

initTestLoggerRuntime();

describe("SkillCatalog", () => {
  let directory: string;
  let catalog: SkillCatalog;
  const onChange = vi.fn();
  const onError = vi.fn();

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "sparkle-skills-test-"));
    catalog = new SkillCatalog({ directory, onChange, onError });
  });

  afterEach(async () => {
    await catalog.stop();
    await rm(directory, { recursive: true, force: true });
  });

  async function skill(name: string, description = "工作方法", body = "步骤") {
    await mkdir(join(directory, name), { recursive: true });
    await writeFile(
      join(directory, name, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\ndisable-model-invocation: true\n---\n${body}`,
    );
  }

  it("初始目录稳定排序、只披露元数据，不按调用标志过滤，也不发布新增通知", async () => {
    await skill("z-last");
    await skill("a-first", "多行说明", "敏感的正文不应进入目录");
    await catalog.refresh();
    expect(catalog.getEntries()).toEqual([
      { name: "a-first", description: "多行说明" },
      { name: "z-last", description: "工作方法" },
    ]);
    expect(onChange).not.toHaveBeenCalled();
    const entries = catalog.getEntries();
    entries[0].name = "mutated";
    expect(catalog.getEntries()[0].name).toBe("a-first");
  });

  it("支持 YAML 块描述与 CRLF，不限制正文或描述长度", async () => {
    const description = "用".repeat(1000);
    await skill("report");
    await writeFile(
      join(directory, "report", "SKILL.md"),
      `---\r\nname: report\r\ndescription: >-\r\n  ${description}\r\n  第二行\r\n---\r\n${"文".repeat(70_000)}`,
    );
    await catalog.refresh();
    expect(catalog.getEntries()).toEqual([
      { name: "report", description: `${description} 第二行` },
    ]);
  });

  it("新增、正文修改、资源修改和删除都有差量，无变化不重复通知", async () => {
    await catalog.refresh();
    await skill("ops");
    await catalog.refresh();
    expect(onChange).toHaveBeenLastCalledWith([
      { name: "ops", description: "工作方法", kind: "added" },
    ]);
    await skill("ops", "工作方法", "新版步骤");
    await catalog.refresh();
    expect(onChange).toHaveBeenLastCalledWith([
      { name: "ops", description: "工作方法", kind: "modified" },
    ]);
    await mkdir(join(directory, "ops", "scripts"));
    await writeFile(join(directory, "ops", "scripts", "run.sh"), "echo example");
    await catalog.refresh();
    expect(onChange).toHaveBeenCalledTimes(3);
    await catalog.refresh();
    expect(onChange).toHaveBeenCalledTimes(3);
    await rm(join(directory, "ops"), { recursive: true });
    await catalog.refresh();
    expect(onChange).toHaveBeenLastCalledWith([{ name: "ops", kind: "removed" }]);
  });

  it.each([
    ["no-frontmatter", "步骤", "MISSING_FRONTMATTER"],
    ["bad-yaml", "---\nname: [\n---\n", "INVALID_FRONTMATTER"],
    ["wrong-name", "---\nname: other\ndescription: 方法\n---\n", "INVALID_NAME"],
    ["no-description", "---\nname: no-description\n---\n", "INVALID_DESCRIPTION"],
    [
      "empty-description",
      "---\nname: empty-description\ndescription: ' '\n---\n",
      "INVALID_DESCRIPTION",
    ],
  ])("无效入口 %s 排除并通知一次", async (name, source, error) => {
    await mkdir(join(directory, name));
    await writeFile(join(directory, name, "SKILL.md"), source);
    await catalog.refresh();
    await catalog.refresh();
    expect(catalog.getEntries()).toEqual([]);
    expect(onChange).toHaveBeenCalledExactlyOnceWith([{ name, kind: "invalid", error }]);
  });

  it("缺少入口报错，修复后重新加入目录，损坏时从有效目录移除", async () => {
    await mkdir(join(directory, "ops"));
    await catalog.refresh();
    expect(onChange).toHaveBeenLastCalledWith([{ name: "ops", kind: "invalid", error: "ENOENT" }]);
    await skill("ops");
    await catalog.refresh();
    expect(catalog.getEntries()).toHaveLength(1);
    expect(onChange).toHaveBeenLastCalledWith([
      { name: "ops", description: "工作方法", kind: "added" },
    ]);
    await writeFile(join(directory, "ops", "SKILL.md"), "invalid");
    await catalog.refresh();
    expect(catalog.getEntries()).toEqual([]);
    expect(onChange).toHaveBeenLastCalledWith([
      { name: "ops", kind: "invalid", error: "MISSING_FRONTMATTER" },
    ]);
  });

  it("拒绝目录及资源符号链接逃逸，允许包内资源链接", async () => {
    await skill("ops");
    await writeFile(join(directory, "ops", "reference.md"), "口径");
    await symlink("reference.md", join(directory, "ops", "alias.md"));
    await catalog.refresh();
    expect(catalog.getEntries()).toHaveLength(1);
    await symlink("..", join(directory, "ops", "outside"));
    await symlink("ops", join(directory, "linked"));
    await catalog.refresh();
    expect(catalog.getEntries()).toEqual([]);
    expect(onChange).toHaveBeenLastCalledWith([
      { name: "linked", kind: "invalid", error: "SKILL_DIRECTORY_SYMLINK" },
      { name: "ops", kind: "invalid", error: "RESOURCE_OUTSIDE_SKILL" },
    ]);
  });

  it("真实 watcher 合并原子替换的连续写入，停止后不再通知", async () => {
    await skill("ops");
    await catalog.refresh();
    await catalog.startWatching();
    const path = join(directory, "ops", "SKILL.md");
    const source = await readFile(path, "utf8");
    await writeFile(join(directory, "ops", ".SKILL.tmp"), `${source}\n更新`);
    await rename(join(directory, "ops", ".SKILL.tmp"), path);
    await writeFile(path, `${source}\n最终更新`);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(onChange.mock.calls[0][0]).toEqual([
      { name: "ops", description: "工作方法", kind: "modified" },
    ]);
    expect(onError).not.toHaveBeenCalled();
    await catalog.stop();
    await writeFile(path, `${source}\n停止后的更新`);
    await catalog.refresh();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("SkillCatalogNotificationDraft", () => {
  it("通过现有通知队列合并，同名最新状态优先、其他变化不丢，文本走模板", async () => {
    const onFlush = vi.fn();
    let flush = () => {};
    const center = new NotificationCenter({
      leadingWindowMs: 1,
      windowMs: 1,
      onFlush,
      scheduler: {
        schedule: (_delay, callback) => {
          flush = callback;
          return () => {};
        },
      },
    });
    center.push(
      new SkillCatalogNotificationDraft({
        changes: [
          { name: "ops", kind: "added", description: "旧说明" },
          { name: "report", kind: "added", description: "报表" },
        ],
      }),
    );
    center.push(
      new SkillCatalogNotificationDraft({
        changes: [
          { name: "ops", kind: "modified", description: "新说明" },
          { name: "bad", kind: "invalid", error: "INVALID_FRONTMATTER" },
          { name: "old", kind: "removed" },
        ],
      }),
    );
    flush();
    expect(onFlush).toHaveBeenCalledTimes(1);
    const text = onFlush.mock.calls[0][0].join("\n");
    expect(text).toContain("<skill_catalog_update>");
    expect(text).toContain("修改：ops — 新说明");
    expect(text).toContain("新增：report — 报表");
    expect(text).toContain("删除：old");
    expect(text).toContain("无效（不在可用目录中）：bad — INVALID_FRONTMATTER");
    expect(text).not.toContain("旧说明");
    center.stop();
  });
});
