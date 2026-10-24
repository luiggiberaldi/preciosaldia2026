import { describe, expect, it } from 'vitest';
import {
  AppliedCommandGuard,
  buildInventoryBatchV2Payload,
  INVENTORY_BATCH_MAX_LINES,
  INVENTORY_LOT_REFERENCE_MAX_LENGTH,
  INVENTORY_MAX_EXPECTED_STOCK,
  INVENTORY_REASON_MAX_LENGTH,
  validateSupervisorCommand,
} from '../src/services/supervisorContracts';
import {
  awaitSupervisorCommandAck,
  buildSupervisorCommand,
  claimSupervisorCommand,
  fetchSupervisorCommandsForRecovery,
  getCommandTtlMs,
  sendSupervisorCommand,
  shouldAwaitSupervisorAck,
  SUPERVISOR_COMMAND_TTL_MS,
  fetchPendingSupervisorCommands,
  isSupervisorCommandEnabled,
  withSupervisorCommandLock,
} from '../src/services/supervisorCommandService';
import { SUPERVISOR_EXTENDED_TTL_ENABLED } from '../src/config/supervisorPolicy';
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
    // Fase 5: los tipos de catálogo admiten hasta 5 min, así que "TTL largo" se
    // prueba por encima de ese tope; los sensibles al tiempo conservan 60 s.
    expect(
      validateSupervisorCommand(baseCommand({ expiresAt: 400_000 }), {
        targetDeviceId: "primary-1",
        monitorDeviceId: "monitor-1",
        now: 2_000,
      }).valid,
    ).toBe(false);
    expect(
      validateSupervisorCommand(
        baseCommand({
          type: "supervisor.shift.close",
          payload: { shiftId: "shift-1", cierreId: "cierre-1" },
          expiresAt: 100_000,
        }),
        {
          targetDeviceId: "primary-1",
          monitorDeviceId: "monitor-1",
          now: 2_000,
        },
      ).valid,
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
        line({ expectedStock: -INVENTORY_MAX_EXPECTED_STOCK - 1 }),
        line({ expectedStock: INVENTORY_MAX_EXPECTED_STOCK + 1 }),
        line({ expectedStock: Number.NaN }),
        line({ inputUnit: "cajas", unitsPerPackage: 0 }),
        line({ inputUnit: "cajas", unitsPerPackage: 1.5 }),
        line({ baseRevision: "" }),
        "no-es-objeto",
      ];
      for (const badLine of bad)
        expect(isValid(v2({ lines: [badLine] }))).toBe(false);
    });
    it("acepta expectedStock negativo: el saldo negativo es una base legítima", () => {
      // Regresión: el contrato rechazaba expectedStock < 0 y los productos en
      // saldo negativo no eran ajustables remotamente desde el supervisor.
      // expectedStock describe la base real de la caja, no un objetivo.
      expect(isValid(v2({ lines: [line({ expectedStock: -1 })] }))).toBe(true);
      expect(isValid(v2({ lines: [line({ expectedStock: -2.5 })] }))).toBe(true);
      expect(
        isValid(v2({ lines: [line({ expectedStock: -INVENTORY_MAX_EXPECTED_STOCK })] })),
      ).toBe(true);
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

describe("sendSupervisorCommand — reintentos de transporte del create (Fase 1)", () => {
  const sessionOk = async () => ({
    session: { user: { id: "auth-1" } },
    error: null,
  });
  const pairingOk = async () => ({
    data: {
      monitor_device_id: "monitor-1",
      monitor_auth_id: "auth-1",
      monitor_device_id_2: null,
      monitor_auth_id_2: null,
    },
    error: null,
    supportsSecondary: true,
  });
  const transportError = () => ({
    data: null,
    error: new TypeError("Failed to fetch"),
  });
  const createdRow = (commandId, status = "pending") => ({
    data: {
      command_id: commandId,
      status,
      created_at: "2026-10-17T12:00:00.000Z",
    },
    error: null,
  });

  const send = (client, overrides = {}) =>
    sendSupervisorCommand({
      type: "supervisor.rate.set",
      targetDeviceId: "primary-1",
      payload: { rateMode: "bcv" },
      commandId: "command-retry-1",
      ensureSession: sessionOk,
      readPairing: pairingOk,
      sleep: async () => {},
      random: () => 0,
      client,
      ...overrides,
    });

  it("reintenta el create tras un fallo de transporte con el MISMO commandId y ventana", async () => {
    const calls = [];
    const delays = [];
    let attempt = 0;
    const client = {
      rpc(name, args) {
        calls.push([name, args]);
        attempt += 1;
        return Promise.resolve(
          attempt === 1 ? transportError() : createdRow("command-retry-1"),
        );
      },
    };

    const result = await send(client, {
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    expect(result).toMatchObject({
      ok: true,
      status: "sent",
      commandId: "command-retry-1",
    });
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe("create_supervisor_command");
    expect(calls[1][0]).toBe("create_supervisor_command");
    // Idempotencia: el reintento lleva exactamente el mismo commandId, payload
    // y ventana temporal, de modo que el servidor jamás crea dos comandos.
    expect(calls[1][1]).toEqual(calls[0][1]);
    expect(calls[0][1].p_command_id).toBe("command-retry-1");
    expect(delays).toEqual([1000]);
  });

  it("reintenta también ante un error 5xx del servidor", async () => {
    const calls = [];
    let attempt = 0;
    const client = {
      rpc(name, args) {
        calls.push([name, args]);
        attempt += 1;
        return Promise.resolve(
          attempt === 1
            ? { data: null, error: { message: "Bad Gateway", status: 502 } }
            : createdRow("command-retry-1"),
        );
      },
    };

    const result = await send(client);

    expect(result).toMatchObject({ ok: true, status: "sent" });
    expect(calls).toHaveLength(2);
  });

  it("no reintenta errores definitivos del servidor y propaga el mensaje", async () => {
    const definitiveErrors = [
      { message: "Ventana temporal inválida", code: "P0001", status: 400 },
      { message: "Monitor no autorizado para esa caja", code: "P0001" },
      { message: "command_id ya utilizado con otro payload", code: "P0001" },
    ];

    for (const error of definitiveErrors) {
      const calls = [];
      const client = {
        rpc(name, args) {
          calls.push([name, args]);
          return Promise.resolve({ data: null, error });
        },
      };

      const result = await send(client);

      expect(result).toMatchObject({ ok: false, status: "failed" });
      expect(result.error).toBe(error.message);
      expect(calls).toHaveLength(1);
    }
  });

  it("reintenta una respuesta perdida tras crear sin duplicar el comando", async () => {
    const calls = [];
    let attempt = 0;
    const client = {
      rpc(name, args) {
        calls.push([name, args]);
        attempt += 1;
        // 1.º: la respuesta se pierde en la red aunque el servidor ya creó la
        // fila. 2.º: la RPC idempotente devuelve la fila existente.
        return Promise.resolve(
          attempt === 1
            ? transportError()
            : createdRow("command-retry-1", "received"),
        );
      },
    };

    const result = await send(client);

    expect(result).toMatchObject({
      ok: true,
      status: "sent",
      commandId: "command-retry-1",
    });
    expect(calls).toHaveLength(2);
    expect(calls[1][1]).toEqual(calls[0][1]);
  });

  it("agota los reintentos y reporta 'failed' sin afirmar un rechazo", async () => {
    const calls = [];
    const delays = [];
    const client = {
      rpc(name, args) {
        calls.push([name, args]);
        return transportError();
      },
    };

    const result = await send(client, {
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    expect(result).toMatchObject({ ok: false, status: "failed" });
    // 'rejected' jamás puede venir de un fallo de transporte: el batch lo trata
    // como estado incierto y reconcilia el mismo commandId.
    expect(result.status).not.toBe("rejected");
    expect(result.error).toBe("Failed to fetch");
    expect(calls).toHaveLength(3);
    expect(delays).toEqual([1000, 2000]);
  });
});

describe("sendSupervisorCommand — sesión y pairing en paralelo (Fase 2)", () => {
  const sessionOk = async () => ({
    session: { user: { id: "auth-1" } },
    error: null,
  });
  const pairingRow = (authId) => ({
    monitor_device_id: "monitor-1",
    monitor_auth_id: authId,
    monitor_device_id_2: null,
    monitor_auth_id_2: null,
  });
  const createdRow = (commandId) => ({
    data: {
      command_id: commandId,
      status: "pending",
      created_at: "2026-10-17T12:00:00.000Z",
    },
    error: null,
  });
  const successClient = (commandId = "command-retry-1") => ({
    rpc(name) {
      if (name !== "create_supervisor_command") {
        throw new Error(`RPC inesperada: ${name}`);
      }
      return Promise.resolve(createdRow(commandId));
    },
  });

  const send = (client, overrides = {}) =>
    sendSupervisorCommand({
      type: "supervisor.rate.set",
      targetDeviceId: "primary-1",
      payload: { rateMode: "bcv" },
      commandId: "command-retry-1",
      ensureSession: sessionOk,
      readPairing: async () => ({ data: pairingRow("auth-1"), error: null }),
      sleep: async () => {},
      random: () => 0,
      client,
      ...overrides,
    });

  it("emite la sesión y la lectura de pairing solapadas, en paralelo", async () => {
    let sessionCalls = 0;
    let pairingCalls = 0;
    let resolveSession;
    let resolvePairing;
    const sessionGate = new Promise((resolve) => {
      resolveSession = resolve;
    });
    const pairingGate = new Promise((resolve) => {
      resolvePairing = resolve;
    });

    const pending = send(successClient(), {
      ensureSession: () => {
        sessionCalls += 1;
        return sessionGate;
      },
      readPairing: () => {
        pairingCalls += 1;
        return pairingGate;
      },
    });

    // Ambas consultas deben estar en vuelo a la vez. Si la sesión se esperara
    // primero, el pairing seguiría en 0 llamadas en este punto.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sessionCalls).toBe(1);
    expect(pairingCalls).toBe(1);

    resolveSession({ session: { user: { id: "auth-1" } }, error: null });
    resolvePairing({ data: pairingRow("auth-1"), error: null });

    const result = await pending;
    expect(result).toMatchObject({ ok: true, status: "sent" });
  });

  it("si el pairing sale vacío con el token viejo, lo reintenta una vez con la sesión ya segura y el envío procede", async () => {
    const reads = [];
    let attempt = 0;
    const result = await send(successClient(), {
      readPairing: async () => {
        attempt += 1;
        reads.push(attempt);
        return attempt === 1
          ? { data: null, error: null }
          : { data: pairingRow("auth-1"), error: null };
      },
    });

    expect(result).toMatchObject({ ok: true, status: "sent" });
    expect(reads).toHaveLength(2);
  });

  it("reintenta también cuando la lectura del pairing falla con el token viejo", async () => {
    const reads = [];
    let attempt = 0;
    const result = await send(successClient(), {
      readPairing: async () => {
        attempt += 1;
        reads.push(attempt);
        return attempt === 1
          ? { data: null, error: new Error("JWT expired") }
          : { data: pairingRow("auth-1"), error: null };
      },
    });

    expect(result).toMatchObject({ ok: true, status: "sent" });
    expect(reads).toHaveLength(2);
  });

  it("declara unauthorized sin reintento infinito cuando no hay vínculo", async () => {
    const noCreateClient = {
      rpc() {
        throw new Error("no debe intentar crear el comando");
      },
    };

    // a) La fila existe pero el actor no está en ningún slot: conclusión
    //    definitiva, sin reintento.
    let reads = 0;
    const resultA = await send(noCreateClient, {
      readPairing: async () => {
        reads += 1;
        return { data: pairingRow("otro-auth"), error: null };
      },
    });
    expect(resultA).toMatchObject({ ok: false, status: "unauthorized" });
    expect(reads).toBe(1);

    // b) Sin fila: el reintento con la sesión segura tampoco la encuentra y se
    //    rinde tras exactamente dos lecturas.
    reads = 0;
    const resultB = await send(noCreateClient, {
      readPairing: async () => {
        reads += 1;
        return { data: null, error: null };
      },
    });
    expect(resultB).toMatchObject({ ok: false, status: "unauthorized" });
    expect(reads).toBe(2);
  });
});

describe("awaitSupervisorCommandAck — degradación del canal a polling (Fase 3)", () => {
  const terminalRow = (status = "applied") => ({
    command_id: "command-1234",
    status,
    ack_payload: { stockAfter: 5 },
    error_message: null,
  });

  // Cliente falso con canal Realtime controlable y lecturas de ACK scriptadas.
  const fakeClient = (readImpl) => {
    const state = {
      channels: 0,
      removed: 0,
      reads: 0,
      subscribeCb: null,
      handler: null,
    };
    const client = {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            state.reads += 1;
            return readImpl(state.reads);
          },
        };
      },
      channel() {
        state.channels += 1;
        const ch = {
          on(event, filter, cb) {
            state.handler = cb;
            return ch;
          },
          subscribe(cb) {
            state.subscribeCb = cb;
            return ch;
          },
        };
        return ch;
      },
      removeChannel() {
        state.removed += 1;
        return Promise.resolve();
      },
    };
    return { client, state };
  };

  it("ante CHANNEL_ERROR degrada a lecturas y resuelve con el ACK del servidor, no 'failed'", async () => {
    const { client, state } = fakeClient((read) =>
      read === 1
        ? { data: null, error: null }
        : { data: terminalRow("applied"), error: null },
    );

    const pending = awaitSupervisorCommandAck("command-1234", 300, {
      client,
      getPollDelayMs: () => 5,
    });
    state.subscribeCb("CHANNEL_ERROR");

    const result = await pending;
    expect(result).toMatchObject({
      ok: true,
      status: "applied",
      commandId: "command-1234",
    });
    // La lectura de degradación encontró el ACK que el canal no pudo entregar.
    expect(state.reads).toBeGreaterThanOrEqual(2);
    expect(state.removed).toBe(1);
  });

  it("canal caído y sin ACK termina en timeout, jamás rejected/failed", async () => {
    const { client, state } = fakeClient(() => ({ data: null, error: null }));

    const pending = awaitSupervisorCommandAck("command-1234", 60, {
      client,
      getPollDelayMs: () => 5,
    });
    state.subscribeCb("CHANNEL_ERROR");

    const result = await pending;
    expect(result).toMatchObject({ ok: false, status: "timeout" });
    // Un fallo de transporte jamás es una conclusión cierta sobre la orden.
    expect(["failed", "rejected"]).not.toContain(result.status);
    expect(state.removed).toBe(1);
  });

  it("un ACK por Realtime con canal sano resuelve igual que antes, sin lecturas de degradación", async () => {
    const { client, state } = fakeClient(() => ({ data: null, error: null }));

    const pending = awaitSupervisorCommandAck("command-1234", 300, {
      client,
      getPollDelayMs: () => 5,
    });
    state.subscribeCb("SUBSCRIBED");
    state.handler({ new: terminalRow("applied_with_warnings") });

    const result = await pending;
    expect(result).toMatchObject({ ok: true, status: "applied_with_warnings" });
    // Solo la lectura anti-carrera: no hubo degradación que sondear.
    expect(state.reads).toBe(1);
    expect(state.removed).toBe(1);
  });

  it("la lectura inmediata anti-carrera conserva un ACK ya publicado", async () => {
    const { client, state } = fakeClient(() => ({
      data: terminalRow("applied"),
      error: null,
    }));

    const result = await awaitSupervisorCommandAck("command-1234", 300, {
      client,
      getPollDelayMs: () => 5,
    });
    expect(result).toMatchObject({ ok: true, status: "applied" });
    expect(state.removed).toBe(1);
  });

  it("tras resolver no quedan timers de polling vivos", async () => {
    const { client, state } = fakeClient(() => ({ data: null, error: null }));

    const pending = awaitSupervisorCommandAck("command-1234", 40, {
      client,
      getPollDelayMs: () => 25,
    });
    state.subscribeCb("CHANNEL_ERROR");
    const result = await pending;
    expect(result.status).toBe("timeout");

    const readsAtFinish = state.reads;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(state.reads).toBe(readsAtFinish);
    expect(state.removed).toBe(1);
  });
});

describe("TTL por tipo y flag de emisión extendida (Fase 5)", () => {
  const EXTENDED_TYPES = [
    "supervisor.inventory.batch.adjust",
    "supervisor.product.create",
    "supervisor.product.update",
    "supervisor.product.delete",
    "supervisor.user.create",
    "supervisor.user.pin.change",
    "supervisor.user.update",
    "supervisor.user.delete",
  ];
  const SHORT_TYPES = [
    "supervisor.rate.set",
    "supervisor.shift.close",
    "supervisor.shift.reopen",
  ];

  it("sin flag, todos los tipos emiten el TTL legado de 60 s", () => {
    // El flag permanece apagado hasta el rollout (migración aplicada + receivers
    // actualizados). Si esto falla, alguien lo encendió antes de tiempo.
    expect(SUPERVISOR_EXTENDED_TTL_ENABLED).toBe(false);
    for (const type of [...EXTENDED_TYPES, ...SHORT_TYPES]) {
      expect(getCommandTtlMs(type)).toBe(SUPERVISOR_COMMAND_TTL_MS);
      const command = buildSupervisorCommand({
        type,
        targetDeviceId: "primary-1",
        monitorDeviceId: "monitor-1",
        payload: {},
        commandId: "command-ttl-1",
        now: 10_000,
      });
      expect(command.expiresAt - command.issuedAt).toBe(
        SUPERVISOR_COMMAND_TTL_MS,
      );
    }
  });

  it("con flag, batch/producto/usuario duran 5 min y cierre/tasa siguen en 60 s", () => {
    for (const type of EXTENDED_TYPES) {
      expect(getCommandTtlMs(type, true)).toBe(5 * 60_000);
    }
    for (const type of SHORT_TYPES) {
      expect(getCommandTtlMs(type, true)).toBe(SUPERVISOR_COMMAND_TTL_MS);
    }
    const batch = buildSupervisorCommand({
      type: "supervisor.inventory.batch.adjust",
      targetDeviceId: "primary-1",
      monitorDeviceId: "monitor-1",
      payload: {},
      commandId: "command-ttl-2",
      now: 10_000,
      extendedTtl: true,
    });
    expect(batch.expiresAt - batch.issuedAt).toBe(5 * 60_000);
    const shift = buildSupervisorCommand({
      type: "supervisor.shift.close",
      targetDeviceId: "primary-1",
      monitorDeviceId: "monitor-1",
      payload: {},
      commandId: "command-ttl-3",
      now: 10_000,
      extendedTtl: true,
    });
    expect(shift.expiresAt - shift.issuedAt).toBe(SUPERVISOR_COMMAND_TTL_MS);
  });

  it("el validador acepta la duración extendida y sigue rechazando excesos y vencidos", () => {
    const ctx = { targetDeviceId: "primary-1", monitorDeviceId: "monitor-1", now: 2_000 };
    // Duración extendida (5 min) en un tipo de catálogo: válido para el receiver.
    expect(
      validateSupervisorCommand(baseCommand({ expiresAt: 1_000 + 5 * 60_000 }), ctx).valid,
    ).toBe(true);
    // Por encima de la cota de seguridad de 10 min: jamás válido.
    expect(
      validateSupervisorCommand(baseCommand({ expiresAt: 1_000 + 11 * 60_000 }), ctx).valid,
    ).toBe(false);
    // Sensible al tiempo: 99 s sigue excediendo su tope de 60 s.
    expect(
      validateSupervisorCommand(
        baseCommand({
          type: "supervisor.shift.close",
          payload: { shiftId: "s1", cierreId: "c1" },
          expiresAt: 100_000,
        }),
        ctx,
      ).valid,
    ).toBe(false);
    // Vencidos siguen rechazándose igual.
    expect(
      validateSupervisorCommand(baseCommand({ expiresAt: 50_000 }), {
        ...ctx,
        now: 60_000,
      }).valid,
    ).toBe(false);
  });

  it("los datos legacy con duración de 60 s siguen aceptándose", () => {
    const ctx = { targetDeviceId: "primary-1", monitorDeviceId: "monitor-1", now: 2_000 };
    expect(
      validateSupervisorCommand(baseCommand({ expiresAt: 61_000 }), ctx).valid,
    ).toBe(true);
    expect(
      validateSupervisorCommand(
        baseCommand({
          type: "supervisor.shift.close",
          payload: { shiftId: "s1", cierreId: "c1" },
          expiresAt: 61_000,
        }),
        ctx,
      ).valid,
    ).toBe(true);
  });
});
