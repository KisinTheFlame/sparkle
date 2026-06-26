/**
 * 最小日志接口。原 kagami 在 server 内用 AppLogger（绑定 logger runtime）；本包改为
 * 注入式，调用方按需提供实现（如适配自家 logger），默认 no-op。
 */
export interface Logger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export const noopLogger: Logger = {
  warn() {
    // no-op
  },
};
