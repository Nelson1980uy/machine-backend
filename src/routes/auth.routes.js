import express from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import jwt from "jsonwebtoken";
import crypto from "crypto";

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
// CONFIGURACIÓN DE RECUPERACIÓN
// =========================================================

const RECOVERY_TOKEN_EXPIRES_MINUTES = 15;

const MACHINE_EMAIL_DOMAIN =
  "@machine.local";


// =========================================================
// CONFIGURACIÓN DE SUBIDA DE FOTOS
// =========================================================

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 5 * 1024 * 1024,
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
// HELPERS DE AUTENTICACIÓN
// =========================================================

const normalizeMachineEmail = (email) => {
  return email
    ?.trim()
    .toLowerCase();
};


const isValidMachineEmail = (email) => {
  if (!email) {
    return false;
  }

  const username =
    email.substring(
      0,
      email.length -
        MACHINE_EMAIL_DOMAIN.length
    );

  const domain =
    email.substring(
      email.length -
        MACHINE_EMAIL_DOMAIN.length
    );

  if (
    domain !== MACHINE_EMAIL_DOMAIN
  ) {
    return false;
  }

  return /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(
    username
  );
};


const validatePassword = (password) => {
  if (!password) {
    return "La contraseña es obligatoria.";
  }

  if (password.length < 8) {
    return "La contraseña debe tener al menos 8 caracteres.";
  }

  if (!/[A-Z]/.test(password)) {
    return "La contraseña debe contener una mayúscula.";
  }

  if (!/[a-z]/.test(password)) {
    return "La contraseña debe contener una minúscula.";
  }

  if (!/\d/.test(password)) {
    return "La contraseña debe contener un número.";
  }

  return null;
};


const createRecoveryToken = () => {
  return crypto.randomBytes(48).toString("hex");
};


const hashRecoveryToken = (token) => {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
};


