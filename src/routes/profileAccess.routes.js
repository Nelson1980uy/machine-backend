import express from "express";
import jwt from "jsonwebtoken";

import pool from "../config/database.js";

import {
  emitProfileAccessRequest,
} from "../socket/chat.socket.js";


const router =
  express.Router();


// =========================================================
// CONFIGURACIÓN
// =========================================================

const JWT_SECRET =
  process.env.JWT_SECRET;

if (!JWT_SECRET) {

  throw new Error(
    "JWT_SECRET no está configurado en el archivo .env"
  );

}


// =========================================================
// DURACIÓN DEL ACCESO
// =========================================================
//
// 3 minutos
//
// IMPORTANTE:
// El contador NO comienza al aprobar.
// Comienza solamente cuando el solicitante acepta
// la responsabilidad.
// =========================================================

const PROFILE_ACCESS_DURATION_MS =
  3 * 60 * 1000;


// =========================================================
// AUTENTICAR SESIÓN
// =========================================================

const authenticateSession = async (
  req,
  res
) => {

  const authorization =
    req.headers.authorization || "";


  if (
    !authorization.startsWith(
      "Bearer "
    )
  ) {

    res.status(401).json({

      status:
        "ERROR",

      message:
        "SESIÓN NO AUTORIZADA.",

    });

    return null;

  }


  const token =
    authorization
      .substring(7)
      .trim();


  if (!token) {

    res.status(401).json({

      status:
        "ERROR",

      message:
        "TOKEN DE SESIÓN NO VÁLIDO.",

    });

    return null;

  }


  try {

    const decoded =
      jwt.verify(
        token,
        JWT_SECRET
      );


    if (!decoded?.userId) {

      res.status(401).json({

        status:
          "ERROR",

        message:
          "SESIÓN NO VÁLIDA.",

      });

      return null;

    }


    return decoded;


  } catch (error) {

    console.error(
      "PROFILE ACCESS JWT ERROR:",
      error
    );


    res.status(401).json({

      status:
        "ERROR",

      message:
        "LA SESIÓN HA EXPIRADO O NO ES VÁLIDA.",

    });

    return null;

  }

};


// =========================================================
// REGISTRAR AUDITORÍA
// =========================================================

const registerAuditEvent = async (
  client,
  {
    requestId,
    requesterUserId,
    targetUserId,
    eventType,
    metadata = {},
  }
) => {

  await client.query(
    `
    INSERT INTO public.profile_access_audit (
      request_id,
      requester_user_id,
      target_user_id,
      event_type,
      event_at,
      metadata
    )

    VALUES (
      $1,
      $2,
      $3,
      $4,
      NOW(),
      $5::jsonb
    )
    `,
    [
      requestId,
      requesterUserId,
      targetUserId,
      eventType,
      JSON.stringify(metadata || {}),
    ]
  );

};


// =========================================================
// CONSTRUIR PAYLOAD DEL SOLICITANTE
// =========================================================

const buildProfileAccessPayload = async (
  client,
  request
) => {

  const requesterResult =
    await client.query(
      `
      SELECT
        u.id,
        u.email,
        u.employee_id,
        u.role,
        u.status AS user_status,

        p.first_name,
        p.last_name,
        p.gender,
        p.photo_url,
        p.job_title

      FROM public.users u

      LEFT JOIN public.user_profiles p
        ON p.user_id = u.id

      WHERE u.id = $1

      LIMIT 1
      `,
      [
        request.requester_user_id,
      ]
    );


  const requester =
    requesterResult.rows[0] ||
    {};


  return {

    requestId:
      request.id,

    requesterUserId:
      request.requester_user_id,

    targetUserId:
      request.target_user_id,

    status:
      request.status,

    createdAt:
      request.created_at,

    respondedAt:
      request.responded_at ||
      null,

    responsibilityAcceptedAt:
      request.responsibility_accepted_at ||
      null,

    accessStartedAt:
      request.access_started_at ||
      null,

    accessExpiresAt:
      request.access_expires_at ||
      null,

    accessClosedAt:
      request.access_closed_at ||
      null,

    accessClosedReason:
      request.access_closed_reason ||
      null,


    requester: {

      id:
        requester.id ||
        request.requester_user_id,

      email:
        requester.email ||
        null,

      employeeId:
        requester.employee_id ||
        null,

      role:
        requester.role ||
        null,

      status:
        requester.user_status ||
        null,

      firstName:
        requester.first_name ||
        "",

      lastName:
        requester.last_name ||
        "",

      gender:
        requester.gender ||
        null,

      photoUrl:
        requester.photo_url ||
        "/operador.png",

      jobTitle:
        requester.job_title ||
        "OPERADOR",

    },

  };

};


// =========================================================
// CONSTRUIR PAYLOAD DEL TARGET / PROPIETARIO
// =========================================================

const buildTargetProfilePayload = async (
  client,
  request
) => {

  const result =
    await client.query(
      `
      SELECT
        u.id,
        u.email,
        u.employee_id,
        u.role,
        u.status AS user_status,

        p.first_name,
        p.last_name,
        p.gender,
        p.photo_url,
        p.job_title

      FROM public.users u

      LEFT JOIN public.user_profiles p
        ON p.user_id = u.id

      WHERE u.id = $1

      LIMIT 1
      `,
      [
        request.target_user_id,
      ]
    );


  const target =
    result.rows[0] ||
    {};


  return {

    id:
      target.id ||
      request.target_user_id,

    email:
      target.email ||
      null,

    employeeId:
      target.employee_id ||
      null,

    role:
      target.role ||
      null,

    status:
      target.user_status ||
      null,

    firstName:
      target.first_name ||
      "",

    lastName:
      target.last_name ||
      "",

    gender:
      target.gender ||
      null,

    photoUrl:
      target.photo_url ||
      "/operador.png",

    jobTitle:
      target.job_title ||
      "OPERADOR",

  };

};


// =========================================================
// SOLICITAR ACCESO
// =========================================================
//
// POST
// /api/profile-access/request/:targetUserId
//
// IMPORTANTE:
//
// APPROVED NO BLOQUEA UNA NUEVA SOLICITUD SI EL ACCESO
// ANTERIOR YA FUE CERRADO O EXPIRÓ.
//
// Si existe una solicitud APPROVED todavía pendiente de
// responsabilidad, se informa al solicitante.
//
// Si existe una sesión activa, se informa que ya existe
// un acceso activo.
//
// Si existe una solicitud antigua cerrada/expirada,
// se reutiliza el registro para crear un NUEVO CICLO.
//
// El historial permanece en profile_access_audit.
// =========================================================

