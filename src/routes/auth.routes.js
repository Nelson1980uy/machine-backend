import express from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import jwt from "jsonwebtoken";

import pool from "../config/database.js";
import supabase from "../config/supabase.js";

const router = express.Router();


// =========================================================
// CONFIGURACIÓN DE SESIONES JWT
// =========================================================

const JWT_SECRET = process.env.JWT_SECRET;

const JWT_EXPIRES_IN =
  process.env.JWT_EXPIRES_IN || "7d";

if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET no está configurado en el archivo .env"
  );
}

// =========================================================
// CONFIGURACIÓN DE SUBIDA DE FOTOS
// =========================================================

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
  },

  fileFilter: (req, file, callback) => {
    const allowedMimeTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      return callback(
        new Error(
          "Formato de imagen no permitido. Utiliza JPG, PNG o WebP."
        )
      );
    }

    callback(null, true);
  },
});

// =========================================================
// CONSTANTES
// =========================================================

const STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET ||
  "operator-profiles";

const DEFAULT_OPERATOR_PHOTO =
  "/operador.png";

// =========================================================
// REGISTER OPERATOR
// =========================================================

router.post(
  "/register",

  // -------------------------------------------------------
  // RECIBIR FORM DATA + FOTO
  // -------------------------------------------------------

  (req, res, next) => {
    upload.single("photo")(req, res, (error) => {
      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            status: "ERROR",
            message:
              "La imagen no puede superar los 5 MB.",
          });
        }

        return res.status(400).json({
          status: "ERROR",
          message:
            "No fue posible procesar la imagen.",
        });
      }

      if (error) {
        return res.status(400).json({
          status: "ERROR",
          message:
            error.message ||
            "El archivo de imagen no es válido.",
        });
      }

      next();
    });
  },

  // -------------------------------------------------------
  // REGISTRO
  // -------------------------------------------------------

  async (req, res) => {
    const client = await pool.connect();

    let uploadedStoragePath = null;

    try {
      const {
        firstName,
        lastName,
        employeeId,
        email,
        password,
        gender,
      } = req.body;

      const photoFile = req.file;

      // ---------------------------------------------------
      // VALIDACIÓN
      // ---------------------------------------------------

      const cleanFirstName =
        firstName?.trim();

      const cleanLastName =
        lastName?.trim();

      const cleanEmployeeId =
        employeeId?.trim();

      const cleanEmail =
        email?.trim().toLowerCase();

      if (!cleanFirstName) {
        return res.status(400).json({
          status: "ERROR",
          message:
            "El nombre es obligatorio.",
        });
      }

      if (!cleanLastName) {
        return res.status(400).json({
          status: "ERROR",
          message:
            "El apellido es obligatorio.",
        });
      }

      if (
        !/^\d{6}$/.test(
          cleanEmployeeId || ""
        )
      ) {
        return res.status(400).json({
          status: "ERROR",
          message:
            "El ID laboral debe contener exactamente 6 dígitos.",
        });
      }

      if (!cleanEmail) {
        return res.status(400).json({
          status: "ERROR",
          message:
            "El correo electrónico es obligatorio.",
        });
      }

      if (!password) {
        return res.status(400).json({
          status: "ERROR",
          message:
            "La contraseña es obligatoria.",
        });
      }

      if (password.length < 8) {
        return res.status(400).json({
          status: "ERROR",
          message:
            "La contraseña debe tener al menos 8 caracteres.",
        });
      }

      if (!/[A-Z]/.test(password)) {
        return res.status(400).json({
          status: "ERROR",
          message:
            "La contraseña debe contener una mayúscula.",
        });
      }

      if (!/[a-z]/.test(password)) {
        return res.status(400).json({
          status: "ERROR",
          message:
            "La contraseña debe contener una minúscula.",
        });
      }

      if (!/\d/.test(password)) {
        return res.status(400).json({
          status: "ERROR",
          message:
            "La contraseña debe contener un número.",
        });
      }

      // ---------------------------------------------------
      // COMPROBAR USUARIO EXISTENTE
      // ---------------------------------------------------

      const existingUser =
        await client.query(
          `
          SELECT id
          FROM public.users
          WHERE email = $1
             OR employee_id = $2
          LIMIT 1
          `,
          [
            cleanEmail,
            cleanEmployeeId,
          ]
        );

      if (existingUser.rows.length > 0) {
        return res.status(409).json({
          status: "ERROR",
          message:
            "El correo o ID laboral ya está registrado.",
        });
      }

      // ---------------------------------------------------
      // HASH PASSWORD
      // ---------------------------------------------------

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );

      // ---------------------------------------------------
      // INICIAR TRANSACCIÓN
      // ---------------------------------------------------

      await client.query("BEGIN");

      // ---------------------------------------------------
      // CREAR USUARIO
      // ---------------------------------------------------

      const userResult =
        await client.query(
          `
          INSERT INTO public.users (
            email,
            employee_id,
            password_hash,
            role,
            status
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING
            id,
            email,
            employee_id,
            role,
            status
          `,
          [
            cleanEmail,
            cleanEmployeeId,
            passwordHash,
            "operator",
            "active",
          ]
        );

      const user =
        userResult.rows[0];

      // ---------------------------------------------------
      // FOTO POR DEFECTO
      // ---------------------------------------------------

      let photoUrl =
        DEFAULT_OPERATOR_PHOTO;

      // ---------------------------------------------------
      // SUBIR FOTO PERSONALIZADA
      // ---------------------------------------------------

      if (photoFile) {
        const extensionByMimeType = {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/webp": "webp",
        };

        const extension =
          extensionByMimeType[
            photoFile.mimetype
          ];

        if (!extension) {
          throw new Error(
            "Formato de imagen no compatible."
          );
        }

        const storagePath =
          `${user.id}/profile.${extension}`;

        const {
          error: uploadError,
        } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(
            storagePath,
            photoFile.buffer,
            {
              contentType:
                photoFile.mimetype,

              cacheControl:
                "3600",

              upsert: true,
            }
          );

        if (uploadError) {
          throw uploadError;
        }

        uploadedStoragePath =
          storagePath;

        // -------------------------------------------------
        // OBTENER URL PÚBLICA
        // -------------------------------------------------

        const {
          data: publicUrlData,
        } = supabase.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(
            storagePath
          );

        if (
          !publicUrlData?.publicUrl
        ) {
          throw new Error(
            "No fue posible obtener la URL pública de la imagen."
          );
        }

        photoUrl =
          publicUrlData.publicUrl;
      }

      // ---------------------------------------------------
      // CREAR PERFIL DEL USUARIO
      // ---------------------------------------------------

      await client.query(
        `
        INSERT INTO public.user_profiles (
          user_id,
          first_name,
          last_name,
          gender,
          photo_url
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          user.id,
          cleanFirstName,
          cleanLastName,
          gender || null,
          photoUrl,
        ]
      );

      // ---------------------------------------------------
      // CONFIRMAR TRANSACCIÓN
      // ---------------------------------------------------

      await client.query("COMMIT");

      // ---------------------------------------------------
      // RESPUESTA
      // ---------------------------------------------------

      return res.status(201).json({
        status: "OK",

        message:
          "Operador registrado correctamente.",

        user: {
          id: user.id,
          email: user.email,
          employeeId:
            user.employee_id,
          role: user.role,
          status: user.status,
          firstName:
            cleanFirstName,
          lastName:
            cleanLastName,
          photoUrl,
        },
      });
    } catch (error) {
      // ---------------------------------------------------
      // ROLLBACK DATABASE
      // ---------------------------------------------------

      try {
        await client.query(
          "ROLLBACK"
        );
      } catch (rollbackError) {
        console.error(
          "ROLLBACK ERROR:",
          rollbackError
        );
      }

      // ---------------------------------------------------
      // ELIMINAR FOTO HUÉRFANA
      // ---------------------------------------------------

      if (uploadedStoragePath) {
        try {
          const {
            error: removeError,
          } = await supabase.storage
            .from(STORAGE_BUCKET)
            .remove([
              uploadedStoragePath,
            ]);

          if (removeError) {
            console.error(
              "STORAGE CLEANUP ERROR:",
              removeError
            );
          }
        } catch (cleanupError) {
          console.error(
            "STORAGE CLEANUP ERROR:",
            cleanupError
          );
        }
      }

      // ---------------------------------------------------
      // UNIQUE CONSTRAINT
      // ---------------------------------------------------

      if (
        error?.code === "23505"
      ) {
        return res.status(409).json({
          status: "ERROR",
          message:
            "El correo o ID laboral ya está registrado.",
        });
      }

      // ---------------------------------------------------
      // ERROR GENERAL / pbhj hlft xhbl meqx
      // ---------------------------------------------------

      console.error(
        "REGISTER ERROR:",
        error
      );

      return res.status(500).json({
        status: "ERROR",
        message:
          "No fue posible crear el operador.",
      });
    } finally {
      client.release();
    }
  }
);

// =========================================================
// LOGIN OPERATOR
// =========================================================

router.post(
  "/login",
  async (req, res) => {
    const client = await pool.connect();

    try {
      const {
        email,
        password,
      } = req.body;

      const cleanEmail =
        email?.trim().toLowerCase();

      // ---------------------------------------------------
      // VALIDACIÓN BÁSICA
      // ---------------------------------------------------

      if (
        !cleanEmail ||
        !password
      ) {
        return res.status(400).json({
          status: "ERROR",
          message:
            "CORREO ELECTRÓNICO Y CONTRASEÑA SON OBLIGATORIOS.",
        });
      }

      // ---------------------------------------------------
      // BUSCAR OPERADOR
      // ---------------------------------------------------

      const userResult =
        await client.query(
          `
          SELECT
            u.id,
            u.email,
            u.employee_id,
            u.password_hash,
            u.role,
            u.status,
            p.first_name,
            p.last_name,
            p.gender,
            p.photo_url
          FROM public.users u
          LEFT JOIN public.user_profiles p
            ON p.user_id = u.id
          WHERE LOWER(u.email) = $1
          LIMIT 1
          `,
          [cleanEmail]
        );

      if (
        userResult.rows.length === 0
      ) {
        return res.status(401).json({
          status: "ERROR",
          message:
            "CORREO O CONTRASEÑA INCORRECTOS.",
        });
      }

      const user =
        userResult.rows[0];

      // ---------------------------------------------------
      // VERIFICAR ESTADO
      // ---------------------------------------------------

      if (
        user.status !== "active"
      ) {
        return res.status(403).json({
          status: "ERROR",
          message:
            "ESTA CUENTA DE OPERADOR NO SE ENCUENTRA ACTIVA.",
        });
      }

      // ---------------------------------------------------
      // COMPARAR CONTRASEÑA
      // ---------------------------------------------------

      const passwordCorrect =
        await bcrypt.compare(
          password,
          user.password_hash
        );

      if (!passwordCorrect) {
        return res.status(401).json({
          status: "ERROR",
          message:
            "CORREO O CONTRASEÑA INCORRECTOS.",
        });
      }

      // ---------------------------------------------------
      // REGISTRAR ÚLTIMO INGRESO
      // ---------------------------------------------------

      await client.query(
        `
        UPDATE public.users
        SET
          last_login = NOW(),
          updated_at = NOW()
        WHERE id = $1
        `,
        [user.id]
      );

      // ---------------------------------------------------
      // CREAR SESIÓN JWT
      // ---------------------------------------------------

      const token = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          role: user.role,
        },
        JWT_SECRET,
        {
          expiresIn: JWT_EXPIRES_IN,
        }
      );

      // ---------------------------------------------------
      // RESPUESTA
      // ---------------------------------------------------

      return res.status(200).json({
        status: "SUCCESS",

        message:
          "ACCESO AUTORIZADO.",

        // Token de sesión para ESTA pestaña.
        token,

        user: {
          id: user.id,

          email: user.email,

          employeeId:
            user.employee_id,

          firstName:
            user.first_name,

          lastName:
            user.last_name,

          gender:
            user.gender,

          photoUrl:
            user.photo_url ||
            DEFAULT_OPERATOR_PHOTO,

          role:
            user.role,

          status:
            user.status,

          lastLogin:
            new Date().toISOString(),
        },
      });

    } catch (error) {

      console.error(
        "LOGIN ERROR:",
        error
      );

      return res.status(500).json({
        status: "ERROR",
        message:
          "ERROR INTERNO DEL SERVIDOR.",
      });

    } finally {

      client.release();

    }
  }
);

// =========================================================
// OBTENER OPERADOR DE LA SESIÓN ACTUAL
// =========================================================

router.get(
  "/me",
  async (req, res) => {

    try {

      // ---------------------------------------------------
      // OBTENER TOKEN
      // ---------------------------------------------------

      const authorization =
        req.headers.authorization || "";

      if (
        !authorization.startsWith("Bearer ")
      ) {
        return res.status(401).json({
          status: "ERROR",
          message:
            "SESIÓN NO AUTORIZADA.",
        });
      }

      const token =
        authorization
          .substring(7)
          .trim();

      if (!token) {
        return res.status(401).json({
          status: "ERROR",
          message:
            "TOKEN DE SESIÓN NO VÁLIDO.",
        });
      }

      // ---------------------------------------------------
      // VERIFICAR TOKEN
      // ---------------------------------------------------

      let decoded;

      try {

        decoded = jwt.verify(
          token,
          JWT_SECRET
        );

      } catch (tokenError) {

        return res.status(401).json({
          status: "ERROR",
          message:
            "LA SESIÓN HA EXPIRADO O NO ES VÁLIDA.",
        });

      }

      const userId =
        decoded?.userId;

      if (!userId) {
        return res.status(401).json({
          status: "ERROR",
          message:
            "SESIÓN NO VÁLIDA.",
        });
      }

      // ---------------------------------------------------
      // BUSCAR USUARIO ACTUAL EN POSTGRESQL
      // ---------------------------------------------------

      const result =
        await pool.query(
          `
          SELECT
            u.id,
            u.email,
            u.employee_id,
            u.role,
            u.status,
            u.last_login,
            p.first_name,
            p.last_name,
            p.gender,
            p.photo_url
          FROM public.users u
          LEFT JOIN public.user_profiles p
            ON p.user_id = u.id
          WHERE u.id = $1
          LIMIT 1
          `,
          [userId]
        );

      if (
        result.rows.length === 0
      ) {
        return res.status(401).json({
          status: "ERROR",
          message:
            "EL OPERADOR YA NO EXISTE.",
        });
      }

      const user =
        result.rows[0];

      // ---------------------------------------------------
      // COMPROBAR ESTADO
      // ---------------------------------------------------

      if (
        user.status !== "active"
      ) {
        return res.status(403).json({
          status: "ERROR",
          message:
            "LA CUENTA DEL OPERADOR NO ESTÁ ACTIVA.",
        });
      }

      // ---------------------------------------------------
      // RESPUESTA
      // ---------------------------------------------------

      return res.status(200).json({
        status: "SUCCESS",

        user: {
          id: user.id,

          email: user.email,

          employeeId:
            user.employee_id,

          firstName:
            user.first_name,

          lastName:
            user.last_name,

          gender:
            user.gender,

          photoUrl:
            user.photo_url ||
            DEFAULT_OPERATOR_PHOTO,

          role:
            user.role,

          status:
            user.status,

          lastLogin:
            user.last_login,
        },
      });

    } catch (error) {

      console.error(
        "AUTH ME ERROR:",
        error
      );

      return res.status(500).json({
        status: "ERROR",
        message:
          "ERROR INTERNO DEL SERVIDOR.",
      });

    }
  }
);

// =========================================================
// ELIMINAR CUENTA DEL OPERADOR
// =========================================================

router.delete(
  "/account/:userId",
  async (req, res) => {
    const client =
      await pool.connect();

    let transactionStarted =
      false;

    try {
      const {
        userId,
      } = req.params;

      // ---------------------------------------------------
      // VALIDAR ID
      // ---------------------------------------------------

      if (!userId) {
        return res.status(400).json({
          status: "ERROR",
          message:
            "ID DE OPERADOR NO VÁLIDO.",
        });
      }

      // ---------------------------------------------------
      // BUSCAR FOTO ACTUAL
      // ---------------------------------------------------

      const userResult =
        await client.query(
          `
          SELECT
            u.id,
            u.email,
            p.photo_url
          FROM public.users u
          LEFT JOIN public.user_profiles p
            ON p.user_id = u.id
          WHERE u.id = $1
          LIMIT 1
          `,
          [userId]
        );

      if (
        userResult.rows.length === 0
      ) {
        return res.status(404).json({
          status: "ERROR",
          message:
            "OPERADOR NO ENCONTRADO.",
        });
      }

      const operator =
        userResult.rows[0];

      // ---------------------------------------------------
      // OBTENER RUTA DE FOTO SUPABASE
      // ---------------------------------------------------

      let storagePath = null;

      if (
        operator.photo_url &&
        operator.photo_url.includes(
          "/operator-profiles/"
        )
      ) {
        const marker =
          "/operator-profiles/";

        const markerIndex =
          operator.photo_url.indexOf(
            marker
          );

        if (
          markerIndex !== -1
        ) {
          storagePath =
            operator.photo_url.substring(
              markerIndex +
                marker.length
            );
        }
      }

      // ---------------------------------------------------
      // INICIAR TRANSACCIÓN
      // ---------------------------------------------------

      await client.query(
        "BEGIN"
      );

      transactionStarted = true;

      // ---------------------------------------------------
      // ELIMINAR USUARIO
      // ---------------------------------------------------
      //
      // user_profiles se elimina
      // automáticamente mediante
      // ON DELETE CASCADE.
      //
      // ---------------------------------------------------

      await client.query(
        `
        DELETE FROM public.users
        WHERE id = $1
        `,
        [userId]
      );

      // ---------------------------------------------------
      // CONFIRMAR ELIMINACIÓN
      // ---------------------------------------------------

      await client.query(
        "COMMIT"
      );

      transactionStarted = false;

      // ---------------------------------------------------
      // ELIMINAR FOTO DE SUPABASE STORAGE
      // ---------------------------------------------------
      //
      // CORREGIDO:
      // antes estaba usando BUCKET,
      // pero la constante correcta es
      // STORAGE_BUCKET.
      //
      // ---------------------------------------------------

      if (storagePath) {
        const {
          error: storageError,
        } = await supabase.storage
          .from(STORAGE_BUCKET)
          .remove([
            storagePath,
          ]);

        if (storageError) {
          console.warn(
            "NO SE PUDO ELIMINAR LA FOTO:",
            storageError.message
          );
        }
      }

      // ---------------------------------------------------
      // RESPUESTA
      // ---------------------------------------------------

      return res.status(200).json({
        status: "SUCCESS",
        message:
          "CUENTA DEL OPERADOR ELIMINADA CORRECTAMENTE.",
      });
    } catch (error) {
      console.error(
        "DELETE ACCOUNT ERROR:",
        error
      );

      // -------------------------------------------------
      // ROLLBACK SI LA TRANSACCIÓN SIGUE ACTIVA
      // -------------------------------------------------

      if (transactionStarted) {
        try {
          await client.query(
            "ROLLBACK"
          );
        } catch (rollbackError) {
          console.error(
            "DELETE ACCOUNT ROLLBACK ERROR:",
            rollbackError
          );
        }
      }

      return res.status(500).json({
        status: "ERROR",
        message:
          "ERROR INTERNO AL ELIMINAR LA CUENTA.",
      });
    } finally {
      client.release();
    }
  }
);

// =========================================================
// EXPORTAR ROUTER
// =========================================================

export default router;