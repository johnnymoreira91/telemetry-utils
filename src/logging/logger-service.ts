/**
 * LoggerService (`src/logging/logger-service.ts`) — R1, R3, R6.
 *
 * Estende {@link WinstonLogger} (níveis/cores/formatação de referência) e monta
 * o logger concreto consumido pela aplicação: resolve o `logLevel` via Config
 * Loader (R1.7), compõe o formato combinado (tracing + contexto de Namespace +
 * timestamp + json) garantindo os campos obrigatórios do registro (R1.3),
 * seleciona o transporte de console (estilizado ou JSON — R1.4/R1.5) conforme
 * `LOG_FORMAT`, anexa o transporte OpenTelemetry (R3) e, condicionalmente, o
 * transporte Loki (R6.6/R6.7/R6.8), e instala um listener de erro resiliente
 * que não derruba o processo (R1.10).
 *
 * O método `withTrace` (R3.3/R3.4) cria um Span ativo nomeado, executa a função
 * em seu contexto e aplica a semântica de sucesso/erro descrita no design.
 */

import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { OpenTelemetryTransportV3 } from '@opentelemetry/winston-transport';
import * as winston from 'winston';
import LokiTransport from 'winston-loki';

import { loadConfig } from '../config/env';
import type { LogFormat, LogLevel } from '../types';
import { WinstonLogger } from './winston-logger';

/** Host padrão do Loki aplicado quando `LOKI_HOST` está ausente (R6.8). */
const DEFAULT_LOKI_HOST = 'http://loki.infra.svc.cluster.local:3100';

/**
 * Formato winston que injeta o `traceId`/`spanId` do Span ativo no registro
 * (R3.1/R3.2). Quando há um Span ativo com `spanContext` válido, adiciona os
 * identificadores de tracing ao `info`; na ausência de Span ativo, o registro
 * segue sem esses campos.
 */
const otelFormat: winston.Logform.FormatWrap = winston.format((info) => {
  const span = trace.getActiveSpan();
  if (span !== undefined) {
    const spanContext = span.spanContext();
    if (spanContext !== undefined && spanContext !== null) {
      info.traceId = spanContext.traceId;
      info.spanId = spanContext.spanId;
    }
  }
  return info;
});

/**
 * LoggerService — logger concreto da biblioteca, montado sobre o
 * {@link WinstonLogger}.
 */
export class LoggerService extends WinstonLogger {
  /** Nível de log efetivo do logger (resolvido via Config Loader quando omitido). */
  readonly logLevel: LogLevel;

  /** Estágio da aplicação usado no prefixo `[stage-service]` do console estilizado. */
  readonly stage: string;

  /** Nome do serviço aplicado como `defaultMeta.service` e emitido em cada registro. */
  readonly service: string;

