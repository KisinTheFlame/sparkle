import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@sparkle/http/register";
import { consoleApiContract } from "@sparkle/console-api/contract";
import type { AppLogQueryService } from "../application/app-log-query.service.js";

type AppLogHandlerDeps = {
  appLogQueryService: AppLogQueryService;
};

/** 应用日志查询路由。路由与 schema 的单一事实源在 @sparkle/console-api（#279 PR4）。 */
export class AppLogHandler {
  private readonly appLogQueryService: AppLogQueryService;

  public constructor({ appLogQueryService }: AppLogHandlerDeps) {
    this.appLogQueryService = appLogQueryService;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, consoleApiContract.queryAppLogs, ({ input }) =>
      this.appLogQueryService.queryList(input),
    );
  }
}
