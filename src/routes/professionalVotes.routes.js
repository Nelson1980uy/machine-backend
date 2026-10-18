import express from "express";
import jwt from "jsonwebtoken";
import pool from "../config/database.js";

const router = express.Router();

const JWT_SECRET =
  process.env.JWT_SECRET;

// =======================================================
// CATEGORÍAS PROFESIONALES MACHINE
// =======================================================

const PROFESSIONAL_CATEGORIES = [
  "TRABAJO_EN_EQUIPO",
  "APOYO_OPERATIVO",
  "SEGURIDAD_EN_MAQUINA",
  "RESPONSABILIDAD_OPERATIVA",
  "RESPUESTA_ANTE_INCIDENCIAS",
  "CONOCIMIENTO_DE_MAQUINA",
  "CAPACITACION_Y_FORMACION",
  "LIDERAZGO_OPERATIVO",
];

// =======================================================
// AUTENTICACIÓN
// =======================================================

const authenticateSession = async (
  req,
  res
) => {

  try {

    const authorization =
      req.headers.authorization || "";

    if (
      !authorization.startsWith(
        "Bearer "
      )
    ) {

      res.status(401).json({
        status: "ERROR",
        message:
          "SESION NO AUTORIZADA.",
      });

      return null;
    }

    const token =
      authorization.substring(
        7
      ).trim();

    if (!token) {

      res.status(401).json({
        status: "ERROR",
        message:
          "TOKEN DE SESION NO ENCONTRADO.",
      });

      return null;
    }

    const decoded =
      jwt.verify(
        token,
        JWT_SECRET
      );

    if (
      !decoded ||
      !decoded.userId
    ) {

      res.status(401).json({
        status: "ERROR",
        message:
          "TOKEN DE SESION INVALIDO.",
      });

      return null;
    }

    return decoded;

  } catch (error) {

    console.error(
      "PROFESSIONAL VOTES AUTH ERROR:",
      error
    );

    res.status(401).json({
      status: "ERROR",
      message:
        "SESION INVALIDA O EXPIRADA.",
    });

    return null;
  }
};


/**
 * MACHINE — CONTROL DE ACCESO A PERFILES PRIVADOS
 *
 * Los perfiles públicos conservan su funcionamiento.
 * Los perfiles privados requieren una autorización activa
 * que no haya superado su vencimiento en el servidor.
 */
const requireProfileAccessIfPrivate = async (
  requesterUserId,
  targetUserId,
  res
) => {
  try {
    const result = await pool.query(
      `
      SELECT
        COALESCE(
          UPPER(p.profile_visibility),
          'PUBLIC'
        ) AS profile_visibility,

        EXISTS (
          SELECT 1
          FROM public.profile_access_requests r
          WHERE
            r.requester_user_id = $1
            AND r.target_user_id = $2
            AND r.status = 'APPROVED'
            AND r.responsibility_accepted_at IS NOT NULL
            AND r.access_started_at IS NOT NULL
            AND r.access_expires_at > NOW()
            AND r.access_closed_at IS NULL
        ) AS has_active_access

      FROM public.users u

      LEFT JOIN public.user_profiles p
        ON p.user_id = u.id

      WHERE u.id = $2

      LIMIT 1
      `,
      [requesterUserId, targetUserId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        status: "ERROR",
        message: "OPERADOR NO ENCONTRADO.",
      });

      return false;
    }

    const {
      profile_visibility,
      has_active_access,
    } = result.rows[0];

    // Los perfiles públicos no necesitan autorización temporal.
    if (profile_visibility !== "PRIVATE") {
      return true;
    }

    // Un perfil privado requiere acceso activo en el servidor.
    if (!has_active_access) {
      res.status(403).json({
        status: "ERROR",
        code: "PROFILE_ACCESS_REQUIRED",
        message:
          "EL ACCESO AL PERFIL PRIVADO NO ESTÁ ACTIVO O HA VENCIDO.",
      });

      return false;
    }

    return true;
  } catch (error) {
    console.error(
      "MACHINE PROFILE ACCESS VALIDATION ERROR:",
      error
    );

    res.status(500).json({
      status: "ERROR",
      message:
        "NO FUE POSIBLE VALIDAR EL ACCESO AL PERFIL.",
    });

    return false;
  }
};


// =======================================================
// GET
// RECONOCIMIENTOS RECIBIDOS POR EL OPERADOR ACTUAL
// =======================================================

