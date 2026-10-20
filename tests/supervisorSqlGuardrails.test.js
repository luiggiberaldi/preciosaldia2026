import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase_supervisor_auth_recovery.sql', 'utf8');
const commandSql = readFileSync('supabase_supervisor_commands.sql', 'utf8');
const inventoryBatchSql = readFileSync('supabase_supervisor_inventory_batch.sql', 'utf8');
const productionEgressSql = readFileSync('supabase_supervisor_inventory_egress_production.sql', 'utf8');
const productCommandsSql = readFileSync('supabase/migrations/20261015_supervisor_product_commands_production.sql', 'utf8');
const unpairCompatibilitySql = readFileSync('supabase/migrations/20261015_supervisor_unpair_owner_compatibility.sql', 'utf8');
const backupLicenseSql = readFileSync('supabase/migrations/20261015_backup_permanent_license_rls.sql', 'utf8');
const inventoryBatchV2Migration = readFileSync('supabase/migrations/20261016_supervisor_inventory_batch_v2.sql', 'utf8');
const commandStateMachineMigration = readFileSync('supabase/migrations/20261016110000_supervisor_command_state_machine.sql', 'utf8');
const commandReceiver = readFileSync('src/hooks/useRemoteCommands.js', 'utf8');

describe('Supervisor SQL guardrails', () => {
    it('no concede acceso directo a anon sobre datos del Supervisor', () => {
        expect(sql).not.toMatch(/GRANT\s+[^;]*\bTO\s+anon\b/i);
        expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.device_pairings\s+FROM\s+anon/i);
        expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.sync_documents\s+FROM\s+anon/i);
    });

    it('mantiene identidad Auth, consumo único y search_path en las RPC', () => {
        expect(sql).toContain('owner_auth_id uuid');
        expect(sql).toContain('monitor_auth_id uuid');
        expect(sql).toContain('token_used_at timestamptz');
        expect(sql).toContain('token_hash text');
        expect((sql.match(/SET search_path = public, extensions/g) || []).length).toBe(3);
        expect(sql).toContain('token_used_at IS NULL');
        expect(sql).toContain('ON CONFLICT (primary_device_id) DO UPDATE');
        expect(sql).toMatch(/WHERE \(primary_device_id = trim\(p_device_id\)\s+OR monitor_device_id = trim\(p_device_id\)\)\s+AND \(owner_auth_id = v_actor OR monitor_auth_id = v_actor\)\s+AND revoked_at IS NULL;/);
        expect(sql).not.toMatch(/CREATE POLICY\s+"sync_documents_anon_access"/i);
    });

    it('no reintroduce Broadcast público y exige RPC/RLS para comandos', () => {
        expect(commandReceiver).not.toContain('system_commands');
        expect(commandReceiver).not.toContain("channel.send");
        expect(commandSql).toContain('CREATE TABLE IF NOT EXISTS public.supervisor_commands');
        expect(commandSql).toContain('CREATE POLICY "supervisor_commands_authorized_read"');
        expect(commandSql).toContain('create_supervisor_command');
        expect(commandSql).toContain('ack_supervisor_command');
        expect(commandSql).toContain('schema_version');
        expect(commandSql).toContain('last_seen_at');
        expect(commandSql).toContain("p_payload->>'cierreId'");
        expect(commandSql).toContain("p_expires_at - p_issued_at > interval '60 seconds'");
        expect(commandSql).not.toContain("p_expires_at > now() + interval '60 seconds'");
        expect(commandReceiver).toContain('targetCierreId');
        expect(commandReceiver).toContain('Turno activo no encontrado');
        expect(commandReceiver).toContain('APPLIED_COMMANDS_KEY');
        expect(commandReceiver).toContain('applyInventoryBatchCommand');
        expect(commandSql).not.toMatch(/GRANT\s+[^;]*\bTO\s+anon\b/i);
        expect((commandSql.match(/SET search_path = public, extensions/g) || []).length).toBe(2);
    });

    it('mantiene la corrección productiva de desvinculación para caja y monitor', () => {
        expect(unpairCompatibilitySql).toContain('ON CONFLICT (primary_device_id) DO UPDATE');
        expect(unpairCompatibilitySql).not.toContain('código de dueño');
        expect(unpairCompatibilitySql).toContain('WHERE monitor_device_id = v_monitor_id');
        expect(unpairCompatibilitySql).toContain('REVOKE ALL ON FUNCTION public.pair_monitor_device(text, text) FROM PUBLIC, anon');
        expect(unpairCompatibilitySql).toContain('owner_auth_id = v_actor OR monitor_auth_id = v_actor');
        expect(unpairCompatibilitySql).toContain('monitor_auth_id = NULL');
        expect(unpairCompatibilitySql).toMatch(/REVOKE ALL ON FUNCTION public\.unpair_monitor\(text\) FROM PUBLIC, anon/);
        expect(unpairCompatibilitySql).toContain('GRANT EXECUTE ON FUNCTION public.unpair_monitor(text) TO authenticated, service_role');
    });

    it('mantiene la migración de ingreso por lote aditiva y cerrada', () => {
        expect(inventoryBatchSql).toContain('supervisor.inventory.batch.adjust');
        expect(inventoryBatchSql).toContain("p_payload->>'direction' NOT IN ('ingreso', 'egreso')");
        expect(inventoryBatchSql).toContain("p_payload->>'reasonCategory'");
        expect(inventoryBatchSql).toContain('DROP CONSTRAINT IF EXISTS');
        expect(inventoryBatchSql).toContain('ROLLBACK');
        expect(inventoryBatchSql).toContain('SET search_path = public, extensions');
        expect(inventoryBatchSql).not.toMatch(/GRANT\s+[^;]*\bTO\s+anon\b/i);
        expect(inventoryBatchSql).not.toMatch(/DROP\s+TABLE/i);
    });

    it('mantiene la migración productiva de egreso con guardas y rollback', () => {
        expect(productionEgressSql).toContain("p_payload->>'direction' NOT IN ('ingreso', 'egreso')");
        expect(productionEgressSql).toContain("p_payload->>'reasonCategory' NOT IN ('merma', 'danio', 'vencimiento', 'autoconsumo', 'devolucion', 'ajuste')");
        expect(productionEgressSql).toContain("p_expires_at - p_issued_at > interval '60 seconds'");
        expect(productionEgressSql).toContain("p_expires_at <= now()");
        expect(productionEgressSql).toContain('monitor_auth_id = v_actor');
        expect(productionEgressSql).toContain('REVOKE ALL ON FUNCTION');
        expect(productionEgressSql).toContain('DROP TRIGGER IF EXISTS supervisor_income_pairing_guard');
        expect(productionEgressSql).toContain('CREATE OR REPLACE FUNCTION public.enforce_supervisor_income_command()');
        expect(productionEgressSql).toContain("NEW.payload->>'direction' = 'egreso'");
        expect(productionEgressSql).toContain("RAISE EXCEPTION 'Payload de ajuste por lote inválido'");
        expect(productionEgressSql).toContain('ROLLBACK');
        expect(productionEgressSql).not.toMatch(/GRANT\s+[^;]*\bTO\s+anon\b/i);
        expect(productionEgressSql).not.toMatch(/DROP\s+TABLE/i);
    });

    it('habilita crear y editar productos en el trigger productivo', () => {
        expect(productCommandsSql).toContain("NEW.command_type = 'supervisor.product.create'");
        expect(productCommandsSql).toContain("NEW.command_type = 'supervisor.product.update'");
        expect(productCommandsSql).toContain("RAISE EXCEPTION 'Payload de producto inválido'");
        expect(productCommandsSql).toContain("RAISE EXCEPTION 'Patch de producto inválido'");
        expect(productCommandsSql).toContain('DROP TRIGGER IF EXISTS supervisor_income_pairing_guard');
        expect(productCommandsSql).toContain('ROLLBACK');
        expect(productCommandsSql).not.toMatch(/GRANT\s+[^;]*\bTO\s+anon\b/i);
        expect(productCommandsSql).not.toMatch(/DROP\s+TABLE/i);
    });

    it('habilita validación batch v2 sin romper v1 ni las dos vinculaciones de Supervisor', () => {
        expect(inventoryBatchV2Migration).toContain('CREATE OR REPLACE FUNCTION public.is_valid_supervisor_inventory_batch_payload(p_payload jsonb)');
        expect(inventoryBatchV2Migration).toContain("IF NOT (p_payload ? 'batchVersion') THEN");
        expect(inventoryBatchV2Migration).toContain("p_payload->'batchVersion' IS DISTINCT FROM '2'::jsonb");
        expect(inventoryBatchV2Migration).toContain("jsonb_array_length(p_payload->'lines') > 50");
        expect(inventoryBatchV2Migration).toContain("p_expires_at - p_issued_at > interval '60 seconds'");
        expect(inventoryBatchV2Migration).toContain('p_expires_at <= now()');
        expect(inventoryBatchV2Migration).not.toContain("p_expires_at > now() + interval '90 seconds'");
        expect(inventoryBatchV2Migration).toContain("'supervisor.inventory.batch.adjust'\n    ) THEN\n        RAISE EXCEPTION 'Tipo de comando no permitido'");
        expect(inventoryBatchV2Migration).toContain('5000000');
        expect(inventoryBatchV2Migration).toContain('10000000');
        expect(inventoryBatchV2Migration).toContain("prior.value->>'productId' = v_line->>'productId'");
        expect(inventoryBatchV2Migration).toContain('dp.monitor_auth_id = v_actor');
        expect(inventoryBatchV2Migration).toContain('dp.monitor_auth_id_2 = v_actor');
        expect(inventoryBatchV2Migration).toContain('dp.monitor_auth_id = NEW.actor_auth_id');
        expect(inventoryBatchV2Migration).toContain('dp.monitor_auth_id_2 = NEW.actor_auth_id');
        expect(inventoryBatchV2Migration).toContain('ELSIF p_command_type = \'supervisor.inventory.batch.adjust\' THEN');
        expect(inventoryBatchV2Migration).toContain("ELSIF p_command_type LIKE 'supervisor.user.%' THEN");
        const triggerBody = inventoryBatchV2Migration
            .split('CREATE OR REPLACE FUNCTION public.enforce_supervisor_income_command()')[1]
            .split('CREATE TRIGGER supervisor_income_pairing_guard')[0];
        expect(triggerBody).toContain('ELSIF NEW.command_type = \'supervisor.inventory.batch.adjust\' THEN');
        expect(triggerBody).not.toContain('NEW.command_type LIKE \'supervisor.user.%\'');
        expect(triggerBody).not.toContain('NEW.command_type = \'supervisor.product.delete\'');
        expect(triggerBody).not.toContain('NEW.command_type IN (\'supervisor.shift.close\', \'supervisor.shift.reopen\')');
        expect(inventoryBatchV2Migration.match(/SET search_path = public, extensions/g)).toHaveLength(3);
        expect(inventoryBatchV2Migration).toContain('REVOKE ALL ON FUNCTION public.create_supervisor_command');
        expect(inventoryBatchV2Migration).toContain('REVOKE ALL ON FUNCTION public.enforce_supervisor_income_command() FROM PUBLIC, anon, authenticated');
        expect(inventoryBatchV2Migration).toContain('TO authenticated;');
        expect(inventoryBatchV2Migration).not.toMatch(/GRANT\s+[^;]*\bTO\s+anon\b/i);
        expect(inventoryBatchV2Migration).not.toMatch(/UPDATE\s+public\.supervisor_commands|status\s*=|ack_supervisor_command/i);
        expect(inventoryBatchV2Migration).toContain('COMMIT;');
    });

    it('autoriza lectura de órdenes al dueño y a ambos supervisores activos', () => {
        const readPolicy = commandStateMachineMigration
            .split('CREATE POLICY "supervisor_commands_authorized_read"')[1]
            .split(';')[0];
        expect(readPolicy).toContain('FOR SELECT');
        expect(readPolicy).toContain('TO authenticated');
        expect(readPolicy).toContain('dp.owner_auth_id = auth.uid()');
        expect(readPolicy).toContain('dp.monitor_auth_id = auth.uid()');
        expect(readPolicy).toContain('dp.monitor_auth_id_2 = auth.uid()');
        const pairingReadPolicy = commandStateMachineMigration
            .split('CREATE POLICY "device_pairings_authenticated_read"')[1]
            .split(';')[0];
        expect(pairingReadPolicy).toContain('auth.uid() = owner_auth_id');
        expect(pairingReadPolicy).toContain('auth.uid() = monitor_auth_id');
        expect(pairingReadPolicy).toContain('auth.uid() = monitor_auth_id_2');
        expect(readPolicy).toContain('dp.revoked_at IS NULL');
        expect(readPolicy).toContain('dp.monitor_device_id_2 <> dp.primary_device_id');
        expect(commandStateMachineMigration).toContain('DROP POLICY IF EXISTS "device_pairings_authenticated_read"');
        expect(commandStateMachineMigration).toContain('DROP POLICY IF EXISTS "supervisor_commands_authorized_read"');
    });

    it('limita cloud_backups a licencias permanentes activas', () => {
        expect(backupLicenseSql).toContain('has_permanent_backup_license');
        expect(backupLicenseSql).toContain("lower(trim(l.type)) = 'permanent'");
        expect(backupLicenseSql).toContain('l.is_active IS TRUE');
        expect(backupLicenseSql).toContain('DROP POLICY IF EXISTS "cloud_backups_device_isolation"');
        expect(backupLicenseSql).toContain('public.has_permanent_backup_license(device_id)');
        expect(backupLicenseSql).toContain('COMMIT;');
        expect(backupLicenseSql).not.toMatch(/DROP\s+TABLE/i);
    });
});

