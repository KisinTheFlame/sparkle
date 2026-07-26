import { initLoggerRuntime } from "@sparkle/kernel/logger/runtime";
import type { LogSink } from "@sparkle/kernel/logger/types";

const sink: LogSink = {
  write: () => {},
};

/** 测试用静音 logger runtime（AppLogger 未初始化会抛错，镜像 apps/browser 的 helper）。 */
export function initTestLoggerRuntime(): void {
  initLoggerRuntime({ sinks: [sink] });
}
