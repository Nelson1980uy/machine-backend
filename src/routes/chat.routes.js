import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";

import pool from "../config/database.js";

const router = express.Router();

// =========================================================
// CHAT - MULTIMEDIA
// =========================================================

// =========================================================
// CONFIGURACIÓN DE UPLOADS
// =========================================================

const uploadsDirectory =
  path.join(
    process.cwd(),
    "uploads",
    "chat"
  );

// =========================================================
// CREAR CARPETA SI NO EXISTE
// =========================================================

fs.mkdirSync(
  uploadsDirectory,
  {
    recursive: true,
  }
);

// =========================================================
// CATEGORÍAS MIME MULTIMEDIA PERMITIDAS
// =========================================================
//
// Para imágenes, videos y audios no utilizamos una lista
// cerrada de MIME individuales.
//
// Esto permite variantes legítimas como:
//
// image/avif
// image/heic
// image/heif
// image/bmp
// image/tiff
// image/svg+xml
//
// video/mp4
// video/webm
// video/quicktime
// video/x-matroska
// video/3gpp
//
// audio/mpeg
// audio/mp3
// audio/webm
// audio/ogg
// audio/opus
// audio/x-m4a
// audio/m4a
// etc.
//
// =========================================================

const allowedMimeCategories =
  new Set([
    "image",
    "video",
    "audio",
  ]);

// =========================================================
// EXTENSIONES DE ARCHIVO PERMITIDAS
// =========================================================
//
// Las extensiones se utilizan principalmente para:
//
// - documentos
// - comprimidos
// - MIME vacío
// - application/octet-stream
// - MIME application/* o text/* conocido
//
// =========================================================

const allowedExtensions =
  new Set([

    // -------------------------------------------------------
    // IMÁGENES
    // -------------------------------------------------------

    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
    ".avif",
    ".bmp",
    ".tif",
    ".tiff",
    ".ico",
    ".heic",
    ".heif",
    ".svg",

    // -------------------------------------------------------
    // VIDEO
    // -------------------------------------------------------

    ".mp4",
    ".m4v",
    ".webm",
    ".mov",
    ".avi",
    ".mkv",
    ".3gp",
    ".3g2",
    ".mpeg",
    ".mpg",
    ".wmv",
    ".flv",

    // -------------------------------------------------------
    // AUDIO
    // -------------------------------------------------------

    ".mp3",
    ".wav",
    ".ogg",
    ".oga",
    ".opus",
    ".webm",
    ".m4a",
    ".aac",
    ".flac",
    ".wma",
    ".aiff",
    ".aif",

    // -------------------------------------------------------
    // DOCUMENTOS
    // -------------------------------------------------------

    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".txt",
    ".csv",
    ".rtf",

    // -------------------------------------------------------
    // ARCHIVOS COMPRIMIDOS
    // -------------------------------------------------------

    ".zip",
    ".rar",
    ".7z",
    ".tar",
    ".gz",
    ".bz2",
  ]);

// =========================================================
// VALIDACIÓN DEL ARCHIVO
// =========================================================
//
// MACHINE permite:
//
// - cualquier MIME de imagen
// - cualquier MIME de video
// - cualquier MIME de audio
// - documentos conocidos
// - comprimidos conocidos
// - MIME vacío con extensión conocida
// - application/octet-stream con extensión conocida
//
// No aceptamos automáticamente cualquier application/*
// porque podría incluir ejecutables u otros archivos que
// no deberían almacenarse.
//
// =========================================================

