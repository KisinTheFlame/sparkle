import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@sparkle/http/register";
import { consoleApiContract } from "@sparkle/console-api/contract";
import type { NapcatQqMessageQueryService } from "../application/napcat-group-message-query.service.js";

type NapcatQqMessageHandlerDeps = {
  napcatQqMessageQueryService: NapcatQqMessageQueryService;
};

/** QQ 消息查询路由。路由与 schema 的单一事实源在 @sparkle/console-api（#279 PR4）。 */
export class NapcatQqMessageHandler {
  private readonly napcatQqMessageQueryService: NapcatQqMessageQueryService;

  public constructor({ napcatQqMessageQueryService }: NapcatQqMessageHandlerDeps) {
    this.napcatQqMessageQueryService = napcatQqMessageQueryService;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, consoleApiContract.queryNapcatQqMessages, ({ input }) =>
      this.napcatQqMessageQueryService.queryList(input),
    );
  }
}
