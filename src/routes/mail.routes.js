import { Router } from "express";
import pool from "../config/database.js";
import authenticateMachineUser from "../middleware/authenticateMachineUser.js";

const router = Router();

router.use(authenticateMachineUser);

const MAX_PAGE_SIZE = 50;

function getPagination(query) {
  const rawLimit = Number.parseInt(query.limit, 10);
  const rawOffset = Number.parseInt(query.offset, 10);

  return {
    limit: Number.isInteger(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), MAX_PAGE_SIZE)
      : 20,
    offset: Number.isInteger(rawOffset)
      ? Math.max(rawOffset, 0)
      : 0,
  };
}

function handleMailError(res, error, operation) {
  console.error(`MACHINE MAIL ${operation} ERROR:`, error.message);

  return res.status(500).json({
    status: "ERROR",
    message: "No se pudo completar la operación de correo interno.",
  });
}

// =========================================================
// 1. BUSCAR DESTINATARIOS ACTIVOS
// GET /api/mail/recipients?q=operador
// =========================================================

router.get("/recipients", async (req, res) => {
  try {
    const search = String(req.query.q || "").trim();

    if (search.length < 2) {
      return res.json({
        status: "OK",
        recipients: [],
      });
    }

    const result = await pool.query(
      `
      SELECT
        id,
        employee_id,
        email
      FROM public.users
      WHERE status = 'active'
        AND id <> $1
        AND (
          employee_id ILIKE $2
          OR email ILIKE $2
        )
      ORDER BY employee_id ASC
      LIMIT 20
      `,
      [req.user.id, `%${search}%`]
    );

    return res.json({
      status: "OK",
      recipients: result.rows,
    });
  } catch (error) {
    return handleMailError(res, error, "RECIPIENT SEARCH");
  }
});

// =========================================================
// 2. BANDEJA DE ENTRADA
// GET /api/mail/inbox?limit=20&offset=0
// =========================================================

router.get("/inbox", async (req, res) => {
  try {
    const { limit, offset } = getPagination(req.query);

    const result = await pool.query(
      `
      SELECT
        m.id,
        m.subject,
        m.body,
        m.created_at,
        m.sender_user_id,
        sender.employee_id AS sender_employee_id,
        sender.email AS sender_email,
        r.id AS recipient_record_id,
        r.read_at,
        (r.read_at IS NULL) AS is_unread
      FROM public.machine_mail_recipients r
      INNER JOIN public.machine_mail_messages m
        ON m.id = r.message_id
      INNER JOIN public.users sender
        ON sender.id = m.sender_user_id
      WHERE r.recipient_user_id = $1
        AND r.deleted_at IS NULL
      ORDER BY m.created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [req.user.id, limit, offset]
    );

    const unreadResult = await pool.query(
      `
      SELECT COUNT(*)::int AS unread_count
      FROM public.machine_mail_recipients
      WHERE recipient_user_id = $1
        AND read_at IS NULL
        AND deleted_at IS NULL
      `,
      [req.user.id]
    );

    return res.json({
      status: "OK",
      messages: result.rows,
      unreadCount: unreadResult.rows[0].unread_count,
      pagination: { limit, offset },
    });
  } catch (error) {
    return handleMailError(res, error, "INBOX");
  }
});

// =========================================================
// 3. BANDEJA DE ENVIADOS
// GET /api/mail/sent?limit=20&offset=0
// =========================================================

router.get("/sent", async (req, res) => {
  try {
    const { limit, offset } = getPagination(req.query);

    const result = await pool.query(
      `
      SELECT
        m.id,
        m.subject,
        m.body,
        m.created_at,
        COALESCE(
          json_agg(
            json_build_object(
              'recipientRecordId', r.id,
              'userId', recipient.id,
              'employeeId', recipient.employee_id,
              'email', recipient.email,
              'readAt', r.read_at
            )
          ) FILTER (WHERE r.id IS NOT NULL),
          '[]'::json
        ) AS recipients
      FROM public.machine_mail_messages m
      LEFT JOIN public.machine_mail_recipients r
        ON r.message_id = m.id
      LEFT JOIN public.users recipient
        ON recipient.id = r.recipient_user_id
      WHERE m.sender_user_id = $1
      GROUP BY m.id
      ORDER BY m.created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [req.user.id, limit, offset]
    );

    return res.json({
      status: "OK",
      messages: result.rows,
      pagination: { limit, offset },
    });
  } catch (error) {
    return handleMailError(res, error, "SENT");
  }
});

