import express from "express";
import jwt from "jsonwebtoken";
import pool from "../config/database.js";

const router = express.Router();

const JWT_SECRET =
  process.env.JWT_SECRET;

// =========================================================
// AUTENTICAR SESIÓN
// =========================================================

const authenticateSession =
  async (
    req,
    res
  ) => {

    try {

      const authorization =
        req.headers.authorization;

      if (
        !authorization ||
        !authorization.startsWith(
          "Bearer "
        )
      ) {

        res.status(401).json({
          status: "ERROR",
          message:
            "SESIÓN NO AUTORIZADA.",
        });

        return null;
      }

      const token =
        authorization.substring(
          7
        );

      const decoded =
        jwt.verify(
          token,
          JWT_SECRET
        );

      return decoded;

    } catch (error) {

      res.status(401).json({
        status: "ERROR",
        message:
          "SESIÓN NO VÁLIDA O EXPIRADA.",
      });

      return null;
    }
  };

// =========================================================
// OBTENER SESIÓN ACTUAL + SESIÓN ANTERIOR
// =========================================================

router.get(
  "/session",
  async (
    req,
    res
  ) => {

    try {

      const decoded =
        await authenticateSession(
          req,
          res
        );

      if (!decoded) {
        return;
      }

      const userId =
        decoded.userId;

      // =====================================================
      // ÚLTIMAS SESIONES
      // =====================================================

      const result =
        await pool.query(
          `
          SELECT
            id,
            user_id,
            started_at,
            ended_at,
            last_seen_at,
            duration_seconds,
            session_status
          FROM public.operator_sessions
          WHERE user_id = $1
          ORDER BY
            started_at DESC
          LIMIT 20
          `,
          [userId]
        );

      const sessions =
        result.rows;

      // =====================================================
      // SESIÓN ACTUAL
      // =====================================================

      const currentSession =
        sessions.find(
          (session) =>
            session.session_status ===
            "ACTIVE"
        ) || null;

      // =====================================================
      // SESIÓN ANTERIOR
      // =====================================================

      const previousSession =
        sessions.find(
          (session) =>
            !currentSession ||
            session.id !==
              currentSession.id
        ) || null;

      return res.status(200).json({

        status:
          "SUCCESS",

        currentSession:
          currentSession
            ? {
                id:
                  currentSession.id,

                startedAt:
                  currentSession.started_at,

                lastSeenAt:
                  currentSession.last_seen_at,

                status:
                  currentSession.session_status,
              }
            : null,

        previousSession:
          previousSession
            ? {
                id:
                  previousSession.id,

                startedAt:
                  previousSession.started_at,

                endedAt:
                  previousSession.ended_at,

                lastSeenAt:
                  previousSession.last_seen_at,

                durationSeconds:
                  previousSession.duration_seconds,

                status:
                  previousSession.session_status,
              }
            : null,
      });

    } catch (error) {

      console.error(
        "OPERATOR ACTIVITY SESSION ERROR:",
        error
      );

      return res.status(500).json({
        status:
          "ERROR",

        message:
          "NO FUE POSIBLE OBTENER EL HISTORIAL DE SESIONES.",
      });
    }
  }
);


// =========================================================
// ÚLTIMA CONVERSACIÓN PRIVADA
// =========================================================

router.get(
  "/private-conversation",
  async (
    req,
    res
  ) => {

    try {

      const decoded =
        await authenticateSession(
          req,
          res
        );

      if (!decoded) {
        return;
      }

      const userId =
        decoded.userId;

      // =====================================================
      // OBTENER EL ÚLTIMO MENSAJE PRIVADO REAL
      //
      // TABLAS REALES:
      //
      // chat_private_conversations
      // chat_private_members
      // chat_private_messages
      // users
      // user_profiles
      // =====================================================

      const result =
        await pool.query(
          `
          SELECT
            m.id,
            m.conversation_id,
            m.author_user_id,
            m.text,
            m.created_at,

            other_user.id
              AS other_user_id,

            other_user.email
              AS other_email,

            other_user.employee_id
              AS other_employee_id,

            other_user.role
              AS other_role,

            other_user.status
              AS other_status,

            other_profile.first_name
              AS other_first_name,

            other_profile.last_name
              AS other_last_name,

            other_profile.photo_url
              AS other_photo_url,

            other_profile.job_title
              AS other_job_title

          FROM public.chat_private_messages m

          INNER JOIN public.chat_private_conversations c
            ON c.id =
              m.conversation_id

          INNER JOIN public.chat_private_members current_member
            ON current_member.conversation_id =
              c.id

            AND current_member.user_id =
              $1

          INNER JOIN public.chat_private_members other_member
            ON other_member.conversation_id =
              c.id

            AND other_member.user_id <>
              $1

          INNER JOIN public.users other_user
            ON other_user.id =
              other_member.user_id

          LEFT JOIN public.user_profiles other_profile
            ON other_profile.user_id =
              other_user.id

          ORDER BY
            m.created_at DESC

          LIMIT 1
          `,
          [userId]
        );

      // =====================================================
      // SIN CONVERSACIONES PRIVADAS
      // =====================================================

      if (
        result.rows.length === 0
      ) {

        return res.status(200).json({

          status:
            "SUCCESS",

          conversation:
            null,

        });
      }

      // =====================================================
      // ÚLTIMO MENSAJE
      // =====================================================

      const message =
        result.rows[0];

      // =====================================================
      // OTRO OPERADOR
      // =====================================================

      const otherUser = {

        id:
          message.other_user_id,

        email:
          message.other_email,

        employeeId:
          message.other_employee_id,

        role:
          message.other_role,

        status:
          message.other_status,

        firstName:
          message.other_first_name ||
          "",

        lastName:
          message.other_last_name ||
          "",

        photoUrl:
          message.other_photo_url ||
          "/operador.png",

        jobTitle:
          message.other_job_title ||
          "OPERADOR MACHINE",

      };

      // =====================================================
      // RESPUESTA
      // =====================================================

      return res.status(200).json({

        status:
          "SUCCESS",

        conversation: {

          messageId:
            message.id,

          conversationId:
            message.conversation_id,

          eventAt:
            message.created_at,

          otherUser:
            otherUser,

        },

      });

    } catch (error) {

      console.error(
        "OPERATOR ACTIVITY PRIVATE CONVERSATION ERROR:",
        error
      );

      return res.status(500).json({

        status:
          "ERROR",

        message:
          "NO FUE POSIBLE OBTENER LA ÚLTIMA CONVERSACIÓN PRIVADA.",

      });
    }
  }
);



// =========================================================
// EXPORTAR ROUTER
// =========================================================

export default router;
