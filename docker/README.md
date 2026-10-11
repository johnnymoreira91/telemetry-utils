# Stack de observabilidade (Docker)

Stack local para receber e visualizar a telemetria emitida por serviços que usam
`@flexicorp/telemetry-utils`: **Alloy** (ingestão OTLP), **Tempo** (traces),
**Mimir** (métricas), **Loki** (logs) e **Grafana** (visualização).

## Subir

```bash
cd docker
docker compose up -d
```

Para acompanhar os logs: `docker compose logs -f mimir` (ou qualquer serviço).
Para derrubar: `docker compose down` (adicione `-v` para apagar os volumes/dados).

> O Mimir leva ~30-60s para ficar `ready` após subir (warm-up dos anéis). As
> escritas são aceitas durante esse período; a leitura PromQL estabiliza logo.

## Fluxo

```
App --(OTLP HTTP :4318 / gRPC :4317)--> Alloy ---> Tempo   (traces)
                                              ---> Mimir   (metrics, remote_write)
                                              ---> Loki    (logs)
Grafana consulta Tempo, Mimir e Loki.
Tempo tambem gera metricas RED (span-metrics/service-graphs) e envia ao Mimir.
```

## Rede e IPs fixos

Bridge dedicada `observability` com subnet `10.0.50.0/24` (gateway `10.0.50.1`).
Cada serviço tem IP fixo, útil para debug e para acessar a partir do host quando
o publish em `localhost` apresenta problemas (ver seção Troubleshooting).

| Serviço | IP fixo | Porta(s) host | Uso |
| --- | --- | --- | --- |
| Alloy | `10.0.50.10` | `4317` / `4318` / `12345` | OTLP gRPC / OTLP HTTP / UI |
| Tempo | `10.0.50.11` | `3200` | API de query |
| Loki | `10.0.50.12` | `3100` | push + query |
| Mimir | `10.0.50.13` | `9009` | remote_write + PromQL |
| Grafana | `10.0.50.14` | `3001` | UI (admin/admin, anônimo habilitado) |

Alloy OTLP HTTP expõe `/v1/traces`, `/v1/metrics` e `/v1/logs`.
Mimir recebe em `/api/v1/push` e serve PromQL sob o prefixo `/prometheus`
(ex.: `http://localhost:9009/prometheus/api/v1/query`).

> O Grafana usa **3001** no host para não colidir com a POC Express (3000).

## Acesso

- Grafana: `http://localhost:3001` ou `http://10.0.50.14:3000`
- Alloy UI: `http://localhost:12345` ou `http://10.0.50.10:12345`
- Mimir: `http://localhost:9009` ou `http://10.0.50.13:9009`

No Grafana, os datasources (Mimir, Tempo, Loki) já vêm provisionados, incluindo
correlações traces↔logs↔métricas. O app **Drilldown** (Logs/Metrics/Traces) já
vem embarcado no Grafana 11.3.

## Apontar a aplicação para esta stack

No `.env` do serviço (ex.: `poc-express-telemetry`), com a stack rodando nesta
máquina:

```env
KUBERNETES=true
EXPORT_TARGET_TRACES=otlp
EXPORT_TARGET_METRICS=otlp
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://localhost:4318/v1/metrics
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://localhost:4318/v1/logs
LOKI_TRANSPORT=false
```

Se `localhost` não funcionar na sua máquina (Docker 28+), use o IP fixo do
Alloy: `http://10.0.50.10:4318/v1/...`.

Os três sinais são aceitos via OTLP no Alloy (não é necessário o transporte Loki
nativo; os logs chegam ao Loki através do Alloy).

## Validar a ingestão

```bash
# traces
curl -i -X POST http://localhost:4318/v1/traces \
  -H 'content-type: application/json' \
  -d '{"resourceSpans":[{"scopeSpans":[{"spans":[{"traceId":"5b8aa5a2d2c872e8321cf37308d69df2","spanId":"051581bf3cb55c13","name":"probe","kind":1,"startTimeUnixNano":"1700000000000000000","endTimeUnixNano":"1700000000000000001"}]}]}]}'
# -> HTTP 200 {"partialSuccess":{}}  (idem para /v1/metrics e /v1/logs)

# consultar a metrica no Mimir (PromQL)
curl -s "http://localhost:9009/prometheus/api/v1/query?query=up" | head -c 200
```

## Object storage do Mimir

Nesta stack o Mimir usa `backend: filesystem` (blocos em disco local, no volume
`mimir-data`). É simples e sem dependências externas, ideal para dev/POC.

Para produção, troque `config/mimir/mimir.yaml` para `backend: s3` apontando ao
seu object storage (S3/MinIO/GCS), criando o bucket de blocos correspondente.

## Troubleshooting

- **`localhost:3001` conecta mas não responde (pendura):** conhecido no Docker
  Engine 28+ com `userland-proxy` desabilitado. Acesse pelo IP fixo
  (`http://10.0.50.14:3000`), ou reative o proxy criando
  `/etc/docker/daemon.json` com `{"userland-proxy": true}` e reiniciando o Docker.
- **Mimir `/ready` retorna 503 logo após subir:** é o warm-up normal; aguarde
  ~30-60s.
- **Tempo/Loki `/ready` 503 logo após subir:** idem, warm-up inicial.

## Notas

- Volumes nomeados (`*-data`) persistem traces/logs/métricas entre reinícios.
  Use `docker compose down -v` para zerar.
- Mimir roda em modo monolítico (`-target=all`) com `multitenancy_enabled:false`
  (tenant anônimo, sem header `X-Scope-OrgID`).
- Versões fixadas nas imagens para builds reprodutíveis.
