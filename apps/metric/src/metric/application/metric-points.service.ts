import type {
  MetricPointsQueryRequest,
  MetricPointsQueryResponse,
} from "@sparkle/metric-api/points";

export interface MetricPointsService {
  query(request: MetricPointsQueryRequest): Promise<MetricPointsQueryResponse>;
}