router.post(
  "/request/:targetUserId",
  async (req, res) => {
    let client;
    let transactionStarted = false;

    try {
      const decoded = await authenticateSession(req, res);

      if (!decoded) return;

      const requesterUserId = String(decoded.userId).trim();
      const normalizedTargetUserId = String(
        req.params.targetUserId || ""
      ).trim();

      if (!normalizedTargetUserId) {
        return res.status(400).json({
          status: "ERROR",
          message: "EL OPERADOR DESTINO NO ES VÁLIDO.",
        });
      }

      if (requesterUserId === normalizedTargetUserId) {
        return res.status(400).json({
          status: "ERROR",
          message: "NO PUEDES SOLICITAR ACCESO A TU PROPIO PERFIL.",
        });
      }

      client = await pool.connect();

      // Serializar operaciones de solicitud para esta pareja
      // de usuarios, incluso cuando todavía no existe una fila.
      await client.query("BEGIN");
      transactionStarted = true;

      await client.query(
        `
        SELECT pg_advisory_xact_lock(
          hashtextextended($1::text || ':' || $2::text, 0)
        )
        `,
        [requesterUserId, normalizedTargetUserId]
      );

      const targetResult = await client.query(
        `
        SELECT
          u.id,
          u.status,
          p.first_name,
          p.last_name,
          p.profile_visibility
        FROM public.users u
        LEFT JOIN public.user_profiles p
          ON p.user_id = u.id
        WHERE u.id = $1
        LIMIT 1
        `,
        [normalizedTargetUserId]
      );

      if (targetResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          status: "ERROR",
          message: "EL OPERADOR NO EXISTE.",
        });
      }

      const target = targetResult.rows[0];

      if (target.status !== "active") {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(403).json({
          status: "ERROR",
          message: "EL OPERADOR NO SE ENCUENTRA ACTIVO.",
        });
      }

      const profileVisibility = String(
        target.profile_visibility || "PUBLIC"
      ).trim().toUpperCase();

      if (profileVisibility !== "PRIVATE") {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(400).json({
          status: "ERROR",
          message: "ESTE PERFIL NO ES PRIVADO.",
        });
      }

      const existingResult = await client.query(
        `
        SELECT
          id,
          requester_user_id,
          target_user_id,
          status,
          created_at,
          responded_at,
          interpreted_at,
          responsibility_accepted_at,
          accessed_at,
          access_started_at,
          access_expires_at,
          access_closed_at,
          access_closed_reason
        FROM public.profile_access_requests
        WHERE requester_user_id = $1
          AND target_user_id = $2
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
        `,
        [requesterUserId, normalizedTargetUserId]
      );

      if (existingResult.rows.length > 0) {
        const existing = existingResult.rows[0];

        const existingStatus = String(
          existing.status || ""
        ).trim().toUpperCase();

        if (existingStatus === "PENDING") {
          const payload = await buildProfileAccessPayload(
            client,
            existing
          );

          await client.query("COMMIT");
          transactionStarted = false;

          const notificationSent = Boolean(
            emitProfileAccessRequest(
              normalizedTargetUserId,
              {
                ...payload,
                eventType: "PROFILE_ACCESS_REQUEST",
              }
            )
          );

          return res.status(409).json({
            status: "PENDING",
            message: notificationSent
              ? "YA EXISTE UNA SOLICITUD PENDIENTE. LA NOTIFICACIÓN FUE ENVIADA NUEVAMENTE."
              : "YA EXISTE UNA SOLICITUD PENDIENTE. EL OPERADOR DESTINO NO ESTÁ CONECTADO.",
            notificationSent,
            request: payload,
          });
        }

        if (
          existingStatus === "APPROVED" &&
          !existing.responsibility_accepted_at &&
          !existing.access_started_at &&
          !existing.access_closed_at
        ) {
          const payload = await buildProfileAccessPayload(
            client,
            existing
          );

          await client.query("COMMIT");
          transactionStarted = false;

          return res.status(200).json({
            status: "APPROVED",
            message:
              "ESTA SOLICITUD YA FUE AUTORIZADA. DEBES ACEPTAR LA RESPONSABILIDAD ANTES DE ACCEDER AL PERFIL.",
            notificationSent: false,
            request: payload,
          });
        }

        if (
          existingStatus === "APPROVED" &&
          existing.access_started_at &&
          !existing.access_closed_at
        ) {
          const expirationResult = await client.query(
            `
            SELECT
              access_expires_at IS NOT NULL
              AND access_expires_at > NOW() AS is_active
            FROM public.profile_access_requests
            WHERE id = $1
            `,
            [existing.id]
          );

          if (expirationResult.rows[0]?.is_active) {
            await client.query("COMMIT");
            transactionStarted = false;

            return res.status(409).json({
              status: "ACTIVE",
              message: "YA EXISTE UN ACCESO ACTIVO A ESTE PERFIL.",
              request: {
                id: existing.id,
                requesterUserId: existing.requester_user_id,
                targetUserId: existing.target_user_id,
                status: existing.status,
                accessStartedAt: existing.access_started_at,
                accessExpiresAt: existing.access_expires_at,
              },
            });
          }

          const expiredResult = await client.query(
            `
            UPDATE public.profile_access_requests
            SET
              access_closed_at = NOW(),
              access_closed_reason = 'EXPIRED'
            WHERE id = $1
              AND requester_user_id = $2
              AND status = 'APPROVED'
              AND access_started_at IS NOT NULL
              AND access_closed_at IS NULL
              AND (
                access_expires_at IS NULL
                OR access_expires_at <= NOW()
              )
            RETURNING
              id,
              requester_user_id,
              target_user_id
            `,
            [existing.id, requesterUserId]
          );

          if (expiredResult.rows.length > 0) {
            const expired = expiredResult.rows[0];

            await registerAuditEvent(client, {
              requestId: expired.id,
              requesterUserId: expired.requester_user_id,
              targetUserId: expired.target_user_id,
              eventType: "ACCESS_EXPIRED",
              metadata: {
                automatic: true,
              },
            });
          }
        }
      }

      const latestResult = await client.query(
        `
        SELECT
          id,
          requester_user_id,
          target_user_id,
          status,
          created_at,
          responded_at,
          interpreted_at,
          responsibility_accepted_at,
          accessed_at,
          access_started_at,
          access_expires_at,
          access_closed_at,
          access_closed_reason
        FROM public.profile_access_requests
        WHERE requester_user_id = $1
          AND target_user_id = $2
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
        `,
        [requesterUserId, normalizedTargetUserId]
      );

      let request;

      if (latestResult.rows.length > 0) {
        const latest = latestResult.rows[0];

        const latestClosed = Boolean(latest.access_closed_at);
        const latestStatus = String(
          latest.status || ""
        ).trim().toUpperCase();

        if (latestClosed || latestStatus === "REJECTED") {
          const resetResult = await client.query(
            `
            UPDATE public.profile_access_requests
            SET
              status = 'PENDING',
              created_at = NOW(),
              responded_at = NULL,
              interpreted_at = NULL,
              responsibility_accepted_at = NULL,
              accessed_at = NULL,
              access_started_at = NULL,
              access_expires_at = NULL,
              access_closed_at = NULL,
              access_closed_reason = NULL
            WHERE id = $1
            RETURNING
              id,
              requester_user_id,
              target_user_id,
              status,
              created_at,
              responded_at,
              interpreted_at,
              responsibility_accepted_at,
              accessed_at,
              access_started_at,
              access_expires_at,
              access_closed_at,
              access_closed_reason
            `,
            [latest.id]
          );

          request = resetResult.rows[0];

          if (!request) {
            throw new Error(
              "NO SE PUDO REINICIAR LA SOLICITUD DE ACCESO."
            );
          }
        } else {
          await client.query("COMMIT");
          transactionStarted = false;

          return res.status(409).json({
            status: latestStatus,
            message:
              "YA EXISTE UNA SOLICITUD O AUTORIZACIÓN ACTIVA PARA ESTE PERFIL.",
            request: latest,
          });
        }
      } else {
        const insertResult = await client.query(
          `
          INSERT INTO public.profile_access_requests (
            requester_user_id,
            target_user_id,
            status,
            created_at
          )
          VALUES ($1, $2, 'PENDING', NOW())
          RETURNING
            id,
            requester_user_id,
            target_user_id,
            status,
            created_at,
            responded_at,
            interpreted_at,
            responsibility_accepted_at,
            accessed_at,
            access_started_at,
            access_expires_at,
            access_closed_at,
            access_closed_reason
          `,
          [requesterUserId, normalizedTargetUserId]
        );

        request = insertResult.rows[0];
      }

      if (!request) {
        throw new Error(
          "NO SE PUDO CREAR LA SOLICITUD DE ACCESO."
        );
      }

      await registerAuditEvent(client, {
        requestId: request.id,
        requesterUserId: request.requester_user_id,
        targetUserId: request.target_user_id,
        eventType: "REQUEST_CREATED",
        metadata: {
          source: "PRIVATE_PROFILE",
        },
      });

      const profileAccessPayload = await buildProfileAccessPayload(
        client,
        request
      );

      // Confirmar la solicitud y su auditoría antes de notificar.
      await client.query("COMMIT");
      transactionStarted = false;

      const notificationSent = Boolean(
        emitProfileAccessRequest(
          normalizedTargetUserId,
          {
            ...profileAccessPayload,
            eventType: "PROFILE_ACCESS_REQUEST",
          }
        )
      );

      return res.status(201).json({
        status: "SUCCESS",
        message: notificationSent
          ? "SOLICITUD DE ACCESO ENVIADA CORRECTAMENTE."
          : "SOLICITUD REGISTRADA. EL OPERADOR DESTINO NO ESTÁ CONECTADO.",
        notificationSent,
        request: profileAccessPayload,
      });
    } catch (error) {
      if (client && transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error(
            "PROFILE ACCESS REQUEST ROLLBACK ERROR:",
            rollbackError
          );
        }
      }

      console.error(
        "PROFILE ACCESS REQUEST ERROR:",
        error
      );

      return res.status(500).json({
        status: "ERROR",
        message: "NO FUE POSIBLE ENVIAR LA SOLICITUD DE ACCESO.",
        notificationSent: false,
      });
    } finally {
      if (client) {
        client.release();
      }
    }
  }
);



