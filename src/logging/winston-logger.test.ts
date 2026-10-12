/**
 * Testes basicos do WinstonLogger (base copiada de @engebras/lib-logger).
 */
import { describe, expect, it } from 'vitest';
import { WinstonLogger, logColors } from './winston-logger';

describe('WinstonLogger.levels', () => {
  it('expõe as prioridades numéricas de crit:0 a verbose:7', () => {
    expect(WinstonLogger.levels).toEqual({
      crit: 0, alert: 1, http: 2, error: 3, warn: 4, info: 5, debug: 6, verbose: 7,
    });
  });
});

describe('WinstonLogger.colors', () => {
  it('mapeia cada nível para a cor da tabela de referência', () => {
    expect(WinstonLogger.colors).toEqual({
      crit: 'bold italic dim red',
      alert: 'bold cyan',
      http: 'bold blue',
      error: 'bold red',
      warn: 'yellow',
      info: 'green',
      debug: 'magenta',
      verbose: 'bold italic dim',
    });
  });
});

describe('WinstonLogger.parsePascalCase', () => {
  it('converte rótulos com separadores para PascalCase', () => {
    expect(WinstonLogger.parsePascalCase('order-service')).toBe('OrderService');
    expect(WinstonLogger.parsePascalCase('health_controller')).toBe('HealthController');
    expect(WinstonLogger.parsePascalCase('http server')).toBe('HttpServer');
  });

  it('retorna undefined para rótulo ausente', () => {
    expect(WinstonLogger.parsePascalCase(undefined)).toBeUndefined();
  });
});

describe('WinstonLogger.styled / logColors', () => {
  it('envolve a mensagem com o código ANSI da cor e o reset', () => {
    expect(WinstonLogger.styled('green', 'ok')).toBe(`${logColors.green}ok\x1b[0m`);
  });
});

describe('WinstonLogger.ucFirst', () => {
  it('capitaliza a primeira letra', () => {
    expect(WinstonLogger.ucFirst('teste')).toBe('Teste');
    expect(WinstonLogger.ucFirst('')).toBe('');
  });
});

describe('WinstonLogger.concatMessageWithDataString', () => {
  it('concatena a mensagem com valores primitivos dos dados', () => {
    const out = WinstonLogger.concatMessageWithDataString('msg', { a: 'x', b: 1, c: { ignore: true } });
    expect(out.startsWith('msg')).toBe(true);
    expect(out).toContain('x');
    expect(out).toContain('1');
  });
});