const fileFilter =
  (req, file, callback) => {

    const mimeType =
      String(
        file.mimetype || ""
      )
        .trim()
        .toLowerCase();

    const originalName =
      String(
        file.originalname || ""
      )
        .trim()
        .toLowerCase();

    const extension =
      path.extname(
        originalName
      );

    const mimeCategory =
      mimeType.includes("/")
        ? mimeType.split("/")[0]
        : "";

    const extensionIsAllowed =
      allowedExtensions.has(
        extension
      );

    const mimeIsAllowed =
      allowedMimeCategories.has(
        mimeCategory
      );

    // =====================================================
    // IMAGEN / VIDEO / AUDIO
    // =====================================================
    //
    // Aceptamos cualquier MIME perteneciente a estas
    // categorías.
    //
    // Esto evita problemas con nuevos formatos legítimos.
    //
    // =====================================================

    if (
      mimeIsAllowed &&
      (
        mimeCategory === "image" ||
        mimeCategory === "video" ||
        mimeCategory === "audio"
      )
    ) {

      return callback(
        null,
        true
      );

    }

    // =====================================================
    // DOCUMENTOS / COMPRIMIDOS
    // =====================================================
    //
    // Para application/* y text/* exigimos una extensión
    // conocida.
    //
    // =====================================================

    if (
      extensionIsAllowed &&
      (
        mimeCategory === "application" ||
        mimeCategory === "text"
      )
    ) {

      return callback(
        null,
        true
      );

    }

    // =====================================================
    // MIME VACÍO
    // =====================================================
    //
    // Algunos navegadores o sistemas pueden no informar
    // correctamente el MIME.
    //
    // Si conocemos la extensión, permitimos el archivo.
    //
    // =====================================================

    if (
      !mimeType &&
      extensionIsAllowed
    ) {

      return callback(
        null,
        true
      );

    }

    // =====================================================
    // application/octet-stream
    // =====================================================
    //
    // MIME genérico utilizado por algunos sistemas.
    //
    // Solamente se permite cuando conocemos la extensión.
    //
    // =====================================================

    if (
      mimeType ===
        "application/octet-stream" &&
      extensionIsAllowed
    ) {

      return callback(
        null,
        true
      );

    }

    // =====================================================
    // RECHAZAR
    // =====================================================

    return callback(
      new Error(
        `Tipo de archivo no permitido: ${
          mimeType || "desconocido"
        }`
      )
    );

  };

// =========================================================
// STORAGE DE MULTER
// =========================================================

const storage =
  multer.diskStorage({

    destination:
      (req, file, callback) => {

        callback(
          null,
          uploadsDirectory
        );

      },

    filename:
      (req, file, callback) => {

        const originalExtension =
          path.extname(
            file.originalname || ""
          )
            .toLowerCase();

        const uniqueName =
          `${Date.now()}-${crypto.randomUUID()}${originalExtension}`;

        callback(
          null,
          uniqueName
        );

      },

  });

// =========================================================
// MULTER
// =========================================================

const upload =
  multer({

    storage,

    fileFilter,

    limits: {
      fileSize:
        50 * 1024 * 1024,
    },

  });

/// =========================================================
// MIDDLEWARE SEGURO PARA MULTER
// MULTI ARCHIVOS PRIVADOS
// =========================================================

const uploadPrivateFile =
  (req, res, next) => {

    upload.array(
      "files",
      20
    )(
      req,
      res,
      (error) => {

        // =================================================
        // SIN ERROR
        // =================================================

        if (!error) {
          return next();
        }

        console.error(
          "CHAT FILE UPLOAD ERROR:",
          error
        );


        // =================================================
        // ERRORES PROPIOS DE MULTER
        // =================================================

        if (
          error instanceof multer.MulterError
        ) {


          // =================================================
          // ARCHIVO DEMASIADO GRANDE
          // =================================================

          if (
            error.code ===
            "LIMIT_FILE_SIZE"
          ) {

            return res.status(400).json({

              status:
                "ERROR",

              message:
                "Cada archivo no puede superar los 50 MB.",

            });

          }


          // =================================================
          // DEMASIADOS ARCHIVOS
          // =================================================

          if (
            error.code ===
            "LIMIT_FILE_COUNT"
          ) {

            return res.status(400).json({

              status:
                "ERROR",

              message:
                "El lote no puede superar los 20 archivos.",

            });

          }


          // =================================================
          // CAMPO INCORRECTO O LÍMITE DE ARCHIVOS
          // =================================================

          if (
            error.code ===
            "LIMIT_UNEXPECTED_FILE"
          ) {

            return res.status(400).json({

              status:
                "ERROR",

              message:
                "El lote no puede superar los 20 archivos.",

            });

          }


          // =================================================
          // OTRO ERROR DE MULTER
          // =================================================

          return res.status(400).json({

            status:
              "ERROR",

            message:
              `Error al subir archivos: ${error.message}`,

          });

        }


        // =================================================
        // ERROR GENERAL
        // =================================================

        return res.status(400).json({

          status:
            "ERROR",

          message:
            error.message ||
            "Los archivos no pudieron ser procesados.",

        });

      }
    );

  };
