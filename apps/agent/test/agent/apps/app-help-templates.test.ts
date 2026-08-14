import { describe, expect, it } from "vitest";
import { ClockApp } from "../../../src/agent/apps/clock/clock.app.js";
import { AmapApp } from "../../../src/agent/apps/amap/amap.app.js";
import { BrowserApp } from "../../../src/agent/apps/browser/browser.app.js";
import type { BrowserClient } from "../../../src/acl/browser-client.js";
import type { RootAgentEffect } from "../../../src/agent/runtime/effect/root-agent-effect.js";

/**
 * App help / portal 模板的职责分界回归锁（issue #262）：
 * - portal（onFocus 屏）只做「这是什么地方」的定位散文——不含子工具清单、不含
 *   switch / help 导航指引（switch 首进已自动附 <app_help>，见 switch.tool.ts）。
 * - help 是子工具清单与用法要点的唯一来源，保留 switch 指引。
 * clock 无 onFocus，其 help 仍锁逐字输出。
 * 改模板文案时应连带更新这里的期望值。
 */

const BROWSER_TOOLS = [
  "browser_navigate",
  "browser_observe",
  "browser_click",
  "browser_type",
  "browser_press",
  "browser_wait_for",
  "browser_screenshot",
  "browser_eval",
];

const AMAP_TOOLS = [
  "geocode",
  "regeocode",
  "search_poi",
  "search_around",
  "plan_route",
  "plan_transit",
  "weather",
  "static_map",
];

function appendedContent(effects: readonly RootAgentEffect[]): string {
  expect(effects).toHaveLength(1);
  const effect = effects[0] as { type: "append_message"; content: string };
  expect(effect.type).toBe("append_message");
  return effect.content;
}

/** portal 定位屏公共断言：无子工具清单、无任一工具名、无 switch/help 导航指引。 */
function expectPortalIsPureIntro(content: string, toolNames: readonly string[]): void {
  expect(content).not.toContain("可调用工具");
  expect(content).not.toContain("switch");
  expect(content).not.toContain("help");
  for (const name of toolNames) {
    expect(content).not.toContain(name);
  }
}

function stubBrowserApp(): BrowserApp {
  const browserClient = {
    getLocation: async () => {
      throw new Error("browser process down");
    },
  } as unknown as BrowserClient;
  return new BrowserApp({ browserClient });
}

async function startedAmapApp(apiKey: string): Promise<AmapApp> {
  const app = new AmapApp();
  await app.onStartup({ config: app.configSchema.parse({ apiKey }) });
  return app;
}

describe("clock — help 逐字锁（无 onFocus，本就只靠 help）", () => {
  it("clock：静态 help", async () => {
    const app = new ClockApp();
    expect(await app.help()).toBe(
      [
        "你在时钟 App 里。当前可调用工具：",
        "  - view_time(): 查看当前北京时间（精确到秒）。",
        "",
        "要去别的 App，用 switch(id=...) 切过去。",
      ].join("\n"),
    );
  });
});

describe("portal 定位屏 — 不含子工具清单与导航指引", () => {
  it("browser：portal 只剩定位散文", async () => {
    const content = appendedContent(await stubBrowserApp().onFocus());
    expect(content.startsWith("<browser_portal>")).toBe(true);
    expect(content).toContain("你进了浏览器。");
    expectPortalIsPureIntro(content, BROWSER_TOOLS);
  });

  it("amap（已配置）：portal 只剩定位散文", async () => {
    const app = await startedAmapApp("K");
    const content = appendedContent(await app.onFocus());
    expect(content.startsWith("<amap_portal>")).toBe(true);
    expect(content).toContain("你进了高德地图。");
    expectPortalIsPureIntro(content, AMAP_TOOLS);
    expect(content).not.toContain("GCJ-02");
  });

  it("amap（未配置 key）：portal 给未配置提示，同样无导航指引", async () => {
    const app = await startedAmapApp("");
    const content = appendedContent(await app.onFocus());
    expect(content).toContain("你进了高德地图，但它还没配置 key，暂时不能用。");
    expectPortalIsPureIntro(content, AMAP_TOOLS);
  });
});

describe("help — 子工具清单的唯一来源，保留 switch 指引", () => {
  it("browser：help 披露全部 8 个工具与用法要点", async () => {
    const help = await stubBrowserApp().help();
    for (const name of BROWSER_TOOLS) {
      expect(help).toContain(name);
    }
    expect(help).toContain("填输入框");
    expect(help).toContain("switch");
  });

  it("browser：无位置时降级为「还没打开过页面」", async () => {
    expect(await stubBrowserApp().help()).toContain("你在浏览器 App 里。还没打开过页面。");
  });

  it("browser：有位置时插值 lastTitle/lastUrl（title 为 null 渲染成空串）", async () => {
    const browserClient = {
      getLocation: async () => ({ lastUrl: "https://example.com", lastTitle: null }),
    } as unknown as BrowserClient;
    const app = new BrowserApp({ browserClient });
    expect(await app.help()).toContain("你在浏览器 App 里。上次你在：（https://example.com）");
  });

  it("amap（已配置）：help 披露全部 8 个工具与 GCJ-02 要点", async () => {
    const help = await (await startedAmapApp("K")).help();
    for (const name of AMAP_TOOLS) {
      expect(help).toContain(name);
    }
    expect(help).toContain("GCJ-02");
    expect(help).toContain("switch");
  });

  it("amap（未配置 key）：help 与 onFocus 都渲染未配置提示屏", async () => {
    const app = await startedAmapApp("");
    const helpText = await app.help();
    expect(helpText).toContain("你进了高德地图，但它还没配置 key，暂时不能用。");
    expect(appendedContent(await app.onFocus())).toBe(helpText);
  });
});
