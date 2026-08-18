import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@sparkle/http/register";
import { feishuApiContract } from "@sparkle/feishu-api/contract";
import type { FeishuGateway } from "../application/feishu-gateway.js";

type FeishuSendHandlerDeps = {
  gateway: FeishuGateway;
};

/** 出站发消息路由：agent 经契约 client 调它，网关转飞书 im.message.create。 */
export class FeishuSendHandler {
  private readonly gateway: FeishuGateway;

  public constructor({ gateway }: FeishuSendHandlerDeps) {
    this.gateway = gateway;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, feishuApiContract.sendMessage, async ({ input }) => {
      return this.gateway.sendMessage(input);
    });
  }
}
