/**
 * Config Loader — resolvers de configuração enumerada (R7).
 *
 * Centraliza a validação/normalização de parâmetros enumerados lidos do
 * ambiente. A validação de `LOG_LEVEL`, `LOG_FORMAT` e `OTEL_LOG_LEVEL` é
 * TOLERANTE (faz fallback para um default seguro e, no caso do `LOG_LEVEL`,
 * registra o valor inválido no console de erro — R1.8/R1.9/R9.3). A validação
 * de `Export_Target` é ESTRITA (rejeita valores inválidos com erro descritivo,
 * preservando o estado não inicializado — R6.4/R7.7).
 *
 * `loadConfig` lê o ambiente completo, aplica os defaults da tabela de design
 * e valida os parâmetros estritos, produzindo a `TelemetryConfig` consumida
 * por Logger, Metrics_Provider, Tracer_Provider e pelo bootstrap do SDK.
 */

import {
  EXPORT_TARGETS,
  LOG_FORMATS,
  LOG_LEVELS,
  type ExportTarget,
  type LogFormat,
  type LogLevel,
  type TelemetryConfig,
} from '../types';

/** Log_Level padrão aplicado em ausência/invalidez da env (R1.7, R1.8). */
const DEFAULT_LOG_LEVEL: LogLevel = 'info';

/** Log_Format padrão aplicado em ausência/invalidez da env (R1.9). */
const DEFAULT_LOG_FORMAT: LogFormat = 'text';

/** Nível de diagnóstico OpenTelemetry padrão (R9.2, R9.3). */
const DEFAULT_OTEL_LOG_LEVEL = 'WARN';

/**
 * Níveis de diagnóstico aceitos pela API do OpenTelemetry (`DiagLogLevel`).
 * Reutilizado pela resolução tolerante de `OTEL_LOG_LEVEL` (R9.2, R9.3).
 */
export const OTEL_LOG_LEVELS: readonly string[] = [
  'NONE',
  'ERROR',
  'WARN',
  'INFO',
  'DEBUG',
  'VERBOSE',
  'ALL',
] as const;

/**
 * Valida/normaliza o `LOG_LEVEL` (R1.6, R1.7, R1.8).
 *
 * - Entrada pertencente ao conjunto permitido: retorna o próprio valor.
 * - Entrada ausente: retorna o default `info` silenciosamente (R1.7).
 * - Entrada inválida: retorna o default `info` e registra no console de erro
 *   uma mensagem indicando o valor inválido informado (R1.8).
 *
 * @param raw Valor bruto lido de `LOG_LEVEL` (pode ser `undefined`).
 * @returns Um `LogLevel` válido.
 */
export function resolveLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined) {
    return DEFAULT_LOG_LEVEL;
  }

  if ((LOG_LEVELS as readonly string[]).includes(raw)) {
    return raw as LogLevel;
  }

  // Valor presente, porém fora do conjunto permitido: fallback + log de erro (R1.8).
  console.error(
    `[telemetry-utils] LOG_LEVEL invalido: "${raw}". ` +
      `Valores permitidos: ${LOG_LEVELS.join(', ')}. Usando o padrao "${DEFAULT_LOG_LEVEL}".`,
  );
  return DEFAULT_LOG_LEVEL;
}

/**
 * Valida/normaliza o `LOG_FORMAT` (R1.9).
 *
 * Entrada ausente ou fora do conjunto `json`|`text`|`message` resulta em
 * fallback silencioso para o formato estilizado `text`.
 *
 * @param raw Valor bruto lido de `LOG_FORMAT` (pode ser `undefined`).
 * @returns Um `LogFormat` válido.
 */
export function resolveLogFormat(raw: string | undefined): LogFormat {
  if (raw !== undefined && (LOG_FORMATS as readonly string[]).includes(raw)) {
    return raw as LogFormat;
  }

  return DEFAULT_LOG_FORMAT;
}

/**
 * Valida/normaliza o `OTEL_LOG_LEVEL` para o nível de diagnóstico do
 * OpenTelemetry (R9.2, R9.3).
 *
 * A comparação é case-insensitive; o valor retornado é normalizado em caixa
 * alta. Entrada ausente ou inválida resulta em fallback para `WARN`.
 *
 * @param raw Valor bruto lido de `OTEL_LOG_LEVEL` (pode ser `undefined`).
 * @returns Um nível de diagnóstico válido em caixa alta.
 */
