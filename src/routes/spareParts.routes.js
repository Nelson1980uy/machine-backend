
import express from "express";
import { randomUUID } from "node:crypto";
import pool from "../config/database.js";
import authenticateMachineUser from "../middleware/authenticateMachineUser.js";

const router = express.Router();

router.use(authenticateMachineUser);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PRICE_SOURCES = new Set([
  "SUPPLIER_QUOTE",
  "PURCHASE",
  "MANUFACTURER",
  "MANUAL",
  "UNCONFIRMED",
]);

const CURRENCIES = new Set(["UYU", "USD", "EUR", "ARS", "BRL"]);

function validUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validText(value, max = 500) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= max
  );
}

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

async function transaction(callback) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function requireInventoryManager(client, userId) {
  const result = await client.query(
    `SELECT
       EXISTS (
         SELECT 1
         FROM public.spare_part_admins
         WHERE user_id = $1
       ) AS is_admin,
       EXISTS (
         SELECT 1
         FROM public.spare_part_managers
         WHERE user_id = $1
           AND is_active = TRUE
       ) AS is_manager`,
    [userId]
  );

  if (!result.rows[0]?.is_admin && !result.rows[0]?.is_manager) {
    fail("No tienes permisos para administrar el inventario.", 403);
  }
}

async function requireAdmin(client, userId) {
  const result = await client.query(
    `SELECT 1
     FROM public.spare_part_admins
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );

  if (!result.rowCount) {
    fail("Esta operación requiere permisos de administrador.", 403);
  }
}

async function audit(
  client,
  {
    actorUserId,
    action,
    entityType,
    entityId = null,
    beforeData = null,
    afterData = null,
    details = {},
  }
) {
  await client.query(
    `INSERT INTO public.spare_part_audit_log (
       actor_user_id,
       action,
       entity_type,
       entity_id,
       before_data,
       after_data,
       details
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)`,
    [
      actorUserId,
      action,
      entityType,
      entityId,
      beforeData === null ? null : JSON.stringify(beforeData),
      afterData === null ? null : JSON.stringify(afterData),
      JSON.stringify(details),
    ]
  );
}

async function notifyUser(
  client,
  { userId, type, title, message, requestId, payload = {} }
) {
  await client.query(
    `INSERT INTO public.spare_part_notifications (
       user_id,
       notification_type,
       title,
       message,
       related_request_id,
       payload
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      userId,
      type,
      title,
      message,
      requestId,
      JSON.stringify(payload),
    ]
  );
}

function respondError(res, error) {
  if (error.status) {
    return res.status(error.status).json({
      status: "ERROR",
      message: error.message,
    });
  }

  if (error.code === "23505") {
    return res.status(409).json({
      status: "ERROR",
      message: "El código o registro ya existe.",
    });
  }

  if (error.code === "23503" || error.code === "23514") {
    return res.status(409).json({
      status: "ERROR",
      message: "La operación no cumple las reglas del inventario.",
    });
  }

  console.error("SPARE PARTS API ERROR:", error);
  return res.status(500).json({
    status: "ERROR",
    message: "No se pudo completar la operación de repuestos.",
  });
}


 // ======================================================
// CATÁLOGO: operadores autenticados pueden consultar.
// GET /api/spare-parts/catalog
// ======================================================

