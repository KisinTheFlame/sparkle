import type { FeishuMessageEvent } from "@sparkle/feishu-api/event";

export type FeishuEventSubscriber = {
  /** 写一帧 SSE（含 id / data 行）。返回 false 表示背压侧已接管（由 write 实现处理）。 */
  write(frame: string): void;
  heartbeat(): void;
  /**
   * 回放尚未完成时缓冲 live 事件（见 events handler 的先订阅后回放编排），
   * 回放完毕后由 handler flush 并置 false。
   */
  buffering: boolean;
  buffered: FeishuMessageEvent[];
  /** 已投递到的 seq；低于等于它的 live 帧跳过（回放与 live 的去重边界）。 */
  lastSentSeq: number;
};

/** 把事件编码成 SSE 帧：`id: <seq>` + `data: <json>`。 */
export function encodeEventFrame(event: FeishuMessageEvent): string {
  return `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * 入站事件的进程内广播器：网关落库成功后 publish，向所有在线订阅者写帧。
 * 订阅者处于 buffering（回放中）时先缓冲，避免回放与 live 交错乱序。
 */
export class FeishuEventBroadcaster {
  private readonly subscribers = new Set<FeishuEventSubscriber>();

  public add(subscriber: FeishuEventSubscriber): void {
    this.subscribers.add(subscriber);
  }

  public remove(subscriber: FeishuEventSubscriber): void {
    this.subscribers.delete(subscriber);
  }

  public publish(event: FeishuMessageEvent): void {
    for (const subscriber of this.subscribers) {
      if (subscriber.buffering) {
        subscriber.buffered.push(event);
        continue;
      }
      if (event.seq <= subscriber.lastSentSeq) {
        continue;
      }
      subscriber.lastSentSeq = event.seq;
      subscriber.write(encodeEventFrame(event));
    }
  }

  public heartbeatAll(): void {
    for (const subscriber of this.subscribers) {
      subscriber.heartbeat();
    }
  }
}