// =========================================================
// 4. REDACTAR Y ENVIAR UN MENSAJE INTERNO
// POST /api/mail/send
//
// Body:
// {
//   "recipient": "OPERATOR-001",
//   "subject": "Asunto",
//   "body": "Contenido del mensaje"
// }
//
// recipient puede ser employee_id o email interno.
// =========================================================

router.post("/send", async (req, res) => {
  const recipientInput =
    typeof req.body?.recipient === "string"
      ? req.body.recipient.trim()
      : "";

  const subject =
    typeof req.body?.subject === "string"
      ? req.body.subject.trim()
      : "";

  const body =
    typeof req.body?.body === "string"
      ? req.body.body.trim()
      : "";

  if (!recipientInput || !subject || !body) {
    return res.status(400).json({
      status: "ERROR",
      message: "Destinatario, asunto y contenido son obligatorios.",
    });
  }

  if (subject.length > 200) {
    return res.status(400).json({
      status: "ERROR",
      message: "El asunto no puede superar los 200 caracteres.",
    });
  }

  if (body.length > 100000) {
    return res.status(400).json({
      status: "ERROR",
      message: "El mensaje supera el límite permitido.",
    });
  }

  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const recipientResult = await client.query(
      `
      SELECT id, employee_id, email
      FROM public.users
      WHERE status = 'active'
        AND id <> $1
        AND (
          LOWER(employee_id) = LOWER($2)
          OR LOWER(email) = LOWER($2)
        )
      LIMIT 1
      `,
      [req.user.id, recipientInput]
    );

    if (recipientResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        status: "ERROR",
        message: "No se encontró un destinatario activo con ese identificador.",
      });
    }

    const recipient = recipientResult.rows[0];

    const messageResult = await client.query(
      `
      INSERT INTO public.machine_mail_messages (
        sender_user_id,
        subject,
        body
      )
      VALUES ($1, $2, $3)
      RETURNING id, subject, body, created_at
      `,
      [req.user.id, subject, body]
    );

    const message = messageResult.rows[0];

    await client.query(
      `
      INSERT INTO public.machine_mail_recipients (
        message_id,
        recipient_user_id
      )
      VALUES ($1, $2)
      `,
      [message.id, recipient.id]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      status: "OK",
      message: "Mensaje interno enviado y guardado.",
      mail: {
        ...message,
        recipient: {
          employeeId: recipient.employee_id,
          email: recipient.email,
        },
      },
    });
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }

    return handleMailError(res, error, "SEND");
  } finally {
    client?.release();
  }
});

// =========================================================
// 5. MARCAR UN MENSAJE DE ENTRADA COMO LEÍDO
// PATCH /api/mail/inbox/:messageId/read
// =========================================================

router.patch("/inbox/:messageId/read", async (req, res) => {
  try {
    const result = await pool.query(
      `
      UPDATE public.machine_mail_recipients
      SET read_at = COALESCE(read_at, now())
      WHERE message_id = $1
        AND recipient_user_id = $2
        AND deleted_at IS NULL
      RETURNING id, message_id, read_at
      `,
      [req.params.messageId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: "ERROR",
        message: "El mensaje no existe en tu bandeja de entrada.",
      });
    }

    return res.json({
      status: "OK",
      message: "Mensaje marcado como leído.",
      mail: result.rows[0],
    });
  } catch (error) {
    return handleMailError(res, error, "MARK READ");
  }
});

// =========================================================
// 6. OCULTAR UN MENSAJE DE LA BANDEJA PROPIA
// DELETE /api/mail/inbox/:messageId
// No borra el mensaje de otros destinatarios ni del remitente.
// =========================================================

router.delete("/inbox/:messageId", async (req, res) => {
  try {
    const result = await pool.query(
      `
      UPDATE public.machine_mail_recipients
      SET deleted_at = now()
      WHERE message_id = $1
        AND recipient_user_id = $2
        AND deleted_at IS NULL
      RETURNING id
      `,
      [req.params.messageId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: "ERROR",
        message: "El mensaje no existe en tu bandeja de entrada.",
      });
    }

    return res.json({
      status: "OK",
      message: "Mensaje ocultado de tu bandeja de entrada.",
    });
  } catch (error) {
    return handleMailError(res, error, "DELETE INBOX MESSAGE");
  }
});

export default router;