router.get("/catalog", async (req, res) => {
  try {
    const search =
      typeof req.query.search === "string"
        ? req.query.search.trim().slice(0, 100)
        : "";

    const machine =
      typeof req.query.machine === "string"
        ? req.query.machine.trim().slice(0, 100)
        : "";

    const category =
      typeof req.query.category === "string"
        ? req.query.category.trim().slice(0, 100)
        : "";

    const limit = Math.min(
      Math.max(Number.parseInt(req.query.limit, 10) || 50, 1),
      100
    );

    const result = await pool.query(
      `SELECT
         p.*,
         COALESCE(stock.total_on_hand, 0) AS total_on_hand,
         COALESCE(stock.total_reserved, 0) AS total_reserved,
         COALESCE(stock.total_available, 0) AS total_available,
         COALESCE(stock.total_minimum_stock, 0) AS total_minimum_stock,
         CASE
           WHEN COALESCE(stock.total_available, 0) <= 0
             THEN 'OUT_OF_STOCK'
           WHEN COALESCE(stock.total_available, 0)
                <= COALESCE(stock.total_minimum_stock, 0)
             THEN 'LOW_STOCK'
           ELSE 'IN_STOCK'
         END AS stock_status
       FROM public.spare_parts p
       LEFT JOIN (
         SELECT
           part_id,
           SUM(quantity_on_hand)::integer AS total_on_hand,
           SUM(quantity_reserved)::integer AS total_reserved,
           SUM(
             quantity_on_hand - quantity_reserved
           )::integer AS total_available,
           SUM(minimum_stock)::integer AS total_minimum_stock
         FROM public.spare_part_stock
         GROUP BY part_id
       ) stock ON stock.part_id = p.id
       WHERE p.is_active = TRUE
         AND (
           $1 = ''
           OR p.internal_code ILIKE '%' || $1 || '%'
           OR p.name ILIKE '%' || $1 || '%'
           OR p.description ILIKE '%' || $1 || '%'
           OR COALESCE(p.manufacturer, '') ILIKE '%' || $1 || '%'
           OR COALESCE(p.manufacturer_reference, '') ILIKE '%' || $1 || '%'
         )
         AND (
           $2 = ''
           OR $2 = ANY(p.compatible_machines)
         )
         AND (
           $3 = ''
           OR p.category = $3
         )
       ORDER BY p.name ASC, p.internal_code ASC
       LIMIT $4`,
      [search, machine, category, limit]
    );

    return res.json({
      status: "OK",
      total: result.rowCount,
      parts: result.rows,
    });
  } catch (error) {
    return respondError(res, error);
  }
});


// ======================================================
// UBICACIONES
// GET /api/spare-parts/locations
// POST /api/spare-parts/locations
// ======================================================

