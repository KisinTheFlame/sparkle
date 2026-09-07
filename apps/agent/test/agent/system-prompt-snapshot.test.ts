import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryQueue,
  TaskAgentMaxRoundsExceededError,
  ToolCatalog,
} from "@sparkle/agent-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkillCatalog } from "../../src/agent/capabilities/skills/skill-catalog.js";
import { DefaultAgentContext } from "../../src/agent/runtime/context/default-agent-context.js";
import type { Event } from "../../src/agent/runtime/event/event.js";
import { RootLoopAgent } from "../../src/agent/runtime/root-agent/root-agent-runtime.js";
import { RootAgentSession } from "../../src/agent/runtime/root-agent/session/root-agent-session.js";
import { SystemPromptSnapshotExtension } from "../../src/agent/runtime/root-agent/extensions/system-prompt-snapshot.extension.js";
import { createAgentSystemPrompt } from "../../src/agent/runtime/root-agent/system-prompt.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

initTestLoggerRuntime();

describe("Skill 目录的稳定前缀与计划性重建", () => {
  let directory: string;
  let catalog: SkillCatalog;
  let snapshot: SystemPromptSnapshotExtension;
  let context: DefaultAgentContext;
  let agent: RootLoopAgent;
  const render = vi.fn();
  const invoke = vi.fn();
  const chat = vi.fn();

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "sparkle-skill-prompt-test-"));
    catalog = new SkillCatalog({ directory, onChange: () => {}, onError: () => {} });
    render.mockImplementation(async () => {
      await catalog.refresh();
      return createAgentSystemPrompt({
        employerName: "雇主",
        apps: [],
        skillsDirectory: directory,
        skills: catalog.getEntries(),
      });
    });
    snapshot = new SystemPromptSnapshotExtension({ render });
    await snapshot.rebuild();
    context = new DefaultAgentContext({ systemPromptFactory: () => snapshot.getSystemPrompt() });
    invoke.mockResolvedValue("工作摘要");
    chat.mockResolvedValue({
      provider: "test",
      model: "test",
      message: { role: "assistant", content: "暂时没有动作", toolCalls: [] },
      usage: { totalTokens: 100 },
    });
    agent = new RootLoopAgent({
      context,
      eventQueue: new InMemoryQueue<Event>(),
      session: new RootAgentSession({ context }),
      tools: new ToolCatalog([]).pick([]),
      llmClient: { chat, listAvailableProviders: vi.fn() },
      contextSummarizer: { invoke },
      contextCompactionTotalTokenThreshold: 1,
      loopExtensions: [snapshot],
    });
  });

  afterEach(async () => {
    await agent.stop();
    await catalog.stop();
    await rm(directory, { recursive: true, force: true });
  });

  async function addSkill() {
    await mkdir(join(directory, "ops"));
    await writeFile(
      join(directory, "ops", "SKILL.md"),
      "---\nname: ops\ndescription: 运维核验\n---\n不应注入的正文",
    );
    await catalog.refresh();
  }

  it("目录变化、尾部追加、fork、读取面板均不重新渲染前缀", async () => {
    const before = await context.getSnapshot();
    await addSkill();
    await context.appendMessages([{ role: "user", content: "目录变化通知" }]);
    const after = await context.getSnapshot();
    expect(after.systemPrompt).toBe(before.systemPrompt);
    expect(after.messages).toEqual([{ role: "user", content: "目录变化通知" }]);
    const fork = await context.fork();
    expect((await fork.getSnapshot()).systemPrompt).toBe(before.systemPrompt);
    await context.getDashboardSummary();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("真正的手动压缩成功后更新目录，摘要请求仍复用旧 system prompt", async () => {
    await agent.initialize();
    const before = snapshot.getSystemPrompt();
    const fork = await context.fork();
    await addSkill();
    await context.appendMessages([{ role: "user", content: "工作" }]);
    expect((await agent.compactContextByRatio(100)).compacted).toBe(true);
    expect(invoke.mock.calls[0][0].systemPrompt).toBe(before);
    expect((await context.getSnapshot()).systemPrompt).toContain("ops — 运维核验");
    expect(snapshot.getSystemPrompt()).not.toContain("不应注入的正文");
    expect((await fork.getSnapshot()).systemPrompt).toBe(before);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("真正的自动压缩成功后更新目录，不添加 Skill 专用 reminder", async () => {
    const before = snapshot.getSystemPrompt();
    await addSkill();
    const run = agent.run();
    try {
      await vi.waitFor(() => expect(snapshot.getSystemPrompt()).toContain("ops — 运维核验"));
      expect(chat.mock.calls[0][0].system).toBe(before);
      expect(invoke.mock.calls[0][0].systemPrompt).toBe(before);
      expect(render).toHaveBeenCalledTimes(2);
      const messages = (await context.getSnapshot()).messages;
      expect(JSON.stringify(messages)).not.toContain("ops");
    } finally {
      await agent.stop();
      await run;
    }
  });

  it("压缩失败不重建前缀，reset 仍重新扫描并更新目录", async () => {
    await agent.initialize();
    const before = snapshot.getSystemPrompt();
    await addSkill();
    invoke.mockRejectedValueOnce(new TaskAgentMaxRoundsExceededError(4));
    expect((await agent.compactContextByRatio(100)).compacted).toBe(false);
    expect(snapshot.getSystemPrompt()).toBe(before);
    expect(render).toHaveBeenCalledTimes(1);
    await agent.resetContext();
    expect(snapshot.getSystemPrompt()).toContain("ops — 运维核验");
    expect(render).toHaveBeenCalledTimes(2);
  });
});