// =========================================================
// HISTORIAL DE ACCESOS PRIVADOS
// =========================================================
//
// GET
// /api/profile-access/history
//
// Este historial pertenece al PROPIETARIO del perfil.
//
// Se consulta profile_access_audit porque
// profile_access_requests puede reutilizarse para
// nuevos ciclos de autorización.
//
// De esta forma conservamos:
//
// REQUEST_CREATED
// REQUEST_APPROVED
// REQUEST_REJECTED
// RESPONSIBILITY_ACCEPTED
// ACCESS_STARTED
// ACCESS_EXPIRED
// ACCESS_CLOSED
// PROFILE_INTERPRETED
// =========================================================

router.get(
  "/history",
  async (req, res) => {

    try {

      const decoded =
        await authenticateSession(
          req,
          res
        );


      if (!decoded) {
        return;
      }


      const targetUserId =
        decoded.userId;


      const result =
        await pool.query(
          `
          SELECT
            a.id AS audit_id,

            a.request_id,

            a.requester_user_id,

            a.target_user_id,

            a.event_type,

            a.event_at,

            a.metadata,

            u.email,
            u.employee_id,
            u.role,
            u.status AS user_status,

            p.first_name,
            p.last_name,
            p.gender,
            p.photo_url,
            p.job_title

          FROM public.profile_access_audit a

          INNER JOIN public.users u
            ON u.id =
              a.requester_user_id

          LEFT JOIN public.user_profiles p
            ON p.user_id =
              a.requester_user_id

          WHERE a.target_user_id = $1

          ORDER BY
            a.event_at DESC

          LIMIT 200
          `,
          [
            targetUserId,
          ]
        );


      return res.status(200).json({

        status:
          "SUCCESS",

        history:
          result.rows.map(
            (event) => ({

              auditId:
                event.audit_id,

              requestId:
                event.request_id,

              requesterUserId:
                event.requester_user_id,

              targetUserId:
                event.target_user_id,

              eventType:
                event.event_type,

              eventAt:
                event.event_at,

              metadata:
                event.metadata ||
                {},


              requester: {

                id:
                  event.requester_user_id,

                email:
                  event.email ||
                  null,

                employeeId:
                  event.employee_id ||
                  null,

                role:
                  event.role ||
                  null,

                status:
                  event.user_status ||
                  null,

                firstName:
                  event.first_name ||
                  "",

                lastName:
                  event.last_name ||
                  "",

                gender:
                  event.gender ||
                  null,

                photoUrl:
                  event.photo_url ||
                  "/operador.png",

                jobTitle:
                  event.job_title ||
                  "OPERADOR",

              },

            })
          ),

      });


    } catch (error) {

      console.error(
        "PROFILE ACCESS HISTORY ERROR:",
        error
      );


      return res.status(500).json({

        status:
          "ERROR",

        message:
          "NO FUE POSIBLE OBTENER EL HISTORIAL DE ACCESOS PRIVADOS.",

      });

    }

  }
);



// =========================================================
// SOLICITUDES RECIBIDAS
// =========================================================

