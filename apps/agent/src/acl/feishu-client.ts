import { createClient, type JsonClient } from "@sparkle/rpc-client/client";
import { feishuApiContract, type FeishuSendMessageRequest } from "@sparkle/feishu-api/contract";

export type FeishuClient = {
  sendMessage(input: FeishuSendMessageRequest): Promise<{ messageId: string }>;
};

/**
 * 飞书出站门面（防腐层）：打到独立的 sparkle-feishu 进程。wire 走契约 client，
 * 服务不可达时抛统一 BizError（工具层回规整失败结构）。
 */
export class HttpFeishuClient implements FeishuClient {
  private readonly api: JsonClient<typeof feishuApiContract>;

  public constructor({ baseUrl }: { baseUrl: string }) {
    this.api = createClient(feishuApiContract, {
      baseUrl,
      unreachableMessage: "飞书服务调用失败",
    });
  }

  public async sendMessage(input: FeishuSendMessageRequest): Promise<{ messageId: string }> {
    return this.api.sendMessage(input);
  }
}