router.get("/locations", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, code, name, description, is_active, created_at
       FROM public.spare_part_locations
       WHERE is_active = TRUE
       ORDER BY name ASC`
    );

    return res.json({
      status: "OK",
      locations: result.rows,
    });
  } catch (error) {
    return respondError(res, error);
  }
});

router.post("/locations", async (req, res) => {
  const { code, name, description = null } = req.body ?? {};

  if (
    !validText(code, 50) ||
    !validText(name, 150) ||
    (description !== null &&
      description !== undefined &&
      (typeof description !== "string" || description.length > 1000))
  ) {
    return res.status(400).json({
      status: "ERROR",
      message: "Código, nombre o descripción de ubicación no válidos.",
    });
  }

  try {
    const location = await transaction(async (client) => {
      await requireInventoryManager(client, req.user.id);

      const result = await client.query(
        `INSERT INTO public.spare_part_locations (
           code, name, description, created_by
         )
         VALUES ($1, $2, $3, $4)
         RETURNING id, code, name, description, is_active, created_at`,
        [
          code.trim().toUpperCase(),
          name.trim(),
          description?.trim() || null,
          req.user.id,
        ]
      );

      await audit(client, {
        actorUserId: req.user.id,
        action: "SPARE_PART_LOCATION_CREATED",
        entityType: "SPARE_PART_LOCATION",
        entityId: result.rows[0].id,
        afterData: result.rows[0],
      });

      return result.rows[0];
    });

    return res.status(201).json({
      status: "OK",
      location,
    });
  } catch (error) {
    return respondError(res, error);
  }
});

// ======================================================
// ALTA DE REPUESTOS
// POST /api/spare-parts/parts
// ======================================================

router.post("/parts", async (req, res) => {
  const {
    internalCode,
    name,
    description,
    category = null,
    manufacturer = null,
    manufacturerReference = null,
    compatibleMachines = [],
    unitOfMeasure = "unidad",
  } = req.body ?? {};

  if (
    !validText(internalCode, 100) ||
    !validText(name, 200) ||
    !validText(description, 5000) ||
    !validText(unitOfMeasure, 30) ||
    !Array.isArray(compatibleMachines) ||
    compatibleMachines.length > 100 ||
    compatibleMachines.some(
      (item) => !validText(item, 100)
    )
  ) {
    return res.status(400).json({
      status: "ERROR",
      message: "Los datos del repuesto no son válidos.",
    });
  }

  for (const value of [category, manufacturer, manufacturerReference]) {
    if (
      value !== null &&
      value !== undefined &&
      (typeof value !== "string" || value.length > 200)
    ) {
      return res.status(400).json({
        status: "ERROR",
        message: "Uno de los campos opcionales supera el límite permitido.",
      });
    }
  }

  try {
    const part = await transaction(async (client) => {
      await requireInventoryManager(client, req.user.id);

      const result = await client.query(
        `INSERT INTO public.spare_parts (
           internal_code,
           name,
           description,
           category,
           manufacturer,
           manufacturer_reference,
           compatible_machines,
           unit_of_measure,
           created_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9)
         RETURNING *`,
        [
          internalCode.trim(),
          name.trim(),
          description.trim(),
          category?.trim() || null,
          manufacturer?.trim() || null,
          manufacturerReference?.trim() || null,
          compatibleMachines.map((item) => item.trim()),
          unitOfMeasure.trim(),
          req.user.id,
        ]
      );

      await audit(client, {
        actorUserId: req.user.id,
        action: "SPARE_PART_CREATED",
        entityType: "SPARE_PART",
        entityId: result.rows[0].id,
        afterData: result.rows[0],
      });

      return result.rows[0];
    });

    return res.status(201).json({
      status: "OK",
      part,
      message: "Repuesto creado. Todavía no tiene existencias registradas.",
    });
  } catch (error) {
    return respondError(res, error);
  }
});



 // ======================================================
// ACTUALIZACIÓN DE DATOS DE UN REPUESTO EXISTENTE
// PUT /api/spare-parts/parts/:id
// No crea registros ni modifica existencias.
// ======================================================

router.put("/parts/:id", async (req, res) => {
  const partId = req.params.id;

  const {
    internalCode,
    name,
    description,
    category = null,
    manufacturer = null,
    manufacturerReference = null,
    compatibleMachines = [],
    unitOfMeasure = "unidad",
  } = req.body ?? {};

  if (!validUuid(partId)) {
    return res.status(400).json({
      status: "ERROR",
      message: "Identificador de repuesto no válido.",
    });
  }

  if (
    !validText(internalCode, 100) ||
    !validText(name, 200) ||
    !validText(description, 5000) ||
    !validText(unitOfMeasure, 30) ||
    !Array.isArray(compatibleMachines) ||
    compatibleMachines.length > 100 ||
    compatibleMachines.some((item) => !validText(item, 100))
  ) {
    return res.status(400).json({
      status: "ERROR",
      message: "Los datos del repuesto no son válidos.",
    });
  }

  for (const value of [category, manufacturer, manufacturerReference]) {
    if (
      value !== null &&
      value !== undefined &&
      (typeof value !== "string" || value.length > 200)
    ) {
      return res.status(400).json({
        status: "ERROR",
        message: "Uno de los campos opcionales supera el límite permitido.",
      });
    }
  }

  try {
    const part = await transaction(async (client) => {
      await requireInventoryManager(client, req.user.id);

      const currentResult = await client.query(
        `SELECT *
         FROM public.spare_parts
         WHERE id = $1
           AND is_active = TRUE
         FOR UPDATE`,
        [partId]
      );

      if (!currentResult.rowCount) {
        fail("El repuesto no existe o está inactivo.", 404);
      }

      const before = currentResult.rows[0];

      const updatedResult = await client.query(
        `UPDATE public.spare_parts
         SET internal_code = $2,
             name = $3,
             description = $4,
             category = $5,
             manufacturer = $6,
             manufacturer_reference = $7,
             compatible_machines = $8::text[],
             unit_of_measure = $9,
             updated_by = $10,
             updated_at = NOW()
         WHERE id = $1
           AND is_active = TRUE
         RETURNING *`,
        [
          partId,
          internalCode.trim(),
          name.trim(),
          description.trim(),
          category?.trim() || null,
          manufacturer?.trim() || null,
          manufacturerReference?.trim() || null,
          compatibleMachines.map((item) => item.trim()),
          unitOfMeasure.trim(),
          req.user.id,
        ]
      );

      const updated = updatedResult.rows[0];

      await audit(client, {
        actorUserId: req.user.id,
        action: "SPARE_PART_UPDATED",
        entityType: "SPARE_PART",
        entityId: partId,
        beforeData: before,
        afterData: updated,
        details: {
          stock_modified: false,
        },
      });

      return updated;
    });

    return res.json({
      status: "OK",
      part,
      message: "Datos del repuesto actualizados correctamente. El stock no fue modificado.",
    });
  } catch (error) {
    return respondError(res, error);
  }
});


// ======================================================
// ENTRADA DE STOCK
// POST /api/spare-parts/stock/receipts
//
// Registra existencias físicas recibidas.
// No permite stock negativo ni duplicar registros de lote.
// ======================================================

router.post("/stock/receipts", async (req, res) => {
  const {
    partId,
    locationId,
    quantity,
    minimumStock = 0,
    lotNumber = null,
    serialNumber = null,
    unitPrice = null,
    currency = null,
    priceSource = "UNCONFIRMED",
    supplier = null,
    priceNotes = null,
    notes = null,
  } = req.body ?? {};

  if (
    !validUuid(partId) ||
    !validUuid(locationId) ||
    !positiveInteger(quantity) ||
    !nonNegativeInteger(minimumStock) ||
    (lotNumber !== null &&
      (typeof lotNumber !== "string" || lotNumber.length > 100)) ||
    (serialNumber !== null &&
      (typeof serialNumber !== "string" || serialNumber.length > 100)) ||
    (notes !== null &&
      (typeof notes !== "string" || notes.length > 1000))
  ) {
    return res.status(400).json({
      status: "ERROR",
      message: "Los datos de entrada de stock no son válidos.",
    });
  }

  if (unitPrice !== null) {
    const parsedPrice = Number(unitPrice);

    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      return res.status(400).json({
        status: "ERROR",
        message: "El precio debe ser un número igual o mayor que cero.",
      });
    }

    if (!CURRENCIES.has(currency)) {
      return res.status(400).json({
        status: "ERROR",
        message: "Indica una moneda admitida: UYU, USD, EUR, ARS o BRL.",
      });
    }

    if (!PRICE_SOURCES.has(priceSource)) {
      return res.status(400).json({
        status: "ERROR",
        message: "La fuente del precio no es válida.",
      });
    }
  }

  try {
    const result = await transaction(async (client) => {
      await requireInventoryManager(client, req.user.id);

      const partResult = await client.query(
        `SELECT id, internal_code, name
         FROM public.spare_parts
         WHERE id = $1
           AND is_active = TRUE
         FOR UPDATE`,
        [partId]
      );

      if (!partResult.rowCount) {
        fail("El repuesto no existe o está inactivo.", 404);
      }

      const locationResult = await client.query(
        `SELECT id, code, name
         FROM public.spare_part_locations
         WHERE id = $1
           AND is_active = TRUE
         FOR UPDATE`,
        [locationId]
      );

      if (!locationResult.rowCount) {
        fail("La ubicación no existe o está inactiva.", 404);
      }

      // Serializa operaciones sobre la misma combinación de repuesto
      // y ubicación antes de buscar o crear el registro de stock.
      await client.query(
        `SELECT pg_advisory_xact_lock(
           hashtextextended($1 || ':' || $2, 0)
         )`,
        [partId, locationId]
      );

      const existing = await client.query(
        `SELECT *
         FROM public.spare_part_stock
         WHERE part_id = $1
           AND location_id = $2
           AND COALESCE(lot_number, '') = COALESCE($3, '')
           AND COALESCE(serial_number, '') = COALESCE($4, '')
         FOR UPDATE`,
        [partId, locationId, lotNumber, serialNumber]
      );

      let stock;

      if (existing.rowCount) {
        const previous = existing.rows[0];

        stock = (
          await client.query(
            `UPDATE public.spare_part_stock
             SET quantity_on_hand = quantity_on_hand + $2,
                 minimum_stock = $3,
                 updated_by = $4,
                 updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [
              previous.id,
              quantity,
              minimumStock,
              req.user.id,
            ]
          )
        ).rows[0];
      } else {
        stock = (
          await client.query(
            `INSERT INTO public.spare_part_stock (
               part_id,
               location_id,
               lot_number,
               serial_number,
               quantity_on_hand,
               quantity_reserved,
               minimum_stock,
               updated_by
             )
             VALUES ($1, $2, $3, $4, $5, 0, $6, $7)
             RETURNING *`,
            [
              partId,
              locationId,
              lotNumber?.trim() || null,
              serialNumber?.trim() || null,
              quantity,
              minimumStock,
              req.user.id,
            ]
          )
        ).rows[0];
      }

      const beforeQuantity = stock.quantity_on_hand - quantity;

      await client.query(
        `INSERT INTO public.spare_part_movements (
           stock_id,
           movement_type,
           quantity_delta,
           quantity_before,
           quantity_after,
           reserved_before,
           reserved_after,
           actor_user_id,
           notes
         )
         VALUES ($1, 'RECEIPT', $2, $3, $4, $5, $6, $7, $8)`,
        [
          stock.id,
          quantity,
          beforeQuantity,
          stock.quantity_on_hand,
          stock.quantity_reserved,
          stock.quantity_reserved,
          req.user.id,
          notes?.trim() || "Entrada de inventario registrada",
        ]
      );

      if (unitPrice !== null) {
        await client.query(
          `INSERT INTO public.spare_part_prices (
             part_id,
             unit_price,
             currency,
             supplier,
             price_source,
             notes,
             recorded_by
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            partId,
            Number(unitPrice),
            currency,
            supplier?.trim() || null,
            priceSource,
            priceNotes?.trim() || null,
            req.user.id,
          ]
        );
      }

      await audit(client, {
        actorUserId: req.user.id,
        action: "SPARE_PART_STOCK_RECEIVED",
        entityType: "SPARE_PART_STOCK",
        entityId: stock.id,
        beforeData: {
          quantity_on_hand: beforeQuantity,
        },
        afterData: stock,
        details: {
          part_id: partId,
          location_id: locationId,
          quantity_received: quantity,
        },
      });

      return { stock, part: partResult.rows[0] };
    });

    return res.status(201).json({
      status: "OK",
      message: "Entrada de stock registrada.",
      ...result,
    });
  } catch (error) {
    return respondError(res, error);
  }
});

// ======================================================
// SOLICITUDES
// POST /api/spare-parts/requests
// GET  /api/spare-parts/requests/mine
// GET  /api/spare-parts/requests
// ======================================================

router.post("/requests", async (req, res) => {
  const {
    stockId,
    quantity,
    requestedForMachine,
    reason,
    workOrder = null,
  } = req.body ?? {};

  if (
    !validUuid(stockId) ||
    !positiveInteger(quantity) ||
    !validText(requestedForMachine, 150) ||
    !validText(reason, 2000) ||
    (workOrder !== null &&
      (typeof workOrder !== "string" || workOrder.length > 100))
  ) {
    return res.status(400).json({
      status: "ERROR",
      message: "Completa correctamente los datos de la solicitud.",
    });
  }

  try {
    const request = await transaction(async (client) => {
      const stockResult = await client.query(
        `SELECT s.id, s.quantity_on_hand, s.quantity_reserved,
                p.name, p.internal_code
         FROM public.spare_part_stock s
         JOIN public.spare_parts p ON p.id = s.part_id
         JOIN public.spare_part_locations l ON l.id = s.location_id
         WHERE s.id = $1
           AND p.is_active = TRUE
           AND l.is_active = TRUE
         FOR UPDATE OF s`,
        [stockId]
      );

      if (!stockResult.rowCount) {
        fail("No se encontró stock activo para ese repuesto.", 404);
      }

      const stock = stockResult.rows[0];
      const available =
        stock.quantity_on_hand - stock.quantity_reserved;

      if (quantity > available) {
        fail(
          `Stock disponible insuficiente. Disponible actualmente: ${available}.`,
          409
        );
      }

      // Crear la solicitud NO modifica las cantidades ni reserva stock.
      const inserted = await client.query(
        `INSERT INTO public.spare_part_requests (
           stock_id,
           requested_by,
           quantity,
           requested_for_machine,
           reason,
           work_order
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          stockId,
          req.user.id,
          quantity,
          requestedForMachine.trim(),
          reason.trim(),
          workOrder?.trim() || null,
        ]
      );

      const created = inserted.rows[0];

      await audit(client, {
        actorUserId: req.user.id,
        action: "SPARE_PART_REQUEST_CREATED",
        entityType: "SPARE_PART_REQUEST",
        entityId: created.id,
        afterData: created,
        details: {
          stock_quantity_unchanged: true,
        },
      });

      return created;
    });

    return res.status(201).json({
      status: "OK",
      message: "Solicitud registrada. El stock todavía no se ha descontado ni reservado.",
      request,
    });
  } catch (error) {
    return respondError(res, error);
  }
});