router.get(
  "/incoming",
  async (req, res) => {

    try {

      const decoded =
        await authenticateSession(
          req,
          res
        );


      if (!decoded) {
        return;
      }


      const targetUserId =
        decoded.userId;


      const result =
        await pool.query(
          `
          SELECT
            r.id,
            r.requester_user_id,
            r.target_user_id,
            r.status,
            r.created_at,
            r.responded_at,
            r.interpreted_at,

            r.responsibility_accepted_at,
            r.accessed_at,
            r.access_started_at,
            r.access_expires_at,
            r.access_closed_at,
            r.access_closed_reason,

            u.email,
            u.employee_id,
            u.role,
            u.status AS user_status,

            p.first_name,
            p.last_name,
            p.gender,
            p.photo_url,
            p.job_title

          FROM public.profile_access_requests r

          INNER JOIN public.users u
            ON u.id =
              r.requester_user_id

          LEFT JOIN public.user_profiles p
            ON p.user_id =
              r.requester_user_id

          WHERE r.target_user_id = $1

          ORDER BY
            r.created_at DESC
          `,
          [
            targetUserId,
          ]
        );


      return res.status(200).json({

        status:
          "SUCCESS",

        requests:
          result.rows.map(
            (request) => ({

              id:
                request.id,

              requesterUserId:
                request.requester_user_id,

              targetUserId:
                request.target_user_id,

              status:
                request.status,

              createdAt:
                request.created_at,

              respondedAt:
                request.responded_at,

              interpretedAt:
                request.interpreted_at,

              responsibilityAcceptedAt:
                request.responsibility_accepted_at,

              accessedAt:
                request.accessed_at,

              accessStartedAt:
                request.access_started_at,

              accessExpiresAt:
                request.access_expires_at,

              accessClosedAt:
                request.access_closed_at,

              accessClosedReason:
                request.access_closed_reason,


              requester: {

                id:
                  request.requester_user_id,

                email:
                  request.email,

                employeeId:
                  request.employee_id,

                role:
                  request.role,

                status:
                  request.user_status,

                firstName:
                  request.first_name,

                lastName:
                  request.last_name,

                gender:
                  request.gender,

                photoUrl:
                  request.photo_url ||
                  "/operador.png",

                jobTitle:
                  request.job_title,

              },

            })
          ),

      });


    } catch (error) {

      console.error(
        "PROFILE ACCESS INCOMING ERROR:",
        error
      );


      return res.status(500).json({

        status:
          "ERROR",

        message:
          "NO FUE POSIBLE OBTENER LAS SOLICITUDES RECIBIDAS.",

      });

    }

  }
);


// =========================================================
// SOLICITUDES ENVIADAS
// =========================================================

router.get(
  "/outgoing",
  async (req, res) => {

    try {

      const decoded =
        await authenticateSession(
          req,
          res
        );


      if (!decoded) {
        return;
      }


      const requesterUserId =
        decoded.userId;


      const result =
        await pool.query(
          `
          SELECT
            r.id,
            r.requester_user_id,
            r.target_user_id,
            r.status,
            r.created_at,
            r.responded_at,
            r.interpreted_at,

            r.responsibility_accepted_at,
            r.accessed_at,
            r.access_started_at,
            r.access_expires_at,
            r.access_closed_at,
            r.access_closed_reason,

            u.email,
            u.employee_id,
            u.role,
            u.status AS user_status,

            p.first_name,
            p.last_name,
            p.gender,
            p.photo_url,
            p.job_title

          FROM public.profile_access_requests r

          INNER JOIN public.users u
            ON u.id =
              r.target_user_id

          LEFT JOIN public.user_profiles p
            ON p.user_id =
              r.target_user_id

          WHERE r.requester_user_id = $1

          ORDER BY
            r.created_at DESC
          `,
          [
            requesterUserId,
          ]
        );


      return res.status(200).json({

        status:
          "SUCCESS",

        requests:
          result.rows.map(
            (request) => ({

              id:
                request.id,

              requesterUserId:
                request.requester_user_id,

              targetUserId:
                request.target_user_id,

              status:
                request.status,

              createdAt:
                request.created_at,

              respondedAt:
                request.responded_at,

              interpretedAt:
                request.interpreted_at,

              responsibilityAcceptedAt:
                request.responsibility_accepted_at,

              accessedAt:
                request.accessed_at,

              accessStartedAt:
                request.access_started_at,

              accessExpiresAt:
                request.access_expires_at,

              accessClosedAt:
                request.access_closed_at,

              accessClosedReason:
                request.access_closed_reason,


              target: {

                id:
                  request.target_user_id,

                email:
                  request.email,

                employeeId:
                  request.employee_id,

                role:
                  request.role,

                status:
                  request.user_status,

                firstName:
                  request.first_name,

                lastName:
                  request.last_name,

                gender:
                  request.gender,

                photoUrl:
                  request.photo_url ||
                  "/operador.png",

                jobTitle:
                  request.job_title,

              },

            })
          ),

      });


    } catch (error) {

      console.error(
        "PROFILE ACCESS OUTGOING ERROR:",
        error
      );


      return res.status(500).json({

        status:
          "ERROR",

        message:
          "NO FUE POSIBLE OBTENER LAS SOLICITUDES ENVIADAS.",

      });

    }

  }
);


// =========================================================
// APROBAR SOLICITUD
// =========================================================
//
// IMPORTANTE:
//
// Aquí NO comienza el acceso.
//
// APPROVED = propietario autorizó.
//
// El solicitante todavía debe aceptar responsabilidad.
// =========================================================

