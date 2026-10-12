import express from "express";
import jwt from "jsonwebtoken";

import pool from "./config/database.js";


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
// AUTENTICAR SESIÓN
// =========================================================

const authenticateSession = (
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
      "PROFILE VISITS JWT ERROR:",
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
// REGISTRAR VISITA PÚBLICA
// =========================================================
//
// POST
// /api/profile-visits/public/:profileUserId
//
// El operador autenticado visita el perfil público
// de otro operador.
//
// No se registra una visita a sí mismo.
//
// Para evitar spam:
// solamente se registra una nueva visita de la misma
// persona al mismo perfil cada 30 minutos.
//
// =========================================================

router.post(
  "/public/:profileUserId",
  async (
    req,
    res
  ) => {

    try {

      const decoded =
        authenticateSession(
          req,
          res
        );


      if (!decoded) {
        return;
      }


      const visitorUserId =
        String(
          decoded.userId
        ).trim();


      const profileUserId =
        String(
          req.params.profileUserId ||
          ""
        ).trim();


      if (!profileUserId) {

        return res.status(400).json({

          status:
            "ERROR",

          message:
            "EL PERFIL DESTINO NO ES VÁLIDO.",

        });

      }


      // =====================================================
      // NO PERMITIR VISITARSE A UNO MISMO
      // =====================================================

      if (
        visitorUserId ===
        profileUserId
      ) {

        return res.status(200).json({

          status:
            "IGNORED",

          message:
            "LAS VISITAS AL PROPIO PERFIL NO SE REGISTRAN.",

        });

      }


      // =====================================================
      // COMPROBAR QUE EL PERFIL EXISTE
      // =====================================================

      const profileResult =
        await pool.query(
          `
          SELECT
            u.id,
            u.status,
            p.profile_visibility

          FROM public.users u

          LEFT JOIN public.user_profiles p
            ON p.user_id = u.id

          WHERE u.id = $1

          LIMIT 1
          `,
          [
            profileUserId,
          ]
        );


      if (
        profileResult.rows.length === 0
      ) {

        return res.status(404).json({

          status:
            "ERROR",

          message:
            "EL OPERADOR NO EXISTE.",

        });

      }


      const profile =
        profileResult.rows[0];


      // =====================================================
      // SOLO PERFILES PÚBLICOS
      // =====================================================

      const visibility =
        String(
          profile.profile_visibility ||
          "PUBLIC"
        )
          .trim()
          .toUpperCase();


      if (
        visibility !==
        "PUBLIC"
      ) {

        return res.status(403).json({

          status:
            "ERROR",

          message:
            "ESTE PERFIL NO ESTÁ DISPONIBLE COMO PERFIL PÚBLICO.",

        });

      }


      // =====================================================
      // SOLO OPERADORES ACTIVOS
      // =====================================================

      if (
        profile.status !==
        "active"
      ) {

        return res.status(403).json({

          status:
            "ERROR",

          message:
            "EL OPERADOR NO SE ENCUENTRA ACTIVO.",

        });

      }


      // =====================================================
      // EVITAR DUPLICADOS DURANTE 30 MINUTOS
      // =====================================================

      const recentVisitResult =
        await pool.query(
          `
          SELECT
            id,
            visited_at

          FROM public.profile_public_visits

          WHERE profile_owner_id = $1

            AND visitor_user_id = $2

            AND visited_at >=
              NOW() - INTERVAL '30 minutes'

          ORDER BY
            visited_at DESC

          LIMIT 1
          `,
          [
            profileUserId,
            visitorUserId,
          ]
        );


      if (
        recentVisitResult.rows.length >
        0
      ) {

        return res.status(200).json({

          status:
            "ALREADY_REGISTERED",

          message:
            "LA VISITA YA FUE REGISTRADA RECIENTEMENTE.",

          visitedAt:
            recentVisitResult.rows[0]
              .visited_at,

        });

      }


      // =====================================================
      // REGISTRAR VISITA
      // =====================================================

      const insertResult =
        await pool.query(
          `
          INSERT INTO public.profile_public_visits (
            profile_owner_id,
            visitor_user_id,
            visited_at
          )

          VALUES (
            $1,
            $2,
            NOW()
          )

          RETURNING
            id,
            profile_owner_id,
            visitor_user_id,
            visited_at
          `,
          [
            profileUserId,
            visitorUserId,
          ]
        );


      const visit =
        insertResult.rows[0];


      return res.status(201).json({

        status:
          "SUCCESS",

        message:
          "VISITA PÚBLICA REGISTRADA.",

        visit: {

          id:
            visit.id,

          profileOwnerId:
            visit.profile_owner_id,

          visitorUserId:
            visit.visitor_user_id,

          visitedAt:
            visit.visited_at,

        },

      });

    } catch (error) {

      console.error(
        "PROFILE PUBLIC VISIT CREATE ERROR:",
        error
      );


      return res.status(500).json({

        status:
          "ERROR",

        message:
          "NO FUE POSIBLE REGISTRAR LA VISITA PÚBLICA.",

      });

    }

  }
);


// =========================================================
// OBTENER VISITAS PÚBLICAS RECIBIDAS
// =========================================================
//
// GET
// /api/profile-visits/public
//
// Devuelve los operadores que visitaron el perfil
// público del usuario autenticado.
//
// =========================================================

router.get(
  "/public",
  async (
    req,
    res
  ) => {

    try {

      const decoded =
        authenticateSession(
          req,
          res
        );


      if (!decoded) {
        return;
      }


      const profileOwnerId =
        String(
          decoded.userId
        ).trim();


      const result =
        await pool.query(
          `
          SELECT

            v.id,
            v.profile_owner_id,
            v.visitor_user_id,
            v.visited_at,

            u.email,
            u.employee_id,
            u.role,
            u.status AS user_status,

            p.first_name,
            p.last_name,
            p.gender,
            p.photo_url,
            p.job_title

          FROM public.profile_public_visits v

          INNER JOIN public.users u
            ON u.id =
              v.visitor_user_id

          LEFT JOIN public.user_profiles p
            ON p.user_id =
              v.visitor_user_id

          WHERE v.profile_owner_id = $1

          ORDER BY
            v.visited_at DESC

          LIMIT 100
          `,
          [
            profileOwnerId,
          ]
        );


      return res.status(200).json({

        status:
          "SUCCESS",

        visits:
          result.rows.map(
            (
              visit
            ) => ({

              id:
                visit.id,

              profileOwnerId:
                visit.profile_owner_id,

              visitorUserId:
                visit.visitor_user_id,

              visitedAt:
                visit.visited_at,

              visitor: {

                id:
                  visit.visitor_user_id,

                email:
                  visit.email,

                employeeId:
                  visit.employee_id,

                role:
                  visit.role,

                status:
                  visit.user_status,

                firstName:
                  visit.first_name ||
                  "",

                lastName:
                  visit.last_name ||
                  "",

                gender:
                  visit.gender ||
                  null,

                photoUrl:
                  visit.photo_url ||
                  "/operador.png",

                jobTitle:
                  visit.job_title ||
                  "OPERADOR",

              },

            })
          ),

      });

    } catch (error) {

      console.error(
        "PROFILE PUBLIC VISITS GET ERROR:",
        error
      );


      return res.status(500).json({

        status:
          "ERROR",

        message:
          "NO FUE POSIBLE OBTENER LAS VISITAS PÚBLICAS.",

      });

    }

  }
);


// =========================================================
// OBTENER PERFILES PÚBLICOS VISITADOS POR EL OPERADOR
// =========================================================
//
// GET
// /api/profile-visits/outgoing
//
// Devuelve los perfiles públicos que el operador
// autenticado ha visitado.
//
// Se utiliza para:
//
// ACTIVIDAD Y CONECTIVIDAD
// → ÚLTIMO PERFIL PÚBLICO VISITADO
//
// =========================================================

router.get(
  "/outgoing",
  async (
    req,
    res
  ) => {

    try {

      const decoded =
        authenticateSession(
          req,
          res
        );


      if (!decoded) {
        return;
      }


      const visitorUserId =
        String(
          decoded.userId
        ).trim();


      const result =
        await pool.query(
          `
          SELECT

            v.id,
            v.profile_owner_id,
            v.visitor_user_id,
            v.visited_at,

            u.email,
            u.employee_id,
            u.role,
            u.status AS user_status,

            p.first_name,
            p.last_name,
            p.gender,
            p.photo_url,
            p.job_title,
            p.profile_visibility

          FROM public.profile_public_visits v

          INNER JOIN public.users u
            ON u.id =
              v.profile_owner_id

          LEFT JOIN public.user_profiles p
            ON p.user_id =
              v.profile_owner_id

          WHERE v.visitor_user_id = $1

          ORDER BY
            v.visited_at DESC

          LIMIT 100
          `,
          [
            visitorUserId,
          ]
        );


      return res.status(200).json({

        status:
          "SUCCESS",

        visits:
          result.rows.map(
            (
              visit
            ) => ({

              id:
                visit.id,

              profileOwnerId:
                visit.profile_owner_id,

              visitorUserId:
                visit.visitor_user_id,

              visitedAt:
                visit.visited_at,

              profile: {

                id:
                  visit.profile_owner_id,

                email:
                  visit.email,

                employeeId:
                  visit.employee_id,

                role:
                  visit.role,

                status:
                  visit.user_status,

                firstName:
                  visit.first_name ||
                  "",

                lastName:
                  visit.last_name ||
                  "",

                gender:
                  visit.gender ||
                  null,

                photoUrl:
                  visit.photo_url ||
                  "/operador.png",

                jobTitle:
                  visit.job_title ||
                  "OPERADOR",

                profileVisibility:
                  visit.profile_visibility ||
                  "PUBLIC",

              },

            })
          ),

      });

    } catch (error) {

      console.error(
        "PROFILE PUBLIC OUTGOING VISITS GET ERROR:",
        error
      );


      return res.status(500).json({

        status:
          "ERROR",

        message:
          "NO FUE POSIBLE OBTENER LOS PERFILES PÚBLICOS VISITADOS.",

      });

    }

  }
);


export default router;
