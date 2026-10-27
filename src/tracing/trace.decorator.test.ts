import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpanStatusCode } from '@opentelemetry/api';
import { TraceClass, Trace, log } from './trace.decorator';

const mockEnd = vi.fn();
const mockSetAttributes = vi.fn();
const mockSetStatus = vi.fn();
const mockRecordException = vi.fn();

const mockSpan = {
  end: mockEnd,
  setAttributes: mockSetAttributes,
  setStatus: mockSetStatus,
  recordException: mockRecordException,
};

const mockStartActiveSpan = vi.fn(
  (
    _name: string,
    callbackOrOptions: unknown,
    maybeCallback?: unknown,
  ) => {
    const callback = (typeof callbackOrOptions === 'function'
      ? callbackOrOptions
      : maybeCallback) as (span: typeof mockSpan) => unknown;
    return callback(mockSpan);
  },
);

vi.mock('@opentelemetry/api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@opentelemetry/api');
  return {
    ...actual,
    trace: {
      getTracer: () => ({
        startActiveSpan: mockStartActiveSpan,
      }),
    },
  };
});

describe('@TraceClass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('instrumenta todos os métodos da classe com o prefixo informado (ex: LOGIC)', () => {
    @TraceClass('LOGIC')
    class HealthMapLogic {
      getHealthMap() {
        return 'map';
      }

      formatData() {
        return 'formatted';
      }
    }

    const instance = new HealthMapLogic();
    expect(instance.getHealthMap()).toBe('map');
    expect(instance.formatData()).toBe('formatted');

    expect(mockStartActiveSpan).toHaveBeenCalledWith(
      '[LOGIC] - HealthMapLogic.getHealthMap',
      expect.any(Function),
    );
    expect(mockStartActiveSpan).toHaveBeenCalledWith(
      '[LOGIC] - HealthMapLogic.formatData',
      expect.any(Function),
    );
    expect(mockSetStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
    expect(mockEnd).toHaveBeenCalledTimes(2);
  });

  it('detecta prefixo automaticamente pelo sufixo do nome da classe (Logic -> [LOGIC])', () => {
    @TraceClass()
    class CustomerLogic {
      find() {
        return 123;
      }
    }

    new CustomerLogic().find();

    expect(mockStartActiveSpan).toHaveBeenCalledWith(
      '[LOGIC] - CustomerLogic.find',
      expect.any(Function),
    );
  });

  it('detecta prefixo automaticamente para Service (Service -> [SERVICE])', () => {
    @TraceClass()
    class PaymentService {
      pay() {
        return true;
      }
    }

    new PaymentService().pay();

    expect(mockStartActiveSpan).toHaveBeenCalledWith(
      '[SERVICE] - PaymentService.pay',
      expect.any(Function),
    );
  });

  it('detecta prefixo automaticamente para Controller (Controller -> [CONTROLLER])', () => {
    @TraceClass()
    class OrderController {
      handle() {
        return { ok: true };
      }
    }

    new OrderController().handle();

    expect(mockStartActiveSpan).toHaveBeenCalledWith(
      '[CONTROLLER] - OrderController.handle',
      expect.any(Function),
    );
  });

  it('ignora métodos especificados na lista ignore', () => {
    @TraceClass({ prefix: 'SERVICE', ignore: ['internalHelper'] })
    class AuthService {
      login() {
        return 'token';
      }

      internalHelper() {
        return 'secret';
      }
    }

    const svc = new AuthService();
    svc.login();
    svc.internalHelper();

    expect(mockStartActiveSpan).toHaveBeenCalledTimes(1);
    expect(mockStartActiveSpan).toHaveBeenCalledWith(
      '[SERVICE] - AuthService.login',
      expect.any(Function),
    );
  });

  it('instrumenta métodos assíncronos (async/Promise) capturando sucesso e erro', async () => {
    const error = new Error('Falha no banco');

    @TraceClass('LOGIC')
    class AsyncLogic {
      async load() {
        return 'loaded';
      }

      async fail() {
        throw error;
      }
    }

    const logic = new AsyncLogic();

    const loaded = await logic.load();
    expect(loaded).toBe('loaded');
    expect(mockSetStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });

    await expect(logic.fail()).rejects.toThrow('Falha no banco');
    expect(mockSetStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR });
    expect(mockRecordException).toHaveBeenCalledWith(error);
  });
});

describe('@Trace / @log (decorator de método)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('instrumenta método individualmente', () => {
    class CustomService {
      @Trace({ name: '[CUSTOM] - CustomService.execute' })
      execute() {
        return 42;
      }

      @log()
      other() {
        return 'done';
      }
    }

    const svc = new CustomService();
    expect(svc.execute()).toBe(42);
    expect(svc.other()).toBe('done');

    expect(mockStartActiveSpan).toHaveBeenCalledWith(
      '[CUSTOM] - CustomService.execute',
      expect.any(Object),
      expect.any(Function),
    );
    expect(mockStartActiveSpan).toHaveBeenCalledWith(
      'CustomService.other',
      expect.any(Object),
      expect.any(Function),
    );
  });
});
