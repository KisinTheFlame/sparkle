import type { RecordMetricRequest } from "@sparkle/metric-api/record";

export interface MetricRecordService {
  record(input: RecordMetricRequest): Promise<void>;
}