// =========================================================
// HELPERS
// =========================================================

// =========================================================
// FORMATEAR ADJUNTOS
// =========================================================

const formatAttachments =
  (files = []) => {

    return files.map(
      (file) => ({

        url:
          `/uploads/chat/${file.filename}`,

        name:
          file.originalname,

        type:
          file.mimetype,

        size:
          file.size,

      })
    );

  };

// =========================================================
// CHAT - TOPICS
// =========================================================

// =========================================================
// GET /api/chat/topics
// Obtener todos los temas
// =========================================================

router.get(
  "/topics",
  async (req, res) => {

    try {

      const result =
        await pool.query(`
          SELECT
            t.id,
            t.title,
            t.description,
            t.status,
            t.created_at,
            t.updated_at,

            u.id AS author_user_id,
            u.email AS author_email,
            u.employee_id AS author_employee_id,

            p.first_name AS author_first_name,
            p.last_name AS author_last_name,
            p.gender AS author_gender,
            p.photo_url AS author_photo_url

          FROM public.chat_topics t

          INNER JOIN public.users u
            ON u.id = t.author_user_id

          LEFT JOIN public.user_profiles p
            ON p.user_id = u.id

          ORDER BY
            t.created_at DESC
        `);

      const topics =
        result.rows.map(
          (topic) => ({

            id:
              topic.id,

            title:
              topic.title,

            description:
              topic.description,

            status:
              topic.status,

            createdAt:
              topic.created_at,

            updatedAt:
              topic.updated_at,

            author: {

              id:
                topic.author_user_id,

              email:
                topic.author_email,

              employeeId:
                topic.author_employee_id,

              firstName:
                topic.author_first_name ||
                "Operador",

              lastName:
                topic.author_last_name ||
                "Local",

              gender:
                topic.author_gender ||
                null,

              photo:
                topic.author_photo_url ||
                null,

            },

          })
        );

      res.json({
        status: "OK",
        topics,
      });

    } catch (error) {

      console.error(
        "CHAT GET TOPICS ERROR:",
        error
      );

      res.status(500).json({
        status: "ERROR",
        message:
          "No fue posible obtener los temas.",
      });

    }

  }
);

// =========================================================
// POST /api/chat/topics
// Crear un nuevo tema
// =========================================================

