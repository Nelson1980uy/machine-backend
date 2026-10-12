import express from "express";
import jwt from "jsonwebtoken";
import pool from "../config/database.js";

const router =
  express.Router();

const JWT_SECRET =
  process.env.JWT_SECRET;


// =========================================================
// AUTHENTICATE SESSION
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
          .substring(7)
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
        "OPERATOR NEARBY AUTH ERROR:",
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
// GET OPERATORS NEARBY
// =========================================================

router.get(
  "/",
  async (
    req,
    res
  ) => {

    try {

      // =====================================================
      // SESSION
      // =====================================================

      const decoded =
        await authenticateSession(
          req,
          res
        );


      if (!decoded) {
        return;
      }


      // =====================================================
      // CURRENT OPERATOR LOCATION
      // =====================================================

      const currentLocationResult =
        await pool.query(
          `
          SELECT

            latitude,

            longitude

          FROM public.operator_locations

          WHERE

            user_id = $1

            AND is_active = TRUE

          LIMIT 1
          `,
          [
            decoded.userId,
          ]
        );


      if (
        currentLocationResult
          .rows
          .length === 0
      ) {

        return res.status(200).json({

          status:
            "SUCCESS",

          message:
            "UBICACION DEL OPERADOR ACTUAL NO DISPONIBLE.",

          operators:
            [],

        });

      }


      const currentLatitude =
        Number(
          currentLocationResult
            .rows[0]
            .latitude
        );


      const currentLongitude =
        Number(
          currentLocationResult
            .rows[0]
            .longitude
        );


      if (
        !Number.isFinite(
          currentLatitude
        ) ||
        !Number.isFinite(
          currentLongitude
        )
      ) {

        return res.status(500).json({

          status:
            "ERROR",

          message:
            "LA UBICACION DEL OPERADOR ACTUAL NO ES VALIDA.",

        });

      }


      // =====================================================
      // SEARCH NEARBY OPERATORS
      // =====================================================

      const result =
        await pool.query(
          `
          SELECT

            u.id,

            up.first_name,

            up.last_name,

            u.employee_id,

            up.photo_url,

            u.status,

            up.job_title,

            up.locality,

            up.profile_visibility,

            ROUND(
              (
                6371000 *
                2 *
                ASIN(
                  SQRT(

                    POWER(
                      SIN(
                        RADIANS(
                          ol.latitude - $1
                        ) / 2
                      ),
                      2
                    )

                    +

                    COS(
                      RADIANS(
                        $1
                      )
                    )

                    *

                    COS(
                      RADIANS(
                        ol.latitude
                      )
                    )

                    *

                    POWER(
                      SIN(
                        RADIANS(
                          ol.longitude - $2
                        ) / 2
                      ),
                      2
                    )

                  )
                )
              )
            )::INTEGER
            AS distance_meters

          FROM public.operator_locations ol

          INNER JOIN public.users u

            ON u.id =
              ol.user_id

          LEFT JOIN public.user_profiles up

            ON up.user_id =
              u.id

          WHERE

            ol.user_id <> $3

            AND ol.is_active = TRUE

          AND LOWER(u.status) = 'active'

          ORDER BY
            distance_meters ASC
          `,
          [
            currentLatitude,
            currentLongitude,
            decoded.userId,
          ]
        );


      // =====================================================
      // FORMAT RESPONSE
      // =====================================================

      const operators =
        result.rows.map(
          (
            operator
          ) => {

            return {

              id:
                operator.id,

              firstName:
                operator.first_name ||
                "",

              lastName:
                operator.last_name ||
                "",

              employeeId:
                operator.employee_id ||
                "",

              photoUrl:
                operator.photo_url ||
                "",

              status:
                operator.status ||
                "ACTIVE",

              jobTitle:
                operator.job_title ||
                "",

              locality:
                operator.locality ||
                "",

              profileVisibility:
                operator.profile_visibility ||
                "PUBLIC",

              distanceMeters:
                Number(
                  operator.distance_meters
                ),

            };

          }
        );


      // =====================================================
      // RESPONSE
      // =====================================================

      return res.status(200).json({

        status:
          "SUCCESS",

        operators,

      });


    } catch (error) {

      console.error(
        "========================================"
      );

      console.error(
        "OPERATOR NEARBY GET ERROR"
      );

      console.error(
        "MESSAGE:",
        error?.message
      );

      console.error(
        "CODE:",
        error?.code
      );

      console.error(
        "DETAIL:",
        error?.detail
      );

      console.error(
        "HINT:",
        error?.hint
      );

      console.error(
        "STACK:",
        error?.stack
      );

      console.error(
        "========================================"
      );


      return res.status(500).json({

        status:
          "ERROR",

        message:
          "NO SE PUDIERON OBTENER LOS OPERADORES CERCANOS.",

      });

    }

  }
);


export default router;
