import express from "express";
import jwt from "jsonwebtoken";
import pool from "../config/database.js";

const router =
  express.Router();


// =========================================================
// JWT
// =========================================================

const JWT_SECRET =
  process.env.JWT_SECRET;


// =========================================================
// AUTENTICACIÓN
// =========================================================

const authenticateSession =
  async (
    req,
    res
  ) => {

    try {

      const authorization =
        req.headers.authorization ||
        "";

      if (
        !authorization.startsWith(
          "Bearer "
        )
      ) {

        res.status(401).json({
          status:
            "ERROR",
          message:
            "SESION NO AUTORIZADA.",
        });

        return null;
      }


      const token =
        authorization
          .substring(
            7
          )
          .trim();


      if (!token) {

        res.status(401).json({
          status:
            "ERROR",
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
          status:
            "ERROR",
          message:
            "TOKEN DE SESION INVALIDO.",
        });

        return null;
      }


      return decoded;

    } catch (error) {

      console.error(
        "OPERATOR LOCATIONS AUTH ERROR:",
        error
      );


      res.status(401).json({
        status:
          "ERROR",
        message:
          "SESION INVALIDA O EXPIRADA.",
      });


      return null;
    }

  };


// =========================================================
// POST
// ACTUALIZAR UBICACIÓN DEL OPERADOR
// =========================================================

router.post(
  "/",
  async (
    req,
    res
  ) => {

    try {

      // ===================================================
      // AUTENTICACIÓN
      // ===================================================

      const decoded =
        await authenticateSession(
          req,
          res
        );


      if (!decoded) {
        return;
      }


      // ===================================================
      // DATOS RECIBIDOS
      // ===================================================

      const {
        latitude,
        longitude,
        accuracyMeters,
      } =
        req.body;


      // ===================================================
      // VALIDAR LATITUD
      // ===================================================

      const parsedLatitude =
        Number(
          latitude
        );


      if (
        !Number.isFinite(
          parsedLatitude
        ) ||
        parsedLatitude < -90 ||
        parsedLatitude > 90
      ) {

        return res.status(400).json({
          status:
            "ERROR",
          message:
            "LATITUD NO VALIDA.",
        });

      }


      // ===================================================
      // VALIDAR LONGITUD
      // ===================================================

      const parsedLongitude =
        Number(
          longitude
        );


      if (
        !Number.isFinite(
          parsedLongitude
        ) ||
        parsedLongitude < -180 ||
        parsedLongitude > 180
      ) {

        return res.status(400).json({
          status:
            "ERROR",
          message:
            "LONGITUD NO VALIDA.",
        });

      }


      // ===================================================
      // VALIDAR PRECISIÓN
      // ===================================================

      let parsedAccuracy =
        null;


      if (
        accuracyMeters !==
          null &&
        accuracyMeters !==
          undefined &&
        accuracyMeters !==
          ""
      ) {

        parsedAccuracy =
          Number(
            accuracyMeters
          );


        if (
          !Number.isFinite(
            parsedAccuracy
          ) ||
          parsedAccuracy < 0
        ) {

          return res.status(400).json({
            status:
              "ERROR",
            message:
              "PRECISION DE UBICACION NO VALIDA.",
          });

        }

      }


      // ===================================================
      // VERIFICAR OPERADOR
      // ===================================================

      const userResult =
        await pool.query(
          `
          SELECT
            id,
            status
          FROM public.users
          WHERE id = $1
          LIMIT 1
          `,
          [
            decoded.userId,
          ]
        );


      if (
        userResult.rows.length ===
        0
      ) {

        return res.status(404).json({
          status:
            "ERROR",
          message:
            "OPERADOR NO ENCONTRADO.",
        });

      }


      // ===================================================
      // VERIFICAR ESTADO
      // ===================================================

      if (
        String(
          userResult.rows[0].status ||
            ""
        ).toUpperCase() !==
        "ACTIVE"
      ) {

        return res.status(403).json({
          status:
            "ERROR",
          message:
            "EL OPERADOR NO ESTA ACTIVO.",
        });

      }


      // ===================================================
      // INSERTAR / ACTUALIZAR UBICACIÓN
      // ===================================================

      const result =
        await pool.query(
          `
          INSERT INTO public.operator_locations (
            user_id,
            latitude,
            longitude,
            accuracy_meters,
            is_active,
            updated_at
          )

          VALUES (
            $1,
            $2,
            $3,
            $4,
            TRUE,
            NOW()
          )

          ON CONFLICT (
            user_id
          )

          DO UPDATE SET

            latitude =
              EXCLUDED.latitude,

            longitude =
              EXCLUDED.longitude,

            accuracy_meters =
              EXCLUDED.accuracy_meters,

            is_active =
              TRUE,

            updated_at =
              NOW()

          RETURNING
            user_id,
            is_active,
            updated_at
          `,
          [
            decoded.userId,
            parsedLatitude,
            parsedLongitude,
            parsedAccuracy,
          ]
        );


      // ===================================================
      // RESPUESTA
      // ===================================================

      return res.status(200).json({

        status:
          "SUCCESS",

        message:
          "UBICACION DEL OPERADOR ACTUALIZADA.",

        location: {

          userId:
            result.rows[0].user_id,

          isActive:
            result.rows[0].is_active,

          updatedAt:
            result.rows[0].updated_at,

        },

      });

    } catch (error) {

      console.error(
        "OPERATOR LOCATION POST ERROR:",
        error
      );


      return res.status(500).json({

        status:
          "ERROR",

        message:
          "NO FUE POSIBLE ACTUALIZAR LA UBICACION DEL OPERADOR.",

      });

    }

  }
);


export default router;
