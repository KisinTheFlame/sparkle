import { describe, expect, it } from "vitest";
import {
  InboundMessagePayloadSchema,
  normalizeInboundMessage,
} from "../src/domain/inbound-message.js";

function payload(message: Record<string, unknown>, sender?: Record<string, unknown>): unknown {
  return {
    sender: sender ?? { sender_id: { open_id: "ou_abc" } },
    message: {
      message_id: "om_1",
      chat_id: "oc_1",
      chat_type: "group",
      create_time: "1755200000000",
      ...message,
    },
  };
}

function normalize(raw: unknown) {
  return normalizeInboundMessage(InboundMessagePayloadSchema.parse(raw));
}

describe("normalizeInboundMessage", () => {
  it("text：提取正文并还原 @ 提及", () => {
    const event = normalize(
      payload({
        message_type: "text",
        content: JSON.stringify({ text: "@_user_1 帮我看下这个" }),
        mentions: [{ key: "@_user_1", name: "Sparkle" }],
      }),
    );
    expect(event.text).toBe("@Sparkle 帮我看下这个");
    expect(event.chatType).toBe("group");
    expect(event.senderId).toBe("ou_abc");
    expect(event.createdAt).toBe(new Date(1755200000000).toISOString());
  });

  it("post：拍平标题与段落，at/img 节点转文字", () => {
    const event = normalize(
      payload({
        message_type: "post",
        content: JSON.stringify({
          title: "周报",
          content: [
            [
              { tag: "text", text: "本周进展：" },
              { tag: "at", user_name: "闻震" },
            ],
            [{ tag: "img" }],
          ],
        }),
      }),
    );
    expect(event.text).toBe("周报\n本周进展：@闻震\n[图片]");
  });

  it("非文本类型给占位；content 解析失败降级不抛", () => {
    expect(normalize(payload({ message_type: "image", content: "{}" })).text).toBe("[图片]");
    expect(
      normalize(payload({ message_type: "file", content: JSON.stringify({ file_name: "a.pdf" }) }))
        .text,
    ).toBe("[文件] a.pdf");
    expect(normalize(payload({ message_type: "text", content: "not-json" })).text).toBe("[text]");
    expect(normalize(payload({ message_type: "vote", content: "{}" })).text).toBe("[vote]");
  });

  it("p2p 会话类型归一", () => {
    const event = normalize(
      payload({ message_type: "text", content: JSON.stringify({ text: "hi" }), chat_type: "p2p" }),
    );
    expect(event.chatType).toBe("p2p");
  });
});