router.post(
  "/topics",
  async (req, res) => {

    try {

      const {
        userId,
        title,
        description,
      } = req.body;

      // ===================================================
      // VALIDAR USER ID
      // ===================================================

      if (!userId) {

        return res.status(400).json({
          status: "ERROR",
          message:
            "El userId es obligatorio.",
        });

      }

      // ===================================================
      // VALIDAR TÍTULO
      // ===================================================

      const cleanTitle =
        String(title || "")
          .trim();

      if (!cleanTitle) {

        return res.status(400).json({
          status: "ERROR",
          message:
            "El título es obligatorio.",
        });

      }

      if (
        cleanTitle.length < 3
      ) {

        return res.status(400).json({
          status: "ERROR",
          message:
            "El título debe tener al menos 3 caracteres.",
        });

      }

      if (
        cleanTitle.length > 200
      ) {

        return res.status(400).json({
          status: "ERROR",
          message:
            "El título no puede superar los 200 caracteres.",
        });

      }

      // ===================================================
      // VALIDAR DESCRIPCIÓN
      // ===================================================

      const cleanDescription =
        String(description || "")
          .trim();

      if (!cleanDescription) {

        return res.status(400).json({
          status: "ERROR",
          message:
            "La descripción es obligatoria.",
        });

      }

      // ===================================================
      // VERIFICAR USUARIO
      // ===================================================

      const userResult =
        await pool.query(
          `
            SELECT
              u.id,
              u.email,
              u.employee_id,
              u.status,

              p.first_name,
              p.last_name,
              p.gender,
              p.photo_url

            FROM public.users u

            LEFT JOIN public.user_profiles p
              ON p.user_id = u.id

            WHERE
              u.id = $1

            LIMIT 1
          `,
          [
            userId,
          ]
        );

      if (
        userResult.rows.length === 0
      ) {

        return res.status(404).json({
          status: "ERROR",
          message:
            "El usuario indicado no existe.",
        });

      }

      const user =
        userResult.rows[0];

      // ===================================================
      // VERIFICAR ESTADO
      // ===================================================

      if (
        user.status !==
        "active"
      ) {

        return res.status(403).json({
          status: "ERROR",
          message:
            "El usuario no está activo.",
        });

      }

      // ===================================================
      // CREAR TEMA
      // ===================================================

      const result =
        await pool.query(
          `
            INSERT INTO public.chat_topics (
              author_user_id,
              title,
              description,
              status
            )

            VALUES (
              $1,
              $2,
              $3,
              'OPEN'
            )

            RETURNING
              id,
              title,
              description,
              status,
              created_at,
              updated_at
          `,
          [
            userId,
            cleanTitle,
            cleanDescription,
          ]
        );

      const topic =
        result.rows[0];

      // ===================================================
      // RESPUESTA
      // ===================================================

      res.status(201).json({

        status:
          "OK",

        message:
          "Tema creado correctamente.",

        topic: {

          id:
            topic.id,

          title:
            topic.title,

          description:
            topic.description,

          status:
            topic.status,

          createdAt:
            topic.created_at,

          updatedAt:
            topic.updated_at,

          author: {

            id:
              user.id,

            email:
              user.email,

            employeeId:
              user.employee_id,

            firstName:
              user.first_name ||
              "Operador",

            lastName:
              user.last_name ||
              "Local",

            gender:
              user.gender ||
              null,

            photo:
              user.photo_url ||
              null,

          },

        },

      });

    } catch (error) {

      console.error(
        "CHAT CREATE TOPIC ERROR:",
        error
      );

      res.status(500).json({
        status: "ERROR",
        message:
          "No fue posible crear el tema.",
      });

    }

  }
);

// =========================================================
// CHAT - OPERATORS
// =========================================================

// =========================================================
// GET /api/chat/operators
// Obtener operadores activos
// =========================================================

router.get(
  "/operators",
  async (req, res) => {

    try {

      const result =
        await pool.query(`
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

          WHERE
            u.status = 'active'
            AND u.role = 'operator'

          ORDER BY
            LOWER(
              COALESCE(
                p.first_name,
                'Operador'
              )
            ) ASC,

            LOWER(
              COALESCE(
                p.last_name,
                'Local'
              )
            ) ASC
        `);

      const operators =
        result.rows.map(
          (operator) => ({

            id:
              operator.id,

            email:
              operator.email,

            employeeId:
              operator.employee_id,

            role:
              operator.role,

            status:
              operator.status,

            lastLogin:
              operator.last_login,

            firstName:
              operator.first_name ||
              "Operador",

            lastName:
              operator.last_name ||
              "Local",

            gender:
              operator.gender ||
              null,

            photoUrl:
              operator.photo_url ||
              null,

            photo:
              operator.photo_url ||
              null,

            isOnline:
              false,

          })
        );

      res.json({
        status: "OK",
        operators,
      });

    } catch (error) {

      console.error(
        "CHAT GET OPERATORS ERROR:",
        error
      );

      res.status(500).json({
        status: "ERROR",
        message:
          "No fue posible obtener los operadores.",
      });

    }

  }
);

// =========================================================
// CHAT - PRIVATE MESSAGES
// =========================================================

// =========================================================
// POST /api/chat/private/:currentUserId/:otherUserId/messages
//
// Crear/recuperar conversación privada y guardar mensaje.
//
// Acepta:
//
// - texto
// - archivo
// - texto + archivo
// - archivo sin texto
//
// =========================================================