const authenticateSession = async (req, res) => {

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
      status: "ERROR",
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
        status: "ERROR",
        message:
          "SESIÓN NO VÁLIDA.",
      });

      return null;
    }

    return decoded;

  } catch (error) {

    res.status(401).json({
      status: "ERROR",
      message:
        "LA SESIÓN HA EXPIRADO O NO ES VÁLIDA.",
    });

    return null;
  }
};


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
    const client =
      await pool.connect();

    let uploadedStoragePath =
      null;

    try {
      const {
        firstName,
        lastName,
        employeeId,
        email,
        password,
        recoveryQuestion,
        recoveryAnswer,
        gender,
      } = req.body;

      const photoFile =
        req.file;

      // ---------------------------------------------------
      // LIMPIAR DATOS
      // ---------------------------------------------------

      const cleanFirstName =
        firstName?.trim();

      const cleanLastName =
        lastName?.trim();

      const cleanEmployeeId =
        employeeId?.trim();

      const cleanEmail =
        normalizeMachineEmail(
          email
        );

      const cleanRecoveryQuestion =
        recoveryQuestion?.trim();

      const cleanRecoveryAnswer =
        recoveryAnswer?.trim();

      // ---------------------------------------------------
      // VALIDAR NOMBRE
      // ---------------------------------------------------

      if (!cleanFirstName) {
        return res.status(400).json({
          status: "ERROR",
          message:
            "El nombre es obligatorio.",
        });
      }

      // ---------------------------------------------------
      // VALIDAR APELLIDO
      // ---------------------------------------------------

      if (!cleanLastName) {
        return res.status(400).json({
          status: "ERROR",
          message:
            "El apellido es obligatorio.",
        });
      }

      // ---------------------------------------------------
      // VALIDAR ID LABORAL
      // ---------------------------------------------------

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

      // ---------------------------------------------------
      // VALIDAR EMAIL MACHINE
      // ---------------------------------------------------

      if (!cleanEmail) {
        return res.status(400).json({
          status: "ERROR",
          message:
            "El correo electrónico es obligatorio.",
        });
      }

      if (
        !isValidMachineEmail(
          cleanEmail
        )
      ) {
        return res.status(400).json({
          status: "ERROR",
          message:
            "El operador debe utilizar una cuenta interna @machine.local.",
        });
      }

      // ---------------------------------------------------
      // VALIDAR CONTRASEÑA
      // ---------------------------------------------------

      const passwordError =
        validatePassword(
          password
        );

      if (passwordError) {
        return res.status(400).json({
          status: "ERROR",
          message:
            passwordError,
        });
      }

      // ---------------------------------------------------
      // VALIDAR RECUPERACIÓN
      // ---------------------------------------------------

      if (!cleanRecoveryQuestion) {
        return res.status(400).json({
          status: "ERROR",
          message:
            "La pregunta de recuperación es obligatoria.",
        });
      }

      if (!cleanRecoveryAnswer) {
        return res.status(400).json({
          status: "ERROR",
          message:
            "La respuesta de recuperación es obligatoria.",
        });
      }

      if (
        cleanRecoveryAnswer.length < 2
      ) {
        return res.status(400).json({
          status: "ERROR",
          message:
            "La respuesta de recuperación es demasiado corta.",
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

      if (
        existingUser.rows.length > 0
      ) {
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
      // HASH RESPUESTA DE RECUPERACIÓN
      // ---------------------------------------------------

      const recoveryAnswerHash =
        await bcrypt.hash(
          cleanRecoveryAnswer.toLowerCase(),
          12
        );

      // ---------------------------------------------------
      // INICIAR TRANSACCIÓN
      // ---------------------------------------------------

      await client.query(
        "BEGIN"
      );

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
            recovery_question,
            recovery_answer_hash,
            role,
            status
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7
          )
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
            cleanRecoveryQuestion,
            recoveryAnswerHash,
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
      // CREAR PERFIL
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
      // CONFIRMAR
      // ---------------------------------------------------

      await client.query(
        "COMMIT"
      );

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

          role:
            user.role,

          status:
            user.status,

          firstName:
            cleanFirstName,

          lastName:
            cleanLastName,

          photoUrl,
        },
      });

    } catch (error) {

      // ---------------------------------------------------
      // ROLLBACK
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
      // LIMPIAR FOTO HUÉRFANA
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
      // UNIQUE
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

    const client =
      await pool.connect();

    try {

      const {
        email,
        password,
      } = req.body;

      const cleanEmail =
        normalizeMachineEmail(
          email
        );

      // ---------------------------------------------------
      // VALIDACIÓN
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

      if (
        !isValidMachineEmail(
          cleanEmail
        )
      ) {
        return res.status(400).json({
          status: "ERROR",
          message:
            "UTILIZA UNA CUENTA INTERNA @machine.local.",
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
      // ESTADO
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
      // PASSWORD
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
// ÚLTIMO LOGIN
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
// REGISTRAR SESIÓN MACHINE
// ---------------------------------------------------

console.log(
  "MACHINE SESSION: REGISTRANDO LOGIN PARA:",
  user.id
);

const sessionResult =
  await client.query(
    `
    INSERT INTO public.operator_sessions (
      user_id,
      started_at,
      last_seen_at,
      session_status
    )
    VALUES (
      $1,
      NOW(),
      NOW(),
      'ACTIVE'
    )
    RETURNING
      id,
      user_id,
      started_at,
      session_status
    `,
    [user.id]
  );

console.log(
  "MACHINE SESSION: REGISTRADA:",
  sessionResult.rows[0]
);

      // ---------------------------------------------------
      // JWT
      // ---------------------------------------------------

      const token =
        jwt.sign(
          {
            userId: user.id,
            email: user.email,
            role: user.role,
          },
          JWT_SECRET,
          {
            expiresIn:
              JWT_EXPIRES_IN,
          }
        );

      // ---------------------------------------------------
      // RESPUESTA
      // ---------------------------------------------------

      return res.status(200).json({
        status: "SUCCESS",

        message:
          "ACCESO AUTORIZADO.",

        token,

        user: {
          id:
            user.id,

          email:
            user.email,

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
// ACTUALIZAR PERFIL PROFESIONAL DEL OPERADOR
// =========================================================

router.put(
  "/profile",
  async (req, res) => {

    const client =
      await pool.connect();

    try {

      // =====================================================
      // AUTENTICAR SESIÓN
      // =====================================================

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
      // DATOS RECIBIDOS
      // =====================================================

      const {
        age,
        jobTitle,
        plant,
        plantNumber,
        sector,
        productionLine,
        assignedMachine,
        shift,
        specialty,
        hireDate,
        bio,
        country,
        department,
        locality,
        street,
        streetNumber,
        latitude,
        longitude,
        locationVisibility,
        profileVisibility,
      } = req.body || {};

      // =====================================================
      // NORMALIZACIÓN
      // =====================================================

      const cleanText = (
        value,
        maxLength
      ) => {

        if (
          value === undefined ||
          value === null
        ) {
          return null;
        }

        const text =
          String(value)
            .trim();

        if (!text) {
          return null;
        }

        return text.substring(
          0,
          maxLength
        );
      };

      const cleanAge =
        age === undefined ||
        age === null ||
        age === ""
          ? null
          : Number(age);

      const cleanJobTitle =
        cleanText(
          jobTitle,
          150
        );

      const cleanPlant =
        cleanText(
          plant,
          150
        );

      const cleanPlantNumber =
        cleanText(
          plantNumber,
          50
        );

      const cleanSector =
        cleanText(
          sector,
          150
        );

      const cleanProductionLine =
        cleanText(
          productionLine,
          150
        );

      const cleanAssignedMachine =
        cleanText(
          assignedMachine,
          150
        );

      const cleanShift =
        cleanText(
          shift,
          100
        );

      const cleanSpecialty =
        cleanText(
          specialty,
          150
        );

      const cleanHireDate =
        cleanText(
          hireDate,
          10
        );

      const cleanBio =
        cleanText(
          bio,
          5000
        );

      const cleanCountry =
        cleanText(
          country,
          100
        );

      const cleanDepartment =
        cleanText(
          department,
          150
        );

      const cleanLocality =
        cleanText(
          locality,
          150
        );

      const cleanStreet =
        cleanText(
          street,
          200
        );

      const cleanStreetNumber =
        cleanText(
          streetNumber,
          30
        );

      // =====================================================
      // VALIDAR EDAD
      // =====================================================

      if (
        cleanAge !== null &&
        (
          !Number.isInteger(
            cleanAge
          ) ||
          cleanAge < 1 ||
          cleanAge > 120
        )
      ) {

        return res.status(400).json({
          status: "ERROR",
          message:
            "LA EDAD DEBE SER UN NÚMERO VÁLIDO ENTRE 1 Y 120.",
        });

      }

      // =====================================================
      // VALIDAR FECHA DE INGRESO
      // =====================================================

      if (
        cleanHireDate &&
        !/^\d{4}-\d{2}-\d{2}$/.test(
          cleanHireDate
        )
      ) {

        return res.status(400).json({
          status: "ERROR",
          message:
            "LA FECHA DE INGRESO NO TIENE UN FORMATO VÁLIDO.",
        });

      }

      // =====================================================
      // VALIDAR LATITUD
      // =====================================================

      let cleanLatitude =
        latitude === undefined ||
        latitude === null ||
        latitude === ""
          ? null
          : Number(latitude);


      let cleanLongitude =
        longitude === undefined ||
        longitude === null ||
        longitude === ""
          ? null
          : Number(longitude);


      if (
        cleanLatitude !== null &&
        (
          !Number.isFinite(
            cleanLatitude
          ) ||
          cleanLatitude < -90 ||
          cleanLatitude > 90
        )
      ) {

        return res.status(400).json({
          status: "ERROR",
          message:
            "LA LATITUD NO ES VÁLIDA.",
        });

      }


      if (
        cleanLongitude !== null &&
        (
          !Number.isFinite(
            cleanLongitude
          ) ||
          cleanLongitude < -180 ||
          cleanLongitude > 180
        )
      ) {

        return res.status(400).json({
          status: "ERROR",
          message:
            "LA LONGITUD NO ES VÁLIDA.",
        });

      }



      // =====================================================
// COMPROBAR QUE EL OPERADOR EXISTA
// =====================================================

const operatorResult =
  await client.query(
    `
    SELECT
      u.id,
      u.status,
      p.user_id,
      p.profile_visibility,
      p.location_visibility
    FROM public.users u
    LEFT JOIN public.user_profiles p
      ON p.user_id = u.id
    WHERE u.id = $1
    LIMIT 1
    `,
    [userId]
  );


if (
  operatorResult.rows.length === 0
) {

  return res.status(404).json({
    status: "ERROR",
    message:
      "OPERADOR NO ENCONTRADO.",
  });

}

const operator =
  operatorResult.rows[0];


if (
  operator.status !== "active"
) {

  return res.status(403).json({
    status: "ERROR",
    message:
      "LA CUENTA DEL OPERADOR NO ESTÁ ACTIVA.",
  });

}


if (
  !operator.user_id
) {

  return res.status(404).json({
    status: "ERROR",
    message:
      "EL PERFIL DEL OPERADOR NO EXISTE.",
  });

}


// =====================================================
// VISIBILIDAD DE UBICACIÓN
// =====================================================

let cleanLocationVisibility =
  operator.location_visibility === true;

if (
  locationVisibility !== undefined &&
  locationVisibility !== null
) {

  if (
    locationVisibility === true ||
    locationVisibility === "true"
  ) {

    cleanLocationVisibility =
      true;

  } else if (
    locationVisibility === false ||
    locationVisibility === "false"
  ) {

    cleanLocationVisibility =
      false;

  } else {

    return res.status(400).json({

      status:
        "ERROR",

      message:
        "LA VISIBILIDAD DE LA UBICACIÓN NO ES VÁLIDA.",

    });

  }

}


// =====================================================
// DETERMINAR VISIBILIDAD FINAL DEL PERFIL
// =====================================================

let finalProfileVisibility =
  operator.profile_visibility ||
  "PUBLIC";


if (
  profileVisibility !== undefined &&
  profileVisibility !== null &&
  String(
    profileVisibility
  ).trim() !== ""
) {

  finalProfileVisibility =
    String(
      profileVisibility
    )
      .trim()
      .toUpperCase();

}


// =====================================================
// VALIDAR VISIBILIDAD FINAL
// =====================================================

if (
  ![
    "PUBLIC",
    "PRIVATE",
  ].includes(
    finalProfileVisibility
  )
) {

  return res.status(400).json({
    status: "ERROR",
    message:
      "LA VISIBILIDAD DEL PERFIL NO ES VÁLIDA.",
  });

}


// =====================================================
// ACTUALIZAR PERFIL
// =====================================================

const result =
  await client.query(
    `
    UPDATE public.user_profiles
    SET

      age =
        $1::INTEGER,

      job_title =
        $2::VARCHAR,

      plant =
        $3::VARCHAR,

      plant_number =
        $4::VARCHAR,

      sector =
        $5::VARCHAR,

      production_line =
        $6::VARCHAR,

      assigned_machine =
        $7::VARCHAR,

      shift =
        $8::VARCHAR,

      specialty =
        $9::VARCHAR,

      hire_date =
        $10::DATE,

      bio =
        $11::TEXT,

      country =
        $12::VARCHAR,

      department =
        $13::VARCHAR,

      locality =
        $14::VARCHAR,

      street =
        $15::VARCHAR,

      street_number =
        $16::VARCHAR,

      latitude =
        $17::NUMERIC(10,7),

      longitude =
        $18::NUMERIC(10,7),

      location_visibility =
        $19::BOOLEAN,

      profile_visibility =
        $20::VARCHAR,

      location_updated_at =
        CASE
          WHEN
            latitude IS DISTINCT FROM
              $17::NUMERIC(10,7)

            OR longitude IS DISTINCT FROM
              $18::NUMERIC(10,7)

            OR locality IS DISTINCT FROM
              $14::VARCHAR

            OR street IS DISTINCT FROM
              $15::VARCHAR

            OR street_number IS DISTINCT FROM
              $16::VARCHAR

          THEN NOW()

          ELSE location_updated_at

        END,

      updated_at =
        NOW()

    WHERE user_id =
      $21

    RETURNING

      id,

      user_id,

      first_name,

      last_name,

      gender,

      photo_url,

      age,

      job_title,

      plant,

      plant_number,

      sector,

      production_line,

      assigned_machine,

      shift,

      specialty,

      hire_date,

      bio,

      country,

      department,

      locality,

      street,

      street_number,

      latitude,

      longitude,

      location_visibility,

      profile_visibility,

      location_updated_at,

      created_at,

      updated_at
    `,
    [
      cleanAge,

      cleanJobTitle,

      cleanPlant,

      cleanPlantNumber,

      cleanSector,

      cleanProductionLine,

      cleanAssignedMachine,

      cleanShift,

      cleanSpecialty,

      cleanHireDate,

      cleanBio,

      cleanCountry,

      cleanDepartment,

      cleanLocality,

      cleanStreet,

      cleanStreetNumber,

      cleanLatitude,

      cleanLongitude,

      cleanLocationVisibility,

      finalProfileVisibility,

      userId,
    ]
  );


if (
  result.rows.length === 0
) {

  return res.status(404).json({
    status: "ERROR",
    message:
      "NO FUE POSIBLE ACTUALIZAR EL PERFIL.",
  });

}


      // =====================================================
// RESPUESTA
// =====================================================

const profile =
  result.rows[0];

return res.status(200).json({

  status:
    "SUCCESS",

  message:
    "PERFIL DEL OPERADOR ACTUALIZADO CORRECTAMENTE.",

  profile: {

    id:
      profile.id,

    userId:
      profile.user_id,

    firstName:
      profile.first_name,

    lastName:
      profile.last_name,

    gender:
      profile.gender,

    photoUrl:
      profile.photo_url ||
      DEFAULT_OPERATOR_PHOTO,

    age:
      profile.age,

    jobTitle:
      profile.job_title,

    plant:
      profile.plant,

    plantNumber:
      profile.plant_number,

    sector:
      profile.sector,

    productionLine:
      profile.production_line,

    assignedMachine:
      profile.assigned_machine,

    shift:
      profile.shift,

    specialty:
      profile.specialty,

    hireDate:
      profile.hire_date,

    bio:
      profile.bio,

    country:
      profile.country,

    department:
      profile.department,

    locality:
      profile.locality,

    street:
      profile.street,

    streetNumber:
      profile.street_number,

    latitude:
      profile.latitude,

    longitude:
      profile.longitude,

    locationVisibility:
      profile.location_visibility,

    profileVisibility:
      profile.profile_visibility,

    locationUpdatedAt:
      profile.location_updated_at,

    createdAt:
      profile.created_at,

    updatedAt:
      profile.updated_at,

  },

});

} catch (error) {

  console.error(
    "========================================================="
  );

  console.error(
    "UPDATE OPERATOR PROFILE ERROR"
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
    "POSITION:",
    error?.position
  );

  console.error(
    "STACK:",
    error?.stack
  );

  console.error(
    "========================================================="
  );

  return res.status(500).json({

    status:
      "ERROR",

    message:
      "NO FUE POSIBLE ACTUALIZAR EL PERFIL DEL OPERADOR.",

  });

} finally {

  client.release();

}

}
);

// =========================================================
// RECOVERY — OBTENER PREGUNTA
// =========================================================

router.post(
  "/recovery/question",
  async (req, res) => {

    try {

      const cleanEmail =
        normalizeMachineEmail(
          req.body?.email
        );

      if (
        !cleanEmail ||
        !isValidMachineEmail(
          cleanEmail
        )
      ) {
        return res.status(400).json({
          status: "ERROR",
          message:
            "UTILIZA UNA CUENTA INTERNA @machine.local.",
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            id,
            recovery_question
          FROM public.users
          WHERE LOWER(email) = $1
          LIMIT 1
          `,
          [cleanEmail]
        );

      if (
        result.rows.length === 0 ||
        !result.rows[0].recovery_question
      ) {
        return res.status(404).json({
          status: "ERROR",
          message:
            "NO SE ENCONTRÓ UNA PREGUNTA DE RECUPERACIÓN PARA ESTA CUENTA.",
        });
      }

      return res.status(200).json({
        status: "SUCCESS",

        question:
          result.rows[0]
            .recovery_question,
      });

    } catch (error) {

      console.error(
        "RECOVERY QUESTION ERROR:",
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
// RECOVERY — VERIFICAR RESPUESTA
// =========================================================

router.post(
  "/recovery/verify",
  async (req, res) => {

    const client =
      await pool.connect();

    const RECOVERY_MAX_ATTEMPTS = 5;

    const RECOVERY_LOCK_MINUTES = 15;

    try {

      const cleanEmail =
        normalizeMachineEmail(
          req.body?.email
        );

      const cleanAnswer =
        req.body?.answer
          ?.trim()
          .toLowerCase();

      // ---------------------------------------------------
      // VALIDAR DATOS
      // ---------------------------------------------------

      if (
        !cleanEmail ||
        !cleanAnswer
      ) {
        return res.status(400).json({
          status: "ERROR",

          message:
            "CORREO Y RESPUESTA SON OBLIGATORIOS.",
        });
      }

      // ---------------------------------------------------
      // VALIDAR CORREO MACHINE
      // ---------------------------------------------------

      if (
        !isValidMachineEmail(
          cleanEmail
        )
      ) {
        return res.status(400).json({
          status: "ERROR",

          message:
            "UTILIZA UNA CUENTA INTERNA @machine.local.",
        });
      }

      // ---------------------------------------------------
      // BUSCAR USUARIO
      // ---------------------------------------------------

      const result =
        await client.query(
          `
          SELECT
            id,
            recovery_answer_hash,
            status
          FROM public.users
          WHERE LOWER(email) = $1
          LIMIT 1
          `,
          [cleanEmail]
        );

      if (
        result.rows.length === 0
      ) {
        return res.status(401).json({
          status: "ERROR",

          message:
            "DATOS DE RECUPERACIÓN INCORRECTOS.",
        });
      }

      const user =
        result.rows[0];

      // ---------------------------------------------------
      // VALIDAR ESTADO DE LA CUENTA
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
      // VALIDAR RESPUESTA CONFIGURADA
      // ---------------------------------------------------

      if (
        !user.recovery_answer_hash
      ) {
        return res.status(400).json({
          status: "ERROR",

          message:
            "ESTA CUENTA NO TIENE CONFIGURADA UNA RESPUESTA DE RECUPERACIÓN.",
        });
      }

      // ===================================================
      // RECOVERY ATTEMPTS
      // ===================================================

      const attemptResult =
        await client.query(
          `
          SELECT
            failed_attempts,
            locked_until
          FROM public.password_recovery_attempts
          WHERE user_id = $1
          LIMIT 1
          `,
          [user.id]
        );

      let failedAttempts = 0;

      let lockedUntil = null;

      if (
        attemptResult.rows.length > 0
      ) {

        failedAttempts =
          Number(
            attemptResult.rows[0]
              .failed_attempts || 0
          );

        lockedUntil =
          attemptResult.rows[0]
            .locked_until;
      }

      // ===================================================
      // COMPROBAR BLOQUEO ACTIVO
      // ===================================================

      if (
        lockedUntil
      ) {

        const lockTime =
          new Date(
            lockedUntil
          );

        const now =
          new Date();

        if (
          lockTime > now
        ) {

          return res.status(423).json({

            status:
              "LOCKED",

            message:
              "LA RECUPERACIÓN DE CONTRASEÑA ESTÁ BLOQUEADA TEMPORALMENTE.",

            failedAttempts:
              RECOVERY_MAX_ATTEMPTS,

            maxAttempts:
              RECOVERY_MAX_ATTEMPTS,

            lockedUntil:
              lockTime.toISOString(),

            warning:
              false,

          });

        }

        // -------------------------------------------------
        // EL BLOQUEO YA VENCIÓ
        // -------------------------------------------------

        failedAttempts = 0;

        lockedUntil = null;

        await client.query(
          `
          INSERT INTO public.password_recovery_attempts (
            user_id,
            failed_attempts,
            locked_until,
            updated_at
          )
          VALUES (
            $1,
            0,
            NULL,
            NOW()
          )
          ON CONFLICT (user_id)
          DO UPDATE SET
            failed_attempts = 0,
            locked_until = NULL,
            updated_at = NOW()
          `,
          [user.id]
        );
      }

      // ===================================================
      // COMPARAR RESPUESTA
      // ===================================================

      const answerCorrect =
        await bcrypt.compare(
          cleanAnswer,
          user.recovery_answer_hash
        );

      // ===================================================
      // RESPUESTA INCORRECTA
      // ===================================================

      if (
        !answerCorrect
      ) {

        const nextAttempts =
          failedAttempts + 1;

        // -------------------------------------------------
        // INTENTO 5 — BLOQUEAR RECUPERACIÓN
        // -------------------------------------------------

        if (
          nextAttempts >=
          RECOVERY_MAX_ATTEMPTS
        ) {

          const lockResult =
            await client.query(
              `
              INSERT INTO public.password_recovery_attempts (
                user_id,
                failed_attempts,
                locked_until,
                updated_at
              )
              VALUES (
                $1,
                $2,
                NOW() + INTERVAL '${RECOVERY_LOCK_MINUTES} minutes',
                NOW()
              )
              ON CONFLICT (user_id)
              DO UPDATE SET
                failed_attempts = EXCLUDED.failed_attempts,
                locked_until = EXCLUDED.locked_until,
                updated_at = NOW()
              RETURNING
                failed_attempts,
                locked_until
              `,
              [
                user.id,
                RECOVERY_MAX_ATTEMPTS,
              ]
            );

          const lockData =
            lockResult.rows[0];

          return res.status(423).json({

            status:
              "LOCKED",

            message:
              "HAS ALCANZADO EL MÁXIMO DE INTENTOS. LA RECUPERACIÓN DE CONTRASEÑA HA SIDO BLOQUEADA TEMPORALMENTE.",

            failedAttempts:
              Number(
                lockData.failed_attempts
              ),

            maxAttempts:
              RECOVERY_MAX_ATTEMPTS,

            lockedUntil:
              new Date(
                lockData.locked_until
              ).toISOString(),

            warning:
              false,

          });
        }

        // -------------------------------------------------
        // GUARDAR INTENTO FALLIDO
        // -------------------------------------------------

        await client.query(
          `
          INSERT INTO public.password_recovery_attempts (
            user_id,
            failed_attempts,
            locked_until,
            updated_at
          )
          VALUES (
            $1,
            $2,
            NULL,
            NOW()
          )
          ON CONFLICT (user_id)
          DO UPDATE SET
            failed_attempts = EXCLUDED.failed_attempts,
            locked_until = NULL,
            updated_at = NOW()
          `,
          [
            user.id,
            nextAttempts,
          ]
        );

        // -------------------------------------------------
        // INTENTO 4 — ÚLTIMO INTENTO
        // -------------------------------------------------

        if (
          nextAttempts ===
          RECOVERY_MAX_ATTEMPTS - 1
        ) {

          return res.status(401).json({

            status:
              "ERROR",

            message:
              "ÚLTIMO INTENTO DISPONIBLE. SI LA RESPUESTA ES INCORRECTA, LA RECUPERACIÓN SERÁ BLOQUEADA.",

            failedAttempts:
              nextAttempts,

            maxAttempts:
              RECOVERY_MAX_ATTEMPTS,

            warning:
              true,

          });
        }

        // -------------------------------------------------
        // INTENTOS 1, 2 Y 3
        // -------------------------------------------------

        return res.status(401).json({

          status:
            "ERROR",

          message:
            "RESPUESTA DE RECUPERACIÓN INCORRECTA.",

          failedAttempts:
            nextAttempts,

          maxAttempts:
            RECOVERY_MAX_ATTEMPTS,

          warning:
            false,

        });
      }

      // ===================================================
      // RESPUESTA CORRECTA
      // ===================================================

      // ---------------------------------------------------
      // REINICIAR CONTADOR DE INTENTOS
      // ---------------------------------------------------

      await client.query(
        `
        INSERT INTO public.password_recovery_attempts (
          user_id,
          failed_attempts,
          locked_until,
          updated_at
        )
        VALUES (
          $1,
          0,
          NULL,
          NOW()
        )
        ON CONFLICT (user_id)
        DO UPDATE SET
          failed_attempts = 0,
          locked_until = NULL,
          updated_at = NOW()
        `,
        [user.id]
      );

      // ---------------------------------------------------
      // INVALIDAR TOKENS ANTERIORES
      // ---------------------------------------------------

      await client.query(
        `
        UPDATE public.password_recovery_tokens
        SET used_at = NOW()
        WHERE user_id = $1
          AND used_at IS NULL
        `,
        [user.id]
      );

      // ---------------------------------------------------
      // CREAR TOKEN TEMPORAL
      // ---------------------------------------------------

      const recoveryToken =
        createRecoveryToken();

      const tokenHash =
        hashRecoveryToken(
          recoveryToken
        );

      await client.query(
        `
        INSERT INTO public.password_recovery_tokens (
          user_id,
          token_hash,
          expires_at
        )
        VALUES (
          $1,
          $2,
          NOW() + INTERVAL '15 minutes'
        )
        `,
        [
          user.id,
          tokenHash,
        ]
      );

      // ===================================================
      // RESPUESTA EXITOSA
      // ===================================================

      return res.status(200).json({

        status:
          "SUCCESS",

        message:
          "RESPUESTA VERIFICADA.",

        recoveryToken,

        expiresIn:
          RECOVERY_TOKEN_EXPIRES_MINUTES *
          60,

        failedAttempts:
          0,

        maxAttempts:
          RECOVERY_MAX_ATTEMPTS,

      });

    } catch (error) {

      console.error(
        "RECOVERY VERIFY ERROR:",
        error
      );

      return res.status(500).json({

        status:
          "ERROR",

        message:
          "ERROR INTERNO DEL SERVIDOR.",

      });

    } finally {

      client.release();

    }
  }
);

// =========================================================
// RECOVERY — CAMBIAR CONTRASEÑA
// =========================================================

router.post(
  "/recovery/reset",
  async (req, res) => {

    const client =
      await pool.connect();

    try {

      const {
  token: recoveryToken,
  newPassword,
} = req.body;

      if (
        !recoveryToken ||
        !newPassword
      ) {
        return res.status(400).json({
          status: "ERROR",
          message:
            "TOKEN DE RECUPERACIÓN Y NUEVA CONTRASEÑA SON OBLIGATORIOS.",
        });
      }

      // ---------------------------------------------------
      // VALIDAR NUEVA CONTRASEÑA
      // ---------------------------------------------------

      const passwordError =
        validatePassword(
          newPassword
        );

      if (passwordError) {
        return res.status(400).json({
          status: "ERROR",
          message:
            passwordError,
        });
      }

      // ---------------------------------------------------
      // HASH DEL TOKEN RECIBIDO
      // ---------------------------------------------------

      const tokenHash =
        hashRecoveryToken(
          recoveryToken
        );

      // ---------------------------------------------------
      // BUSCAR TOKEN VÁLIDO
      // ---------------------------------------------------

      const tokenResult =
        await client.query(
          `
          SELECT
            id,
            user_id,
            expires_at,
            used_at
          FROM public.password_recovery_tokens
          WHERE token_hash = $1
          LIMIT 1
          `,
          [tokenHash]
        );

      if (
        tokenResult.rows.length === 0
      ) {
        return res.status(401).json({
          status: "ERROR",
          message:
            "EL TOKEN DE RECUPERACIÓN NO ES VÁLIDO.",
        });
      }

      const recovery =
        tokenResult.rows[0];

      if (
        recovery.used_at
      ) {
        return res.status(401).json({
          status: "ERROR",
          message:
            "EL TOKEN DE RECUPERACIÓN YA FUE UTILIZADO.",
        });
      }

      if (
        new Date(
          recovery.expires_at
        ).getTime() <= Date.now()
      ) {
        return res.status(401).json({
          status: "ERROR",
          message:
            "EL TOKEN DE RECUPERACIÓN HA EXPIRADO.",
        });
      }

      // ---------------------------------------------------
      // HASH NUEVA CONTRASEÑA
      // ---------------------------------------------------

      const newPasswordHash =
        await bcrypt.hash(
          newPassword,
          12
        );

      // ---------------------------------------------------
      // TRANSACCIÓN
      // ---------------------------------------------------

      await client.query(
        "BEGIN"
      );

      // ---------------------------------------------------
      // ACTUALIZAR PASSWORD
      // ---------------------------------------------------

      const updateResult =
        await client.query(
          `
          UPDATE public.users
          SET
            password_hash = $1,
            updated_at = NOW()
          WHERE id = $2
            AND status = 'active'
          RETURNING id
          `,
          [
            newPasswordHash,
            recovery.user_id,
          ]
        );

      if (
        updateResult.rows.length === 0
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(404).json({
          status: "ERROR",
          message:
            "NO FUE POSIBLE ACTUALIZAR LA CONTRASEÑA.",
        });
      }

      // ---------------------------------------------------
      // MARCAR TOKEN COMO UTILIZADO
      // ---------------------------------------------------

      await client.query(
        `
        UPDATE public.password_recovery_tokens
        SET used_at = NOW()
        WHERE id = $1
          AND used_at IS NULL
        `,
        [recovery.id]
      );

      // ---------------------------------------------------
      // INVALIDAR OTROS TOKENS
      // ---------------------------------------------------

      await client.query(
        `
        UPDATE public.password_recovery_tokens
        SET used_at = NOW()
        WHERE user_id = $1
          AND used_at IS NULL
        `,
        [recovery.user_id]
      );

      await client.query(
        "COMMIT"
      );

      // ---------------------------------------------------
      // LIMPIEZA DE TOKENS ANTIGUOS
      // ---------------------------------------------------

      try {
        await client.query(
          `
          DELETE FROM public.password_recovery_tokens
          WHERE expires_at < NOW()
             OR used_at IS NOT NULL
          `
        );
      } catch (cleanupError) {
        console.warn(
          "RECOVERY TOKEN CLEANUP WARNING:",
          cleanupError.message
        );
      }

      return res.status(200).json({
        status: "SUCCESS",

        message:
          "CONTRASEÑA ACTUALIZADA CORRECTAMENTE.",
      });

    } catch (error) {

      try {
        await client.query(
          "ROLLBACK"
        );
      } catch (rollbackError) {
        console.error(
          "RECOVERY RESET ROLLBACK ERROR:",
          rollbackError
        );
      }

      console.error(
        "RECOVERY RESET ERROR:",
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

      const authorization =
        req.headers.authorization || "";

      if (
        !authorization.startsWith(
          "Bearer "
        )
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

      let decoded;

      try {

        decoded =
          jwt.verify(
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

      // =====================================================
      // OBTENER USUARIO + PERFIL COMPLETO
      // =====================================================

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
            p.photo_url,

            p.age,
            p.job_title,
            p.plant,
            p.plant_number,
            p.sector,
            p.production_line,
            p.assigned_machine,
            p.shift,
            p.specialty,
            p.hire_date,
            p.bio,

            p.country,
            p.department,
            p.locality,
            p.street,
            p.street_number,

            p.latitude,
            p.longitude,
            p.location_visibility,
            p.profile_visibility

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

      if (
        user.status !== "active"
      ) {

        return res.status(403).json({
          status: "ERROR",
          message:
            "LA CUENTA DEL OPERADOR NO ESTÁ ACTIVA.",
        });

      }

      // =====================================================
      // RESPUESTA COMPLETA
      // =====================================================

      return res.status(200).json({

        status: "SUCCESS",

        user: {

          id:
            user.id,

          email:
            user.email,

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

          // =================================================
          // PERFIL PROFESIONAL
          // =================================================

          age:
            user.age,

          jobTitle:
            user.job_title,

          plant:
            user.plant,

          plantNumber:
            user.plant_number,

          sector:
            user.sector,

          productionLine:
            user.production_line,

          assignedMachine:
            user.assigned_machine,

          shift:
            user.shift,

          specialty:
            user.specialty,

          hireDate:
            user.hire_date,

          bio:
            user.bio,

          // =================================================
          // UBICACIÓN
          // =================================================

          country:
            user.country,

          department:
            user.department,

          locality:
            user.locality,

          street:
            user.street,

          streetNumber:
            user.street_number,

          latitude:
            user.latitude,

          longitude:
            user.longitude,

          locationVisibility:
            user.location_visibility,

          profileVisibility:
            user.profile_visibility,

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

      if (!userId) {
        return res.status(400).json({
          status: "ERROR",
          message:
            "ID DE OPERADOR NO VÁLIDO.",
        });
      }

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

      let storagePath =
        null;

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

      await client.query(
        "BEGIN"
      );

      transactionStarted =
        true;

      await client.query(
        `
        DELETE FROM public.users
        WHERE id = $1
        `,
        [userId]
      );

      await client.query(
        "COMMIT"
      );

      transactionStarted =
        false;

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

      if (
        transactionStarted
      ) {
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