router.get(
  "/me",
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


      const targetUserId =
        decoded.userId;


      const result =
        await pool.query(
          `
          SELECT
            category,
            COUNT(*)::INTEGER AS votes
          FROM public.operator_professional_votes
          WHERE target_user_id = $1
          GROUP BY category
          `,
          [
            targetUserId,
          ]
        );


      const counts = {};


      for (
        const category
        of PROFESSIONAL_CATEGORIES
      ) {

        counts[category] = 0;

      }


      for (
        const row
        of result.rows
      ) {

        counts[row.category] =
          Number(
            row.votes
          );

      }


      return res.status(200).json({

        status:
          "SUCCESS",

        targetUserId,

        categories:
          PROFESSIONAL_CATEGORIES.map(
            (
              category
            ) => ({

              category,

              votes:
                counts[
                  category
                ] || 0,

            })
          ),

      });

    } catch (error) {

      console.error(
        "PROFESSIONAL VOTES ME ERROR:",
        error
      );

      return res.status(500).json({

        status:
          "ERROR",

        message:
          "NO FUE POSIBLE OBTENER LAS VALORACIONES PROFESIONALES.",

      });

    }

  }
);






// =======================================================
// GET
// VALORACIONES RECIBIDAS POR UN MAQUINISTA
// =======================================================

router.get(
  "/:userId",
  async (req, res) => {
    try {
      const decoded = await authenticateSession(req, res);

      if (!decoded) return;

      const targetUserId = req.params.userId;

      const userResult = await pool.query(
        `
        SELECT id
        FROM public.users
        WHERE id = $1
        LIMIT 1
        `,
        [targetUserId]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          status: "ERROR",
          message: "OPERADOR NO ENCONTRADO.",
        });
      }

      const hasAccess = await requireProfileAccessIfPrivate(
        decoded.userId,
        targetUserId,
        res
      );

      if (!hasAccess) return;

      const result = await pool.query(
        `
        SELECT
          category,
          COUNT(*)::INTEGER AS votes
        FROM public.operator_professional_votes
        WHERE target_user_id = $1
        GROUP BY category
        `,
        [targetUserId]
      );

      const counts = {};

      for (const category of PROFESSIONAL_CATEGORIES) {
        counts[category] = 0;
      }

      for (const row of result.rows) {
        counts[row.category] = Number(row.votes);
      }

      return res.status(200).json({
        status: "SUCCESS",
        targetUserId,
        categories: PROFESSIONAL_CATEGORIES.map((category) => ({
          category,
          votes: counts[category] || 0,
        })),
      });
    } catch (error) {
      console.error("PROFESSIONAL VOTES GET ERROR:", error);

      return res.status(500).json({
        status: "ERROR",
        message: "NO FUE POSIBLE OBTENER LAS VALORACIONES PROFESIONALES.",
      });
    }
  }
);

// =======================================================
// GET
// MI VOTO SOBRE UN MAQUINISTA
// =======================================================

router.get(
  "/:userId/my-vote",
  async (req, res) => {
    try {
      const decoded = await authenticateSession(req, res);

      if (!decoded) return;

      const voterUserId = decoded.userId;
      const targetUserId = req.params.userId;

      const hasAccess = await requireProfileAccessIfPrivate(
        voterUserId,
        targetUserId,
        res
      );

      if (!hasAccess) return;

      const result = await pool.query(
        `
        SELECT
          id,
          category,
          created_at,
          updated_at
        FROM public.operator_professional_votes
        WHERE
          voter_user_id = $1
          AND target_user_id = $2
        LIMIT 1
        `,
        [voterUserId, targetUserId]
      );

      if (result.rows.length === 0) {
        return res.status(200).json({
          status: "SUCCESS",
          hasVote: false,
          vote: null,
        });
      }

      const vote = result.rows[0];

      return res.status(200).json({
        status: "SUCCESS",
        hasVote: true,
        vote: {
          id: vote.id,
          category: vote.category,
          createdAt: vote.created_at,
          updatedAt: vote.updated_at,
        },
      });
    } catch (error) {
      console.error("PROFESSIONAL VOTES MY VOTE ERROR:", error);

      return res.status(500).json({
        status: "ERROR",
        message: "NO FUE POSIBLE OBTENER TU VALORACION.",
      });
    }
  }
);

// =======================================================
// POST
// EMITIR O ACTUALIZAR VOTO PROFESIONAL
// =======================================================