router.post(
  "/private/:currentUserId/:otherUserId/messages",
  uploadPrivateFile,
  async (req, res) => {

    const {
      currentUserId,
      otherUserId,
    } = req.params;

    const cleanCurrentUserId =
      String(currentUserId || "")
        .trim();

    const cleanOtherUserId =
      String(otherUserId || "")
        .trim();

    const cleanText =
      typeof req.body?.text === "string"
        ? req.body.text.trim()
        : "";

    const uploadedFiles =
  req.files || [];


const attachments =
  formatAttachments(
    uploadedFiles
  );

    // =====================================================
    // VALIDAR USUARIOS
    // =====================================================

    if (
      !cleanCurrentUserId ||
      !cleanOtherUserId
    ) {

      if (
  uploadedFiles.length > 0
) {

  uploadedFiles.forEach(
    (file) => {

      try {

        fs.unlinkSync(
          file.path
        );

      } catch {}

    }
  );

}
      return res.status(400).json({
        status: "ERROR",
        message:
          "Los usuarios de la conversación son obligatorios.",
      });

    }

    if (
      cleanCurrentUserId ===
      cleanOtherUserId
    ) {
if (
  uploadedFiles.length > 0
) {

  uploadedFiles.forEach(
    (file) => {

      try {

        fs.unlinkSync(
          file.path
        );

      } catch {}

    }
  );

}
      return res.status(400).json({
        status: "ERROR",
        message:
          "No puedes iniciar una conversación privada contigo mismo.",
      });

    }

    // =====================================================
    // VALIDAR MENSAJE
    // =====================================================

    if (
  !cleanText &&
  uploadedFiles.length === 0
){

      return res.status(400).json({
        status: "ERROR",
        message:
          "Debes enviar un mensaje o adjuntar un archivo.",
      });

    }

    // =====================================================
    // CONEXIÓN
    // =====================================================

    const client =
      await pool.connect();

    try {

      // ===================================================
      // INICIAR TRANSACCIÓN
      // ===================================================

      await client.query(
        "BEGIN"
      );

      // ===================================================
      // VERIFICAR USUARIOS
      // ===================================================

      const usersResult =
        await client.query(
          `
            SELECT
              u.id,
              u.email,
              u.employee_id,
              u.status,

              p.first_name,
              p.last_name,
              p.gender,
              p.photo_url

            FROM public.users u

            LEFT JOIN public.user_profiles p
              ON p.user_id = u.id

            WHERE
              u.id = ANY($1::uuid[])
          `,
          [
            [
              cleanCurrentUserId,
              cleanOtherUserId,
            ],
          ]
        );

      if (
        usersResult.rows.length !== 2
      ) {

        await client.query(
          "ROLLBACK"
        );
if (
  uploadedFiles.length > 0
) {

  uploadedFiles.forEach(
    (file) => {

      try {

        fs.unlinkSync(
          file.path
        );

      } catch {}

    }
  );

}

        return res.status(404).json({
          status: "ERROR",
          message:
            "Uno o ambos usuarios no existen.",
        });

      }

      const currentUser =
        usersResult.rows.find(
          (row) =>
            String(row.id) ===
            cleanCurrentUserId
        );

      const otherUser =
        usersResult.rows.find(
          (row) =>
            String(row.id) ===
            cleanOtherUserId
        );

      if (
        !currentUser ||
        !otherUser
      ) {

        await client.query(
          "ROLLBACK"
        );
if (
  uploadedFiles.length > 0
) {

  uploadedFiles.forEach(
    (file) => {

      try {

        fs.unlinkSync(
          file.path
        );

      } catch {}

    }
  );

}

        return res.status(404).json({
          status: "ERROR",
          message:
            "No fue posible identificar a los usuarios.",
        });

      }

      // ===================================================
      // VERIFICAR ESTADO
      // ===================================================

      if (
        currentUser.status !==
          "active" ||
        otherUser.status !==
          "active"
      ) {

        await client.query(
          "ROLLBACK"
        );
if (
  uploadedFiles.length > 0
) {

  uploadedFiles.forEach(
    (file) => {

      try {

        fs.unlinkSync(
          file.path
        );

      } catch {}

    }
  );

}

        return res.status(403).json({
          status: "ERROR",
          message:
            "Ambos operadores deben estar activos.",
        });

      }

      // ===================================================
      // BUSCAR CONVERSACIÓN EXISTENTE
      // ===================================================

      const conversationResult =
        await client.query(
          `
            SELECT
              c.id

            FROM public.chat_private_conversations c

            INNER JOIN public.chat_private_members m1
              ON m1.conversation_id = c.id

            INNER JOIN public.chat_private_members m2
              ON m2.conversation_id = c.id

            WHERE
              m1.user_id = $1
              AND m2.user_id = $2

            LIMIT 1
          `,
          [
            cleanCurrentUserId,
            cleanOtherUserId,
          ]
        );

      let conversationId;

      // ===================================================
      // CREAR CONVERSACIÓN
      // ===================================================

      if (
        conversationResult.rows.length === 0
      ) {

        const newConversation =
          await client.query(
            `
              INSERT INTO
                public.chat_private_conversations
              DEFAULT VALUES

              RETURNING id
            `
          );

        conversationId =
          newConversation.rows[0].id;

        // -------------------------------------------------
        // MIEMBRO 1
        // -------------------------------------------------

        await client.query(
          `
            INSERT INTO
              public.chat_private_members
            (
              conversation_id,
              user_id
            )

            VALUES
              ($1, $2)
          `,
          [
            conversationId,
            cleanCurrentUserId,
          ]
        );

        // -------------------------------------------------
        // MIEMBRO 2
        // -------------------------------------------------

        await client.query(
          `
            INSERT INTO
              public.chat_private_members
            (
              conversation_id,
              user_id
            )

            VALUES
              ($1, $2)
          `,
          [
            conversationId,
            cleanOtherUserId,
          ]
        );

      } else {

        conversationId =
          conversationResult.rows[0].id;

      }

     // ===================================================
// GUARDAR MENSAJE
// ===================================================

const messageResult =
  await client.query(
    `
      INSERT INTO
        public.chat_private_messages
      (
        conversation_id,
        author_user_id,
        text
      )

      VALUES
        ($1, $2, $3)

      RETURNING
        id,
        conversation_id,
        author_user_id,
        text,
        created_at,
        read_at
    `,
    [
      conversationId,

      cleanCurrentUserId,

      cleanText ||
        null,
    ]
  );


const message =
  messageResult.rows[0];


// ===================================================
// GUARDAR TODOS LOS ADJUNTOS
// ===================================================

if (
  attachments.length > 0
) {

  for (
    const attachment of attachments
  ) {

    await client.query(
      `
        INSERT INTO
          public.chat_private_attachments
        (
          message_id,
          url,
          name,
          type,
          size
        )

        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          $5
        )
      `,
      [
        message.id,

        attachment.url,

        attachment.name,

        attachment.type,

        attachment.size,
      ]
    );

  }

}

      // ===================================================
      // ACTUALIZAR CONVERSACIÓN
      // ===================================================

      await client.query(
        `
          UPDATE
            public.chat_private_conversations

          SET
            updated_at = NOW()

          WHERE
            id = $1
        `,
        [
          conversationId,
        ]
      );

      // ===================================================
      // CONFIRMAR
      // ===================================================

      await client.query(
        "COMMIT"
      );

      // ===================================================
// RESPUESTA
// ===================================================

return res.status(201).json({

  status:
    "OK",

  message:
    "Mensaje privado guardado correctamente.",

  conversationId,


  data: {

    id:
      message.id,


    conversationId:
      message.conversation_id,


    senderId:
      message.author_user_id,


    text:
      message.text || "",


    createdAt:
      message.created_at,


    read:
      message.read_at !== null,


    readAt:
      message.read_at,


    // ===================================================
    // MULTIMEDIA
    // TODOS LOS ARCHIVOS DEL MENSAJE
    // ===================================================

    attachments:
      attachments || [],



    // ===================================================
    // AUTOR
    // ===================================================

    author: {

      id:
        currentUser.id,


      email:
        currentUser.email,


      employeeId:
        currentUser.employee_id,


      firstName:
        currentUser.first_name ||
        "Operador",


      lastName:
        currentUser.last_name ||
        "Local",


      gender:
        currentUser.gender ||
        null,


      photo:
        currentUser.photo_url ||
        null,

    },



    // ===================================================
    // RECEPTOR
    // ===================================================

    receiver: {

      id:
        otherUser.id,


      email:
        otherUser.email,


      employeeId:
        otherUser.employee_id,


      firstName:
        otherUser.first_name ||
        "Operador",


      lastName:
        otherUser.last_name ||
        "Local",


      gender:
        otherUser.gender ||
        null,


      photo:
        otherUser.photo_url ||
        null,

    },

  },

});
      // ===================================================
// ELIMINAR ARCHIVOS SI FALLÓ LA BD
// ===================================================

if (
  uploadedFiles.length > 0
) {

  uploadedFiles.forEach(
    (file) => {

      try {

        if (
          fs.existsSync(
            file.path
          )
        ) {

          fs.unlinkSync(
            file.path
          );

        }

      } catch (
        fileDeleteError
      ) {

        console.error(
          "CHAT FILE CLEANUP ERROR:",
          fileDeleteError
        );

      }

    }
  );

}

      return res.status(500).json({

        status:
          "ERROR",

        message:
          "No fue posible enviar el mensaje privado.",

      });

    } finally {

      client.release();

    }

  }

);