export function resolveOtelLogLevel(raw: string | undefined): string {
  if (raw !== undefined) {
    const normalized = raw.trim().toUpperCase();
    if (OTEL_LOG_LEVELS.includes(normalized)) {
      return normalized;
    }
  }

  return DEFAULT_OTEL_LOG_LEVEL;
}

/**
 * Valida de forma ESTRITA o `Export_Target` de um sinal (R6.1, R6.4, R7.7).
 *
 * Aceita exclusivamente `alloy` ou `otlp`. Qualquer outro valor (incluindo
 * ausente) é rejeitado com um erro descritivo identificando o sinal e o valor
 * inválido, preservando o estado não inicializado do Exporter correspondente.
 *
 * @param raw Valor bruto lido da env de Export_Target do sinal.
 * @param signal Sinal de telemetria ao qual o Export_Target se aplica.
 * @returns Um `ExportTarget` válido.
 * @throws {Error} Quando o valor não pertence ao conjunto permitido.
 */
export function resolveExportTarget(
  raw: string | undefined,
  signal: 'metrics' | 'traces',
): ExportTarget {
  if (raw !== undefined && (EXPORT_TARGETS as readonly string[]).includes(raw)) {
    return raw as ExportTarget;
  }

  throw new Error(
    `[telemetry-utils] Export_Target invalido para o sinal "${signal}": ` +
      `${raw === undefined ? '(ausente)' : `"${raw}"`}. ` +
      `Valores permitidos: ${EXPORT_TARGETS.join(', ')}.`,
  );
}

// ---------------------------------------------------------------------------
// loadConfig (R7) — leitura completa do ambiente, aplicação de defaults e
// validação, produzindo uma TelemetryConfig consumível por Logger,
// Metrics_Provider, Tracer_Provider e pelo bootstrap do SDK.
// ---------------------------------------------------------------------------

/** APPLICATION_NAME padrão aplicado em ausência da env (R7.4). */
const DEFAULT_APPLICATION_NAME = 'unknown-service';

/** APP_STAGE padrão aplicado em ausência da env (R7.5). */
const DEFAULT_STAGE = 'unknown-stage';

/** SERVICE_NAMESPACE padrão sugerido pelo design (Data Models — R9.8). */
const DEFAULT_SERVICE_NAMESPACE = 'ecs';

/** LOKI_HOST padrão aplicado em ausência da env quando o transporte está ativo (R6.8). */
const DEFAULT_LOKI_HOST = 'http://loki.infra.svc.cluster.local:3100';

/** Base do coletor OTLP da infraestrutura usada para compor os endpoints por sinal (R7.3). */
const DEFAULT_OTLP_BASE = 'http://otel-collector.infra.svc.cluster.local:4318';

/**
 * Base do Grafana Alloy, usada para compor o host efetivo quando o
 * `Export_Target` selecionado para um sinal é `alloy` (R6.2). O Alloy recebe
 * OTLP HTTP nativamente; a seleção apenas direciona a URL do exportador.
 */
const DEFAULT_ALLOY_BASE = 'http://alloy.infra.svc.cluster.local:4318';

/** Endpoints OTLP padrão, independentes por sinal (R7.2, R7.3). */
const DEFAULT_OTLP_ENDPOINTS = {
  traces: `${DEFAULT_OTLP_BASE}/v1/traces`,
  logs: `${DEFAULT_OTLP_BASE}/v1/logs`,
  metrics: `${DEFAULT_OTLP_BASE}/v1/metrics`,
} as const;

/**
 * Endpoints padrão do Alloy, independentes por sinal, compostos a partir da
 * base do Alloy. Usados quando o `Export_Target` do sinal é `alloy` e a env
 * `OTEL_EXPORTER_ALLOY_{SIGNAL}_ENDPOINT` não está definida (R6.2).
 */
const DEFAULT_ALLOY_ENDPOINTS = {
  traces: `${DEFAULT_ALLOY_BASE}/v1/traces`,
  logs: `${DEFAULT_ALLOY_BASE}/v1/logs`,
  metrics: `${DEFAULT_ALLOY_BASE}/v1/metrics`,
} as const;