router.get("/requests/mine", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, p.internal_code, p.name AS part_name,
              l.code AS location_code, l.name AS location_name
       FROM public.spare_part_requests r
       JOIN public.spare_part_stock s ON s.id = r.stock_id
       JOIN public.spare_parts p ON p.id = s.part_id
       JOIN public.spare_part_locations l ON l.id = s.location_id
       WHERE r.requested_by = $1
       ORDER BY r.created_at DESC
       LIMIT 200`,
      [req.user.id]
    );

    return res.json({
      status: "OK",
      requests: result.rows,
    });
  } catch (error) {
    return respondError(res, error);
  }
});

router.get("/requests", async (req, res) => {
  try {
    await requireInventoryManager(pool, req.user.id);

    const result = await pool.query(
      `SELECT r.*, p.internal_code, p.name AS part_name,
              l.code AS location_code, l.name AS location_name,
              u.employee_id AS requester_employee_id,
              u.email AS requester_email
       FROM public.spare_part_requests r
       JOIN public.spare_part_stock s ON s.id = r.stock_id
       JOIN public.spare_parts p ON p.id = s.part_id
       JOIN public.spare_part_locations l ON l.id = s.location_id
       JOIN public.users u ON u.id = r.requested_by
       ORDER BY
         CASE r.status
           WHEN 'PENDING' THEN 0
           WHEN 'APPROVED' THEN 1
           ELSE 2
         END,
         r.created_at ASC
       LIMIT 500`
    );

    return res.json({
      status: "OK",
      requests: result.rows,
    });
  } catch (error) {
    return respondError(res, error);
  }
});

// ======================================================
// APROBAR SOLICITUD: reservar sin descontar stock físico.
// POST /api/spare-parts/requests/:requestId/approve
// ======================================================

router.post("/requests/:requestId/approve", async (req, res) => {
  const requestId = req.params.requestId;

  if (!validUuid(requestId)) {
    return res.status(400).json({
      status: "ERROR",
      message: "Identificador de solicitud no válido.",
    });
  }

  try {
    const request = await transaction(async (client) => {
      await requireInventoryManager(client, req.user.id);

      const result = await client.query(
        `SELECT *
         FROM public.spare_part_requests
         WHERE id = $1
         FOR UPDATE`,
        [requestId]
      );

      if (!result.rowCount) {
        fail("No se encontró la solicitud.", 404);
      }

      const current = result.rows[0];

      if (current.status !== "PENDING") {
        fail("Solo se pueden aprobar solicitudes pendientes.", 409);
      }

      const stockResult = await client.query(
        `SELECT *
         FROM public.spare_part_stock
         WHERE id = $1
         FOR UPDATE`,
        [current.stock_id]
      );

      if (!stockResult.rowCount) {
        fail("No se encontró el registro de stock.", 404);
      }

      const stock = stockResult.rows[0];
      const available =
        stock.quantity_on_hand - stock.quantity_reserved;

      if (current.quantity > available) {
        fail("El stock disponible ya no alcanza para esta solicitud.", 409);
      }

      const updatedStock = (
        await client.query(
          `UPDATE public.spare_part_stock
           SET quantity_reserved = quantity_reserved + $2,
               updated_by = $3,
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [stock.id, current.quantity, req.user.id]
        )
      ).rows[0];

      const updatedRequest = (
        await client.query(
          `UPDATE public.spare_part_requests
           SET status = 'APPROVED',
               reviewed_by = $2,
               reviewed_at = NOW(),
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [requestId, req.user.id]
        )
      ).rows[0];

      await client.query(
        `INSERT INTO public.spare_part_movements (
           stock_id, request_id, movement_type, quantity_delta,
           quantity_before, quantity_after, reserved_before,
           reserved_after, actor_user_id, notes
         )
         VALUES ($1, $2, 'RESERVATION', 0, $3, $3, $4, $5, $6, $7)`,
        [
          stock.id,
          requestId,
          stock.quantity_on_hand,
          stock.quantity_reserved,
          updatedStock.quantity_reserved,
          req.user.id,
          "Reserva de stock por solicitud aprobada",
        ]
      );

      await notifyUser(client, {
        userId: current.requested_by,
        type: "REQUEST_APPROVED",
        title: "Solicitud aprobada",
        message: "Tu solicitud fue aprobada. La entrega todavía está pendiente.",
        requestId,
      });

      await audit(client, {
        actorUserId: req.user.id,
        action: "SPARE_PART_REQUEST_APPROVED",
        entityType: "SPARE_PART_REQUEST",
        entityId: requestId,
        beforeData: current,
        afterData: updatedRequest,
      });

      return updatedRequest;
    });

    return res.json({
      status: "OK",
      message: "Solicitud aprobada y stock reservado. Todavía no se ha descontado stock físico.",
      request,
    });
  } catch (error) {
    return respondError(res, error);
  }
});

// ======================================================
// RECHAZAR SOLICITUD PENDIENTE.
// POST /api/spare-parts/requests/:requestId/reject
// ======================================================

router.post("/requests/:requestId/reject", async (req, res) => {
  const requestId = req.params.requestId;
  const reason = req.body?.reason;

  if (!validUuid(requestId) || !validText(reason, 1000)) {
    return res.status(400).json({
      status: "ERROR",
      message: "Indica una solicitud válida y el motivo del rechazo.",
    });
  }

  try {
    const request = await transaction(async (client) => {
      await requireInventoryManager(client, req.user.id);

      const result = await client.query(
        `SELECT *
         FROM public.spare_part_requests
         WHERE id = $1
         FOR UPDATE`,
        [requestId]
      );

      if (!result.rowCount) {
        fail("No se encontró la solicitud.", 404);
      }

      const current = result.rows[0];

      if (current.status !== "PENDING") {
        fail("Solo se pueden rechazar solicitudes pendientes.", 409);
      }

      const updated = (
        await client.query(
          `UPDATE public.spare_part_requests
           SET status = 'REJECTED',
               reviewed_by = $2,
               reviewed_at = NOW(),
               rejection_reason = $3,
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [requestId, req.user.id, reason.trim()]
        )
      ).rows[0];

      await notifyUser(client, {
        userId: current.requested_by,
        type: "REQUEST_REJECTED",
        title: "Solicitud rechazada",
        message: reason.trim(),
        requestId,
      });

      await audit(client, {
        actorUserId: req.user.id,
        action: "SPARE_PART_REQUEST_REJECTED",
        entityType: "SPARE_PART_REQUEST",
        entityId: requestId,
        beforeData: current,
        afterData: updated,
      });

      return updated;
    });

    return res.json({
      status: "OK",
      request,
    });
  } catch (error) {
    return respondError(res, error);
  }
});