router.post(
  "/:requestId/approve",
  async (req, res) => {

    const client =
      await pool.connect();


    try {

      const decoded =
        await authenticateSession(
          req,
          res
        );


      if (!decoded) {
        return;
      }


      const targetUserId =
        decoded.userId;


      const {
        requestId,
      } = req.params;


      if (!requestId) {

        return res.status(400).json({

          status:
            "ERROR",

          message:
            "SOLICITUD NO VÁLIDA.",

        });

      }


      const requestResult =
        await client.query(
          `
          SELECT
            id,
            requester_user_id,
            target_user_id,
            status,
            created_at,
            responded_at,
            responsibility_accepted_at,
            access_started_at,
            access_expires_at,
            access_closed_at

          FROM public.profile_access_requests

          WHERE id = $1
            AND target_user_id = $2

          LIMIT 1
          `,
          [
            requestId,
            targetUserId,
          ]
        );


      if (
        requestResult.rows.length === 0
      ) {

        return res.status(404).json({

          status:
            "ERROR",

          message:
            "SOLICITUD NO ENCONTRADA.",

        });

      }


      const request =
        requestResult.rows[0];


      if (
        request.status ===
        "APPROVED"
      ) {

        return res.status(200).json({

          status:
            "APPROVED",

          message:
            "LA SOLICITUD YA ESTÁ AUTORIZADA. EL SOLICITANTE TODAVÍA DEBE ACEPTAR LA RESPONSABILIDAD.",

          requestId:
            request.id,

        });

      }


      if (
        request.status !==
        "PENDING"
      ) {

        return res.status(409).json({

          status:
            "ERROR",

          message:
            "ESTA SOLICITUD YA FUE RESPONDIDA.",

        });

      }


      const updateResult =
        await client.query(
          `
          UPDATE public.profile_access_requests

          SET
            status = 'APPROVED',
            responded_at = NOW()

          WHERE id = $1
            AND target_user_id = $2
            AND status = 'PENDING'

          RETURNING
            id,
            requester_user_id,
            target_user_id,
            status,
            created_at,
            responded_at,
            interpreted_at,

            responsibility_accepted_at,
            accessed_at,
            access_started_at,
            access_expires_at,
            access_closed_at,
            access_closed_reason
          `,
          [
            requestId,
            targetUserId,
          ]
        );


      const approved =
        updateResult.rows[0];


      if (!approved) {

        return res.status(409).json({

          status:
            "ERROR",

          message:
            "NO FUE POSIBLE APROBAR LA SOLICITUD.",

        });

      }


      // =====================================================
      // AUDITORÍA
      // =====================================================

      await registerAuditEvent(
        client,
        {
          requestId:
            approved.id,

          requesterUserId:
            approved.requester_user_id,

          targetUserId:
            approved.target_user_id,

          eventType:
            "REQUEST_APPROVED",

          metadata: {
            accessGranted:
              false,
            responsibilityStillRequired:
              true,
          },

        }
      );


      // =====================================================
      // AVISAR AL SOLICITANTE
      // =====================================================

      const requesterPayload =
        await buildTargetProfilePayload(
          client,
          approved
        );


      emitProfileAccessRequest(
        approved.requester_user_id,
        {

          eventType:
            "PROFILE_ACCESS_APPROVED",

          requestId:
            approved.id,

          requesterUserId:
            approved.requester_user_id,

          targetUserId:
            approved.target_user_id,

          status:
            "APPROVED",

          createdAt:
            approved.created_at,

          respondedAt:
            approved.responded_at,

          target:
            requesterPayload,

          message:
            "EL PROPIETARIO DEL PERFIL AUTORIZÓ TU SOLICITUD. DEBES ACEPTAR LA RESPONSABILIDAD PARA CONTINUAR.",

        }
      );


      return res.status(200).json({

        status:
          "SUCCESS",

        message:
          "SOLICITUD AUTORIZADA. EL SOLICITANTE DEBE ACEPTAR LA RESPONSABILIDAD ANTES DE ACCEDER AL PERFIL.",

        request: {

          id:
            approved.id,

          requesterUserId:
            approved.requester_user_id,

          targetUserId:
            approved.target_user_id,

          status:
            approved.status,

          createdAt:
            approved.created_at,

          respondedAt:
            approved.responded_at,

        },

      });


    } catch (error) {

      console.error(
        "PROFILE ACCESS APPROVE ERROR:",
        error
      );


      return res.status(500).json({

        status:
          "ERROR",

        message:
          "NO FUE POSIBLE APROBAR LA SOLICITUD.",

      });


    } finally {

      client.release();

    }

  }
);


// =========================================================
// RECHAZAR SOLICITUD
// =========================================================

router.post(
  "/:requestId/reject",
  async (req, res) => {

    const client =
      await pool.connect();


    try {

      const decoded =
        await authenticateSession(
          req,
          res
        );


      if (!decoded) {
        return;
      }


      const targetUserId =
        decoded.userId;


      const {
        requestId,
      } = req.params;


      if (!requestId) {

        return res.status(400).json({

          status:
            "ERROR",

          message:
            "SOLICITUD NO VÁLIDA.",

        });

      }


      const updateResult =
        await client.query(
          `
          UPDATE public.profile_access_requests

          SET
            status = 'REJECTED',
            responded_at = NOW()

          WHERE id = $1
            AND target_user_id = $2
            AND status = 'PENDING'

          RETURNING
            id,
            requester_user_id,
            target_user_id,
            status,
            created_at,
            responded_at
          `,
          [
            requestId,
            targetUserId,
          ]
        );


      if (
        updateResult.rows.length === 0
      ) {

        return res.status(404).json({

          status:
            "ERROR",

          message:
            "NO SE ENCONTRÓ UNA SOLICITUD PENDIENTE PARA RECHAZAR.",

        });

      }


      const rejected =
        updateResult.rows[0];


      await registerAuditEvent(
        client,
        {
          requestId:
            rejected.id,

          requesterUserId:
            rejected.requester_user_id,

          targetUserId:
            rejected.target_user_id,

          eventType:
            "REQUEST_REJECTED",

          metadata: {},

        }
      );


      // =====================================================
      // AVISAR AL SOLICITANTE
      // =====================================================

      emitProfileAccessRequest(
        rejected.requester_user_id,
        {

          eventType:
            "PROFILE_ACCESS_REJECTED",

          requestId:
            rejected.id,

          requesterUserId:
            rejected.requester_user_id,

          targetUserId:
            rejected.target_user_id,

          status:
            "REJECTED",

          message:
            "EL PROPIETARIO DEL PERFIL NO AUTORIZÓ EL ACCESO.",

        }
      );


      return res.status(200).json({

        status:
          "SUCCESS",

        message:
          "SOLICITUD RECHAZADA.",

        request: {

          id:
            rejected.id,

          requesterUserId:
            rejected.requester_user_id,

          targetUserId:
            rejected.target_user_id,

          status:
            rejected.status,

          createdAt:
            rejected.created_at,

          respondedAt:
            rejected.responded_at,

        },

      });


    } catch (error) {

      console.error(
        "PROFILE ACCESS REJECT ERROR:",
        error
      );


      return res.status(500).json({

        status:
          "ERROR",

        message:
          "NO FUE POSIBLE RECHAZAR LA SOLICITUD.",

      });


    } finally {

      client.release();

    }

  }
);


// =========================================================
// ACEPTAR RESPONSABILIDAD
// =========================================================
//
// POST
// /api/profile-access/:requestId/accept-responsibility
//
// ESTE ES EL MOMENTO EXACTO EN EL QUE COMIENZAN LOS 3 MINUTOS.
//
// Antes:
// APPROVED
//
// Después:
// APPROVED + responsibility_accepted_at
//         + access_started_at
//         + access_expires_at
//
// El perfil NO se devuelve aquí.
// Este endpoint solamente activa la autorización temporal.
// =========================================================

