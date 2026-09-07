import type { MetricChartSeries } from "@sparkle/metric-api/chart";
import { formatBucketLabel } from "./metric-format";

type ChartRow = {
  bucketLabel: string;
  bucketStart: string;
} & Record<string, number | string | null>;

export type RenderSeries = MetricChartSeries & {
  dataKey: string;
  /** 已解析的展示颜色（seriesMeta 显式映射优先，否则 seriesColors 轮转）。 */
  color: string;
};

/**
 * 按隐藏集过滤出可见序列。仅 filter、不重排不重编号：保留各序列原 dataKey / color / 顺序，
 * 隐藏中间项也不会让剩余序列串色。喂给图表几何（rows / pieData / 各画法的 .map）。
 */
export function selectVisibleSeries(
  series: RenderSeries[],
  hiddenKeys: Set<string>,
): RenderSeries[] {
  return series.filter(item => !hiddenKeys.has(item.key));
}

/**
 * 把 pinKey 对应的序列移到数组末位（stacked-area 里 = 堆叠视觉最顶），其余保持原相对顺序。
 * 只改渲染顺序、不碰 dataKey/color（已在 renderSeries 阶段按原序号定死，随 dataKey 走色）——
 * 守住「绝不重新编号」不变量。pinKey 缺省或不在序列里时按原序返回（顺序不变，不保证同一引用）。
 */
export function orderSeriesForStack<T extends { key: string }>(series: T[], pinKey?: string): T[] {
  if (!pinKey) {
    return series;
  }
  const pinned = series.filter(item => item.key === pinKey);
  if (pinned.length === 0) {
    return series;
  }
  return [...series.filter(item => item.key !== pinKey), ...pinned];
}

type PieSlice = { dataKey: string; name: string; value: number; fill: string };

/**
 * pie 构成数据：每序列塌成一个切片，值 = 其各点之和的**绝对量**（null 记 0）。饼图走「单桶查询」
 * （bucket 覆盖整段范围）时每序列恰一个点，求和即那个值。取绝对量是因为饼图表达「部分占整体」，
 * 负值（min/avg 聚合或 P3 diff 派生可产生）无构成语义——recharts 会把负值画成负角度/反向切片、且把
 * 负值计入分母扭曲占比。饼图应配非负 metric，这里对误用做兜底。dataKey 供稳定 React key（label 不保唯一）。
 */
export function buildPieData(series: RenderSeries[]): PieSlice[] {
  return series.map(item => ({
    dataKey: item.dataKey,
    name: item.label,
    value: Math.abs(item.points.reduce((sum, point) => sum + (point.value ?? 0), 0)),
    fill: item.color,
  }));
}

export function buildChartRows(series: RenderSeries[]): ChartRow[] {
  const rowsByBucketStart = new Map<string, ChartRow>();

  for (const item of series) {
    for (const point of item.points) {
      const existingRow =
        rowsByBucketStart.get(point.bucketStart) ??
        ({
          bucketLabel: formatBucketLabel(point.bucketStart),
          bucketStart: point.bucketStart,
        } satisfies ChartRow);

      existingRow[item.dataKey] = point.value;
      rowsByBucketStart.set(point.bucketStart, existingRow);
    }
  }

  return [...rowsByBucketStart.values()].sort((left, right) =>
    left.bucketStart.localeCompare(right.bucketStart),
  );
}
