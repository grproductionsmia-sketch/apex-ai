# Apex AI

Multi-tenant SaaS de 6 agentes de IA para líderes de venta directa hispanohablantes en EE.UU.
Una sola base de código e infraestructura sirve a todos los clientes; cada distribuidor es un
`workspace_id` aislado por Row Level Security.

> Estado: **Fase 1 — schema + RLS + invariantes.** Los agentes 0-5 y el dashboard llegan en fases posteriores.

## Arquitectura (resumen)

- **DB:** Postgres (Supabase) con RLS multi-tenant desde el primer schema + pgvector.
- **Cerebro de los agentes:** Claude API (`claude-sonnet-4-6`); el 2º pase de compliance usa el
  modelo más fuerte (`claude-opus-4-6`), configurable por ruleset.
- **Frontend:** Next.js + Tailwind + Recharts (fase Dashboard).
- **Backend:** servicio Node/TS (Fastify) para webhooks + orquestación; worker BullMQ para el scheduler del Agente 2.
- **Aislamiento:** el backend usa la *secret key* (service_role, omite RLS) y **siempre** filtra
  `workspace_id`; las sesiones de usuario (publishable key) quedan sujetas a RLS como segunda muralla.

Dos invariantes de negocio están forzados a nivel DB (triggers), no solo en código:
1. **Campañas de Meta Ads nunca se autoactivan** — solo pasan a `active` con `activated_by` + fila de auditoría.
2. **El contenido del Agente 3 no se publica** sin una fila `compliance_checks` con verdict `approved`.

## Estructura

```
apex-ai/
├─ supabase/migrations/     # 0001..0005: extensiones, tenancy, tablas, RLS, invariantes
├─ packages/
│  ├─ db/                   # apply script + tests de integración RLS/invariantes
│  └─ shared/               # mapa tier -> features (assertFeature)
├─ .env.example
├─ README.md
└─ RUNBOOK.md
```

## Arranque local (< 15 min)

Requisitos: Node >= 20, `pnpm` (`npm i -g pnpm`).

1. **Clonar e instalar**
   ```bash
   git clone https://github.com/grproductionsmia-sketch/apex-ai.git
   cd apex-ai
   pnpm install
   ```

2. **Configurar entorno**
   ```bash
   cp .env.example .env
   ```
   Rellena en `.env`:
   - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (Supabase > Settings > API).
   - `SUPABASE_DB_URL` (Supabase > Settings > Database > Connection string > URI). **Requerido para migraciones.**

3. **Aplicar el schema**
   ```bash
   pnpm db:apply
   ```
   Idempotente: registra cada migración en `schema_migrations` y salta las ya aplicadas.

4. **Correr los tests de integración reales** (cruce entre 2 workspaces + invariantes)
   ```bash
   pnpm db:test
   ```
   Provisiona 2 workspaces y 2 usuarios de prueba, verifica cero fuga de datos, y limpia al final.

## Notas de seguridad

- `.env` está en `.gitignore` y **nunca** se commitea. Solo `.env.example` (placeholders) va al repo.
- La *secret key* de Supabase equivale a service_role: solo en backend, nunca en el cliente.
- Credenciales de integración por workspace (Meta/WhatsApp) van en **Supabase Vault**, no en columnas planas.