router.post(
  "/:requestId/accept-responsibility",
  async (req, res) => {

    const client =
      await pool.connect();


    try {

      const decoded =
        await authenticateSession(
          req,
          res
        );


      if (!decoded) {
        return;
      }


      const requesterUserId =
        decoded.userId;


      const {
        requestId,
      } = req.params;


      if (!requestId) {

        return res.status(400).json({

          status:
            "ERROR",

          message:
            "SOLICITUD NO VÁLIDA.",

        });

      }


      await client.query(
        "BEGIN"
      );


      const requestResult =
        await client.query(
          `
          SELECT
            id,
            requester_user_id,
            target_user_id,
            status,
            created_at,
            responded_at,
            responsibility_accepted_at,
            accessed_at,
            access_started_at,
            access_expires_at,
            access_closed_at

          FROM public.profile_access_requests

          WHERE id = $1
            AND requester_user_id = $2

          LIMIT 1

          FOR UPDATE
          `,
          [
            requestId,
            requesterUserId,
          ]
        );


      if (
        requestResult.rows.length === 0
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(404).json({

          status:
            "ERROR",

          message:
            "AUTORIZACIÓN DE PERFIL NO ENCONTRADA.",

        });

      }


      const request =
        requestResult.rows[0];


      if (
        request.status !==
        "APPROVED"
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(403).json({

          status:
            "ERROR",

          message:
            "EL PROPIETARIO TODAVÍA NO HA AUTORIZADO EL ACCESO.",

        });

      }


      if (
        request.access_closed_at
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(403).json({

          status:
            "ERROR",

          message:
            "ESTE ACCESO YA FUE CERRADO. DEBES SOLICITAR ACCESO NUEVAMENTE.",

        });

      }


      if (
        request.access_started_at &&
        request.access_expires_at
      ) {

        const expiration =
          new Date(
            request.access_expires_at
          ).getTime();


        if (
          expiration >
          Date.now()
        ) {

          await client.query(
            "ROLLBACK"
          );

          return res.status(409).json({

            status:
              "ACTIVE",

            message:
              "EL ACCESO AL PERFIL YA ESTÁ ACTIVO.",

            accessStartedAt:
              request.access_started_at,

            accessExpiresAt:
              request.access_expires_at,

          });

        }

      }


      const updateResult =
        await client.query(
          `
          UPDATE public.profile_access_requests

          SET
            responsibility_accepted_at =
              NOW(),

            accessed_at =
              NOW(),

            access_started_at =
              NOW(),

            access_expires_at =
              NOW() + INTERVAL '3 minutes',

            access_closed_at =
              NULL,

            access_closed_reason =
              NULL

          WHERE id = $1
            AND requester_user_id = $2
            AND status = 'APPROVED'
            AND access_started_at IS NULL
            AND access_closed_at IS NULL

          RETURNING
            id,
            requester_user_id,
            target_user_id,
            status,
            created_at,
            responded_at,
            responsibility_accepted_at,
            accessed_at,
            access_started_at,
            access_expires_at,
            access_closed_at,
            access_closed_reason
          `,
          [
            requestId,
            requesterUserId,
          ]
        );


      if (
        updateResult.rows.length === 0
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(409).json({

          status:
            "ERROR",

          message:
            "NO FUE POSIBLE ACTIVAR EL ACCESO AL PERFIL.",

        });

      }


      const activeAccess =
        updateResult.rows[0];


      // =====================================================
      // AUDITORÍA
      // =====================================================

      await registerAuditEvent(
        client,
        {
          requestId:
            activeAccess.id,

          requesterUserId:
            activeAccess.requester_user_id,

          targetUserId:
            activeAccess.target_user_id,

          eventType:
            "RESPONSIBILITY_ACCEPTED",

          metadata: {
            durationMinutes:
              3,
          },

        }
      );


      await registerAuditEvent(
        client,
        {
          requestId:
            activeAccess.id,

          requesterUserId:
            activeAccess.requester_user_id,

          targetUserId:
            activeAccess.target_user_id,

          eventType:
            "ACCESS_STARTED",

          metadata: {
            durationMinutes:
              3,
          },

        }
      );


      await client.query(
        "COMMIT"
      );


      // =====================================================
      // AVISAR AL PROPIETARIO
      // =====================================================

      emitProfileAccessRequest(
        activeAccess.target_user_id,
        {

          eventType:
            "PROFILE_ACCESS_STARTED",

          requestId:
            activeAccess.id,

          requesterUserId:
            activeAccess.requester_user_id,

          targetUserId:
            activeAccess.target_user_id,

          status:
            activeAccess.status,

          responsibilityAcceptedAt:
            activeAccess.responsibility_accepted_at,

          accessedAt:
            activeAccess.accessed_at,

          accessStartedAt:
            activeAccess.access_started_at,

          accessExpiresAt:
            activeAccess.access_expires_at,

          message:
            "EL OPERADOR ACEPTÓ LA RESPONSABILIDAD Y ACCEDIÓ A TU PERFIL PROFESIONAL.",

        }
      );


      return res.status(200).json({

        status:
          "ACTIVE",

        message:
          "RESPONSABILIDAD ACEPTADA. EL ACCESO AL PERFIL ESTÁ ACTIVO DURANTE 3 MINUTOS.",

        request: {

          id:
            activeAccess.id,

          requesterUserId:
            activeAccess.requester_user_id,

          targetUserId:
            activeAccess.target_user_id,

          status:
            activeAccess.status,

          responsibilityAcceptedAt:
            activeAccess.responsibility_accepted_at,

          accessedAt:
            activeAccess.accessed_at,

          accessStartedAt:
            activeAccess.access_started_at,

          accessExpiresAt:
            activeAccess.access_expires_at,

        },

      });


    } catch (error) {

      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}

      console.error(
        "PROFILE ACCESS RESPONSIBILITY ERROR:",
        error
      );


      return res.status(500).json({

        status:
          "ERROR",

        message:
          "NO FUE POSIBLE ACEPTAR LA RESPONSABILIDAD Y ACTIVAR EL ACCESO.",

      });


    } finally {

      client.release();

    }

  }
);



 // =========================================================
 // VERIFICAR / OBTENER PERFIL PRIVADO AUTORIZADO
 // =========================================================
 //
 // GET /api/profile-access/:requestId/profile
 //
 // El acceso solo funciona mientras la autorización temporal
 // esté activa. El vencimiento se valida en PostgreSQL.
 // =========================================================