describe('Baja de productos desde el Supervisor (20261018)', () => {
    const productDeleteSql = readFileSync('supabase/migrations/20261018_supervisor_product_delete.sql', 'utf8');

    it('habilita supervisor.product.delete en el trigger con la misma validación que la RPC', () => {
        expect(productDeleteSql).toContain("ELSIF NEW.command_type = 'supervisor.product.delete' THEN");
        expect(productDeleteSql).toContain("coalesce(NEW.payload->>'productId', '') = ''");
        expect(productDeleteSql).toContain("RAISE EXCEPTION 'Producto inválido'");
    });

    it('mantiene el resto del trigger intacto: pairing, tipos no habilitados y cero acceso a anon', () => {
        expect(productDeleteSql).toContain("RAISE EXCEPTION 'Tipo de orden Supervisor no permitido'");
        expect(productDeleteSql).toContain("RAISE EXCEPTION 'Monitor no vinculado o no autorizado para esa caja'");
        expect(productDeleteSql).toContain('dp.monitor_auth_id = NEW.actor_auth_id');
        expect(productDeleteSql).toContain('dp.monitor_auth_id_2 = NEW.actor_auth_id');
        // El trigger se reemplaza completo: se retira el previo y se recrea.
        // El constraint se reafirma con la lista canónica completa (incluye la baja).
        expect(productDeleteSql).toContain('DROP CONSTRAINT IF EXISTS supervisor_commands_command_type_check');
        expect(productDeleteSql).toContain('ADD CONSTRAINT supervisor_commands_command_type_check');
        expect(productDeleteSql).toContain("        'supervisor.product.delete',\n        'supervisor.user.create',");
        expect(productDeleteSql).toContain('DROP TRIGGER IF EXISTS supervisor_income_pairing_guard');
        expect(productDeleteSql).toContain('CREATE TRIGGER supervisor_income_pairing_guard');
        expect(productDeleteSql).toContain('REVOKE ALL ON FUNCTION public.enforce_supervisor_income_command() FROM PUBLIC, anon, authenticated');
        expect(productDeleteSql).toContain('BEGIN;');
        expect(productDeleteSql).toContain('COMMIT;');
        // Solo se habilita la baja: usuarios y turnos siguen fuera del trigger.
        expect(productDeleteSql).not.toContain("NEW.command_type LIKE 'supervisor.user.%'");
        expect(productDeleteSql).not.toContain("NEW.command_type IN ('supervisor.shift.close'");
        expect(productDeleteSql).not.toMatch(/GRANT\s+[^;]*\bTO\s+anon\b/i);
        expect(productDeleteSql).not.toMatch(/DROP\s+TABLE/i);
        expect(productDeleteSql).not.toMatch(/UPDATE\s+public\.supervisor_commands/i);
    });
});

