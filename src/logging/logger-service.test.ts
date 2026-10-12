/**
 * Testes basicos do LoggerService (base de @engebras/lib-logger):
 * - instanciacao e propriedades;
 * - selecao de transports (Console sempre; OpenTelemetry sempre; Loki condicional);
 * - metodos por nivel e withTrace (sucesso/erro).
 */
import LokiTransport from 'winston-loki';
import { OpenTelemetryTransportV3 } from '@opentelemetry/winston-transport';
import * as winston from 'winston';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LoggerService } from './logger-service';

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('LoggerService — instanciação e propriedades', () => {
  it('usa defaults quando env ausente e expõe context/level/stage/service', () => {
    delete process.env.LOG_LEVEL;
    delete process.env.APP_STAGE;
    delete process.env.APPLICATION_NAME;
    const logger = new LoggerService('MyContext');
    expect(logger.logLevel).toBe('info');
    expect(logger.service).toBe('unknown-service');
    // métodos por nível existem
    expect(typeof (logger as any).info).toBe('function');
    expect(typeof (logger as any).crit).toBe('function');
  });

  it('respeita os valores explícitos passados ao construtor', () => {
    const logger = new LoggerService('Ctx', 'debug', 'prod', 'orders');
    expect(logger.logLevel).toBe('debug');
    expect(logger.stage).toBe('prod');
    expect(logger.service).toBe('orders');
  });
});

describe('LoggerService — transports', () => {
  function kinds(logger: LoggerService): string[] {
    return (logger as unknown as winston.Logger).transports.map((t) => t.constructor.name);
  }

  it('inclui Console e OpenTelemetryTransportV3; NÃO inclui Loki quando LOKI_TRANSPORT!=true', () => {
    process.env.LOKI_TRANSPORT = 'false';
    const logger = new LoggerService('Ctx');
    const transports = (logger as unknown as winston.Logger).transports;
    expect(transports.some((t) => t instanceof OpenTelemetryTransportV3)).toBe(true);
    expect(transports.some((t) => t instanceof winston.transports.Console)).toBe(true);
    expect(transports.some((t) => t instanceof LokiTransport)).toBe(false);
  });

  it('inclui LokiTransport quando LOKI_TRANSPORT=true', () => {
    process.env.LOKI_TRANSPORT = 'true';
    process.env.LOKI_HOST = 'http://localhost:3100';
    const logger = new LoggerService('Ctx');
    const transports = (logger as unknown as winston.Logger).transports;
    const loki = transports.find((t) => t instanceof LokiTransport) as LokiTransport | undefined;
    expect(loki).toBeDefined();
    logger.close();
  });

  it('seleciona console estilizado para LOG_FORMAT=text e json caso contrário (não lança)', () => {
    process.env.LOG_FORMAT = 'text';
    expect(() => new LoggerService('Ctx')).not.toThrow();
    process.env.LOG_FORMAT = 'json';
    expect(() => new LoggerService('Ctx')).not.toThrow();
  });
});

describe('LoggerService.withTrace', () => {
  it('retorna o valor resolvido em caso de sucesso', async () => {
    const logger = new LoggerService('Ctx', 'info', 'test', 'svc');
    const result = await logger.withTrace('op-ok', async () => 42);
    expect(result).toBe(42);
  });

  it('repropaga a exceção em caso de erro', async () => {
    const logger = new LoggerService('Ctx', 'info', 'test', 'svc');
    const boom = new Error('boom');
    await expect(logger.withTrace('op-fail', async () => { throw boom; })).rejects.toBe(boom);
  });
});