router.get(
  "/:requestId/profile",
  async (req, res) => {
    let client;
    let transactionStarted = false;

    try {
      const decoded = await authenticateSession(req, res);

      if (!decoded) {
        return;
      }

      const requesterUserId = decoded.userId;
      const { requestId } = req.params;

      client = await pool.connect();

      await client.query("BEGIN");
      transactionStarted = true;

      // Bloquear la autorización para evitar que otra operación
      // modifique su estado durante esta comprobación.
      const accessResult = await client.query(
        `
        SELECT
          id,
          requester_user_id,
          target_user_id,
          status,
          responsibility_accepted_at,
          access_started_at,
          access_expires_at,
          access_closed_at
        FROM public.profile_access_requests
        WHERE id = $1
          AND requester_user_id = $2
        FOR UPDATE
        `,
        [requestId, requesterUserId]
      );

      if (accessResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          status: "ERROR",
          message: "AUTORIZACIÓN DE PERFIL NO ENCONTRADA.",
        });
      }

      const access = accessResult.rows[0];

      if (access.status !== "APPROVED") {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(403).json({
          status: "FORBIDDEN",
          message: "EL PERFIL NO ESTÁ AUTORIZADO.",
        });
      }

      if (!access.access_started_at) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(403).json({
          status: "WAITING_RESPONSIBILITY",
          message:
            "DEBES ACEPTAR LA RESPONSABILIDAD ANTES DE VER EL PERFIL.",
        });
      }

      if (access.access_closed_at) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(403).json({
          status: "CLOSED",
          message: "EL ACCESO A ESTE PERFIL YA FINALIZÓ.",
        });
      }

      // PostgreSQL determina si el acceso sigue vigente.
      const expirationResult = await client.query(
        `
        SELECT
          access_expires_at IS NOT NULL
          AND access_expires_at > NOW() AS is_active
        FROM public.profile_access_requests
        WHERE id = $1
        `,
        [requestId]
      );

      if (!expirationResult.rows[0]?.is_active) {
        const expiredResult = await client.query(
          `
          UPDATE public.profile_access_requests
          SET
            access_closed_at = NOW(),
            access_closed_reason = 'EXPIRED'
          WHERE id = $1
            AND requester_user_id = $2
            AND status = 'APPROVED'
            AND access_started_at IS NOT NULL
            AND access_closed_at IS NULL
            AND (
              access_expires_at IS NULL
              OR access_expires_at <= NOW()
            )
          RETURNING
            id,
            requester_user_id,
            target_user_id
          `,
          [requestId, requesterUserId]
        );

        if (expiredResult.rows.length > 0) {
          const expired = expiredResult.rows[0];

          await registerAuditEvent(client, {
            requestId: expired.id,
            requesterUserId: expired.requester_user_id,
            targetUserId: expired.target_user_id,
            eventType: "ACCESS_EXPIRED",
            metadata: {
              automatic: true,
            },
          });
        }

        await client.query("COMMIT");
        transactionStarted = false;

        return res.status(403).json({
          status: "EXPIRED",
          message:
            "EL TIEMPO DE ACCESO AL PERFIL HA FINALIZADO.",
        });
      }

      // Obtener únicamente los datos permitidos del operador.
      const profileResult = await client.query(
        `
        SELECT
          u.id AS profile_user_id,
          u.email,
          u.employee_id,
          u.role,
          u.status AS user_status,
          p.first_name,
          p.last_name,
          p.gender,
          p.photo_url,
          p.job_title
        FROM public.users u
        LEFT JOIN public.user_profiles p
          ON p.user_id = u.id
        WHERE u.id = $1
        LIMIT 1
        `,
        [access.target_user_id]
      );

      if (profileResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          status: "ERROR",
          message: "NO SE ENCONTRÓ EL PERFIL DEL OPERADOR.",
        });
      }

      const row = profileResult.rows[0];

      await client.query("COMMIT");
      transactionStarted = false;

      return res.status(200).json({
        status: "ACTIVE",

        access: {
          requestId: access.id,
          accessStartedAt: access.access_started_at,
          accessExpiresAt: access.access_expires_at,
        },

        profile: {
          id: row.profile_user_id,
          email: row.email,
          employeeId: row.employee_id,
          role: row.role,
          status: row.user_status,
          firstName: row.first_name,
          lastName: row.last_name,
          gender: row.gender,
          photoUrl: row.photo_url || "/operador.png",
          jobTitle: row.job_title,
        },
      });
    } catch (error) {
      if (client && transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error(
            "PROFILE ACCESS ROLLBACK ERROR:",
            rollbackError
          );
        }
      }

      console.error(
        "PROFILE ACCESS PRIVATE PROFILE ERROR:",
        error
      );

      return res.status(500).json({
        status: "ERROR",
        message: "NO FUE POSIBLE OBTENER EL PERFIL PRIVADO.",
      });
    } finally {
      if (client) {
        client.release();
      }
    }
  }
);



/**
 * =======================================================
 * CERRAR ACCESO A PERFIL PRIVADO
 * POST /api/profile-access/:requestId/close
 * =======================================================
 */

router.post(
  "/:requestId/close",
  async (req, res) => {
    let client;

    try {
      const decoded = await authenticateSession(req, res);

      if (!decoded) {
        return;
      }

      const requesterUserId = decoded.userId;
      const { requestId } = req.params;

      client = await pool.connect();

      await client.query("BEGIN");

      // Cerrar únicamente un acceso todavía vigente.
      const result = await client.query(
        `
        UPDATE public.profile_access_requests
        SET
          access_closed_at = NOW(),
          access_closed_reason = 'USER_CLOSED'
        WHERE
          id = $1
          AND requester_user_id = $2
          AND status = 'APPROVED'
          AND responsibility_accepted_at IS NOT NULL
          AND access_started_at IS NOT NULL
          AND access_expires_at > NOW()
          AND access_closed_at IS NULL
        RETURNING
          id,
          requester_user_id,
          target_user_id,
          status,
          access_started_at,
          access_expires_at,
          access_closed_at,
          access_closed_reason
        `,
        [requestId, requesterUserId]
      );

      if (result.rows.length === 0) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          status: "ERROR",
          message:
            "EL ACCESO NO ESTÁ ACTIVO, YA FUE CERRADO O HA VENCIDO.",
        });
      }

      const closed = result.rows[0];

      // Auditoría dentro de la misma transacción.
      await registerAuditEvent(client, {
        requestId: closed.id,
        requesterUserId: closed.requester_user_id,
        targetUserId: closed.target_user_id,
        eventType: "ACCESS_CLOSED",
        metadata: {
          reason: "USER_CLOSED",
        },
      });

      await client.query("COMMIT");

      // Notificar al propietario solo después del COMMIT.
      try {
        emitProfileAccessRequest(
          closed.target_user_id,
          {
            eventType: "PROFILE_ACCESS_CLOSED",
            requestId: closed.id,
            requesterUserId: closed.requester_user_id,
            targetUserId: closed.target_user_id,
            status: closed.status,
            accessClosedAt: closed.access_closed_at,
            accessClosedReason: closed.access_closed_reason,
            message: "EL OPERADOR CERRÓ EL ACCESO A TU PERFIL.",
          }
        );
      } catch (notificationError) {
        console.error(
          "PROFILE ACCESS CLOSE NOTIFICATION ERROR:",
          notificationError
        );
      }

      return res.status(200).json({
        status: "CLOSED",
        message: "EL ACCESO AL PERFIL FUE CERRADO.",
        request: closed,
      });
    } catch (error) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error(
            "PROFILE ACCESS CLOSE ROLLBACK ERROR:",
            rollbackError
          );
        }
      }

      console.error("PROFILE ACCESS CLOSE ERROR:", error);

      return res.status(500).json({
        status: "ERROR",
        message: "NO FUE POSIBLE CERRAR EL ACCESO AL PERFIL.",
      });
    } finally {
      if (client) {
        client.release();
      }
    }
  }
);



