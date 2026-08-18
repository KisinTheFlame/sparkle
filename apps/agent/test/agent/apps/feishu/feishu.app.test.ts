import { describe, expect, it, vi } from "vitest";
import type { FeishuMessageEvent } from "@sparkle/feishu-api/event";
import { FeishuApp } from "../../../../src/agent/apps/feishu/feishu.app.js";
import type { NotificationCenter } from "../../../../src/agent/runtime/root-agent/notification/notification-center.js";

function event(overrides: Partial<FeishuMessageEvent> = {}): FeishuMessageEvent {
  return {
    seq: 1,
    messageId: "om_1",
    chatId: "oc_1",
    chatType: "group",
    chatName: "产品群",
    senderId: "ou_boss",
    senderName: "闻震",
    msgType: "text",
    text: "帮我看下这个",
    createdAt: "2026-08-15T02:00:00.000Z",
    ...overrides,
  };
}

function setup() {
  const sendMessage = vi.fn(async () => ({ messageId: "om_out" }));
  const push = vi.fn();
  const clearForSource = vi.fn();
  const knock = vi.fn();
  const app = new FeishuApp({
    feishuClient: { sendMessage },
    notificationCenter: { push, clearForSource } as unknown as NotificationCenter,
    notifyForegroundInput: knock,
  });
  return { app, sendMessage, push, clearForSource, knock };
}

function tool(app: FeishuApp, name: string) {
  const found = app.tools.find(candidate => candidate.name === name);
  if (!found) throw new Error(`tool ${name} not found`);
  return found;
}

describe("FeishuApp", () => {
  it("后台消息走横幅：未读累积 + 会话级 draft，不敲门", async () => {
    const { app, push, knock } = setup();
    app.handleInboundMessage(event());
    app.handleInboundMessage(event({ seq: 2, messageId: "om_2", text: "在吗" }));

    expect(push).toHaveBeenCalledTimes(2);
    expect(knock).not.toHaveBeenCalled();

    const list = await tool(app, "list_conversations").execute({}, {});
    expect(list.content).toContain("产品群（群聊）（2 条未读）");
    expect(list.content).toContain("chatId=oc_1");
  });

  it("打开会话：清未读与横幅、回最近消息屏幕；此后实时消息走敲门", async () => {
    const { app, clearForSource, knock } = setup();
    app.handleInboundMessage(event());
    await app.onFocus();

    const opened = await tool(app, "open_conversation").execute({ chatId: "oc_1" }, {});
    expect(opened.content).toContain('<feishu_conversation name="产品群（群聊）" id="oc_1">');
    expect(opened.content).toContain("闻震: 帮我看下这个");
    expect(clearForSource).toHaveBeenCalledWith("feishu:chat:oc_1");

    app.handleInboundMessage(event({ seq: 2, messageId: "om_2", text: "看到了吗" }));
    expect(knock).toHaveBeenCalledTimes(1);

    const drained = await app.drainForegroundInput();
    expect(drained?.itemCount).toBe(1);
    expect(drained?.text).toContain("<feishu_conversation_new_messages");
    expect(drained?.text).toContain("看到了吗");
    // 先渲染后消费：再拉即空。
    expect(await app.drainForegroundInput()).toBeNull();
  });

  it("失焦：前台缓冲退化回通知路径，当前会话关闭", async () => {
    const { app, push, knock } = setup();
    app.handleInboundMessage(event());
    await app.onFocus();
    await tool(app, "open_conversation").execute({ chatId: "oc_1" }, {});
    app.handleInboundMessage(event({ seq: 2, messageId: "om_2" }));
    expect(knock).toHaveBeenCalledTimes(1);

    push.mockClear();
    await app.onBlur();
    // 退化补推一条 draft，且 drain 不再命中（会话已关）。
    expect(push).toHaveBeenCalledTimes(1);
    expect(await app.drainForegroundInput()).toBeNull();
  });

  it("send_message：无当前会话给指路错误；有会话则出站并计入记录", async () => {
    const { app, sendMessage } = setup();
    const noChat = await tool(app, "send_message").execute({ message: "hi" }, {});
    expect(JSON.parse(noChat.content)).toMatchObject({
      ok: false,
      error: "CHAT_CONTEXT_UNAVAILABLE",
    });

    app.handleInboundMessage(event());
    await app.onFocus();
    await tool(app, "open_conversation").execute({ chatId: "oc_1" }, {});
    const sent = await tool(app, "send_message").execute({ message: " 收到 " }, {});
    expect(JSON.parse(sent.content)).toEqual({ ok: true, messageId: "om_out" });
    expect(sendMessage).toHaveBeenCalledWith({ chatId: "oc_1", text: "收到" });

    const reopened = await tool(app, "open_conversation").execute({ chatId: "oc_1" }, {});
    expect(reopened.content).toContain("Sparkle: 收到");
  });

  it("p2p 会话名缺失时回落用发送者名字（而非 chatId）", async () => {
    const { app } = setup();
    app.handleInboundMessage(
      event({ chatId: "oc_p2p", chatType: "p2p", chatName: null, senderName: "闻震" }),
    );
    const list = await tool(app, "list_conversations").execute({}, {});
    expect(list.content).toContain("- 闻震（1 条未读）");
    expect(list.content).not.toContain("- oc_p2p");
  });

  it("open_conversation 不存在的会话给指路错误", async () => {
    const { app } = setup();
    const result = await tool(app, "open_conversation").execute({ chatId: "oc_nope" }, {});
    const parsed = JSON.parse(result.content);
    expect(parsed).toMatchObject({ ok: false, error: "CHAT_NOT_FOUND" });
    expect(parsed.message).toContain("list_conversations");
  });

  it("exportState/restoreState：会话元数据跨重启保留（消息体不保留）", () => {
    const { app } = setup();
    app.handleInboundMessage(event());
    const state = app.exportState();

    const { app: restored } = setup();
    restored.restoreState(state);
    const summary = restored.exportState() as {
      conversations: { chatId: string; unreadCount: number }[];
    };
    expect(summary.conversations).toHaveLength(1);
    expect(summary.conversations[0]).toMatchObject({ chatId: "oc_1", unreadCount: 1 });
  });
});