describe('Identidad de dispositivo auto-reparable (20261017)', () => {
    const identitySql = readFileSync('supabase/migrations/20261017_supervisor_pairing_identity_selfheal.sql', 'utf8');

    it('autoriza a la caja por is_own_device_row además de por sesión guardada', () => {
        const pairingReadPolicy = identitySql
            .split('CREATE POLICY "device_pairings_authenticated_read"')[1]
            .split(';')[0];
        expect(pairingReadPolicy).toContain('public.is_own_device_row(primary_device_id)');
        expect(pairingReadPolicy).toContain('auth.uid() = monitor_auth_id_2');

        const commandsReadPolicy = identitySql
            .split('CREATE POLICY "supervisor_commands_authorized_read"')[1]
            .split(';')[0];
        expect(commandsReadPolicy).toContain('public.is_own_device_row(supervisor_commands.target_device_id)');
        expect(commandsReadPolicy).toContain('dp.revoked_at IS NULL');
    });

    it('claim y ack autorizan por identidad de dispositivo, no por owner congelado', () => {
        const claimFn = identitySql.split('FUNCTION public.claim_supervisor_command')[1].split('$$;')[0];
        expect(claimFn).toContain('public.is_own_device_row(sc.target_device_id)');
        expect(claimFn).not.toContain('dp.owner_auth_id = v_actor');
        expect(claimFn).toContain("'expired', true");
        expect(claimFn).toContain('FOR UPDATE OF sc');

        const ackFn = identitySql.split('FUNCTION public.ack_supervisor_command')[1].split('$$;')[0];
        expect(ackFn).toContain('public.is_own_device_row(sc.target_device_id)');
        expect(ackFn).not.toContain('dp.owner_auth_id = v_actor');
        expect(ackFn).toContain("status = 'received'");
    });

    it('re-liga owner_auth_id y permite desvincular a la caja poseedora', () => {
        expect(identitySql).toContain('WHEN public.is_own_device_row(v_device_id) THEN v_owner');
        expect(identitySql).toContain('ELSE coalesce(owner_auth_id, v_owner)');

        const unpairFn = identitySql.split('FUNCTION public.unpair_monitor')[1].split('$$;')[0];
        expect(unpairFn).toContain('public.is_own_device_row(v_pairing.primary_device_id)');
        expect(unpairFn).toContain('monitor_auth_id_2 = NULL');
        expect(unpairFn).toContain('RAISE EXCEPTION \'No autorizado o vínculo inexistente\'');
    });

    it('no abre acceso a anon ni toca datos de negocio', () => {
        expect(identitySql).not.toMatch(/GRANT\s+[^;]*\bTO\s+anon\b/i);
        expect(identitySql).not.toMatch(/DROP\s+TABLE/i);
        expect(identitySql).not.toMatch(/UPDATE\s+public\.(sync_documents|cloud_backups)/i);
        expect(identitySql).toContain('BEGIN;');
        expect(identitySql).toContain('COMMIT;');
    });
});