/**
 * =======================================================
 * MARCAR PERFIL COMO INTERPRETADO
 * POST /api/profile-access/:requestId/interpreted
 *
 * Compatibilidad: esta acción NO concede acceso.
 * =======================================================
 */

router.post(
  "/:requestId/interpreted",
  async (req, res) => {
    let client;

    try {
      const decoded = await authenticateSession(req, res);

      if (!decoded) {
        return;
      }

      const requesterUserId = decoded.userId;
      const { requestId } = req.params;

      client = await pool.connect();

      await client.query("BEGIN");

      // Obtener y bloquear la solicitud para evitar
      // modificaciones concurrentes sobre este registro.
      const requestResult = await client.query(
        `
        SELECT
          id,
          requester_user_id,
          target_user_id,
          status,
          interpreted_at,
          access_started_at,
          access_expires_at,
          access_closed_at
        FROM public.profile_access_requests
        WHERE
          id = $1
          AND requester_user_id = $2
        LIMIT 1
        FOR UPDATE
        `,
        [requestId, requesterUserId]
      );

      if (requestResult.rows.length === 0) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          status: "ERROR",
          message: "AUTORIZACIÓN DE PERFIL NO ENCONTRADA.",
        });
      }

      const request = requestResult.rows[0];

      if (request.status !== "APPROVED") {
        await client.query("ROLLBACK");

        return res.status(403).json({
          status: "ERROR",
          message: "EL PERFIL TODAVÍA NO ESTÁ AUTORIZADO.",
        });
      }

      if (!request.access_started_at) {
        await client.query("ROLLBACK");

        return res.status(403).json({
          status: "WAITING_RESPONSIBILITY",
          message:
            "DEBES ACEPTAR LA RESPONSABILIDAD ANTES DE ACCEDER AL PERFIL.",
        });
      }

      if (request.access_closed_at) {
        await client.query("ROLLBACK");

        return res.status(403).json({
          status: "CLOSED",
          message: "EL ACCESO AL PERFIL YA FINALIZÓ.",
        });
      }

      // El vencimiento se valida con el reloj de PostgreSQL.
      const expirationResult = await client.query(
        `
        SELECT
          access_expires_at > NOW() AS is_active
        FROM public.profile_access_requests
        WHERE id = $1
        `,
        [requestId]
      );

      if (
        !request.access_expires_at ||
        !expirationResult.rows[0]?.is_active
      ) {
        // Marcar el vencimiento solamente si aún no se cerró.
        const expiredResult = await client.query(
          `
          UPDATE public.profile_access_requests
          SET
            access_closed_at = NOW(),
            access_closed_reason = 'EXPIRED'
          WHERE
            id = $1
            AND access_closed_at IS NULL
            AND access_expires_at <= NOW()
          RETURNING id
          `,
          [requestId]
        );

        if (expiredResult.rows.length > 0) {
          await registerAuditEvent(client, {
            requestId: request.id,
            requesterUserId: request.requester_user_id,
            targetUserId: request.target_user_id,
            eventType: "ACCESS_EXPIRED",
            metadata: {
              automatic: true,
            },
          });
        }

        await client.query("COMMIT");

        return res.status(403).json({
          status: "EXPIRED",
          message: "EL TIEMPO DE ACCESO AL PERFIL HA VENCIDO.",
        });
      }

      if (request.interpreted_at) {
        await client.query("COMMIT");

        return res.status(200).json({
          status: "ALREADY_INTERPRETED",
          message: "EL PERFIL YA FUE MARCADO COMO INTERPRETADO.",
          interpretedAt: request.interpreted_at,
        });
      }

      const updateResult = await client.query(
        `
        UPDATE public.profile_access_requests
        SET interpreted_at = NOW()
        WHERE
          id = $1
          AND requester_user_id = $2
          AND status = 'APPROVED'
          AND access_started_at IS NOT NULL
          AND access_expires_at > NOW()
          AND access_closed_at IS NULL
          AND interpreted_at IS NULL
        RETURNING
          id,
          requester_user_id,
          target_user_id,
          status,
          interpreted_at
        `,
        [requestId, requesterUserId]
      );

      if (updateResult.rows.length === 0) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          status: "ERROR",
          message:
            "NO FUE POSIBLE MARCAR EL PERFIL COMO INTERPRETADO.",
        });
      }

      const interpreted = updateResult.rows[0];

      await registerAuditEvent(client, {
        requestId: interpreted.id,
        requesterUserId: interpreted.requester_user_id,
        targetUserId: interpreted.target_user_id,
        eventType: "PROFILE_INTERPRETED",
        metadata: {},
      });

      await client.query("COMMIT");

      return res.status(200).json({
        status: "SUCCESS",
        message: "PERFIL MARCADO COMO INTERPRETADO.",
        request: {
          id: interpreted.id,
          requesterUserId: interpreted.requester_user_id,
          targetUserId: interpreted.target_user_id,
          status: interpreted.status,
          interpretedAt: interpreted.interpreted_at,
        },
      });
    } catch (error) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error(
            "PROFILE INTERPRETED ROLLBACK ERROR:",
            rollbackError
          );
        }
      }

      console.error("PROFILE ACCESS INTERPRETED ERROR:", error);

      return res.status(500).json({
        status: "ERROR",
        message:
          "NO FUE POSIBLE MARCAR EL PERFIL COMO INTERPRETADO.",
      });
    } finally {
      if (client) {
        client.release();
      }
    }
  }
);



// =========================================================
// EXPORTAR ROUTER
// =========================================================

export default router;