/** Export_Target padrão por sinal aplicado em ausência da env (R6.1). */
const DEFAULT_EXPORT_TARGET: ExportTarget = 'otlp';

/**
 * Aplica um default quando a variável está ausente, preservando o valor
 * fornecido quando presente (R7.1, R7.3, R7.4, R7.5).
 *
 * @param raw Valor bruto lido do ambiente (pode ser `undefined`).
 * @param fallback Valor padrão aplicado quando `raw` é `undefined`.
 * @returns O próprio `raw` quando presente, ou o `fallback` caso contrário.
 */
function withDefault(raw: string | undefined, fallback: string): string {
  return raw === undefined ? fallback : raw;
}

/**
 * Resolve o Export_Target de um sinal aplicando o default `otlp` quando a env
 * está AUSENTE, mas rejeitando (via validação estrita) quando um valor
 * não-vazio inválido está presente (R6.1, R6.4, R7.7).
 *
 * A distinção reflete a intenção do design: a ausência da configuração é
 * tolerada (default `otlp`), porém um valor explicitamente inválido é
 * fail-fast, preservando o estado não inicializado do Exporter correspondente.
 *
 * @param raw Valor bruto lido da env de Export_Target do sinal.
 * @param signal Sinal de telemetria ao qual o Export_Target se aplica.
 * @returns Um `ExportTarget` válido.
 * @throws {Error} Quando um valor não-vazio inválido está presente.
 */
function resolveExportTargetWithDefault(
  raw: string | undefined,
  signal: 'metrics' | 'traces',
): ExportTarget {
  if (raw === undefined || raw === '') {
    return DEFAULT_EXPORT_TARGET;
  }

  // Valor presente e não-vazio: validação estrita (rejeita inválido — R6.4/R7.7).
  return resolveExportTarget(raw, signal);
}

/**
 * Lê o ambiente, aplica os defaults da tabela de design e valida os parâmetros,
 * produzindo a `TelemetryConfig` consumida por todos os componentes (R7).
 *
 * Resolução por parâmetro:
 * - `APPLICATION_NAME` -> default `unknown-service` (R7.4).
 * - `APP_STAGE` -> default `unknown-stage` (R7.5).
 * - `SERVICE_NAMESPACE` -> default `ecs` (R9.8).
 * - `LOG_LEVEL` -> validação tolerante, default `info` (R1.7, R1.8).
 * - `LOG_FORMAT` -> validação tolerante, default `text` (R1.9).
 * - `LOKI_TRANSPORT` -> habilitado apenas quando igual a `true` (R6.6, R6.7).
 * - `LOKI_HOST` -> default `http://loki.infra.svc.cluster.local:3100` (R6.8).
 * - `KUBERNETES` -> ativa o SDK apenas quando igual a `true` (R9.4, R9.5).
 * - `OTEL_LOG_LEVEL` -> validação tolerante, default `WARN` (R9.2, R9.3).
 * - endpoints OTLP por sinal -> defaults independentes `.../v1/{traces,logs,metrics}` (R7.2, R7.3).
 * - `EXPORT_TARGET_{TRACES,METRICS}` -> default `otlp`; valor inválido rejeitado (R6.1, R6.4, R7.7).
 *
 * @param env Ambiente a inspecionar; usa `process.env` quando omitido.
 * @returns A configuração de telemetria resolvida e validada.
 * @throws {Error} Em config estrita inválida (Export_Target), preservando o
 *   estado não inicializado (R6.4, R7.7).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): TelemetryConfig {
  return {
    applicationName: withDefault(env.APPLICATION_NAME, DEFAULT_APPLICATION_NAME),
    stage: withDefault(env.APP_STAGE, DEFAULT_STAGE),
    serviceNamespace: withDefault(env.SERVICE_NAMESPACE, DEFAULT_SERVICE_NAMESPACE),
    logLevel: resolveLogLevel(env.LOG_LEVEL),
    logFormat: resolveLogFormat(env.LOG_FORMAT),
    lokiTransport: env.LOKI_TRANSPORT === 'true',
    lokiHost: withDefault(env.LOKI_HOST, DEFAULT_LOKI_HOST),
    kubernetes: env.KUBERNETES === 'true',
    otelLogLevel: resolveOtelLogLevel(env.OTEL_LOG_LEVEL),
    otlpEndpoints: {
      traces: withDefault(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, DEFAULT_OTLP_ENDPOINTS.traces),
      logs: withDefault(env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT, DEFAULT_OTLP_ENDPOINTS.logs),
      metrics: withDefault(env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT, DEFAULT_OTLP_ENDPOINTS.metrics),
    },
    exportTargets: {
      traces: resolveExportTargetWithDefault(env.EXPORT_TARGET_TRACES, 'traces'),
      metrics: resolveExportTargetWithDefault(env.EXPORT_TARGET_METRICS, 'metrics'),
    },
  };
}

// ---------------------------------------------------------------------------
// Resolução do host efetivo por Export_Target (R6.2, R6.3)
// ---------------------------------------------------------------------------

/** Sinal de telemetria exportável cujo host efetivo é selecionável por target. */
export type ExportableSignal = 'traces' | 'metrics';

