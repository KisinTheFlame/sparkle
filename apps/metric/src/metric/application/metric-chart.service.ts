import type { MetricChartQueryRequest, MetricChartQueryResponse } from "@sparkle/metric-api/chart";

export interface MetricChartService {
  query(request: MetricChartQueryRequest): Promise<MetricChartQueryResponse>;
}
