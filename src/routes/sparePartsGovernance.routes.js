
import express from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
import pool from "../config/database.js";
import authenticateMachineUser from "../middleware/authenticateMachineUser.js";
import { sendMachineEmail } from "../services/mail.service.js";
const router = express.Router();

router.use(authenticateMachineUser);

const MAX_MANAGERS = 10;
const GOVERNANCE_LOCK = 81234;
const BOOTSTRAP_LOCK = 10002;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function validReason(value) {
  return (
    typeof value === "string" &&
    value.trim().length >= 12 &&
    value.trim().length <= 1000
  );
}

function secretMatches(received, expected) {
  if (
    typeof received !== "string" ||
    typeof expected !== "string" ||
    !received ||
    !expected
  ) {
    return false;
  }

  const receivedBuffer = Buffer.from(received, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

async function inTransaction(callback) {
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

async function requireAdmin(client, userId) {
  const result = await client.query(
    `SELECT user_id
       FROM public.spare_part_admins
      WHERE user_id = $1
      LIMIT 1`,
    [userId]
  );

  if (result.rowCount === 0) {
    const error = new Error(
      "Se requiere autorización de administración de repuestos."
    );
    error.status = 403;
    throw error;
  }
}

async function requireActiveUser(client, userId) {
  if (!validUuid(userId)) {
    const error = new Error("Identificador de operador no válido.");
    error.status = 400;
    throw error;
  }

  const result = await client.query(
    `SELECT id
       FROM public.users
      WHERE id = $1
        AND status = 'active'
      LIMIT 1`,
    [userId]
  );

  if (result.rowCount === 0) {
    const error = new Error(
      "El operador no existe o su cuenta no está activa."
    );
    error.status = 404;
    throw error;
  }
}


async function writeGovernanceEvent(
  client,
  {
    roleCode,
    eventType,
    subjectUserId,
    actorUserId,
    reason,
    authorizationMethod,
    correlationId,
    details = {},
  }
) {
  const result = await client.query(
    `INSERT INTO public.spare_part_governance_events (
       event_key,
       role_code,
       event_type,
       subject_user_id,
       actor_user_id,
       authorized_by_user_id,
       reason,
       authorization_method,
       correlation_id,
       details
     )
     VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9::jsonb)
     RETURNING id, event_key, role_code, event_type,
               subject_user_id, actor_user_id,
               authorized_by_user_id, occurred_at,
               correlation_id`,
    [
      randomUUID(),
      roleCode,
      eventType,
      subjectUserId,
      actorUserId,
      reason.trim(),
      authorizationMethod,
      correlationId,
      JSON.stringify(details),
    ]
  );

  return result.rows[0];
}


async function writeAudit(
  client,
  {
    actorUserId,
    action,
    entityType,
    entityId,
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


function respondWithError(res, error) {
  // Diagnóstico detallado para la terminal del backend.
  console.error("SPARE PARTS GOVERNANCE ERROR:", {
    message: error?.message,
    code: error?.code,
    detail: error?.detail,
    hint: error?.hint,
    constraint: error?.constraint,
    table: error?.table,
    column: error?.column,
    where: error?.where,
    stack: error?.stack,
  });

  if (error?.status) {
    return res.status(error.status).json({
      status: "ERROR",
      message: error.message,
    });
  }

  if (
    ["23505", "23514", "P0001"].includes(error?.code)
  ) {
    return res.status(409).json({
      status: "ERROR",
      message:
        "La operación entra en conflicto con una regla de gobernanza o inventario.",
    });
  }

  return res.status(500).json({
    status: "ERROR",
    message: "No se pudo completar la operación administrativa.",
  });
}



function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]
  );
}

// Estado de permisos del operador autenticado.
router.get("/status", async (req, res) => {
  try {
    const result = await pool.query(
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
         ) AS is_manager,
         (
           SELECT COUNT(*)::integer
             FROM public.spare_part_managers
            WHERE is_active = TRUE
         ) AS active_managers`,
      [req.user.id]
    );

    return res.json({
  status: "OK",
  ...result.rows[0],
  current_user_id: req.user.id,
  maximum_managers: MAX_MANAGERS,
});
} catch (error) {
  return respondWithError(res, error);
}
});

// Nombramiento inicial: identidad oficial verificada en la base de datos.
router.post("/bootstrap", async (req, res) => {
  const receivedSecret = req.get("x-machine-spare-parts-bootstrap");
  const configuredSecret = process.env.SPARE_PARTS_BOOTSTRAP_SECRET;

  if (!secretMatches(receivedSecret, configuredSecret)) {
    return res.status(403).json({
      status: "ERROR",
      message: "Autorización inicial no válida.",
    });
  }

  const reason = req.body?.reason;

  if (!validReason(reason)) {
    return res.status(400).json({
      status: "ERROR",
      message:
        "Indica un motivo de autorización de al menos 12 caracteres.",
    });
  }

  try {
    await inTransaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock($1, $2)",
        [GOVERNANCE_LOCK, BOOTSTRAP_LOCK]
      );

      const existing = await client.query(
        `SELECT user_id
           FROM public.spare_part_admins
          LIMIT 1`
      );

      if (existing.rowCount > 0) {
        const error = new Error(
          "El administrador inicial ya fue designado."
        );
        error.status = 409;
        throw error;
      }

      const identity = await client.query(
        `SELECT u.id
           FROM public.users AS u
           JOIN public.user_profiles AS p ON p.user_id = u.id
          WHERE u.id = $1
            AND u.employee_id = $2
            AND LOWER(TRIM(u.email)) = $3
            AND u.status = 'active'
            AND LOWER(TRIM(p.first_name)) = $4
            AND LOWER(TRIM(p.last_name)) = $5
          LIMIT 1`,
        [
          req.user.id,
          "200011",
          "nelson.lapizaga@machine.local",
          "nelson",
          "lapizaga",
        ]
      );

      if (identity.rowCount !== 1) {
        const error = new Error(
          "La cuenta autenticada no coincide con la identidad autorizada para el nombramiento inicial."
        );
        error.status = 403;
        throw error;
      }

      const initialAdminId = identity.rows[0].id;

      await client.query(
        `INSERT INTO public.spare_part_admins (
           user_id,
           assigned_by
         )
         VALUES ($1, $1)`,
        [initialAdminId]
      );

      const correlationId = randomUUID();

      await writeGovernanceEvent(client, {
        roleCode: "SPARE_PARTS_ADMIN",
        eventType: "APPOINTED",
        subjectUserId: initialAdminId,
        actorUserId: initialAdminId,
        reason,
        authorizationMethod: "ONE_TIME_ORGANIZATIONAL_BOOTSTRAP",
        correlationId,
        details: {
          initial_appointment: true,
          employee_id: "200011",
          verified_email: "nelson.lapizaga@machine.local",
          identity_verified_in_database: true,
        },
      });

      await writeAudit(client, {
        actorUserId: initialAdminId,
        action: "INITIAL_SPARE_PARTS_ADMIN_APPOINTED",
        entityType: "SPARE_PARTS_ADMIN",
        entityId: initialAdminId,
        afterData: {
          user_id: initialAdminId,
          employee_id: "200011",
          email: "nelson.lapizaga@machine.local",
        },
        details: {
          reason: reason.trim(),
          authorization_method: "ONE_TIME_ORGANIZATIONAL_BOOTSTRAP",
          correlation_id: correlationId,
        },
      });
    });

    return res.status(201).json({
      status: "OK",
      message: "Administrador inicial designado.",
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});

// Consulta del administrador vigente. Solo para el administrador actual.
router.get("/admins", async (req, res) => {
  try {
    await inTransaction(async (client) => {
      await requireAdmin(client, req.user.id);
    });

    const result = await pool.query(
      `SELECT
         a.user_id,
         a.assigned_by,
         a.assigned_at,
         u.employee_id,
         u.email,
         p.first_name,
         p.last_name
       FROM public.spare_part_admins AS a
       JOIN public.users AS u ON u.id = a.user_id
       LEFT JOIN public.user_profiles AS p ON p.user_id = u.id
       ORDER BY a.assigned_at DESC`
    );

    return res.json({
      status: "OK",
      admins: result.rows,
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});




/**
 * Invitaciones formales para administradores de repuestos.
 * Una invitación pendiente no concede permisos.
 */
router.post("/admins/invitations", async (req, res) => {
  const { userId, reason } = req.body ?? {};

  if (!validUuid(userId) || !validReason(reason)) {
    return res.status(400).json({
      status: "ERROR",
      message: "Indica un operador válido y un motivo de al menos 12 caracteres.",
    });
  }

  try {
    const result = await inTransaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock($1, $2)",
        [GOVERNANCE_LOCK, BOOTSTRAP_LOCK]
      );

      await requireAdmin(client, req.user.id);
      await requireActiveUser(client, userId);

      if (userId === req.user.id) {
        const error = new Error("No puedes invitarte a ti mismo.");
        error.status = 400;
        throw error;
      }

      const candidateResult = await client.query(
        `SELECT id, employee_id, email
           FROM public.users
          WHERE id = $1
          LIMIT 1`,
        [userId]
      );

      if (candidateResult.rowCount !== 1) {
        const error = new Error("No se encontró el operador destinatario.");
        error.status = 404;
        throw error;
      }

      const candidate = candidateResult.rows[0];

      const existingAdmin = await client.query(
        `SELECT user_id
           FROM public.spare_part_admins
          WHERE user_id = $1
          FOR UPDATE`,
        [userId]
      );

      if (existingAdmin.rowCount > 0) {
        const error = new Error("El operador ya es administrador.");
        error.status = 409;
        throw error;
      }

      const pendingForCandidate = await client.query(
        `SELECT id
           FROM public.spare_part_admin_invitations
          WHERE user_id = $1
            AND status = 'PENDING'
          LIMIT 1`,
        [userId]
      );

      if (pendingForCandidate.rowCount > 0) {
        const error = new Error("El operador ya tiene una invitación pendiente.");
        error.status = 409;
        throw error;
      }

      const counts = await client.query(
        `SELECT
           (SELECT COUNT(*)::integer
              FROM public.spare_part_admins) AS active_count,
           (SELECT COUNT(*)::integer
              FROM public.spare_part_admin_invitations
             WHERE status = 'PENDING') AS pending_count`
      );

      const { active_count: activeCount, pending_count: pendingCount } =
        counts.rows[0];

      if (activeCount + pendingCount >= 3) {
        const error = new Error(
          "Se alcanzó el límite de tres administradores e invitaciones pendientes."
        );
        error.status = 409;
        throw error;
      }

      const correlationId = randomUUID();

      const inserted = await client.query(
        `INSERT INTO public.spare_part_admin_invitations (
           user_id, invited_by, reason
         )
         VALUES ($1, $2, $3)
         RETURNING *`,
        [userId, req.user.id, reason.trim()]
      );

      const invitation = inserted.rows[0];

      await writeGovernanceEvent(client, {
        roleCode: "SPARE_PARTS_ADMIN",
        eventType: "INVITED",
        subjectUserId: userId,
        actorUserId: req.user.id,
        reason: reason.trim(),
        authorizationMethod: "ADMIN_INVITATION_PENDING_ACCEPTANCE",
        correlationId,
        details: {
          invitation_id: invitation.id,
          permissions_activated: false,
        },
      });

      await writeAudit(client, {
        actorUserId: req.user.id,
        action: "SPARE_PARTS_ADMIN_INVITED",
        entityType: "SPARE_PARTS_ADMIN_INVITATION",
        entityId: invitation.id,
        afterData: invitation,
        details: {
          correlation_id: correlationId,
          permissions_activated: false,
        },
      });

      return { invitation, recipientEmail: candidate.email };
    });

    let emailSent = false;

    if (result.recipientEmail) {
      try {
        await sendMachineEmail({
          to: result.recipientEmail,
          subject: "MACHINE — Invitación para administrar repuestos",
          text:
            "Has recibido una invitación para ser administrador de repuestos " +
            "de MACHINE. Inicia sesión en MACHINE para revisar y responder " +
            "la invitación. La invitación no activa permisos hasta que la aceptes.",
          html:
            "<p>Has recibido una invitación para ser administrador de repuestos de MACHINE.</p>" +
            "<p>Inicia sesión en MACHINE para revisar y responder la invitación.</p>" +
            "<p><strong>La invitación no activa permisos hasta que la aceptes.</strong></p>",
        });
        emailSent = true;
      } catch (mailError) {
        console.error("No se pudo enviar la invitación administrativa:", mailError);
      }
    }

    return res.status(201).json({
      status: "OK",
      message: emailSent
        ? "Invitación administrativa creada y correo enviado."
        : "Invitación creada. El correo no pudo confirmarse; la invitación permanece pendiente.",
      invitation: result.invitation,
      emailSent,
      permissionsActivated: false,
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});


/**
 * El operador autenticado consulta exclusivamente sus invitaciones.
 */
router.get("/admins/invitations/mine", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         i.id,
         i.user_id,
         i.invited_by,
         i.reason,
         i.status,
         i.created_at,
         i.responded_at,
         i.response_reason,
         inviter.employee_id AS inviter_employee_id,
         inviter.email AS inviter_email,
         TRIM(
           CONCAT_WS(
             ' ',
             NULLIF(TRIM(p.first_name), ''),
             NULLIF(TRIM(p.last_name), '')
           )
         ) AS inviter_name,
         p.first_name AS inviter_first_name,
         p.last_name AS inviter_last_name,
         p.photo_url AS inviter_photo_url
       FROM public.spare_part_admin_invitations AS i
       JOIN public.users AS inviter
         ON inviter.id = i.invited_by
       LEFT JOIN public.user_profiles AS p
         ON p.user_id = inviter.id
       WHERE i.user_id = $1
       ORDER BY i.created_at DESC`,
      [req.user.id]
    );

    return res.json({
      status: "OK",
      invitations: result.rows,
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});





/**
 * Aceptación o rechazo explícito de una invitación administrativa.
 * Máximo: 3 administradores activos + invitaciones pendientes.
 */
router.post(
  "/admin-invitations/:invitationId/respond",
  async (req, res) => {
    const { invitationId } = req.params;
    const { decision, responseReason } = req.body ?? {};

    if (
      !validUuid(invitationId) ||
      !["ACCEPTED", "REJECTED"].includes(decision)
    ) {
      return res.status(400).json({
        status: "ERROR",
        message: "La invitación o la decisión no son válidas.",
      });
    }

    if (
      responseReason !== undefined &&
      (typeof responseReason !== "string" ||
        responseReason.trim().length > 1000)
    ) {
      return res.status(400).json({
        status: "ERROR",
        message: "El comentario no puede superar los 1000 caracteres.",
      });
    }

    try {
      const outcome = await inTransaction(async (client) => {
        await client.query(
          "SELECT pg_advisory_xact_lock($1, $2)",
          [GOVERNANCE_LOCK, BOOTSTRAP_LOCK]
        );

        await requireActiveUser(client, req.user.id);

        const invitationResult = await client.query(
          `SELECT *
             FROM public.spare_part_admin_invitations
            WHERE id = $1
              AND user_id = $2
            FOR UPDATE`,
          [invitationId, req.user.id]
        );

        if (invitationResult.rowCount !== 1) {
          const error = new Error(
            "La invitación no existe o no pertenece a tu cuenta."
          );
          error.status = 404;
          throw error;
        }

        const invitation = invitationResult.rows[0];

        if (invitation.status !== "PENDING") {
          const error = new Error(
            "La invitación ya fue respondida o cancelada."
          );
          error.status = 409;
          throw error;
        }

        const cleanResponseReason =
          typeof responseReason === "string"
            ? responseReason.trim()
            : null;

        const correlationId = randomUUID();

        // RECHAZO: no concede permisos administrativos.
        if (decision === "REJECTED") {
          const updated = await client.query(
            `UPDATE public.spare_part_admin_invitations
                SET status = 'REJECTED',
                    responded_at = clock_timestamp(),
                    response_reason = $3
              WHERE id = $1
                AND user_id = $2
                AND status = 'PENDING'
              RETURNING *`,
            [
              invitationId,
              req.user.id,
              cleanResponseReason || null,
            ]
          );

          if (updated.rowCount !== 1) {
            const error = new Error(
              "No se pudo registrar el rechazo de la invitación."
            );
            error.status = 409;
            throw error;
          }

          await writeGovernanceEvent(client, {
            roleCode: "SPARE_PARTS_ADMIN",
            eventType: "REJECTED",
            subjectUserId: req.user.id,
            actorUserId: req.user.id,
            reason: invitation.reason,
            authorizationMethod:
              "OPERATOR_REJECTED_ADMIN_INVITATION",
            correlationId,
            details: {
              invitation_id: invitationId,
              permissions_activated: false,
              response_reason: cleanResponseReason || null,
            },
          });

          await writeAudit(client, {
            actorUserId: req.user.id,
            action: "SPARE_PARTS_ADMIN_INVITATION_REJECTED",
            entityType: "SPARE_PARTS_ADMIN_INVITATION",
            entityId: invitationId,
            beforeData: invitation,
            afterData: updated.rows[0],
            details: {
              correlation_id: correlationId,
            },
          });

          return {
            decision: "REJECTED",
            invitation: updated.rows[0],
            permissionsActivated: false,
          };
        }

        // ACEPTACIÓN: el administrador que invitó debe seguir activo.
        await requireAdmin(client, invitation.invited_by);

        const candidateResult = await client.query(
          `SELECT id, employee_id, email
             FROM public.users
            WHERE id = $1
              AND status = 'active'
            FOR UPDATE`,
          [req.user.id]
        );

        if (candidateResult.rowCount !== 1) {
          const error = new Error(
            "No se pudo verificar la cuenta activa del operador."
          );
          error.status = 409;
          throw error;
        }

        const candidate = candidateResult.rows[0];

        const existingAdmin = await client.query(
          `SELECT user_id
             FROM public.spare_part_admins
            WHERE user_id = $1
            FOR UPDATE`,
          [req.user.id]
        );

        if (existingAdmin.rowCount > 0) {
          const error = new Error(
            "Tu cuenta ya es administradora."
          );
          error.status = 409;
          throw error;
        }

        // La invitación actual no cuenta como otra invitación pendiente.
        const capacity = await client.query(
          `SELECT
             (
               SELECT COUNT(*)::integer
                 FROM public.spare_part_admins
             ) AS active_count,
             (
               SELECT COUNT(*)::integer
                 FROM public.spare_part_admin_invitations
                WHERE status = 'PENDING'
                  AND id <> $1
             ) AS other_pending_count`,
          [invitationId]
        );

        const activeAdminCount = Number(
          capacity.rows[0].active_count
        );

        const otherPendingCount = Number(
          capacity.rows[0].other_pending_count
        );

        if (
          activeAdminCount >= 3 ||
          activeAdminCount + otherPendingCount >= 3
        ) {
          const error = new Error(
            "No hay una plaza administrativa disponible. " +
              "El límite es de tres administradores activos " +
              "y puestos reservados por invitaciones pendientes."
          );
          error.status = 409;
          throw error;
        }

        const inviterResult = await client.query(
          `SELECT id, employee_id
             FROM public.users
            WHERE id = $1
              AND status = 'active'
            FOR UPDATE`,
          [invitation.invited_by]
        );

        if (inviterResult.rowCount !== 1) {
          const error = new Error(
            "No se pudo verificar al administrador que invitó."
          );
          error.status = 409;
          throw error;
        }

        const inviter = inviterResult.rows[0];

        const updated = await client.query(
          `UPDATE public.spare_part_admin_invitations
              SET status = 'ACCEPTED',
                  responded_at = clock_timestamp(),
                  response_reason = $3
            WHERE id = $1
              AND user_id = $2
              AND status = 'PENDING'
            RETURNING *`,
          [
            invitationId,
            req.user.id,
            cleanResponseReason || null,
          ]
        );

        if (updated.rowCount !== 1) {
          const error = new Error(
            "No se pudo confirmar la aceptación."
          );
          error.status = 409;
          throw error;
        }

        const appointmentEvent = await writeGovernanceEvent(
          client,
          {
            roleCode: "SPARE_PARTS_ADMIN",
            eventType: "APPOINTED",
            subjectUserId: req.user.id,
            actorUserId: invitation.invited_by,
            reason: invitation.reason,
            authorizationMethod:
              "ADMIN_INVITATION_ACCEPTED_BY_OPERATOR",
            correlationId,
            details: {
              invitation_id: invitationId,
              accepted_by_user_id: req.user.id,
              appointed_by_user_id: invitation.invited_by,
              permissions_activated: true,
            },
          }
        );

        if (!appointmentEvent?.id) {
          const error = new Error(
            "No se pudo registrar el nombramiento."
          );
          error.status = 500;
          throw error;
        }

        const membership = await client.query(
          `INSERT INTO public.spare_part_admins (
             user_id,
             assigned_by
           )
           VALUES ($1, $2)
           RETURNING *`,
          [req.user.id, invitation.invited_by]
        );
const rolePeriod = {
  appointment_event_id: appointmentEvent.id,
  subject_user_id: candidate.id,
  employee_id: candidate.employee_id,
  email: candidate.email,
  role_code: "SPARE_PARTS_ADMIN",
  appointed_by_user_id: inviter.id,
  appointed_by_employee_id: inviter.employee_id,
  started_at: appointmentEvent.occurred_at,
  appointment_reason: invitation.reason,
  period_status: "ACTIVE",
  ended_at: null,
};


        await writeAudit(client, {
          actorUserId: req.user.id,
          action: "SPARE_PARTS_ADMIN_INVITATION_ACCEPTED",
          entityType: "SPARE_PARTS_ADMIN_INVITATION",
          entityId: invitationId,
          beforeData: invitation,
          afterData: {
            invitation: updated.rows[0],
            admin: membership.rows[0],
            role_period: rolePeriod,
          },
          details: {
            correlation_id: correlationId,
            appointment_event_id: appointmentEvent.id,
            permissions_activated: true,
          },
        });

        return {
          decision: "ACCEPTED",
          invitation: updated.rows[0],
          admin: membership.rows[0],
          rolePeriod: rolePeriod,
          appointmentEventId: appointmentEvent.id,
          permissionsActivated: true,
        };
      });

      // El cambio en la base ya fue confirmado.
      // Si falla el correo, no se revierte ni se duplica el nombramiento.
      let emailSent = false;

      try {
        const notificationResult = await pool.query(
          `SELECT
             inviter.email AS inviter_email,
             invitee.employee_id AS invitee_employee_id
           FROM public.users AS inviter
           JOIN public.users AS invitee
             ON invitee.id = $2
           WHERE inviter.id = $1`,
          [
            outcome.invitation.invited_by,
            req.user.id,
          ]
        );

        const notification = notificationResult.rows[0];

        if (notification?.inviter_email) {
          const accepted = outcome.decision === "ACCEPTED";
          const statusText = accepted ? "ACEPTADA" : "RECHAZADA";

          const permissionText = accepted
            ? "Los permisos administrativos están activos y el nombramiento quedó registrado."
            : "No se concedieron permisos administrativos.";

          const reason = String(
            outcome.invitation.reason || "No especificado"
          );

          const response = String(
            outcome.invitation.response_reason || "Sin comentarios"
          );

          const operatorId = String(
            notification.invitee_employee_id || req.user.id
          );

          const subject = accepted
            ? "MACHINE — Invitación administrativa aceptada"
            : "MACHINE — Invitación administrativa rechazada";

          const text = [
            "MACHINE — INDUSTRIAL CONTROL SYSTEM",
            "",
            `La invitación administrativa fue ${statusText}.`,
            "",
            `Operador: ${operatorId}`,
            `Identificador de invitación: ${invitationId}`,
            `Motivo de la invitación: ${reason}`,
            `Respuesta del operador: ${response}`,
            "",
            permissionText,
            "",
            "Notificación automática de gobernanza de MACHINE.",
          ].join("\n");

          const escapeHtml = (value) =>
            String(value).replace(/[&<>"']/g, (character) => ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            })[character]);

          await sendMachineEmail({
            to: notification.inviter_email,
            subject,
            text,
            html: `
              <div style="font-family:Arial,sans-serif;color:#17212b;line-height:1.6;max-width:640px;margin:auto">
                <div style="background:#111c2a;color:#ffffff;padding:22px 26px">
                  <h2 style="margin:0;letter-spacing:2px">MACHINE</h2>
                  <p style="margin:6px 0 0;color:#cbd5e1">INDUSTRIAL CONTROL SYSTEM</p>
                </div>
                <div style="padding:24px;border:1px solid #dbe2ea">
                  <h3>Invitación administrativa ${statusText}</h3>
                  <p><strong>Operador:</strong> ${escapeHtml(operatorId)}</p>
                  <p><strong>Identificador:</strong> ${escapeHtml(invitationId)}</p>
                  <p><strong>Motivo de la invitación:</strong> ${escapeHtml(reason)}</p>
                  <p><strong>Respuesta del operador:</strong> ${escapeHtml(response)}</p>
                  <p>${escapeHtml(permissionText)}</p>
                  <hr style="border:0;border-top:1px solid #dbe2ea;margin:24px 0" />
                  <p style="font-size:12px;color:#64748b">Notificación automática de gobernanza de MACHINE.</p>
                </div>
              </div>
            `,
          });

          emailSent = true;
        }
      } catch (mailError) {
        console.error(
          "No se pudo notificar la respuesta de la invitación administrativa:",
          mailError
        );
      }


      return res.json({
        status: "OK",
        message:
          outcome.decision === "ACCEPTED"
            ? "Invitación aceptada. Tu cargo administrativo está activo y quedó registrado."
            : "Invitación rechazada. No se concedieron permisos.",
        ...outcome,
        emailSent,
      });
    } catch (error) {
      return respondWithError(res, error);
    }

  }
);



/**
 * Transferencia directa de administración deshabilitada.
 *
 * MACHINE incorporará administradores mediante invitación,
 * aceptación explícita y registro de gobernanza.
 *
 * No modifica cargos ni elimina registros históricos.
 */
router.post("/admins/transfer", async (req, res) => {
  return res.status(409).json({
    status: "ERROR",
    code: "ADMIN_TRANSFER_REQUIRES_GOVERNANCE",
    message:
      "La transferencia administrativa directa está deshabilitada. " +
      "La incorporación y sucesión de administradores deberá realizarse " +
      "mediante el procedimiento formal de gobernanza de MACHINE.",
  });
});


// Bloquear la revocación independiente del administrador.
router.delete("/admins/:userId", (req, res) => {
  return res.status(409).json({
    status: "ERROR",
    message:
      "La revocación independiente está deshabilitada. Usa POST /api/spare-parts/governance/admins/transfer.",
  });
});


/**
 * Renuncia voluntaria del administrador de repuestos.
 * El operador autenticado solo puede abandonar su propio puesto.
 * Conserva el historial y registra el evento y la auditoría.
 */
router.post("/admins/leave", async (req, res) => {
  const subjectUserId = req.user.id;

  try {
    const result = await inTransaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock($1, $2)",
        [GOVERNANCE_LOCK, BOOTSTRAP_LOCK]
      );

      // Verificar que el usuario autenticado sea administrador activo.
      await requireAdmin(client, subjectUserId);

      const membershipResult = await client.query(
        `SELECT *
           FROM public.spare_part_admins
          WHERE user_id = $1
          FOR UPDATE`,
        [subjectUserId]
      );

      if (membershipResult.rowCount !== 1) {
        const error = new Error(
          "No tienes un puesto administrativo activo que puedas abandonar."
        );
        error.status = 409;
        throw error;
      }

      const membership = membershipResult.rows[0];


      // Localizar el período histórico vigente.
      // La tabla es una vista derivada de eventos; no se bloquea directamente.
      const periodResult = await client.query(
        `SELECT *
           FROM public.spare_part_role_periods
          WHERE subject_user_id = $1
            AND role_code = 'SPARE_PARTS_ADMIN'
            AND period_status = 'ACTIVE'
            AND ended_at IS NULL
          LIMIT 2`,
        [subjectUserId]
      );

      if (periodResult.rowCount !== 1) {
        const error = new Error(
          "No se encontró un único período administrativo activo. " +
          "No se modificó el puesto; se requiere revisar el historial."
        );
        error.status = 409;
        throw error;
      }

      const period = periodResult.rows[0];
      const reason = "Renuncia voluntaria al puesto administrativo.";
      const correlationId = randomUUID();

      // Registrar la renuncia como REVOKED para cerrar el período en la vista.
      const resignationEvent = await writeGovernanceEvent(client, {
        roleCode: "SPARE_PARTS_ADMIN",
        eventType: "REVOKED",
        subjectUserId,
        actorUserId: subjectUserId,
        reason,
        authorizationMethod: "VOLUNTARY_SELF_RESIGNATION",
        correlationId,
        details: {
          previous_membership: membership,
          previous_role_period: period,
          voluntary_resignation: true,
        },
      });

      if (!resignationEvent?.id) {
        const error = new Error(
          "No se pudo registrar el evento de renuncia."
        );
        error.status = 500;
        throw error;
      }

      // Representación del período cerrado para auditoría y respuesta.
      // El cierre real lo determina la vista a partir de los eventos.
      const closedPeriod = {
        ...period,
        ended_at: resignationEvent.occurred_at,
        revocation_event_id: resignationEvent.id,
        revoked_by_user_id: subjectUserId,
        revoked_by_employee_id: period.employee_id,
        revocation_reason: reason,
        period_status: "ENDED",
      };

      // Eliminar únicamente la membresía activa.
      // El historial de eventos se conserva.
      const removedMembership = await client.query(
        `DELETE FROM public.spare_part_admins
          WHERE user_id = $1
          RETURNING *`,
        [subjectUserId]
      );

      if (removedMembership.rowCount !== 1) {
        const error = new Error(
          "No se pudo liberar el puesto administrativo."
        );
        error.status = 409;
        throw error;
      }

      await writeAudit(client, {
        actorUserId: subjectUserId,
        action: "SPARE_PARTS_ADMIN_VOLUNTARILY_RESIGNED",
        entityType: "SPARE_PARTS_ADMIN",
        entityId: subjectUserId,
        beforeData: {
          membership,
          role_period: period,
        },
        afterData: {
          membership_active: false,
          role_period: closedPeriod,
          resignation_event_id: resignationEvent.id,
        },
        details: {
          reason,
          correlation_id: correlationId,
          voluntary: true,
        },
      });

      return {
        event: resignationEvent,
        period: closedPeriod,
      };
    });


    return res.status(200).json({
      status: "OK",
      code: "SPARE_PARTS_ADMIN_RESIGNED",
      message:
        "Has abandonado voluntariamente el puesto administrativo. " +
        "Tu historial se ha conservado.",
      eventId: result.event.id,
      rolePeriod: result.period,
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});


// Listado de gestores. Solo administradores.
router.get("/managers", async (req, res) => {
  try {
    await inTransaction(async (client) => {
      await requireAdmin(client, req.user.id);
    });

    const result = await pool.query(
      `SELECT
         m.user_id,
         m.granted_by,
         m.granted_at,
         m.is_active,
         m.revoked_by,
         m.revoked_at,
         u.employee_id,
         u.email,
         p.first_name,
         p.last_name
       FROM public.spare_part_managers AS m
       JOIN public.users AS u ON u.id = m.user_id
       LEFT JOIN public.user_profiles AS p ON p.user_id = u.id
       ORDER BY m.granted_at DESC`
    );

    return res.json({
      status: "OK",
      managers: result.rows,
      maximum_active_managers: MAX_MANAGERS,
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});




/**
 * Crear una invitación pendiente para gestionar repuestos.
 *
 * La invitación no activa permisos.
 * Los permisos se activan únicamente después de la aceptación.
 * El correo se envía después de confirmar la transacción.
 */
router.post("/managers", async (req, res) => {
  const { userId, reason } = req.body ?? {};

  if (!validUuid(userId) || !validReason(reason)) {
    return res.status(400).json({
      status: "ERROR",
      message:
        "Indica un operador válido y un motivo de al menos 12 caracteres.",
    });
  }

  try {
    const result = await inTransaction(async (client) => {
      // Serializar las operaciones de gobernanza.
      await client.query(
        "SELECT pg_advisory_xact_lock($1, $2)",
        [GOVERNANCE_LOCK, BOOTSTRAP_LOCK]
      );

      // Solo un administrador activo puede invitar gestores.
      await requireAdmin(client, req.user.id);
      await requireActiveUser(client, userId);

      if (userId === req.user.id) {
        const error = new Error(
          "No puedes designarte a ti mismo como gestor."
        );

        error.status = 400;
        throw error;
      }

      // Obtener el correo del operador destinatario.
      const userResult = await client.query(
        `SELECT id, email
           FROM public.users
          WHERE id = $1
          LIMIT 1`,
        [userId]
      );

      if (userResult.rowCount !== 1) {
        const error = new Error(
          "No se encontró el operador destinatario."
        );

        error.status = 404;
        throw error;
      }

      const recipientEmail = userResult.rows[0].email;

      // Comprobar si ya tiene un cargo activo.
      const managerResult = await client.query(
        `SELECT user_id, is_active
           FROM public.spare_part_managers
          WHERE user_id = $1
          FOR UPDATE`,
        [userId]
      );

      if (managerResult.rows[0]?.is_active === true) {
        const error = new Error(
          "El operador ya es gestor de repuestos."
        );

        error.status = 409;
        throw error;
      }

      // Evitar invitaciones pendientes duplicadas.
      const pendingResult = await client.query(
        `SELECT id
           FROM public.spare_part_manager_invitations
          WHERE user_id = $1
            AND status = 'PENDING'
          LIMIT 1`,
        [userId]
      );

      if (pendingResult.rowCount > 0) {
        const error = new Error(
          "El operador ya tiene una invitación pendiente."
        );

        error.status = 409;
        throw error;
      }

      // Comprobar capacidad de gestores e invitaciones.
      const capacityResult = await client.query(
        `SELECT COUNT(*)::integer AS active_count
           FROM public.spare_part_managers
          WHERE is_active = TRUE`
      );

      const pendingCountResult = await client.query(
        `SELECT COUNT(*)::integer AS pending_count
           FROM public.spare_part_manager_invitations
          WHERE status = 'PENDING'`
      );

      const activeCount =
        capacityResult.rows[0].active_count;

      const pendingCount =
        pendingCountResult.rows[0].pending_count;

      if (activeCount + pendingCount >= MAX_MANAGERS) {
        const error = new Error(
          "Se alcanzó el límite de gestores e invitaciones pendientes."
        );

        error.status = 409;
        throw error;
      }

      // Crear la invitación sin activar permisos.
      const inserted = await client.query(
        `INSERT INTO public.spare_part_manager_invitations (
           user_id,
           invited_by,
           reason
         )
         VALUES ($1, $2, $3)
         RETURNING
           id,
           user_id,
           invited_by,
           reason,
           status,
           created_at`,
        [userId, req.user.id, reason.trim()]
      );

      const createdInvitation = inserted.rows[0];
      const correlationId = randomUUID();

      // Registrar el evento de gobernanza.
      await writeGovernanceEvent(client, {
        roleCode: "SPARE_PARTS_MANAGER",
        eventType: "INVITED",
        subjectUserId: userId,
        actorUserId: req.user.id,
        reason: reason.trim(),
        authorizationMethod:
          "ADMIN_INVITATION_PENDING_ACCEPTANCE",
        correlationId,
        details: {
          invitation_id: createdInvitation.id,
          permissions_activated: false,
        },
      });

      // Registrar la auditoría.
      await writeAudit(client, {
        actorUserId: req.user.id,
        action: "SPARE_PARTS_MANAGER_INVITED",
        entityType: "SPARE_PARTS_MANAGER_INVITATION",
        entityId: createdInvitation.id,
        beforeData: null,
        afterData: createdInvitation,
        details: {
          reason: reason.trim(),
          correlation_id: correlationId,
          permissions_activated: false,
        },
      });

      return {
        invitation: createdInvitation,
        recipientEmail,
      };
    });

    // La transacción ya está confirmada.
    // El correo no debe enviarse antes de confirmar la invitación.
    let emailSent = false;

    try {
      await sendMachineEmail({
        to: result.recipientEmail,

        subject:
          "MACHINE | Invitación para gestionar repuestos",

        text: [
          "MACHINE — INDUSTRIAL CONTROL SYSTEM",
          "",
          "Has recibido una invitación para asumir el rol SPARE_PARTS_MANAGER.",
          "",
          `Motivo: ${result.invitation.reason}`,
          "",
          "La invitación está pendiente de tu decisión.",
          "Los permisos no se activarán hasta que aceptes la invitación dentro de MACHINE.",
          "",
          "Ingresa a MACHINE para revisar y responder la invitación.",
          "",
          "MACHINE Support",
          "machineofficialsupport@gmail.com",
        ].join("\n"),

        html: `
          <div style="font-family:Arial,sans-serif;color:#17212b;max-width:640px;margin:auto">
            <div style="background:#101820;color:#ffffff;padding:24px">
              <h1 style="margin:0">MACHINE</h1>
              <p>INDUSTRIAL CONTROL SYSTEM</p>
            </div>

            <div style="padding:24px;border:1px solid #d9e0e5">
              <h2>Invitación para gestionar repuestos</h2>

              <p>
                Has recibido una invitación para asumir el rol
                <strong>SPARE_PARTS_MANAGER</strong>.
              </p>

              <p>
                <strong>Motivo de la invitación:</strong>
              </p>

              <p>${escapeHtml(result.invitation.reason)}</p>

              <p>
                La invitación está pendiente de tu decisión.
                Los permisos de gestión no se activarán hasta que
                aceptes la invitación dentro de MACHINE.
              </p>

              <p>
                Ingresa a MACHINE para revisar y responder la invitación.
              </p>

              <hr />

              <p style="font-size:12px;color:#64748b">
                MACHINE Support · machineofficialsupport@gmail.com
              </p>
            </div>
          </div>
        `,
      });

      emailSent = true;
    } catch (mailError) {
      // La invitación permanece registrada aunque falle el correo.
      console.error(
        "[MACHINE] No se pudo enviar el correo de invitación:",
        mailError.message
      );
    }

    return res.status(201).json({
      status: "OK",

      message: emailSent
        ? "Invitación creada y correo enviado. Los permisos se activarán únicamente cuando el operador acepte."
        : "Invitación creada, pero no se pudo enviar el correo. El operador aún puede revisar la invitación dentro de MACHINE.",

      invitation: result.invitation,
      emailSent,
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});



// Revocar gestor sin eliminar el registro histórico.
router.delete("/managers/:userId", async (req, res) => {
  const subjectUserId = req.params.userId;
  const { reason } = req.body ?? {};

  if (!validUuid(subjectUserId) || !validReason(reason)) {
    return res.status(400).json({
      status: "ERROR",
      message: "Identificador o motivo de revocación no válido.",
    });
  }

  try {
    await inTransaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock($1, $2)",
        [GOVERNANCE_LOCK, BOOTSTRAP_LOCK]
      );

      await requireAdmin(client, req.user.id);

      const target = await client.query(
        `SELECT *
           FROM public.spare_part_managers
          WHERE user_id = $1
          FOR UPDATE`,
        [subjectUserId]
      );

      if (
        target.rowCount === 0 ||
        target.rows[0].is_active !== true
      ) {
        const error = new Error(
          "El operador no tiene una designación activa como gestor."
        );
        error.status = 404;
        throw error;
      }

      const beforeData = target.rows[0];

      await client.query(
        `UPDATE public.spare_part_managers
            SET is_active = FALSE,
                revoked_by = $2,
                revoked_at = clock_timestamp()
          WHERE user_id = $1`,
        [subjectUserId, req.user.id]
      );

      const correlationId = randomUUID();

      await writeGovernanceEvent(client, {
        roleCode: "SPARE_PARTS_MANAGER",
        eventType: "REVOKED",
        subjectUserId,
        actorUserId: req.user.id,
        reason,
        authorizationMethod: "EXISTING_ADMIN_AUTHORIZATION",
        correlationId,
        details: {
          previous_assignment: beforeData,
        },
      });

      await writeAudit(client, {
        actorUserId: req.user.id,
        action: "SPARE_PARTS_MANAGER_REVOKED",
        entityType: "SPARE_PARTS_MANAGER",
        entityId: subjectUserId,
        beforeData,
        afterData: {
          user_id: subjectUserId,
          is_active: false,
          revoked_by: req.user.id,
        },
        details: {
          reason: reason.trim(),
          correlation_id: correlationId,
        },
      });
    });

    return res.json({
      status: "OK",
      message: "Gestor revocado. Historial conservado.",
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});


/**
 * Consultar las invitaciones de gestor del operador autenticado.
 * Un operador nunca puede consultar las invitaciones de otra persona.
 */
router.get("/manager-invitations/mine", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         i.id,
         i.reason,
         i.status,
         i.created_at,
         i.responded_at,
         i.response_reason,
         i.invited_by,
         u.email AS inviter_email
       FROM public.spare_part_manager_invitations i
       JOIN public.users u ON u.id = i.invited_by
       WHERE i.user_id = $1
       ORDER BY
         CASE WHEN i.status = 'PENDING' THEN 0 ELSE 1 END,
         i.created_at DESC`,
      [req.user.id]
    );

    return res.json({
      status: "OK",
      invitations: result.rows,
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});


/**
 * Aceptar o rechazar una invitación de gestor de repuestos.
 *
 * REGLAS:
 * - Solo el operador destinatario puede responder.
 * - Solo se pueden responder invitaciones PENDING.
 * - El administrador que invitó debe seguir autorizado.
 * - Los permisos se activan exclusivamente tras una aceptación válida.
 * - Cada decisión queda registrada en gobernanza y auditoría.
 * - El nombramiento genera un período histórico vinculado al evento.
 * - Todos los cambios se confirman en una única transacción.
 */
router.post(
  "/manager-invitations/:invitationId/respond",
  async (req, res) => {
    const { invitationId } = req.params;
    const { decision, responseReason } = req.body ?? {};

    if (
      !validUuid(invitationId) ||
      !["ACCEPTED", "REJECTED"].includes(decision)
    ) {
      return res.status(400).json({
        status: "ERROR",
        message: "La invitación o la decisión no son válidas.",
      });
    }

    if (
      responseReason !== undefined &&
      (
        typeof responseReason !== "string" ||
        responseReason.trim().length > 1000
      )
    ) {
      return res.status(400).json({
        status: "ERROR",
        message:
          "El comentario debe ser texto y no puede superar los 1000 caracteres.",
      });
    }

    try {
      const outcome = await inTransaction(async (client) => {
        // Serializar las operaciones de gobernanza.
        await client.query(
          "SELECT pg_advisory_xact_lock($1, $2)",
          [GOVERNANCE_LOCK, BOOTSTRAP_LOCK]
        );

        // El destinatario debe continuar activo.
        await requireActiveUser(client, req.user.id);

        // Bloquear y verificar la invitación del usuario autenticado.
        const invitationResult = await client.query(
          `SELECT *
             FROM public.spare_part_manager_invitations
            WHERE id = $1
              AND user_id = $2
            FOR UPDATE`,
          [invitationId, req.user.id]
        );

        if (invitationResult.rowCount !== 1) {
          const error = new Error(
            "La invitación no existe o no pertenece a tu cuenta."
          );
          error.status = 404;
          throw error;
        }

        const invitation = invitationResult.rows[0];

        if (invitation.status !== "PENDING") {
          const error = new Error(
            "Esta invitación ya fue respondida o cancelada."
          );
          error.status = 409;
          throw error;
        }

        const cleanResponseReason =
          typeof responseReason === "string"
            ? responseReason.trim()
            : null;

        const correlationId = randomUUID();

        // =====================================================
        // RECHAZAR INVITACIÓN
        // =====================================================
        if (decision === "REJECTED") {
          const updated = await client.query(
            `UPDATE public.spare_part_manager_invitations
                SET status = 'REJECTED',
                    responded_at = clock_timestamp(),
                    response_reason = $3
              WHERE id = $1
                AND user_id = $2
                AND status = 'PENDING'
              RETURNING *`,
            [
              invitationId,
              req.user.id,
              cleanResponseReason || null,
            ]
          );

          if (updated.rowCount !== 1) {
            const error = new Error(
              "No se pudo registrar el rechazo de la invitación."
            );
            error.status = 409;
            throw error;
          }

          await writeGovernanceEvent(client, {
            roleCode: "SPARE_PARTS_MANAGER",
            eventType: "REJECTED",
            subjectUserId: req.user.id,
            actorUserId: req.user.id,
            reason: invitation.reason,
            authorizationMethod:
              "OPERATOR_REJECTED_MANAGER_INVITATION",
            correlationId,
            details: {
              invitation_id: invitationId,
              response_reason: cleanResponseReason,
              permissions_activated: false,
            },
          });

          await writeAudit(client, {
            actorUserId: req.user.id,
            action: "SPARE_PARTS_MANAGER_INVITATION_REJECTED",
            entityType: "SPARE_PARTS_MANAGER_INVITATION",
            entityId: invitationId,
            beforeData: invitation,
            afterData: updated.rows[0],
            details: {
              correlation_id: correlationId,
              permissions_activated: false,
            },
          });

          return {
            decision: "REJECTED",
            invitation: updated.rows[0],
          };
        }

        // =====================================================
        // ACEPTAR INVITACIÓN
        // =====================================================

        // El administrador que envió la invitación debe seguir
        // autorizado y tener una cuenta activa.
        const inviterResult = await client.query(
          `SELECT
             a.user_id,
             u.employee_id
           FROM public.spare_part_admins AS a
           JOIN public.users AS u
             ON u.id = a.user_id
           WHERE a.user_id = $1
             AND u.status = 'active'
           FOR UPDATE OF a, u`,
          [invitation.invited_by]
        );

        if (inviterResult.rowCount !== 1) {
          const error = new Error(
            "El administrador que emitió la invitación ya no está autorizado. No se activaron permisos."
          );
          error.status = 409;
          throw error;
        }

        const inviter = inviterResult.rows[0];

        // Recuperar los datos oficiales del destinatario.
        const operatorResult = await client.query(
          `SELECT id, employee_id, email
             FROM public.users
            WHERE id = $1
              AND status = 'active'
            FOR UPDATE`,
          [req.user.id]
        );

        if (operatorResult.rowCount !== 1) {
          const error = new Error(
            "El operador no está activo. No se activaron permisos."
          );
          error.status = 403;
          throw error;
        }

        const operator = operatorResult.rows[0];

        // Bloquear el registro de gestor, si ya existe.
        const existingManagerResult = await client.query(
          `SELECT user_id, is_active
             FROM public.spare_part_managers
            WHERE user_id = $1
            FOR UPDATE`,
          [req.user.id]
        );

        if (
          existingManagerResult.rowCount === 1 &&
          existingManagerResult.rows[0].is_active === true
        ) {
          const error = new Error(
            "El operador ya tiene activo el rol de gestor. No se puede duplicar el nombramiento."
          );
          error.status = 409;
          throw error;
        }

        // No permitir un nuevo nombramiento si ya existe
        // un período activo para el mismo rol.
        const activePeriodResult = await client.query(
          `SELECT appointment_event_id
             FROM public.spare_part_role_periods
            WHERE subject_user_id = $1
              AND role_code = 'SPARE_PARTS_MANAGER'
              AND period_status = 'ACTIVE'
              AND ended_at IS NULL
            LIMIT 1
            FOR UPDATE`,
          [req.user.id]
        );

        if (activePeriodResult.rowCount > 0) {
          const error = new Error(
            "Ya existe un período activo de gestor para este operador. Se requiere revisar el historial antes de continuar."
          );
          error.status = 409;
          throw error;
        }

        // Comprobar el límite de gestores activos.
        const capacityResult = await client.query(
          `SELECT COUNT(*)::integer AS active_count
             FROM public.spare_part_managers
            WHERE is_active = TRUE`
        );

        if (
          capacityResult.rows[0].active_count >= MAX_MANAGERS
        ) {
          const error = new Error(
            "Se alcanzó el límite de gestores. La invitación sigue pendiente."
          );
          error.status = 409;
          throw error;
        }

        // Activar al gestor o reactivar un registro previamente
        // revocado, sin sobrescribir un registro ya activo.
        const managerResult = await client.query(
          `INSERT INTO public.spare_part_managers (
             user_id,
             granted_by,
             granted_at,
             is_active,
             revoked_by,
             revoked_at
           )
           VALUES (
             $1,
             $2,
             clock_timestamp(),
             TRUE,
             NULL,
             NULL
           )
           ON CONFLICT (user_id)
           DO UPDATE SET
             granted_by = EXCLUDED.granted_by,
             granted_at = clock_timestamp(),
             is_active = TRUE,
             revoked_by = NULL,
             revoked_at = NULL
           WHERE public.spare_part_managers.is_active = FALSE
           RETURNING *`,
          [req.user.id, invitation.invited_by]
        );

        if (managerResult.rowCount !== 1) {
          const error = new Error(
            "No se pudo activar el rol de gestor de forma segura."
          );
          error.status = 409;
          throw error;
        }

        // Confirmar la aceptación de la invitación.
        const updatedInvitation = await client.query(
          `UPDATE public.spare_part_manager_invitations
              SET status = 'ACCEPTED',
                  responded_at = clock_timestamp(),
                  response_reason = $3
            WHERE id = $1
              AND user_id = $2
              AND status = 'PENDING'
            RETURNING *`,
          [
            invitationId,
            req.user.id,
            cleanResponseReason || null,
          ]
        );

        if (updatedInvitation.rowCount !== 1) {
          const error = new Error(
            "No se pudo confirmar la aceptación de la invitación."
          );
          error.status = 409;
          throw error;
        }

        // Registrar la aceptación del operador.
        await writeGovernanceEvent(client, {
          roleCode: "SPARE_PARTS_MANAGER",
          eventType: "ACCEPTED",
          subjectUserId: req.user.id,
          actorUserId: req.user.id,
          reason: invitation.reason,
          authorizationMethod:
            "OPERATOR_ACCEPTED_MANAGER_INVITATION",
          correlationId,
          details: {
            invitation_id: invitationId,
            permissions_activated: true,
          },
        });

        // Registrar el nombramiento y capturar su ID real.
        const appointmentEvent = await writeGovernanceEvent(
          client,
          {
            roleCode: "SPARE_PARTS_MANAGER",
            eventType: "APPOINTED",
            subjectUserId: req.user.id,
            actorUserId: invitation.invited_by,
            reason: invitation.reason,
            authorizationMethod:
              "ADMIN_INVITATION_ACCEPTED_BY_OPERATOR",
            correlationId,
            details: {
              invitation_id: invitationId,
              accepted_by_user_id: req.user.id,
              appointed_by_user_id: invitation.invited_by,
              permissions_activated: true,
            },
          }
        );

        if (!appointmentEvent?.id) {
          const error = new Error(
            "No se pudo obtener el identificador del nombramiento."
          );
          error.status = 500;
          throw error;
        }


        // Representar el período histórico a partir del evento APPOINTED.
        // spare_part_role_periods es una vista derivada de eventos.
        // No se debe insertar directamente en ella.
        const rolePeriod = {
          appointment_event_id: appointmentEvent.id,
          subject_user_id: operator.id,
          employee_id: operator.employee_id,
          email: operator.email,
          role_code: "SPARE_PARTS_MANAGER",
          appointed_by_user_id: inviter.user_id,
          appointed_by_employee_id: inviter.employee_id,
          started_at: appointmentEvent.occurred_at,
          appointment_reason: invitation.reason,
          period_status: "ACTIVE",
          ended_at: null,
        };

        // Auditoría de la operación completa.
        await writeAudit(client, {
          actorUserId: req.user.id,
          action: "SPARE_PARTS_MANAGER_INVITATION_ACCEPTED",
          entityType: "SPARE_PARTS_MANAGER_INVITATION",
          entityId: invitationId,
          beforeData: invitation,
          afterData: {
            invitation: updatedInvitation.rows[0],
            manager: managerResult.rows[0],
            role_period: rolePeriod,
          },
          details: {
            correlation_id: correlationId,
            appointment_event_id: appointmentEvent.id,
            permissions_activated: true,
          },
        });

        return {
          decision: "ACCEPTED",
          invitation: updatedInvitation.rows[0],
          manager: managerResult.rows[0],
          rolePeriod,
          appointmentEventId: appointmentEvent.id,
        };
      });

      return res.json({
        status: "OK",
        message:
          outcome.decision === "ACCEPTED"
            ? "Invitación aceptada. Tu rol de gestor de repuestos está activo y su nombramiento quedó registrado."
            : "Invitación rechazada. No se han concedido permisos.",
        ...outcome,
      });
    } catch (error) {
      return respondWithError(res, error);
    }
  }
);


// Historial inmutable de gobernanza. Solo administrador actual.
router.get("/history", async (req, res) => {
  try {
    await inTransaction(async (client) => {
      await requireAdmin(client, req.user.id);
    });

    const result = await pool.query(
      `SELECT
         event_key,
         role_code,
         event_type,
         subject_user_id,
         actor_user_id,
         authorized_by_user_id,
         occurred_at,
         reason,
         authorization_method,
         correlation_id,
         details
       FROM public.spare_part_governance_events
       ORDER BY occurred_at DESC
       LIMIT 500`
    );

    return res.json({
      status: "OK",
      events: result.rows,
    });
  } catch (error) {
    return respondWithError(res, error);
  }
});

export default router;
