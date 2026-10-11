/**
 * Ponto de entrada raiz da biblioteca `@flexicorp/telemetry-utils` (R8.5).
 *
 * Re-exporta a API pública nomeada do pacote — `LoggerService`, `Namespace`,
 * `MetricsProvider`, `TracerProvider` — além dos tipos públicos compartilhados
 * (`TelemetryConfig`, `ExportTarget`, `LogLevel`, `LogFormat`, `MetricKind`),
 * acessíveis via importação a partir do pacote raiz.
 *
 * IMPORTANTE: este módulo NÃO importa o bootstrap de telemetria
 * (`src/tracing/index.ts`). A importação da raiz não deve iniciar o Node_SDK;
 * o bootstrap é exposto exclusivamente pelo subcaminho dedicado
 * (`@flexicorp/telemetry-utils/tracing`), importável por efeito colateral
 * (R8.7, R9.11).
 */

// Logging — LoggerService (classe concreta) e tipos auxiliares de métrica/handle
// expostos por seus respectivos módulos.
export { LoggerService } from './logging/logger-service';
export { WinstonLogger } from './logging/winston-logger';

// Namespace — classe nomeada e a instância default compartilhada (R8.5).
export { Namespace } from './logging/namespace';
export { default as namespace } from './logging/namespace';

// Metrics_Provider — provedor de métricas e tipos auxiliares públicos (R4).
export { MetricsProvider } from './metrics/metrics-provider';
export type { MetricHandle, MetricAttributes } from './metrics/metrics-provider';

// Tracer_Provider — provedor de tracing (R5).
export { TracerProvider } from './tracing/tracer-provider';

// Tipos públicos compartilhados (R6, R7).
export type {
  TelemetryConfig,
  ExportTarget,
  LogLevel,
  LogFormat,
  MetricKind,
} from './types';