/**
 * Mapa de endpoints por sinal associados a um destino de exportação.
 * Tanto o Alloy quanto o OTLP_Collector consomem OTLP HTTP; a diferença é
 * exclusivamente o Host/endpoint de destino (R6.2, R6.3).
 */
export interface EndpointMapBySignal {
  traces: string;
  metrics: string;
}

/**
 * Hosts/endpoints efetivos por destino (`alloy` | `otlp`), independentes por
 * sinal. Permite injetar overrides nos testes mantendo a resolução pura.
 */
export interface EffectiveEndpointsByTarget {
  alloy: EndpointMapBySignal;
  otlp: EndpointMapBySignal;
}

/**
 * Deriva, a partir da `TelemetryConfig`, o conjunto de endpoints efetivos por
 * destino e por sinal. Para `otlp`, usa os endpoints OTLP já resolvidos na
 * config; para `alloy`, lê `OTEL_EXPORTER_ALLOY_{SIGNAL}_ENDPOINT` do ambiente
 * com fallback para o host padrão do Alloy (R6.2, R6.3).
 *
 * @param config Configuração de telemetria resolvida.
 * @param env Ambiente a inspecionar; usa `process.env` quando omitido.
 * @returns Os endpoints efetivos por destino e por sinal.
 */
export function resolveEndpointsByTarget(
  config: TelemetryConfig,
  env: NodeJS.ProcessEnv = process.env,
): EffectiveEndpointsByTarget {
  return {
    otlp: {
      traces: config.otlpEndpoints.traces,
      metrics: config.otlpEndpoints.metrics,
    },
    alloy: {
      traces: withDefault(env.OTEL_EXPORTER_ALLOY_TRACES_ENDPOINT, DEFAULT_ALLOY_ENDPOINTS.traces),
      metrics: withDefault(
        env.OTEL_EXPORTER_ALLOY_METRICS_ENDPOINT,
        DEFAULT_ALLOY_ENDPOINTS.metrics,
      ),
    },
  };
}

/**
 * Resolve o Host/endpoint efetivo que o exportador OTLP HTTP de um sinal
 * utilizará, selecionando-o conforme o `Export_Target` configurado para esse
 * sinal (R6.2, R6.3).
 *
 * Como ambos os destinos consomem OTLP HTTP, a seleção apenas direciona a URL:
 * - `Export_Target === 'alloy'` -> endpoint associado ao Host do Alloy.
 * - `Export_Target === 'otlp'`  -> endpoint associado ao Host do OTLP_Collector.
 *
 * A função é pura: aceita, opcionalmente, um mapa de endpoints por destino
 * (`endpoints`) para facilitar a injeção nos testes; quando omitido, deriva-o
 * da `config`/ambiente via `resolveEndpointsByTarget`.
 *
 * @param config Configuração de telemetria resolvida (contém `exportTargets`).
 * @param signal Sinal exportável (`traces` | `metrics`).
 * @param endpoints Endpoints efetivos por destino; derivados da config quando omitido.
 * @returns O Host/endpoint efetivo correspondente ao destino selecionado.
 */
export function resolveEffectiveEndpoint(
  config: TelemetryConfig,
  signal: ExportableSignal,
  endpoints: EffectiveEndpointsByTarget = resolveEndpointsByTarget(config),
): string {
  const target = config.exportTargets[signal];
  return endpoints[target][signal];
}
