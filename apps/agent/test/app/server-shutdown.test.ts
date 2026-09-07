import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  shutdownServerResources,
  type AgentRuntimeController,
} from "../../src/app/server-shutdown.js";

type ShutdownLoggerStub = {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  errorWithCause: ReturnType<typeof vi.fn>;
};

function createLoggerStub(): ShutdownLoggerStub {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    errorWithCause: vi.fn(),
  };
}

function createAgentRuntimeStub(order: string[], label: string): AgentRuntimeController {
  return {
    stop: vi.fn(async () => {
      order.push(label);
    }),
  };
}

describe("shutdownServerResources", () => {
  it("按预期顺序关闭资源", async () => {
    const order: string[] = [];
    const logger = createLoggerStub();
    const app = {
      close: vi.fn(async () => {
        order.push("app.close");
      }),
    } as unknown as FastifyInstance;
    const shutdownApps = vi.fn(async () => {
      order.push("shutdownApps");
    });
    const schedulerClient = {
      stop: vi.fn(() => {
        order.push("schedulerClient.stop");
      }),
    };
    const rootAgentRuntime = createAgentRuntimeStub(order, "rootAgentRuntime.stop");
    const closeLoggerRuntime = vi.fn(async () => {
      order.push("closeLoggerRuntime");
    });
    const closeDatabase = vi.fn(async () => {
      order.push("closeDb");
    });
    const exit = vi.fn((code: number) => {
      order.push(`exit(${code})`);
    });

    await shutdownServerResources({
      signal: "SIGTERM",
      timeoutMs: 10_000,
      isServerStarted: true,
      app,
      database: {} as never,
      shutdownApps,
      schedulerClient: schedulerClient as never,
      rootAgentRuntime,
      logger,
      closeLoggerRuntime,
      closeDatabase,
      exit,
      setShutdownTimeout: () => ({}) as ReturnType<typeof setTimeout>,
      clearShutdownTimeout: () => {},
    });

    expect(order).toEqual([
      "app.close",
      "schedulerClient.stop",
      "rootAgentRuntime.stop",
      "shutdownApps",
      "closeLoggerRuntime",
      "closeDb",
      "exit(0)",
    ]);
  });

  it("有状态采样器时先停它（早于 HTTP / root agent），保证关停期间不再打点", async () => {
    const order: string[] = [];
    const logger = createLoggerStub();
    const app = {
      close: vi.fn(async () => {
        order.push("app.close");
      }),
    } as unknown as FastifyInstance;
    const stateSampler = {
      stop: vi.fn(() => {
        order.push("stateSampler.stop");
      }),
    };
    const rootAgentRuntime = createAgentRuntimeStub(order, "rootAgentRuntime.stop");
    const exit = vi.fn();

    await shutdownServerResources({
      signal: "SIGTERM",
      timeoutMs: 10_000,
      isServerStarted: true,
      app,
      database: {} as never,
      shutdownApps: null,
      schedulerClient: null,
      rootAgentRuntime,
      stateSampler,
      logger,
      closeLoggerRuntime: vi.fn(async () => {}),
      closeDatabase: vi.fn(async () => {}),
      exit,
      setShutdownTimeout: () => ({}) as ReturnType<typeof setTimeout>,
      clearShutdownTimeout: () => {},
    });

    expect(stateSampler.stop).toHaveBeenCalledTimes(1);
    // 采样器停在最前：早于 app.close 与 rootAgentRuntime.stop。
    expect(order[0]).toBe("stateSampler.stop");
    expect(order.indexOf("stateSampler.stop")).toBeLessThan(order.indexOf("rootAgentRuntime.stop"));
  });

  it("root agent 为空时仍能安全完成关停", async () => {
    const logger = createLoggerStub();
    const closeLoggerRuntime = vi.fn(async () => {});
    const closeDatabase = vi.fn(async () => {});
    const exit = vi.fn();

    await shutdownServerResources({
      signal: "SIGINT",
      timeoutMs: 10_000,
      isServerStarted: false,
      app: null,
      database: {} as never,
      shutdownApps: null,
      schedulerClient: null,
      rootAgentRuntime: null,
      logger,
      closeLoggerRuntime,
      closeDatabase,
      exit,
      setShutdownTimeout: () => ({}) as ReturnType<typeof setTimeout>,
      clearShutdownTimeout: () => {},
    });

    expect(closeDatabase).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("成功关停时 root agent stop 只调用一次", async () => {
    const logger = createLoggerStub();
    const rootAgentRuntime = {
      stop: vi.fn(async () => {}),
    };
    const exit = vi.fn();

    await shutdownServerResources({
      signal: "SIGTERM",
      timeoutMs: 10_000,
      isServerStarted: false,
      app: null,
      database: null,
      shutdownApps: null,
      schedulerClient: null,
      rootAgentRuntime,
      logger,
      closeLoggerRuntime: async () => {},
      closeDatabase: async () => {},
      exit,
      setShutdownTimeout: () => ({}) as ReturnType<typeof setTimeout>,
      clearShutdownTimeout: () => {},
    });

    expect(rootAgentRuntime.stop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("某步关停失败时后续步骤仍 best-effort 执行，DB 照关，最终退出 1", async () => {
    const logger = createLoggerStub();
    const rootStopError = new Error("root stop failed");
    const rootAgentRuntime = {
      stop: vi.fn(async () => {
        throw rootStopError;
      }),
    };
    const closeLoggerRuntime = vi.fn(async () => {});
    const closeDatabase = vi.fn(async () => {});
    const exit = vi.fn();

    await shutdownServerResources({
      signal: "SIGTERM",
      timeoutMs: 10_000,
      isServerStarted: false,
      app: null,
      database: {} as never,
      shutdownApps: null,
      schedulerClient: null,
      rootAgentRuntime,
      logger,
      closeLoggerRuntime,
      closeDatabase,
      exit,
      setShutdownTimeout: () => ({}) as ReturnType<typeof setTimeout>,
      clearShutdownTimeout: () => {},
    });

    expect(rootAgentRuntime.stop).toHaveBeenCalledTimes(1);
    // 单步失败不再阻断后续：logger / DB 都仍被关闭（尤其 DB 必须关，防连接泄漏）。
    expect(closeLoggerRuntime).toHaveBeenCalledTimes(1);
    expect(closeDatabase).toHaveBeenCalledTimes(1);
    expect(logger.errorWithCause).toHaveBeenCalledWith(
      "Root agent runtime closed failed",
      rootStopError,
      {
        event: "server.shutdown.root_agent_runtime_closed.failed",
        signal: "SIGTERM",
      },
    );
    // 有步骤失败 → 退出码 1。
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("全部关停成功时按顺序走完并退出 0", async () => {
    const logger = createLoggerStub();
    const closeDatabase = vi.fn(async () => {});
    const exit = vi.fn();

    await shutdownServerResources({
      signal: "SIGTERM",
      timeoutMs: 10_000,
      isServerStarted: false,
      app: null,
      database: {} as never,
      shutdownApps: null,
      schedulerClient: null,
      rootAgentRuntime: null,
      logger,
      closeLoggerRuntime: async () => {},
      closeDatabase,
      exit,
      setShutdownTimeout: () => ({}) as ReturnType<typeof setTimeout>,
      clearShutdownTimeout: () => {},
    });

    expect(closeDatabase).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
});

it("HTTP 有未完成的压缩请求时立即通知 root 停止，App 存档等待所有在途工作", async () => {
  const order: string[] = [];
  let finishInput!: () => void;
  let finishRoot!: () => void;
  let finishHttp!: () => void;
  const inputs = new Promise<void>(resolve => {
    finishInput = resolve;
  });
  const root = new Promise<void>(resolve => {
    finishRoot = resolve;
  });
  const http = new Promise<void>(resolve => {
    finishHttp = resolve;
  });
  const shutdownApps = vi.fn(async () => {
    order.push("saveApps");
  });
  const stopping = shutdownServerResources({
    signal: "SIGTERM",
    timeoutMs: 10_000,
    isServerStarted: true,
    app: { close: () => http } as unknown as FastifyInstance,
    database: {} as never,
    schedulerClient: null,
    stopInputs: () => inputs,
    rootAgentRuntime: {
      stop: async () => {
        order.push("stopRoot");
        await root;
        order.push("rootDone");
      },
    },
    shutdownApps,
    logger: createLoggerStub(),
    closeLoggerRuntime: async () => {},
    closeDatabase: async () => {
      order.push("closeDb");
    },
    exit: vi.fn(),
  });
  await vi.waitFor(() => expect(order).toContain("stopRoot"));
  expect(shutdownApps).not.toHaveBeenCalled();
  finishRoot();
  finishHttp();
  await Promise.resolve();
  expect(shutdownApps).not.toHaveBeenCalled();
  finishInput();
  await stopping;
  expect(order).toEqual(["stopRoot", "rootDone", "saveApps", "closeDb"]);
});
