import { beforeEach, expect, it, vi } from "vitest";
import { initLoggerRuntime } from "@sparkle/kernel/logger/runtime";
import { FeishuGateway } from "../src/application/feishu-gateway.js";
import type { FeishuEventStore } from "../src/application/event-store.js";
import { FeishuEventBroadcaster } from "../src/application/event-broadcaster.js";

const { start } = vi.hoisted(() => ({ start: vi.fn() }));

vi.mock("@larksuiteoapi/node-sdk", () => ({
  Client: class {},
  WSClient: class {
    start = start;
  },
  EventDispatcher: class {
    register() {
      return this;
    }
  },
}));

beforeEach(() => {
  start.mockReset();
  initLoggerRuntime({ sinks: [{ write() {} }] });
});

function createGateway(): FeishuGateway {
  return new FeishuGateway({
    appId: "test",
    appSecret: "test",
    // 启动订阅不访问事件存储；SDK 在此测试中不会投递入站事件。
    eventStore: {} as FeishuEventStore,
    broadcaster: new FeishuEventBroadcaster(),
  });
}

it("等待 SDK 完成启动后才向调用方报告完成", async () => {
  let finish!: () => void;
  start.mockReturnValueOnce(new Promise<void>(resolve => (finish = resolve)));
  let completed = false;
  const starting = Promise.resolve(createGateway().start()).then(() => {
    completed = true;
  });

  await Promise.resolve();
  expect(completed).toBe(false);
  finish();
  await starting;
  expect(completed).toBe(true);
});

it("将 SDK 启动失败传回启动链", async () => {
  const error = new Error("SDK startup failed");
  const failed = Promise.reject(error);
  // 保证旧实现丢弃此 Promise 时，回归测试也不会制造未处理拒绝。
  void failed.catch(() => undefined);
  start.mockReturnValueOnce(failed);

  await expect(Promise.resolve(createGateway().start())).rejects.toBe(error);
});