describe('Reloj del dispositivo fuera del create (20261020)', () => {
    const serverClockSql = readFileSync('supabase/migrations/20261020_supervisor_command_server_clock.sql', 'utf8');
    // El cuerpo activo es todo lo anterior al bloque DOWN (comentario /* */).
    const [upBody, downBody] = serverClockSql.split('/*');

    it('construye la ventana con now() del servidor y solo valida la duración pedida', () => {
        expect(upBody).toContain('v_duration := p_expires_at - p_issued_at');
        expect(upBody).toContain("IF v_duration IS NULL OR v_duration <= interval '0' THEN");
        expect(upBody).toContain("RAISE EXCEPTION 'Ventana temporal inválida'");
        expect(upBody).toContain("v_duration > LEAST(v_max_ttl, interval '10 minutes')");
        expect(upBody).toContain('now(), now() + v_duration');
        // Sin comparaciones contra el reloj absoluto del cliente.
        expect(upBody).not.toContain("p_issued_at < now() - interval '2 minutes'");
        expect(upBody).not.toContain("p_issued_at > now() + interval '2 minutes'");
        expect(upBody).not.toContain('p_expires_at <= now()');
    });

    it('conserva firma, autorización, idempotencia y permisos', () => {
        expect(upBody).toContain('CREATE OR REPLACE FUNCTION public.create_supervisor_command(');
        expect(upBody).toContain('p_issued_at        TIMESTAMPTZ');
        expect(upBody).toContain('p_expires_at       TIMESTAMPTZ');
        expect(upBody).toContain("RAISE EXCEPTION 'Monitor no autorizado para esa caja'");
        expect(upBody).toContain("RAISE EXCEPTION 'command_id ya utilizado con otro payload'");
        expect(upBody).toContain('REVOKE ALL ON FUNCTION public.create_supervisor_command(text, text, text, jsonb, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated');
        expect(upBody).toContain('GRANT EXECUTE ON FUNCTION public.create_supervisor_command(text, text, text, jsonb, timestamptz, timestamptz) TO authenticated;');
        expect(upBody).toContain('BEGIN;');
        expect(upBody).toContain('COMMIT;');
        expect(serverClockSql).not.toMatch(/GRANT\s+[^;]*\bTO\s+anon\b/i);
        expect(serverClockSql).not.toMatch(/DROP\s+TABLE/i);
        expect(serverClockSql).not.toMatch(/UPDATE\s+public\.supervisor_commands/i);
    });

    it('incluye la reversión literal de la definición previa', () => {
        expect(downBody).toContain("p_issued_at < now() - interval '2 minutes'");
        expect(downBody).toContain('p_issued_at, p_expires_at)');
    });
});
