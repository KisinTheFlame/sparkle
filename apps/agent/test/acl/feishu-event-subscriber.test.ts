import { expect, it, vi } from "vitest";
import { FeishuEventSubscriber } from "../../src/acl/feishu-event-subscriber.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

initTestLoggerRuntime();
it("stop 等待在途消息与游标落库，缓冲中的下一帧不再投递", async () => {
  let finish!: () => void;
  const onEvent = vi.fn(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  const save = vi.fn(async () => {});
  const frame = (seq: number) =>
    `data: ${JSON.stringify({
      seq,
      messageId: `om_${seq}`,
      chatId: "oc_1",
      chatType: "group",
      chatName: null,
      senderId: "ou_1",
      senderName: null,
      msgType: "text",
      text: "hi",
      createdAt: "2026-09-07T00:00:00.000Z",
    })}\n\n`;
  const fetchMock = vi.fn(async () => new Response(frame(1) + frame(2)));
  const subscriber = new FeishuEventSubscriber({
    baseUrl: "http://feishu",
    onEvent,
    cursorStore: { load: async () => 0, save },
    fetch: fetchMock,
  });
  const running = subscriber.start();
  await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1));
  let stopped = false;
  const stopping = subscriber.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  expect(save).not.toHaveBeenCalled();
  finish();
  await Promise.all([running, stopping]);
  expect(save).toHaveBeenCalledExactlyOnceWith(1);
  expect(onEvent).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
