# Apex AI — RUNBOOK

Procedimientos ante fallos críticos. Mantener actualizado por fase.

---

## 1. Una campaña de Meta Ads se activó por error

**Recordatorio de diseño:** no debería poder pasar. Las campañas se crean `paused` y el trigger
`enforce_campaign_activation` (migración 0005) bloquea cualquier transición a `active` sin
`activated_by` + fila en `campaign_activation_audit`. Aun así:

1. **Pausar de inmediato** en Meta Ads Manager (o vía API `POST /{campaign-id}` con `status=PAUSED`).
2. Marcar en DB:
   ```sql
   update ad_campaigns set status = 'paused' where id = '<campaign_id>';
   insert into campaign_activation_audit (workspace_id, campaign_id, action, actor_user_id, note)
   values ('<ws>', '<campaign_id>', 'paused', '<actor>', 'emergency pause - incident');
   ```
3. Revisar `campaign_activation_audit` de esa campaña: **¿quién** puso `activated`, con qué `ip`/`user_agent`.
   Si no hay fila `activated` y aun así estaba activa en Meta → la activación vino de fuera del sistema
   (alguien en Meta Ads Manager directo). Rotar el token de la integración del workspace.
4. Confirmar que ningún código nuevo hace `status: 'active'` fuera del endpoint de activación con auditoría:
   ```bash
   grep -rn "status.*active" --include=*.ts apps packages | grep -i campaign
   ```

## 2. El filtro de compliance (Agente 3) falla o deja pasar contenido

**Recordatorio de diseño:** `content_pieces.status` no puede llegar a `approved`/`published` sin una
fila `compliance_checks` con `verdict='approved'` (trigger `enforce_compliance_gate`, migración 0005).
Los usuarios no pueden escribir `compliance_checks` (RLS): solo el backend (service_role).

- **Síntoma: contenido publicado que no debía.**
  1. Despublicar:
     ```sql
     update content_pieces set status = 'draft' where id = '<piece_id>';
     ```
  2. Auditar cómo pasó:
     ```sql
     select * from compliance_checks where content_piece_id = '<piece_id>' order by created_at;
     ```
     Si hay un `verdict='approved'` indebido → revisar el system prompt del 2º pase y el `ruleset_id` usado.
  3. Si el ruleset heredado estaba mal: revisar `compliance_rulesets` (owner_type/owner_id, `parent_ruleset_id`).

- **Síntoma: el 2º pase (Claude) devuelve error / timeout.**
  - El contenido debe quedar en `pending_compliance`, **nunca** avanzar por defecto. Verificar que el
    código trata el error como "rechazado/pendiente", no como "aprobado".
  - Reintentar el pase; si persiste, dejar en `pending_compliance` y alertar al líder.

- **Interruptor de emergencia (parar toda publicación de un workspace):**
  ```sql
  update content_pieces set status = 'draft'
  where workspace_id = '<ws>' and status in ('approved','published');
  ```

## 3. Sospecha de fuga de datos entre workspaces (RLS)

1. Reproducir con el suite real:
   ```bash
   pnpm db:test
   ```
   Si algún test de `RLS multi-tenant isolation` falla → hay fuga. **Tratar como incidente de seguridad.**
2. Verificar que RLS sigue activo en todas las tablas:
   ```sql
   select relname, relrowsecurity from pg_class
   where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity = false;
   ```
   (No debe listar ninguna tabla de negocio.)
3. Revisar queries del backend que usen la *secret key*: **todas** deben filtrar `workspace_id`.
   Una query con service_role sin filtro de workspace es la causa más probable.

## 4. Rotación de credenciales

- **Supabase secret key comprometida:** Settings > API > roll `secret`; actualizar `.env` y los secrets
  de despliegue (Railway/Vercel). Redeploy.
- **Token de integración de un workspace (Meta/WhatsApp):** rotar en Meta, actualizar el secreto en
  Supabase Vault referenciado por `workspace_integrations.vault_secret_id`.

---

### Contactos / paneles (rellenar)

- Supabase project: `vhghwaoakosiyabhuwak`
- Meta Business Manager: _pendiente (verificación de negocio en curso)_