// =========================================================
// CHAT - PRIVATE HISTORY
// =========================================================

// =========================================================
// GET /api/chat/private/:currentUserId/:otherUserId
//
// Cargar historial de una conversación privada.
// =========================================================

router.get(
  "/private/:currentUserId/:otherUserId",
  async (req, res) => {

    const {
      currentUserId,
      otherUserId,
    } = req.params;

    const cleanCurrentUserId =
      String(currentUserId || "")
        .trim();

    const cleanOtherUserId =
      String(otherUserId || "")
        .trim();

    // =====================================================
    // VALIDAR USUARIOS
    // =====================================================

    if (
      !cleanCurrentUserId ||
      !cleanOtherUserId
    ) {

      return res.status(400).json({
        status: "ERROR",
        message:
          "Los usuarios de la conversación son obligatorios.",
      });

    }

    if (
      cleanCurrentUserId ===
      cleanOtherUserId
    ) {

      return res.status(400).json({
        status: "ERROR",
        message:
          "No puedes abrir una conversación contigo mismo.",
      });

    }

    try {

      // ===================================================
      // BUSCAR CONVERSACIÓN
      // ===================================================

      const conversationResult =
        await pool.query(
          `
            SELECT
              c.id

            FROM public.chat_private_conversations c

            INNER JOIN public.chat_private_members m1
              ON m1.conversation_id = c.id

            INNER JOIN public.chat_private_members m2
              ON m2.conversation_id = c.id

            WHERE
              m1.user_id = $1
              AND m2.user_id = $2

            LIMIT 1
          `,
          [
            cleanCurrentUserId,
            cleanOtherUserId,
          ]
        );

      // ===================================================
      // SIN CONVERSACIÓN
      // ===================================================

      if (
        conversationResult.rows.length === 0
      ) {

        return res.status(200).json({

          status:
            "OK",

          conversationId:
            null,

          messages:
            [],

        });

      }

      const conversationId =
        conversationResult.rows[0].id;

     // ===================================================
// OBTENER MENSAJES
// EMISOR + DESTINATARIO + ADJUNTOS
// ===================================================

const messagesResult =
  await pool.query(
    `
      SELECT
        m.id,
        m.conversation_id,
        m.author_user_id,
        m.text,
        m.created_at,
        m.read_at,


        -- =================================================
        -- TODOS LOS ADJUNTOS DEL MENSAJE
        -- =================================================

        COALESCE(
          json_agg(
            json_build_object(

              'url',
              a.url,

              'name',
              a.name,

              'type',
              a.type,

              'size',
              a.size

            )
          )
          FILTER (
            WHERE a.id IS NOT NULL
          ),

          '[]'
        ) AS attachments,


        -- =================================================
        -- DATOS DEL EMISOR
        -- =================================================

        author_u.email AS author_email,
        author_u.employee_id AS author_employee_id,
        author_u.status AS author_status,

        author_p.first_name AS author_first_name,
        author_p.last_name AS author_last_name,
        author_p.gender AS author_gender,
        author_p.photo_url AS author_photo_url,


        -- =================================================
        -- DATOS DEL DESTINATARIO
        -- =================================================

        receiver_u.id AS receiver_user_id,
        receiver_u.email AS receiver_email,
        receiver_u.employee_id AS receiver_employee_id,
        receiver_u.status AS receiver_status,

        receiver_p.first_name AS receiver_first_name,
        receiver_p.last_name AS receiver_last_name,
        receiver_p.gender AS receiver_gender,
        receiver_p.photo_url AS receiver_photo_url


      FROM public.chat_private_messages m


      -- =================================================
      -- EMISOR
      -- =================================================

      INNER JOIN public.users author_u
        ON author_u.id = m.author_user_id


      LEFT JOIN public.user_profiles author_p
        ON author_p.user_id = author_u.id


      -- =================================================
      -- DESTINATARIO
      -- =================================================

      INNER JOIN public.chat_private_members receiver_member
        ON receiver_member.conversation_id = m.conversation_id
        AND receiver_member.user_id <> m.author_user_id


      INNER JOIN public.users receiver_u
        ON receiver_u.id = receiver_member.user_id


      LEFT JOIN public.user_profiles receiver_p
        ON receiver_p.user_id = receiver_u.id


      -- =================================================
      -- ADJUNTOS
      -- =================================================

      LEFT JOIN public.chat_private_attachments a
        ON a.message_id = m.id


      WHERE
        m.conversation_id = $1


      GROUP BY

        m.id,

        m.conversation_id,

        m.author_user_id,

        m.text,

        m.created_at,

        m.read_at,


        author_u.email,

        author_u.employee_id,

        author_u.status,


        author_p.first_name,

        author_p.last_name,

        author_p.gender,

        author_p.photo_url,


        receiver_u.id,

        receiver_u.email,

        receiver_u.employee_id,

        receiver_u.status,


        receiver_p.first_name,

        receiver_p.last_name,

        receiver_p.gender,

        receiver_p.photo_url


      ORDER BY
        m.created_at ASC
    `,
    [
      conversationId,
    ]
  );
      // ===================================================
// FORMATEAR MENSAJES
// EMISOR + DESTINATARIO
// ===================================================

const messages =
  messagesResult.rows.map(
    (message) => ({

      id:
        message.id,

      conversationId:
        message.conversation_id,

      senderId:
        message.author_user_id,

      text:
        message.text ||
        "",

      createdAt:
        message.created_at,

      // ---------------------------------------------
      // LECTURA
      // ---------------------------------------------

      read:
        message.read_at !== null,

      readAt:
        message.read_at,

      // ---------------------------------------------
      // MULTIMEDIA
      // ---------------------------------------------

      attachmentUrl:
        message.attachment_url ||
        null,

      attachmentName:
        message.attachment_name ||
        null,

      attachmentType:
        message.attachment_type ||
        null,

      attachmentSize:
        message.attachment_size ||
        null,

      // ---------------------------------------------
      // EMISOR / AUTOR
      // ---------------------------------------------

      author: {

        id:
          message.author_user_id,

        email:
          message.author_email,

        employeeId:
          message.author_employee_id,

        status:
          message.author_status,

        firstName:
          message.author_first_name ||
          "Operador",

        lastName:
          message.author_last_name ||
          "Local",

        gender:
          message.author_gender ||
          null,

        photo:
          message.author_photo_url ||
          null,

      },

      // ---------------------------------------------
      // DESTINATARIO
      // ---------------------------------------------

      receiver: {

        id:
          message.receiver_user_id,

        email:
          message.receiver_email,

        employeeId:
          message.receiver_employee_id,

        status:
          message.receiver_status,

        firstName:
          message.receiver_first_name ||
          "Operador",

        lastName:
          message.receiver_last_name ||
          "Local",

        gender:
          message.receiver_gender ||
          null,

        photo:
          message.receiver_photo_url ||
          null,

      },

    })
  );

// ===================================================
// RESPUESTA
// ===================================================

return res.status(200).json({

  status:
    "OK",

  conversationId,

  messages,

});


} catch (error) {

  console.error(
    "CHAT PRIVATE HISTORY ERROR:",
    error
  );


  return res.status(500).json({

    status:
      "ERROR",

    message:
      "No fue posible cargar el historial del chat privado.",

  });


}


  }

);

// =========================================================
// EXPORTAR ROUTER
// =========================================================

export default router;

