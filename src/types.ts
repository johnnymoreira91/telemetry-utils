/**
 * Tipos públicos compartilhados da biblioteca `@flexicorp/telemetry-utils`.
 *
 * Centraliza os tipos de domínio (ExportTarget, LogLevel, LogFormat, MetricKind)
 * e a interface de configuração resolvida (TelemetryConfig), além das constantes
 * de conjuntos permitidos reutilizadas pela camada de validação (Config Loader).
 */

/**
 * Destino de exportação selecionável por sinal de telemetria.
 * Valores permitidos: `alloy` ou `otlp` (R6.1).
 */
export type ExportTarget = 'alloy' | 'otlp';

/**
 * Nível de log com prioridade numérica fixa, do mais crítico (`crit`=0)
 * ao menos crítico (`verbose`=7) (R1.1).
 */
export type LogLevel =
  | 'crit'
  | 'alert'
  | 'http'
  | 'error'
  | 'warn'
  | 'info'
  | 'debug'
  | 'verbose';

/**
 * Formato de saída de log no console (R1.4, R1.5, R1.9).
 */
export type LogFormat = 'json' | 'text' | 'message';

/**
 * Tipo de métrica suportado pelo Metrics_Provider (R4.1).
 */
export type MetricKind = 'counter' | 'histogram' | 'gauge';

/**
 * Configuração de telemetria resolvida a partir das variáveis de ambiente,
 * com defaults aplicados e valores validados pelo Config Loader (R7).
 */
export interface TelemetryConfig {
  /** APPLICATION_NAME, default `unknown-service` (R7.4). */
  applicationName: string;
  /** APP_STAGE, default `unknown-stage` (R7.5). */
  stage: string;
  /** SERVICE_NAMESPACE -> atributo de recurso `service.namespace` (R9.8). */
  serviceNamespace: string;
  /** APP_VERSION -> atributo de recurso `service.version`, default `0.0.0`. */
  serviceVersion: string;
  /**
   * OTEL_TENANT. Identificador de tenant propagado como o header
   * `X-Scope-OrgID` em cada exportador OTLP HTTP (traces, logs, metrics),
   * permitindo o isolamento multi-tenant no backend de observabilidade (ex.:
   * Grafana Mimir/Loki/Tempo). Também é exposto como atributo de recurso
   * `tenant`.
   *
   * É OBRIGATÓRIO para iniciar o Node SDK: o bootstrap (`/tracing`) falha de
   * forma rápida quando `OTEL_TENANT` está ausente em modo Kubernetes. Em modo
   * local (SDK não iniciado) assume o valor placeholder `default`.
   */
  tenant: string;
  /** LOG_LEVEL, default `info` (R1.7, R1.8). */
  logLevel: LogLevel;
  /** LOG_FORMAT, default `text` (R1.9). */
  logFormat: LogFormat;
  /** LOKI_TRANSPORT === 'true' (R6.6, R6.7). */
  lokiTransport: boolean;
  /** LOKI_HOST, default `http://loki.infra.svc.cluster.local:3100` (R6.8). */
  lokiHost: string;
  /** KUBERNETES === 'true' (R9.4, R9.5). */
  kubernetes: boolean;
  /** OTEL_LOG_LEVEL, default `WARN` (R9.2, R9.3). */
  otelLogLevel: string;
  /** Endpoints OTLP independentes por sinal (R7.2, R7.3). */
  otlpEndpoints: {
    /** OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, default `.../v1/traces`. */
    traces: string;
    /** OTEL_EXPORTER_OTLP_LOGS_ENDPOINT, default `.../v1/logs`. */
    logs: string;
    /** OTEL_EXPORTER_OTLP_METRICS_ENDPOINT, default `.../v1/metrics`. */
    metrics: string;
  };
  /** Destino de exportação selecionado por sinal (R6.1). */
  exportTargets: {
    /** EXPORT_TARGET_METRICS, default `otlp`. */
    metrics: ExportTarget;
    /** EXPORT_TARGET_TRACES, default `otlp`. */
    traces: ExportTarget;
  };
}

/**
 * Conjunto de Log_Level permitidos, em ordem crescente de prioridade numérica
 * (índice 0 = `crit`, índice 7 = `verbose`). Reutilizado pela validação
 * tolerante de `LOG_LEVEL` (R1.6, R1.8).
 */
export const LOG_LEVELS: readonly LogLevel[] = [
  'crit',
  'alert',
  'http',
  'error',
  'warn',
  'info',
  'debug',
  'verbose',
] as const;

/**
 * Conjunto de Log_Format permitidos. Reutilizado pela validação tolerante
 * de `LOG_FORMAT` (R1.9).
 */
export const LOG_FORMATS: readonly LogFormat[] = ['json', 'text', 'message'] as const;

/**
 * Conjunto de Export_Target permitidos. Reutilizado pela validação estrita
 * de `Export_Target` por sinal (R6.1, R6.4).
 */
export const EXPORT_TARGETS: readonly ExportTarget[] = ['alloy', 'otlp'] as const;

/**
 * Conjunto de tipos de métrica permitidos. Reutilizado pela validação de
 * registro de métricas (R4.1, R4.6).
 */
export const METRIC_KINDS: readonly MetricKind[] = ['counter', 'histogram', 'gauge'] as const;
