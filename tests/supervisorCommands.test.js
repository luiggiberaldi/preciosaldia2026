import { describe, expect, it } from 'vitest';
import {
  AppliedCommandGuard,
  buildInventoryBatchV2Payload,
  INVENTORY_BATCH_MAX_LINES,
  INVENTORY_LOT_REFERENCE_MAX_LENGTH,
  INVENTORY_REASON_MAX_LENGTH,
  validateSupervisorCommand,
} from '../src/services/supervisorContracts';
import {
  buildSupervisorCommand,
  claimSupervisorCommand,
  fetchSupervisorCommandsForRecovery,
  sendSupervisorCommand,
  shouldAwaitSupervisorAck,
  SUPERVISOR_COMMAND_TTL_MS,
  fetchPendingSupervisorCommands,
  isSupervisorCommandEnabled,
  withSupervisorCommandLock,
} from '../src/services/supervisorCommandService';
const baseCommand = (overrides = {}) => ({
  commandId: "command-1234",
  type: "supervisor.product.delete",
  monitorDeviceId: "monitor-1",
  targetDeviceId: "primary-1",
  issuedAt: 1_000,
  expiresAt: 50_000,
  payload: { productId: "product-1" },
  ...overrides,
});
describe("Supervisor command contract", () => {
  it("acepta un comando dirigido dentro de su TTL", () => {
    const result = validateSupervisorCommand(baseCommand(), {
      targetDeviceId: "primary-1",
      monitorDeviceId: "monitor-1",
      now: 2_000,
    });
    expect(result).toEqual({ valid: true, error: null });
  });
  it("rechaza target o monitor diferentes", () => {
    expect(
      validateSupervisorCommand(baseCommand(), {
        targetDeviceId: "primary-2",
        monitorDeviceId: "monitor-1",
        now: 2_000,
      }).valid,
    ).toBe(false);
    expect(
      validateSupervisorCommand(baseCommand(), {
        targetDeviceId: "primary-1",
        monitorDeviceId: "monitor-2",
        now: 2_000,
      }).valid,
    ).toBe(false);
  });
  it("rechaza comandos vencidos, TTL largo o sin commandId", () => {
    expect(
      validateSupervisorCommand(baseCommand({ expiresAt: 100_000 }), {
        targetDeviceId: "primary-1",
        monitorDeviceId: "monitor-1",
        now: 2_000,
      }).valid,
    ).toBe(false);
    expect(
      validateSupervisorCommand(baseCommand({ expiresAt: 1_001 }), {
        targetDeviceId: "primary-1",
        monitorDeviceId: "monitor-1",
        now: 2_000,
      }).valid,
    ).toBe(false);
    expect(
      validateSupervisorCommand(baseCommand({ commandId: "short" }), {
        targetDeviceId: "primary-1",
        monitorDeviceId: "monitor-1",
        now: 2_000,
      }).valid,
    ).toBe(false);
  });
  it("valida ingreso y egreso por lote con categoría de salida", () => {
    const valid = validateSupervisorCommand(
      baseCommand({
        type: "supervisor.inventory.batch.adjust",
        payload: {
          direction: "ingreso",
          productId: "product-1",
          quantityInput: 2,
          inputUnit: "cajas",
          unitsPerPackage: 24,
          expectedStock: 10,
          reason: "Mercancía recibida",
          lotReference: "LOTE-001",
        },
      }),
      { targetDeviceId: "primary-1", monitorDeviceId: "monitor-1", now: 2_000 },
    );
    expect(valid.valid).toBe(true);
    const validEgress = validateSupervisorCommand(
      baseCommand({
        type: "supervisor.inventory.batch.adjust",
        payload: {
          direction: "egreso",
          productId: "product-1",
          quantityInput: 1,
          inputUnit: "unidades",
          unitsPerPackage: 1,
          expectedStock: 10,
          reasonCategory: "merma",
          reason: "Producto dañado",
        },
      }),
      { targetDeviceId: "primary-1", monitorDeviceId: "monitor-1", now: 2_000 },
    );
    expect(validEgress.valid).toBe(true);
    const invalid = validateSupervisorCommand(
      baseCommand({
        type: "supervisor.inventory.batch.adjust",
        payload: {
          direction: "egreso",
          productId: "product-1",
          quantityInput: 1,
          inputUnit: "unidades",
          unitsPerPackage: 1,
          expectedStock: 10,
          reason: "Producto dañado",
        },
      }),
      { targetDeviceId: "primary-1", monitorDeviceId: "monitor-1", now: 2_000 },
    );
    expect(invalid.valid).toBe(false);
  });
  describe("inventario batch v2", () => {
    const ctx = {
      targetDeviceId: "primary-1",
      monitorDeviceId: "monitor-1",
      now: 2_000,
    };
    const line = (overrides = {}) => ({
      lineId: "line-1",
      productId: "product-1",
      inputUnit: "unidades",
      quantityInput: 2,
      expectedStock: 10,
      ...overrides,
    });
    const v2 = (overrides = {}) => ({
      batchVersion: 2,
      direction: "ingreso",
      reason: "Compra recibida",
      lotReference: "LOTE-9",
      lines: [
        line(),
        line({
          lineId: "line-2",
          productId: "product-2",
          inputUnit: "cajas",
          quantityInput: 3,
          unitsPerPackage: 12,
          baseRevision: "rev-2",
        }),
      ],
      ...overrides,
    });
    const isValid = (payload) =>
      validateSupervisorCommand(
        baseCommand({ type: "supervisor.inventory.batch.adjust", payload }),
        ctx,
      ).valid;
    it("acepta el payload de ejemplo v2 de ingreso, egreso y granel", () => {
      expect(isValid(v2())).toBe(true);
      expect(
        isValid(
          v2({
            direction: "egreso",
            reasonCategory: "merma",
            lotReference: undefined,
          }),
        ),
      ).toBe(true);
      expect(
        isValid(
          v2({
            lines: [
              line({ inputUnit: "g", quantityInput: 500 }),
              line({
                productId: "aceite",
                inputUnit: "ml",
                quantityInput: 750,
              }),
            ],
          }),
        ),
      ).toBe(true);
      expect(
        isValid(v2({ lines: [line({ inputUnit: "kg", quantityInput: 1.5 })] })),
      ).toBe(true);
    });
    it("mantiene v1 válido sin batchVersion", () => {
      expect(
        isValid({
          direction: "ingreso",
          productId: "product-1",
          quantityInput: 2,
          inputUnit: "cajas",
          unitsPerPackage: 24,
          expectedStock: 10,
          reason: "Mercancía recibida",
        }),
      ).toBe(true);
    });
    it("rechaza schema desconocido y mezcla con forma v1", () => {
      expect(isValid(v2({ batchVersion: 3 }))).toBe(false);
      expect(isValid(v2({ batchVersion: "2" }))).toBe(false);
      expect(
        isValid({
          batchVersion: 2,
          direction: "ingreso",
          productId: "product-1",
          quantityInput: 1,
          inputUnit: "unidades",
          unitsPerPackage: 1,
          expectedStock: 1,
          reason: "x",
        }),
      ).toBe(false);
    });
    it("rechaza array vacío, excesivo o ausente", () => {
      expect(isValid(v2({ lines: [] }))).toBe(false);
      expect(isValid(v2({ lines: undefined }))).toBe(false);
      const max = Array.from({ length: INVENTORY_BATCH_MAX_LINES }, (_, i) =>
        line({ lineId: `l-${i}`, productId: `p-${i}` }),
      );
      expect(isValid(v2({ lines: max }))).toBe(true);
      expect(
        isValid(v2({ lines: [...max, line({ productId: "extra" })] })),
      ).toBe(false);
    });
    it("rechaza cabecera inválida: dirección, motivo, categoría y referencia", () => {
      expect(isValid(v2({ direction: "traslado" }))).toBe(false);
      expect(isValid(v2({ reason: "   " }))).toBe(false);
      expect(isValid(v2({ reason: undefined }))).toBe(false);
      expect(
        isValid(v2({ reason: "x".repeat(INVENTORY_REASON_MAX_LENGTH + 1) })),
      ).toBe(false);
      expect(
        isValid(v2({ reason: "x".repeat(INVENTORY_REASON_MAX_LENGTH) })),
      ).toBe(true);
      expect(isValid(v2({ direction: "egreso" }))).toBe(false);
      expect(isValid(v2({ direction: "egreso", reasonCategory: "robo" }))).toBe(
        false,
      );
      expect(
        isValid(
          v2({
            lotReference: "x".repeat(INVENTORY_LOT_REFERENCE_MAX_LENGTH + 1),
          }),
        ),
      ).toBe(false);
      expect(isValid(v2({ lotReference: 42 }))).toBe(false);
    });
    it("rechaza líneas con campos faltantes, unidades inválidas o números fuera de rango", () => {
      const bad = [
        line({ productId: undefined }),
        line({ productId: "" }),
        line({ inputUnit: "litros" }),
        line({ inputUnit: undefined }),
        line({ quantityInput: 0 }),
        line({ quantityInput: -1 }),
        line({ quantityInput: Number.NaN }),
        line({ quantityInput: Number.POSITIVE_INFINITY }),
        line({ quantityInput: "2" }),
        line({ inputUnit: "kg", quantityInput: 5000.001 }),
        line({ expectedStock: undefined }),
        line({ expectedStock: -1 }),
        line({ expectedStock: Number.NaN }),
        line({ inputUnit: "cajas", unitsPerPackage: 0 }),
        line({ inputUnit: "cajas", unitsPerPackage: 1.5 }),
        line({ baseRevision: "" }),
        "no-es-objeto",
      ];
      for (const badLine of bad)
        expect(isValid(v2({ lines: [badLine] }))).toBe(false);
    });
    it("rechaza líneas duplicadas o con estado base inconsistente", () => {
      expect(isValid(v2({ lines: [line(), line({ lineId: "line-2" })] }))).toBe(
        false,
      );
      expect(
        isValid(
          v2({
            lines: [
              line(),
              line({
                inputUnit: "cajas",
                unitsPerPackage: 6,
                expectedStock: 11,
              }),
            ],
          }),
        ),
      ).toBe(false);
      expect(
        isValid(
          v2({
            lines: [line(), line({ inputUnit: "cajas", unitsPerPackage: 6 })],
          }),
        ),
      ).toBe(true);
    });
    it("consolida líneas repetidas y no envía deltas derivados", () => {
      const payload = buildInventoryBatchV2Payload(
        {
          direction: "ingreso",
          reason: "  Compra  ",
          reasonCategory: "merma",
          lotReference: "  ",
        },
        [
          {
            productId: "p1",
            inputUnit: "kg",
            quantityInput: 1.2,
            expectedStock: 3,
            unitsDelta: 99,
          },
          {
            productId: "p1",
            inputUnit: "kg",
            quantityInput: 0.1,
            expectedStock: 3,
          },
          {
            productId: "p2",
            inputUnit: "cajas",
            quantityInput: 1,
            unitsPerPackage: 12,
            expectedStock: 0,
          },
          {
            productId: "p2",
            inputUnit: "cajas",
            quantityInput: 2,
            unitsPerPackage: 12,
            expectedStock: 0,
          },
        ],
      );
      expect(payload).toEqual({
        batchVersion: 2,
        direction: "ingreso",
        reason: "Compra",
        lines: [
          {
            productId: "p1",
            inputUnit: "kg",
            quantityInput: 1.3,
            expectedStock: 3,
          },
          {
            productId: "p2",
            inputUnit: "cajas",
            quantityInput: 3,
            unitsPerPackage: 12,
            expectedStock: 0,
          },
        ],
      });
      expect(isValid(payload)).toBe(true);
    });
    it("no suma cajas con factores distintos: el contrato las rechaza", () => {
      const payload = buildInventoryBatchV2Payload(
        { direction: "ingreso", reason: "Compra" },
        [
          {
            productId: "p2",
            inputUnit: "cajas",
            quantityInput: 1,
            unitsPerPackage: 12,
            expectedStock: 0,
          },
          {
            productId: "p2",
            inputUnit: "cajas",
            quantityInput: 1,
            unitsPerPackage: 6,
            expectedStock: 0,
          },
        ],
      );
      expect(payload.lines).toHaveLength(2);
      expect(isValid(payload)).toBe(false);
    });
  });
  it("rechaza tipos y payloads no permitidos", () => {
    expect(
      validateSupervisorCommand(baseCommand({ type: "supervisor.unknown" }), {
        targetDeviceId: "primary-1",
        monitorDeviceId: "monitor-1",
        now: 2_000,
      }).valid,
    ).toBe(false);
    expect(
      validateSupervisorCommand(baseCommand({ payload: {} }), {
        targetDeviceId: "primary-1",
        monitorDeviceId: "monitor-1",
        now: 2_000,
      }).valid,
    ).toBe(false);
  });
  it("acepta una fecha base válida y rechaza una inválida al editar productos", () => {
    expect(
      validateSupervisorCommand(
        baseCommand({
          type: "supervisor.product.update",
          payload: {
            productId: "product-1",
            baseRevision: '["Arroz"]',
            baseUpdatedAt: "2026-10-15T12:00:00.000Z",
            patch: { name: "Arroz nuevo", baseRevision: '["Arroz"]' },
          },
        }),
        {
          targetDeviceId: "primary-1",
          monitorDeviceId: "monitor-1",
          now: 2_000,
        },
      ).valid,
    ).toBe(true);
    expect(
      validateSupervisorCommand(
        baseCommand({
          type: "supervisor.product.update",
          payload: {
            productId: "product-1",
            baseRevision: '["Arroz"]',
            baseUpdatedAt: "no-es-fecha",
            patch: { name: "Arroz nuevo", baseRevision: '["Arroz"]' },
          },
        }),
        {
          targetDeviceId: "primary-1",
          monitorDeviceId: "monitor-1",
          now: 2_000,
        },
      ).valid,
    ).toBe(false);
  });
  it("acepta una revisión base válida y rechaza si la revisión anidada está ausente, es inválida o difiere de la raíz", () => {
    const validRev = '["Arroz",null,2.5]';
    expect(
      validateSupervisorCommand(
        baseCommand({
          type: "supervisor.product.update",
          payload: {
            productId: "product-1",
            baseRevision: validRev,
            patch: { name: "Arroz nuevo", baseRevision: validRev },
          },
        }),
        {
          targetDeviceId: "primary-1",
          monitorDeviceId: "monitor-1",
          now: 2_000,
        },
      ).valid,
    ).toBe(true);
    expect(
      validateSupervisorCommand(
        baseCommand({
          type: "supervisor.product.update",
          payload: {
            productId: "product-1",
            baseRevision: validRev,
            patch: { name: "Arroz nuevo" },
          },
        }),
        {
          targetDeviceId: "primary-1",
          monitorDeviceId: "monitor-1",
          now: 2_000,
        },
      ).valid,
    ).toBe(false);
    expect(
      validateSupervisorCommand(
        baseCommand({
          type: "supervisor.product.update",
          payload: {
            productId: "product-1",
            baseRevision: validRev,
            patch: { name: "Arroz nuevo", baseRevision: 12345 },
          },
        }),
        {
          targetDeviceId: "primary-1",
          monitorDeviceId: "monitor-1",
          now: 2_000,
        },
      ).valid,
    ).toBe(false);
    expect(
      validateSupervisorCommand(
        baseCommand({
          type: "supervisor.product.update",
          payload: {
            productId: "product-1",
            baseRevision: validRev,
            patch: { name: "Arroz nuevo", baseRevision: "   " },
          },
        }),
        {
          targetDeviceId: "primary-1",
          monitorDeviceId: "monitor-1",
          now: 2_000,
        },
      ).valid,
    ).toBe(false);
    expect(
      validateSupervisorCommand(
        baseCommand({
          type: "supervisor.product.update",
          payload: {
            productId: "product-1",
            baseRevision: validRev,
            patch: { name: "Arroz nuevo", baseRevision: '["Arroz",null,3.0]' },
          },
        }),
        {
          targetDeviceId: "primary-1",
          monitorDeviceId: "monitor-1",
          now: 2_000,
        },
      ).valid,
    ).toBe(false);
    expect(
      validateSupervisorCommand(
        baseCommand({
          type: "supervisor.product.update",
          payload: {
            productId: "product-1",
            patch: { name: "Arroz nuevo", baseRevision: validRev },
          },
        }),
        {
          targetDeviceId: "primary-1",
          monitorDeviceId: "monitor-1",
          now: 2_000,
        },
      ).valid,
    ).toBe(false);
    expect(
      validateSupervisorCommand(
        baseCommand({
          type: "supervisor.product.update",
          payload: {
            productId: "product-1",
            baseRevision: 12345,
            patch: { name: "Arroz nuevo", baseRevision: validRev },
          },
        }),
        {
          targetDeviceId: "primary-1",
          monitorDeviceId: "monitor-1",
          now: 2_000,
        },
      ).valid,
    ).toBe(false);
  });
  it("rechaza una orden repetida mediante commandId", () => {
    let now = 2_000;
    const guard = new AppliedCommandGuard({ now: () => now });
    expect(guard.accept("command-1234", 50_000)).toBe(true);
    expect(guard.has("command-1234")).toBe(true);
    expect(guard.accept("command-1234", 50_000)).toBe(false);
    now = 60_000;
    expect(guard.has("command-1234")).toBe(false);
    expect(guard.accept("command-1234", 70_000)).toBe(true);
  });
  it("construye el envelope de comando con TTL y schema", () => {
    const command = buildSupervisorCommand({
      type: "supervisor.product.delete",
      targetDeviceId: "primary-1",
      monitorDeviceId: "monitor-1",
      payload: { productId: "product-1" },
      commandId: "command-5678",
      now: 10_000,
    });
    expect(command).toMatchObject({
      commandId: "command-5678",
      schemaVersion: 1,
      issuedAt: 10_000,
      expiresAt: 10_000 + SUPERVISOR_COMMAND_TTL_MS,
    });
  });
  it("rechaza tipos desconocidos antes de intentar la red", async () => {
    const result = await sendSupervisorCommand({
      type: "supervisor.unknown",
      targetDeviceId: "primary-1",
      payload: {},
    });
    expect(result).toMatchObject({ ok: false, status: "disabled" });
  });
  it("habilita productos, inventario, turnos y usuarios", () => {
    expect(isSupervisorCommandEnabled("supervisor.product.create")).toBe(true);
    expect(isSupervisorCommandEnabled("supervisor.product.update")).toBe(true);
    expect(isSupervisorCommandEnabled("supervisor.product.delete")).toBe(true);
    expect(
      isSupervisorCommandEnabled("supervisor.inventory.batch.adjust", {
        direction: "egreso",
      }),
    ).toBe(true);
    expect(isSupervisorCommandEnabled("supervisor.shift.close")).toBe(true);
    expect(isSupervisorCommandEnabled("supervisor.user.create")).toBe(true);
  });
  it("recupera órdenes pendientes al reconectar la caja", async () => {
    const calls = [];
    const query = {
      from(table) {
        calls.push(["from", table]);
        return this;
      },
      select(columns) {
        calls.push(["select", columns]);
        return this;
      },
      eq(column, value) {
        calls.push(["eq", column, value]);
        return this;
      },
      order(column, options) {
        calls.push(["order", column, options]);
        return this;
      },
      limit(value) {
        calls.push(["limit", value]);
        return Promise.resolve({ data: [], error: null });
      },
    };
    await fetchPendingSupervisorCommands(query, "primary-1");
    expect(calls).toEqual([
      ["from", "supervisor_commands"],
      [
        "select",
        "command_id,target_device_id,actor_auth_id,command_type,status,issued_at,expires_at,payload,schema_version",
      ],
      ["eq", "target_device_id", "primary-1"],
      ["eq", "status", "pending"],
      ["order", "issued_at", { ascending: true }],
      ["limit", 25],
    ]);
  });
  it("envía tasas como notificación sin esperar ACK visible", () => {
    expect(shouldAwaitSupervisorAck("supervisor.rate.set")).toBe(false);
    expect(shouldAwaitSupervisorAck("supervisor.inventory.batch.adjust")).toBe(
      true,
    );
  });
  it("mantiene habilitada la tasa remota junto con las demás mutaciones", () => {
    expect(isSupervisorCommandEnabled("supervisor.rate.set")).toBe(true);
    expect(isSupervisorCommandEnabled("supervisor.user.create")).toBe(true);
    expect(isSupervisorCommandEnabled("supervisor.shift.close")).toBe(true);
  });
  it("recupera órdenes pendientes y recibidas para la misma caja y commandId", async () => {
    const calls = [];
    const query = {
      from(table) {
        calls.push(["from", table]);
        return this;
      },
      select(columns) {
        calls.push(["select", columns]);
        return this;
      },
      eq(column, value) {
        calls.push(["eq", column, value]);
        return this;
      },
      or(filters) {
        calls.push(["or", filters]);
        return this;
      },
      order(column, options) {
        calls.push(["order", column, options]);
        return this;
      },
      limit(value) {
        calls.push(["limit", value]);
        return Promise.resolve({ data: [], error: null });
      },
    };
    await fetchSupervisorCommandsForRecovery(
      query,
      "primary-1",
      Date.parse("2026-10-16T12:00:00.000Z"),
    );
    expect(calls).toEqual([
      ["from", "supervisor_commands"],
      [
        "select",
        "command_id,target_device_id,actor_auth_id,command_type,status,issued_at,expires_at,payload,schema_version",
      ],
      ["eq", "target_device_id", "primary-1"],
      [
        "or",
        "status.eq.received,and(status.eq.pending,expires_at.gt.2026-10-16T12:00:00.000Z)",
      ],
      ["order", "issued_at", { ascending: true }],
      ["limit", 25],
    ]);
  });
  it("interpreta el claim idempotente por la caja y conserva el estado terminal devuelto", async () => {
    const calls = [];
    const client = {
      rpc(name, args) {
        calls.push([name, args]);
        return Promise.resolve({
          data: {
            command_id: "command-1234",
            status: "received",
            claimed: true,
          },
          error: null,
        });
      },
    };
    const result = await claimSupervisorCommand({
      client,
      commandId: "command-1234",
      targetDeviceId: "primary-1",
    });
    expect(calls).toEqual([
      [
        "claim_supervisor_command",
        { p_command_id: "command-1234", p_target_device_id: "primary-1" },
      ],
    ]);
    expect(result).toMatchObject({
      ok: true,
      status: "received",
      claimed: true,
    });
  });
  it("serializa trabajo local concurrente para el mismo commandId", async () => {
    const calls = [];
    const managerQueues = new Map();
    const lockManager = {
      request(name, options, operation) {
        calls.push([name, options]);
        const previous = managerQueues.get(name) || Promise.resolve();
        const next = previous.catch(() => {}).then(operation);
        managerQueues.set(name, next);
        return next;
      },
    };
    let active = 0;
    let maxActive = 0;
    const operation = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    };
    await Promise.all([
      withSupervisorCommandLock("command-1234", operation, lockManager),
      withSupervisorCommandLock("command-1234", operation, lockManager),
    ]);
    expect(calls).toEqual([
      ["supervisor-command:command-1234", { mode: "exclusive" }],
      ["supervisor-command:command-1234", { mode: "exclusive" }],
    ]);
    expect(maxActive).toBe(1);
  });
});
