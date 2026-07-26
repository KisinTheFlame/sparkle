import type { MetricChartQueryResponse } from "@sparkle/metric-api/chart";
import type { MetricDeriveRequest } from "@sparkle/metric-api/derive";

export interface MetricDeriveService {
  derive(request: MetricDeriveRequest): Promise<MetricChartQueryResponse>;
}
