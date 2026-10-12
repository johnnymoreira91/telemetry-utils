import * as winston from 'winston';
import LokiTransport from 'winston-loki';
import { trace, context as otelContext, type Span } from '@opentelemetry/api';
import { WinstonLogger } from './winston-logger';
import { OpenTelemetryTransportV3 } from '@opentelemetry/winston-transport';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      LOG_LEVEL: 'verbose' | 'debug' | 'info' | 'warn' | 'error';
      LOG_FORMAT: 'json' | 'text' | 'message';
      APPLICATION_NAME: string;
      APP_STAGE: string;
      LOKI_TRANSPORT: string;
      LOKI_HOST: string;
    }
  }
}

export class LoggerService extends WinstonLogger {
  private currentLevel: string;
  private readonly context: string;
  readonly logLevel: string;
  readonly stage: string;
  readonly service: string;

  constructor(
    context: string,
    logLevel = process.env.LOG_LEVEL,
    stage = process.env.APP_STAGE,
    service = process.env.APPLICATION_NAME
  ) {
    // 1. Definimos o formato do OpenTelemetry antes do super (sem usar 'this')
    const otelFormat = winston.format((info) => {
      const span = trace.getSpan(otelContext.active());
      if (span) {
        const { traceId, spanId } = span.spanContext();
        info.traceId = traceId;
        info.spanId = spanId;
      }
      return info;
    });

    // 2. Chamada obrigatória do super()
    super({
      levels: WinstonLogger.levels,
      format: winston.format.combine(
        otelFormat(),
        winston.format.timestamp(),
        winston.format.json()
      ),
      defaultMeta: { service }
    });

    // ----

    // 3. Agora o 'this' está disponível. Inicializamos as propriedades.
    this.context = context;
    this.logLevel = logLevel || 'info';
    this.stage = stage || '';
    this.service = service || 'unknown-service';
    this.currentLevel = this.logLevel;

    this.add(new OpenTelemetryTransportV3({
      level: this.currentLevel,
    }));

    // 4. Injetar Trace atual no defaultMeta (se existir um rastro ativo agora)
    const currentSpan = trace.getSpan(otelContext.active());
    if (currentSpan) {
      const { traceId, spanId } = currentSpan.spanContext();
      this.defaultMeta = { ...this.defaultMeta, traceId, spanId };
    }

    // 5. Configuração dos Transportes (Console)
    if (['message', 'text'].includes(process.env.LOG_FORMAT)) {
      this.add(
        new winston.transports.Console({
          level: this.currentLevel,
          format: winston.format.combine(
            winston.format.timestamp({ format: 'DD/MM/YYYY HH:mm:ss' }),
            WinstonLogger.formatContext({
              ctx: this.context,
              pad: 7
            }),
            winston.format.metadata({
              fillExcept: ['message', 'level', 'timestamp', 'service', 'context', 'correlationId', 'keyId', 'meta', 'traceId', 'spanId'],
              key: 'data'
            }),
            winston.format.colorize({ all: true }),
            winston.format.label({
              label: WinstonLogger.parsePascalCase('\x1b[33m' + this.context + '\x1b[0m'),
              message: true
            }),
            WinstonLogger.formatPrint(this.stage)
          )
        })
      );
    } else {
      this.add(
        new winston.transports.Console({
          level: this.currentLevel,
          format: winston.format.combine(
            WinstonLogger.formatContext({
              ctx: this.context,
              pad: 0
            }),
            winston.format.metadata({
              fillExcept: ['message', 'level', 'timestamp', 'service', 'context', 'correlationId', 'keyId', 'meta', 'traceId', 'spanId'],
              key: 'data'
            }),
            winston.format.label({
              label: WinstonLogger.parsePascalCase(this.context),
              message: true
            }),
            winston.format.json()
          )
        })
      );
    }

    // 6. Configuração do Loki
    if (process.env.LOKI_TRANSPORT === 'true') {
      this.add(
        new LokiTransport({
          host: process.env.LOKI_HOST || 'http://loki.infra.svc.cluster.local:3100',
          level: this.currentLevel,
          labels: {
            service: this.service,
            stage: this.stage,
            context: this.context
          },
          json: true,
          batching: true,
          interval: 5,
          format: winston.format.combine(otelFormat(), winston.format.json()) || this.getLokiFormat()
        })
      );
    }

    // Listener de erro para evitar crash do processo
    this.on('error', (error) => {
      console.error(`[logger-error-${this.context}]`, error.message);
    });
  }

  /**
   * Executa uma função dentro de um Span do OpenTelemetry, gerando telemetria automática.
   */
  async withTrace<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
    const tracer = trace.getTracer(this.service || 'default-service');

    return tracer.startActiveSpan(name, async (span) => {
      try {
        this.info(`Iniciando trace: ${name}`);
        const result = await fn(span);
        span.setStatus({ code: 0 }); // OK
        return result;
      } catch (error: any) {
        span.recordException(error);
        span.setStatus({ code: 1, message: error.message }); // Error
        this.error(`Erro no trace ${name}`, { error: error.message, stack: error.stack });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  private getLokiFormat() {
    return winston.format.combine(
      WinstonLogger.formatContext({ ctx: this.context, pad: 0 }),
      winston.format.metadata({ key: 'data' }),
      winston.format.json()
    );
  }
}