router.post(
  "/:userId",
  async (req, res) => {
    try {
      const decoded = await authenticateSession(req, res);

      if (!decoded) return;

      const voterUserId = decoded.userId;
      const targetUserId = req.params.userId;

      const category = String(req.body?.category || "")
        .trim()
        .toUpperCase();

      // No permitir votar sobre el propio perfil.
      if (voterUserId === targetUserId) {
        return res.status(400).json({
          status: "ERROR",
          message: "NO PUEDES EMITIR UNA VALORACION SOBRE TU PROPIO PERFIL.",
        });
      }

      // Validar categoría.
      if (!PROFESSIONAL_CATEGORIES.includes(category)) {
        return res.status(400).json({
          status: "ERROR",
          message: "LA CATEGORIA PROFESIONAL NO ES VALIDA.",
        });
      }

      // Validar operador destino.
      const targetResult = await pool.query(
        `
        SELECT id, status
        FROM public.users
        WHERE id = $1
        LIMIT 1
        `,
        [targetUserId]
      );

      if (targetResult.rows.length === 0) {
        return res.status(404).json({
          status: "ERROR",
          message: "OPERADOR NO ENCONTRADO.",
        });
      }

      if (
        String(targetResult.rows[0].status || "").toUpperCase() !==
        "ACTIVE"
      ) {
        return res.status(400).json({
          status: "ERROR",
          message: "EL OPERADOR NO SE ENCUENTRA ACTIVO.",
        });
      }

      // Verificar autorización antes de modificar el voto.
      const hasAccess = await requireProfileAccessIfPrivate(
        voterUserId,
        targetUserId,
        res
      );

      if (!hasAccess) return;

      // Buscar voto existente.
      const existingResult = await pool.query(
        `
        SELECT
          id,
          category,
          created_at,
          updated_at
        FROM public.operator_professional_votes
        WHERE
          voter_user_id = $1
          AND target_user_id = $2
        LIMIT 1
        `,
        [voterUserId, targetUserId]
      );

      // Crear voto.
      if (existingResult.rows.length === 0) {
        const insertResult = await pool.query(
          `
          INSERT INTO public.operator_professional_votes (
            voter_user_id,
            target_user_id,
            category
          )
          VALUES ($1, $2, $3)
          RETURNING
            id,
            voter_user_id,
            target_user_id,
            category,
            created_at,
            updated_at
          `,
          [voterUserId, targetUserId, category]
        );

        return res.status(201).json({
          status: "SUCCESS",
          action: "CREATED",
          message: "VALORACION PROFESIONAL REGISTRADA CORRECTAMENTE.",
          vote: insertResult.rows[0],
        });
      }

      // Actualizar voto existente.
      const existingVote = existingResult.rows[0];

      if (existingVote.category === category) {
        return res.status(200).json({
          status: "SUCCESS",
          action: "UNCHANGED",
          message: "YA HABIAS SELECCIONADO ESTA VALORACION PROFESIONAL.",
          vote: existingVote,
        });
      }

      const updateResult = await pool.query(
        `
        UPDATE public.operator_professional_votes
        SET
          category = $1,
          updated_at = NOW()
        WHERE id = $2
        RETURNING
          id,
          voter_user_id,
          target_user_id,
          category,
          created_at,
          updated_at
        `,
        [category, existingVote.id]
      );

      return res.status(200).json({
        status: "SUCCESS",
        action: "UPDATED",
        message: "VALORACION PROFESIONAL ACTUALIZADA CORRECTAMENTE.",
        vote: updateResult.rows[0],
      });
    } catch (error) {
      console.error("PROFESSIONAL VOTE POST ERROR:", error);

      return res.status(500).json({
        status: "ERROR",
        message: "NO FUE POSIBLE REGISTRAR LA VALORACION PROFESIONAL.",
      });
    }
  }
);



// =======================================================
// DELETE
// RETIRAR MI VALORACIÓN PROFESIONAL
// =======================================================

router.delete(
  "/:userId",
  async (req, res) => {
    try {
      const decoded = await authenticateSession(req, res);

      if (!decoded) {
        return;
      }

      const voterUserId = decoded.userId;
      const targetUserId = req.params.userId;

      // No permitir retirar una valoración del propio perfil.
      if (voterUserId === targetUserId) {
        return res.status(400).json({
          status: "ERROR",
          message:
            "NO PUEDES RETIRAR UNA VALORACION SOBRE TU PROPIO PERFIL.",
        });
      }

      // Comprobar que el operador destino existe.
      const targetResult = await pool.query(
        `
        SELECT id
        FROM public.users
        WHERE id = $1
        LIMIT 1
        `,
        [targetUserId]
      );

      if (targetResult.rows.length === 0) {
        return res.status(404).json({
          status: "ERROR",
          message: "OPERADOR NO ENCONTRADO.",
        });
      }

      // Validar el acceso si el perfil es privado.
      const hasAccess = await requireProfileAccessIfPrivate(
        voterUserId,
        targetUserId,
        res
      );

      if (!hasAccess) {
        return;
      }

      // Retirar únicamente la valoración del operador autenticado.
      const result = await pool.query(
        `
        DELETE FROM public.operator_professional_votes
        WHERE
          voter_user_id = $1
          AND target_user_id = $2
        RETURNING
          id,
          category
        `,
        [voterUserId, targetUserId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "ERROR",
          message:
            "NO EXISTE UNA VALORACION TUYA PARA ESTE OPERADOR.",
        });
      }

      return res.status(200).json({
        status: "SUCCESS",
        message:
          "VALORACION PROFESIONAL RETIRADA CORRECTAMENTE.",
        removedVote: result.rows[0],
      });
    } catch (error) {
      console.error(
        "PROFESSIONAL VOTE DELETE ERROR:",
        error
      );

      return res.status(500).json({
        status: "ERROR",
        message:
          "NO FUE POSIBLE RETIRAR LA VALORACION PROFESIONAL.",
      });
    }
  }
);


export default router;