  /**
   * @param context Rótulo de contexto do logger (ex.: nome do controller/módulo),
   *   emitido como `context` em cada registro e exibido em PascalCase no console
   *   estilizado.
   * @param logLevel Nível de log; quando omitido, usa o default resolvido pelo
   *   Config Loader a partir de `LOG_LEVEL` (R1.7, R1.8).
   * @param stage Estágio da aplicação; quando omitido, usa o `stage` resolvido
   *   pelo Config Loader a partir de `APP_STAGE` (R7.5).
   * @param service Nome do serviço; quando omitido, usa o `applicationName`
   *   resolvido pelo Config Loader a partir de `APPLICATION_NAME` (R7.4).
   */
  constructor(context: string, logLevel?: LogLevel, stage?: string, service?: string) {
    const config = loadConfig();

    const effectiveLogLevel: LogLevel = logLevel ?? config.logLevel;
    const effectiveStage = stage ?? config.stage;
    const effectiveService = service ?? config.applicationName;
    const logFormat: LogFormat = config.logFormat;

    // Formato combinado comum a todos os transportes estruturados (R1.3/R2.4/R3.1):
    // tracing (traceId/spanId) + contexto do Namespace (correlationId/keyId) +
    // timestamp + json. O `timestamp`, `level`, `service` e `message` ficam
    // sempre presentes no registro resultante (R1.3).
    const combinedFormat = winston.format.combine(
      otelFormat(),
      WinstonLogger.formatContext(),
      winston.format.timestamp(),
      winston.format.json(),
    );

    // Seleção do transporte de console (R1.4/R1.5): estilizado para
    // `text`/`message`, JSON caso contrário.
    const consoleFormat =
      logFormat === 'text' || logFormat === 'message'
        ? winston.format.combine(
            otelFormat(),
            WinstonLogger.formatContext(),
            winston.format.timestamp(),
            WinstonLogger.formatPrint(effectiveStage),
          )
        : combinedFormat;

    const transports: winston.transport[] = [
      new winston.transports.Console({ format: consoleFormat }),
      // Transporte OpenTelemetry no nível corrente (R3 / design "LoggerService").
      new OpenTelemetryTransportV3({ level: effectiveLogLevel }),
    ];

    // Transporte Loki adicionado apenas quando habilitado (R6.6/R6.7), com host
    // de `LOKI_HOST` ou o default (R6.8).
    if (config.lokiTransport) {
      transports.push(
        new LokiTransport({
          host: config.lokiHost || DEFAULT_LOKI_HOST,
          level: effectiveLogLevel,
          labels: { service: effectiveService, stage: effectiveStage },
          json: true,
        }),
      );
    }

    super({
      level: effectiveLogLevel,
      levels: WinstonLogger.levels,
      format: combinedFormat,
      defaultMeta: { service: effectiveService, context },
      transports,
    });

    this.logLevel = effectiveLogLevel;
    this.stage = effectiveStage;
    this.service = effectiveService;

    // Resiliência de transporte (R1.10): um erro em qualquer transporte é
    // registrado no console de erro sem derrubar o processo nem interromper a
    // emissão dos demais registros.
    this.on('error', (error: Error) => {
      console.error('[telemetry-utils] erro em transporte de log:', error);
    });
  }

  /**
   * Executa `fn` dentro de um Span ativo nomeado (R3.3/R3.4).
   *
   * Cria um Span ativo com o nome informado via `startActiveSpan`, de modo que
   * o Span fique disponível em `trace.getActiveSpan()` durante a execução de
   * `fn` (permitindo a correlação de logs — R3.1/R3.2). Ao concluir sem
   * exceção, encerra o Span e retorna ao chamador o valor resolvido (R3.3). Se
   * `fn` lança/rejeita, registra a exceção no Span (`recordException`), define o
   * status do Span como erro (`SpanStatusCode.ERROR`), encerra o Span e
   * repropaga a mesma exceção (R3.4).
   *
   * @typeParam T Tipo do valor resolvido pela função.
   * @param name Nome da operação atribuído ao Span ativo.
   * @param fn Função assíncrona executada no contexto do Span; recebe o Span
   *   criado como argumento.
   * @returns O valor resolvido por `fn` em caso de sucesso.
   */
  async withTrace<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
    const tracer = trace.getTracer(this.service);
    return tracer.startActiveSpan(name, async (span: Span) => {
      try {
        const result = await fn(span);
        span.end();
        return result;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
        throw error;
      }
    });
  }
}

/**
 * Assinatura dos métodos auxiliares por nível anexados ao `LoggerService`
 * (ex.: `logger.info(...)`, `logger.crit(...)`). O winston os cria dinamicamente
 * em um protótipo derivado por `createLogger`; como aqui estendemos
 * `winston.Logger` diretamente, anexamos os mesmos atalhos ao protótipo a partir
 * dos níveis customizados (R1.1).
 */
export interface LoggerService extends Record<LogLevel, winston.LeveledLogMethod> {}

// Anexa os atalhos por nível ao protótipo do LoggerService, reproduzindo o
// comportamento de `winston.createLogger` (que define esses métodos em um
// protótipo derivado). Sem isso, `logger.info(...)`, `logger.crit(...)`, etc.
// não existiriam, pois `winston.Logger` não define métodos de nível por si só.
for (const level of Object.keys(WinstonLogger.levels)) {
  if (level === 'log') {
    continue;
  }
  (LoggerService.prototype as unknown as Record<string, unknown>)[level] = function (
    this: LoggerService,
    ...args: unknown[]
  ) {
    return (this.log as (...a: unknown[]) => unknown)(level, ...args);
  };
}