// ======================================================
// ENTREGA CONFIRMADA.
// POST /api/spare-parts/requests/:requestId/deliver
//
// Descuenta existencias físicas y libera la reserva
// en una sola transacción.
// ======================================================

router.post("/requests/:requestId/deliver", async (req, res) => {
  const requestId = req.params.requestId;
  const notes = req.body?.notes ?? null;

  if (
    !validUuid(requestId) ||
    (notes !== null &&
      (typeof notes !== "string" || notes.length > 1000))
  ) {
    return res.status(400).json({
      status: "ERROR",
      message: "Los datos de entrega no son válidos.",
    });
  }

  try {
    const result = await transaction(async (client) => {
      await requireInventoryManager(client, req.user.id);

      const requestResult = await client.query(
        `SELECT *
         FROM public.spare_part_requests
         WHERE id = $1
         FOR UPDATE`,
        [requestId]
      );

      if (!requestResult.rowCount) {
        fail("No se encontró la solicitud.", 404);
      }

      const current = requestResult.rows[0];

      if (current.status !== "APPROVED") {
        fail("Solo se pueden entregar solicitudes aprobadas.", 409);
      }

      const stockResult = await client.query(
        `SELECT *
         FROM public.spare_part_stock
         WHERE id = $1
         FOR UPDATE`,
        [current.stock_id]
      );

      if (!stockResult.rowCount) {
        fail("No se encontró el registro de stock.", 404);
      }

      const stock = stockResult.rows[0];

      if (
        stock.quantity_on_hand < current.quantity ||
        stock.quantity_reserved < current.quantity
      ) {
        fail("Las existencias o reservas no coinciden con la solicitud.", 409);
      }

      const updatedStock = (
        await client.query(
          `UPDATE public.spare_part_stock
           SET quantity_on_hand = quantity_on_hand - $2,
               quantity_reserved = quantity_reserved - $2,
               updated_by = $3,
               updated_at = NOW()
           WHERE id = $1
             AND quantity_on_hand >= $2
             AND quantity_reserved >= $2
           RETURNING *`,
          [stock.id, current.quantity, req.user.id]
        )
      ).rows[0];

      if (!updatedStock) {
        fail("No se pudo actualizar el stock de forma segura.", 409);
      }

      const updatedRequest = (
        await client.query(
          `UPDATE public.spare_part_requests
           SET status = 'DELIVERED',
               delivered_by = $2,
               delivered_at = NOW(),
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [requestId, req.user.id]
        )
      ).rows[0];

      await client.query(
        `INSERT INTO public.spare_part_movements (
           stock_id, request_id, movement_type, quantity_delta,
           quantity_before, quantity_after, reserved_before,
           reserved_after, actor_user_id, notes
         )
         VALUES ($1, $2, 'DELIVERY', $3, $4, $5, $6, $7, $8, $9)`,
        [
          stock.id,
          requestId,
          -current.quantity,
          stock.quantity_on_hand,
          updatedStock.quantity_on_hand,
          stock.quantity_reserved,
          updatedStock.quantity_reserved,
          req.user.id,
          notes?.trim() || "Entrega de repuesto confirmada",
        ]
      );

      await notifyUser(client, {
        userId: current.requested_by,
        type: "REQUEST_DELIVERED",
        title: "Repuesto entregado",
        message: "La entrega de tu solicitud quedó registrada.",
        requestId,
      });

      await audit(client, {
        actorUserId: req.user.id,
        action: "SPARE_PART_REQUEST_DELIVERED",
        entityType: "SPARE_PART_REQUEST",
        entityId: requestId,
        beforeData: current,
        afterData: updatedRequest,
        details: {
          quantity_delivered: current.quantity,
          stock_before: stock.quantity_on_hand,
          stock_after: updatedStock.quantity_on_hand,
        },
      });

      return {
        request: updatedRequest,
        stock: updatedStock,
      };
    });

    return res.json({
      status: "OK",
      message: "Entrega confirmada y movimiento de inventario registrado.",
      ...result,
    });
  } catch (error) {
    return respondError(res, error);
  }
});

// ======================================================
// HISTORIAL DE MOVIMIENTOS
// GET /api/spare-parts/movements
// ======================================================

router.get("/movements", async (req, res) => {
  try {
    await requireInventoryManager(pool, req.user.id);

    const result = await pool.query(
      `SELECT m.*, p.internal_code, p.name AS part_name,
              l.code AS location_code, l.name AS location_name,
              u.employee_id AS actor_employee_id,
              u.email AS actor_email
       FROM public.spare_part_movements m
       JOIN public.spare_part_stock s ON s.id = m.stock_id
       JOIN public.spare_parts p ON p.id = s.part_id
       JOIN public.spare_part_locations l ON l.id = s.location_id
       JOIN public.users u ON u.id = m.actor_user_id
       ORDER BY m.created_at DESC
       LIMIT 500`
    );

    return res.json({
      status: "OK",
      movements: result.rows,
    });
  } catch (error) {
    return respondError(res, error);
  }
});

// ======================================================
// AUDITORÍA: solo administrador.
// GET /api/spare-parts/audit
// ======================================================

router.get("/audit", async (req, res) => {
  try {
    await requireAdmin(pool, req.user.id);

    const result = await pool.query(
      `SELECT a.*, u.employee_id AS actor_employee_id,
              u.email AS actor_email
       FROM public.spare_part_audit_log a
       LEFT JOIN public.users u ON u.id = a.actor_user_id
       WHERE a.entity_type LIKE 'SPARE_PART%'
       ORDER BY a.created_at DESC
       LIMIT 500`
    );

    return res.json({
      status: "OK",
      events: result.rows,
    });
  } catch (error) {
    return respondError(res, error);
  }
});

export default router;
