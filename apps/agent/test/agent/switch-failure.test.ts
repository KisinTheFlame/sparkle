import { AppManager, InMemoryQueue, type ToolContext } from "@sparkle/agent-runtime";
import type { FeishuMessageEvent } from "@sparkle/feishu-api/event";
import { describe, expect, it, vi } from "vitest";
import { FeishuApp } from "../../src/agent/apps/feishu/feishu.app.js";
import { DefaultAgentContext } from "../../src/agent/runtime/context/default-agent-context.js";
import { createRootEffectInterpreter } from "../../src/agent/runtime/effect/root-effect-interpreter.js";
import type { Event } from "../../src/agent/runtime/event/event.js";
import { NotificationCenter } from "../../src/agent/runtime/root-agent/notification/notification-center.js";
import { RootAgentSession } from "../../src/agent/runtime/root-agent/session/root-agent-session.js";
import { SwitchTool } from "../../src/agent/runtime/root-agent/tools/switch.tool.js";

describe("App 切换失败后的焦点一致性", () => {
  it("目标屏幕加载失败后，飞书消息路由与 session 当前 App 一致", async () => {
    const knock = vi.fn();
    const center = new NotificationCenter({
      leadingWindowMs: 1,
      windowMs: 1,
      onFlush: () => {},
      scheduler: { schedule: () => () => {} },
    });
    const feishu = new FeishuApp({
      feishuClient: { sendMessage: async () => ({ messageId: "unused" }) },
      notificationCenter: center,
      notifyForegroundInput: knock,
    });
    const manager = new AppManager();
    manager.register(feishu);
    manager.register({
      id: "todo",
      displayName: "待办",
      description: "测试目标",
      tools: [],
      canInvoke: () => true,
      help: async () => "待办工具说明",
      onFocus: async () => {
        throw new Error("清单查询失败");
      },
    });
    const context = new DefaultAgentContext({ systemPrompt: "固定前缀" });
    const session = new RootAgentSession({ context, appManager: manager });
    const interpreter = createRootEffectInterpreter({
      session,
      context,
      eventQueue: new InMemoryQueue<Event>(),
    });
    const tool = new SwitchTool({ appManager: manager });
    const toolContext = { rootAgentSession: session } as ToolContext;
    const enterFeishu = await tool.execute({ id: "feishu" }, toolContext);
    await interpreter.apply(enterFeishu.effects ?? []);
    const event: FeishuMessageEvent = {
      seq: 1,
      messageId: "message-1",
      chatId: "chat-1",
      chatType: "group",
      chatName: "测试群",
      senderId: "sender-1",
      senderName: "测试人",
      msgType: "text",
      text: "第一条消息",
      createdAt: "2026-09-04T00:00:00.000Z",
    };
    feishu.handleInboundMessage(event);
    const open = feishu.tools.find(candidate => candidate.name === "open_conversation")!;
    await open.execute({ chatId: event.chatId }, {});

    const switchResult = await tool.execute({ id: "todo" }, toolContext);
    await interpreter.apply(switchResult.effects ?? []);

    // session 仍在飞书时应允许重新打开会话，并继续走前台实时路径。
    if (session.getCurrentApp() === "feishu") {
      await open.execute({ chatId: event.chatId }, {});
    }
    feishu.handleInboundMessage({ ...event, seq: 2, messageId: "message-2" });
    expect(knock.mock.calls.length > 0).toBe(session.getCurrentApp() === "feishu");
    expect(session.getCurrentApp()).toBe("todo");
    expect(JSON.parse(switchResult.content)).toMatchObject({
      ok: true,
      toApp: "todo",
      warning: { code: "APP_SCREEN_UNAVAILABLE", details: "清单查询失败" },
    });
    expect(session.hasEnteredApp("todo")).toBe(true);

    // 失败首屏不妨碍之后切回飞书，重新打开会话后恢复实时投递。
    const back = await tool.execute({ id: "feishu" }, toolContext);
    await interpreter.apply(back.effects ?? []);
    await open.execute({ chatId: event.chatId }, {});
    feishu.handleInboundMessage({ ...event, seq: 3, messageId: "message-3" });
    expect(knock).toHaveBeenCalledTimes(1);
    expect((await feishu.drainForegroundInput())?.itemCount).toBe(1);
  });
});
