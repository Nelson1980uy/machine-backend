import express from "express";
import multer from "multer";
import path from "path";
import crypto from "crypto";

import pool from "../config/database.js";
import supabase from "../config/supabase.js";

const router = express.Router();



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
//
// Los archivos del chat privado NO se guardan en el disco
// del servidor.
//
// Multer los mantiene temporalmente en memoria mediante
// file.buffer.
//
// Después el backend los sube directamente a:
//
// Supabase Storage
// → machine-private-chat 🔒
//
// =========================================================

const storage =
  multer.memoryStorage();

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

// =========================================================
// MIDDLEWARE SEGURO PARA MULTER
// MULTI ARCHIVOS PRIVADOS
// =========================================================
//
// MACHINE permite hasta 20 archivos por lote.
//
// Multer utiliza memoryStorage(), por lo que los archivos
// todavía no existen físicamente en el servidor.
//
// Los archivos serán enviados posteriormente al bucket
// privado de Supabase:
//
// machine-private-chat
//
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
          // CAMPO INCORRECTO
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
// SUPABASE STORAGE
// CHAT PRIVADO MACHINE
// =========================================================
//
// Los archivos privados de los operadores se almacenan
// exclusivamente en el bucket privado:
//
// machine-private-chat
//
// El bucket NO debe ser público.
//
// El backend utiliza SUPABASE_SERVICE_ROLE_KEY,
// por lo que esta operación nunca debe ejecutarse
// directamente desde el frontend.
//
// =========================================================

const PRIVATE_CHAT_BUCKET =
  "machine-private-chat";


// =========================================================
// SUBIR ARCHIVO PRIVADO
// =========================================================
//
// El archivo llega mediante multer.memoryStorage()
// y permanece temporalmente en:
//
// file.buffer
//
// Después se almacena en:
//
// Supabase Storage
// → machine-private-chat 🔒
//
// =========================================================

const uploadPrivateAttachment =
  async (
    file,
    currentUserId,
    conversationId
  ) => {

    // =======================================================
    // VALIDAR ARCHIVO
    // =======================================================

    if (
      !file ||
      !file.buffer
    ) {

      throw new Error(
        "El archivo recibido no contiene datos válidos."
      );

    }

    // =======================================================
    // OBTENER EXTENSIÓN ORIGINAL
    // =======================================================

    const originalExtension =
      path.extname(
        file.originalname || ""
      )
        .toLowerCase();

    // =======================================================
    // GENERAR NOMBRE ÚNICO
    // =======================================================

    const uniqueFileName =
      `${Date.now()}-${crypto.randomUUID()}${originalExtension}`;

    // =======================================================
    // RUTA PRIVADA EN SUPABASE
    // =======================================================

    const storagePath =
      `private/${conversationId}/${currentUserId}/${uniqueFileName}`;

    // =======================================================
    // SUBIR A SUPABASE STORAGE
    // =======================================================

    const {
      data,
      error
    } =
      await supabase.storage
        .from(
          PRIVATE_CHAT_BUCKET
        )
        .upload(
          storagePath,
          file.buffer,
          {
            contentType:
              file.mimetype ||
              "application/octet-stream",

            upsert:
              false,
          }
        );

    // =======================================================
    // ERROR DE SUPABASE
    // =======================================================

    if (
      error
    ) {

      console.error(
        "MACHINE PRIVATE STORAGE UPLOAD ERROR:",
        error
      );

      throw new Error(
        "No fue posible almacenar el archivo privado."
      );

    }

    // =======================================================
    // DEVOLVER DATOS DEL ARCHIVO
    // =======================================================

    return {

      storagePath:
        data?.path ||
        storagePath,

      name:
        file.originalname ||
        "Archivo",

      type:
        file.mimetype ||
        "application/octet-stream",

      size:
        file.size,

    };

  };


// =========================================================
// SUBIR TODOS LOS ARCHIVOS PRIVADOS
// =========================================================
//
// Si un archivo falla:
//
// 1. Se detiene el proceso.
// 2. Se eliminan los archivos que ya fueron subidos.
// 3. Se devuelve el error.
//
// =========================================================

const uploadPrivateAttachments =
  async (
    files = [],
    currentUserId,
    conversationId
  ) => {

    // =======================================================
    // SIN ARCHIVOS
    // =======================================================

    if (
      !Array.isArray(files) ||
      files.length === 0
    ) {

      return [];

    }

    // =======================================================
    // ARCHIVOS SUBIDOS CORRECTAMENTE
    // =======================================================

    const uploadedAttachments =
      [];

    // =======================================================
    // PROCESAR LOTE
    // =======================================================

    try {

      for (
        const file of files
      ) {

        const attachment =
          await uploadPrivateAttachment(
            file,
            currentUserId,
            conversationId
          );

        uploadedAttachments.push(
          attachment
        );

      }

      // =====================================================
      // DEVOLVER TODOS LOS ARCHIVOS
      // =====================================================

      return uploadedAttachments;

    } catch (
      error
    ) {

      // =====================================================
      // SI FALLA UN ARCHIVO,
      // ELIMINAR LOS ANTERIORES DEL MISMO LOTE
      // =====================================================

      for (
        const attachment
        of uploadedAttachments
      ) {

        if (
          !attachment?.storagePath
        ) {

          continue;

        }

        try {

          await supabase.storage
            .from(
              PRIVATE_CHAT_BUCKET
            )
            .remove([
              attachment.storagePath,
            ]);

        } catch (
          cleanupError
        ) {

          console.error(
            "MACHINE PRIVATE STORAGE CLEANUP ERROR:",
            cleanupError
          );

        }

      }

      // =====================================================
      // DEVOLVER ERROR ORIGINAL
      // =====================================================

      throw error;

    }

  };

  // =========================================================
// GENERAR URL PRIVADA TEMPORAL
// =========================================================

const createPrivateAttachmentSignedUrl =
  async (
    storagePath
  ) => {

    if (
      !storagePath
    ) {

      throw new Error(
        "El archivo privado no tiene una ruta de almacenamiento válida."
      );

    }

    const {
      data,
      error,
    } =
      await supabase.storage
        .from(
          PRIVATE_CHAT_BUCKET
        )
        .createSignedUrl(
          storagePath,
          60 * 60
        );

    if (
      error ||
      !data?.signedUrl
    ) {

      console.error(
        "MACHINE PRIVATE SIGNED URL ERROR:",
        error
      );

      throw new Error(
        "No fue posible generar el acceso temporal al archivo privado."
      );

    }

    return data.signedUrl;
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
  // GET /api/chat/topics
  // RECUPERAR TEMAS PERSISTENTES DESDE POSTGRESQL
  // Y RENOVAR LOS ENLACES DE SUPABASE STORAGE
  // =========================================================

  router.get("/topics", async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          t.id AS topic_id,
          t.title,
          t.description,
          t.status AS topic_status,
          t.created_at AS topic_created_at,
          t.updated_at AS topic_updated_at,

          u.id AS author_id,
          u.email AS author_email,
          u.employee_id AS author_employee_id,

          p.first_name AS author_first_name,
          p.last_name AS author_last_name,
          p.gender AS author_gender,
          p.photo_url AS author_photo,

          a.file_name AS attachment_name,
          a.mime_type AS attachment_type,
          a.file_size AS attachment_size,
          a.storage_bucket AS attachment_bucket,
          a.storage_path AS attachment_path

        FROM public.chat_topics t

        LEFT JOIN public.users u
          ON u.id = t.author_user_id

        LEFT JOIN public.user_profiles p
          ON p.user_id = u.id

        LEFT JOIN public.chat_attachments a
          ON a.topic_id = t.id

        ORDER BY
          t.created_at DESC,
          t.id DESC
      `);

      const topics = await Promise.all(
        result.rows.map(async (row) => {
          let attachment = null;

          // ===============================================
          // RENOVAR URL DE ARCHIVO PRIVADO
          // ===============================================

          if (
            row.attachment_path &&
            row.attachment_bucket
          ) {
            try {
              const { data, error } =
                await supabase.storage
                  .from(row.attachment_bucket)
                  .createSignedUrl(
                    row.attachment_path,
                    3600
                  );

              if (error) {
                console.error(
                  "MACHINE TOPIC SIGNED URL ERROR:",
                  error
                );
              } else {
                attachment = {
                  name: row.attachment_name,
                  type:
                    row.attachment_type ||
                    "application/octet-stream",
                  size: Number(
                    row.attachment_size || 0
                  ),
                  url: data.signedUrl,
                };
              }
            } catch (error) {
              console.error(
                "MACHINE TOPIC ATTACHMENT ERROR:",
                error
              );
            }
          }

          return {
            id: row.topic_id,
            title: row.title,
            description: row.description,
            status: row.topic_status,

            createdAt: row.topic_created_at,
            updatedAt: row.topic_updated_at,

            attachment,
            comments: [],

            author: {
              id: row.author_id,
              email: row.author_email,
              employeeId: row.author_employee_id,
              firstName:
                row.author_first_name || "Operador",
              lastName:
                row.author_last_name || "Local",
              gender: row.author_gender || null,
              photo: row.author_photo || null,
            },
          };
        })
      );

      return res.status(200).json({
        status: "OK",
        topics,
      });

    } catch (error) {
      console.error(
        "MACHINE LOAD TOPICS ERROR:",
        error
      );

      return res.status(500).json({
        status: "ERROR",
        message:
          "No fue posible recuperar los temas guardados.",
      });
    }
  });



 // =========================================================
 // POST /api/chat/topics
 // Crear un nuevo tema con archivo adjunto opcional
 // PostgreSQL + Supabase Storage
 // =========================================================

router.post(
  "/topics",

  // -------------------------------------------------------
  // PROCESAR ARCHIVO OPCIONAL (máximo 50 MB)
  // El formulario debe enviar el archivo como "file".
  // -------------------------------------------------------
  (req, res, next) => {
    upload.single("file")(req, res, (error) => {
      if (!error) {
        return next();
      }

      console.error("MACHINE TOPIC FILE ERROR:", error);

      if (error instanceof multer.MulterError) {
        return res.status(400).json({
          status: "ERROR",
          message:
            error.code === "LIMIT_FILE_SIZE"
              ? "El archivo no puede superar los 50 MB."
              : "No fue posible procesar el archivo adjunto.",
        });
      }

      return res.status(400).json({
        status: "ERROR",
        message: error.message || "Archivo no permitido.",
      });
    });
  },

  async (req, res) => {
    const TOPIC_BUCKET = "machine-topic-attachments";

    let createdTopicId = null;
    let uploadedStoragePath = null;

    try {
      const { userId, title, description } = req.body;

      // -----------------------------------------------------
      // VALIDAR USUARIO
      // -----------------------------------------------------
      if (!userId) {
        return res.status(400).json({
          status: "ERROR",
          message: "El userId es obligatorio.",
        });
      }

      // -----------------------------------------------------
      // VALIDAR TÍTULO
      // -----------------------------------------------------
      const cleanTitle = String(title || "").trim();

      if (cleanTitle.length < 3 || cleanTitle.length > 200) {
        return res.status(400).json({
          status: "ERROR",
          message: "El título debe tener entre 3 y 200 caracteres.",
        });
      }

      // -----------------------------------------------------
      // VALIDAR DESCRIPCIÓN
      // -----------------------------------------------------
      const cleanDescription = String(description || "").trim();

      if (!cleanDescription) {
        return res.status(400).json({
          status: "ERROR",
          message: "La descripción es obligatoria.",
        });
      }

      // -----------------------------------------------------
      // VERIFICAR USUARIO
      // -----------------------------------------------------
      const userResult = await pool.query(
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
          WHERE u.id = $1
          LIMIT 1
        `,
        [userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          status: "ERROR",
          message: "El usuario indicado no existe.",
        });
      }

      const user = userResult.rows[0];

      if (user.status !== "active") {
        return res.status(403).json({
          status: "ERROR",
          message: "El usuario no está activo.",
        });
      }

      // -----------------------------------------------------
      // CREAR TEMA EN POSTGRESQL
      // -----------------------------------------------------
      const topicResult = await pool.query(
        `
          INSERT INTO public.chat_topics (
            author_user_id,
            title,
            description,
            status
          )
          VALUES ($1, $2, $3, 'OPEN')
          RETURNING
            id,
            title,
            description,
            status,
            created_at,
            updated_at
        `,
        [user.id, cleanTitle, cleanDescription]
      );

      const topic = topicResult.rows[0];
      createdTopicId = topic.id;

      let attachment = null;

      // -----------------------------------------------------
      // SUBIR ARCHIVO A SUPABASE SI EXISTE
      // -----------------------------------------------------
      if (req.file) {
        const file = req.file;

        if (!file.buffer || file.size <= 0) {
          throw new Error(
            "El archivo está vacío o no es válido."
          );
        }

        const originalName = String(
          file.originalname || "archivo"
        )
          .replace(/^.*[\\/]/, "")
          .slice(0, 255);

        const extension = path
          .extname(originalName)
          .toLowerCase();

        const uniqueName =
          `${Date.now()}-${crypto.randomUUID()}${extension}`;

        const storagePath =
          `topics/${topic.id}/${user.id}/${uniqueName}`;

        const { data: uploadedFile, error: uploadError } =
          await supabase.storage
            .from(TOPIC_BUCKET)
            .upload(storagePath, file.buffer, {
              contentType:
                file.mimetype || "application/octet-stream",
              upsert: false,
            });

        if (uploadError) {
          console.error(
            "MACHINE TOPIC STORAGE ERROR:",
            uploadError
          );

          throw new Error(
            "No fue posible guardar el archivo en Supabase."
          );
        }

        uploadedStoragePath =
          uploadedFile?.path || storagePath;

        // ---------------------------------------------------
        // GUARDAR METADATOS DEL ARCHIVO EN POSTGRESQL
        // ---------------------------------------------------
        const supabaseUrl = String(
          process.env.SUPABASE_URL || ""
        ).replace(/\/+$/, "");

        if (!supabaseUrl) {
          throw new Error(
            "Falta configurar SUPABASE_URL en el backend."
          );
        }

        const authenticatedObjectUrl =
          `${supabaseUrl}/storage/v1/object/authenticated/` +
          `${TOPIC_BUCKET}/` +
          uploadedStoragePath
            .split("/")
            .map(encodeURIComponent)
            .join("/");

        await pool.query(
          `
            INSERT INTO public.chat_attachments (
              uploaded_by_user_id,
              file_name,
              mime_type,
              file_size,
              storage_bucket,
              storage_path,
              public_url,
              topic_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            user.id,
            originalName,
            file.mimetype || "application/octet-stream",
            file.size,
            TOPIC_BUCKET,
            uploadedStoragePath,
            authenticatedObjectUrl,
            topic.id,
          ]
        );

        // ---------------------------------------------------
        // GENERAR URL TEMPORAL PARA MOSTRAR EL ARCHIVO
        // Dura una hora. El GET de temas deberá renovarla.
        // ---------------------------------------------------
        const { data: signedData, error: signedError } =
          await supabase.storage
            .from(TOPIC_BUCKET)
            .createSignedUrl(uploadedStoragePath, 3600);

        if (signedError) {
          console.error(
            "MACHINE TOPIC SIGNED URL ERROR:",
            signedError
          );

          throw new Error(
            "El archivo se guardó, pero no fue posible generar su enlace temporal."
          );
        }

        attachment = {
          name: originalName,
          type: file.mimetype || "application/octet-stream",
          size: file.size,
          url: signedData.signedUrl,
        };
      }

      // -----------------------------------------------------
      // RESPUESTA
      // -----------------------------------------------------
      return res.status(201).json({
        status: "OK",
        message: "Tema creado correctamente.",

        topic: {
          id: topic.id,
          title: topic.title,
          description: topic.description,
          status: topic.status,
          createdAt: topic.created_at,
          updatedAt: topic.updated_at,

          attachment,
          comments: [],

          author: {
            id: user.id,
            email: user.email,
            employeeId: user.employee_id,
            firstName: user.first_name || "Operador",
            lastName: user.last_name || "Local",
            gender: user.gender || null,
            photo: user.photo_url || null,
          },
        },
      });
    } catch (error) {
      console.error("CHAT CREATE TOPIC ERROR:", error);

      // -----------------------------------------------------
      // LIMPIAR ARCHIVO SI FALLÓ LA OPERACIÓN
      // -----------------------------------------------------
      if (uploadedStoragePath) {
        try {
          const { error: removeError } =
            await supabase.storage
              .from(TOPIC_BUCKET)
              .remove([uploadedStoragePath]);

          if (removeError) {
            console.error(
              "MACHINE TOPIC STORAGE CLEANUP ERROR:",
              removeError
            );
          }
        } catch (cleanupError) {
          console.error(
            "MACHINE TOPIC CLEANUP ERROR:",
            cleanupError
          );
        }
      }

      // -----------------------------------------------------
      // ELIMINAR EL TEMA SI NO PUDO COMPLETARSE
      // -----------------------------------------------------
      if (createdTopicId) {
        try {
          await pool.query(
            "DELETE FROM public.chat_topics WHERE id = $1",
            [createdTopicId]
          );
        } catch (rollbackError) {
          console.error(
            "MACHINE TOPIC DATABASE CLEANUP ERROR:",
            rollbackError
          );
        }
      }

      return res.status(500).json({
        status: "ERROR",
        message:
          error.message || "No fue posible crear el tema.",
      });
    }
  }
);


/// =========================================================
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

            p.location_visibility,
            p.profile_visibility

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

            // =================================================
            // DATOS PROFESIONALES
            // =================================================

            age:
              operator.age ??
              null,

            jobTitle:
              operator.job_title ||
              "",

            plant:
              operator.plant ||
              "",

            plantNumber:
              operator.plant_number ||
              "",

            sector:
              operator.sector ||
              "",

            productionLine:
              operator.production_line ||
              "",

            assignedMachine:
              operator.assigned_machine ||
              "",

            shift:
              operator.shift ||
              "",

            specialty:
              operator.specialty ||
              "",

            hireDate:
              operator.hire_date ||
              null,

            bio:
              operator.bio ||
              "",

            // =================================================
            // UBICACIÓN PÚBLICA / NO SENSIBLE
            // =================================================

            country:
              operator.country ||
              "",

            department:
              operator.department ||
              "",

            locality:
              operator.locality ||
              "",

            // =================================================
            // PRIVACIDAD DE UBICACIÓN
            // =================================================

            locationVisibility:
              operator.location_visibility ||
              "PRIVATE",

            // =================================================
            // PRIVACIDAD DEL PERFIL
            // =================================================

            profileVisibility:
              String(
                operator.profile_visibility ||
                "PUBLIC"
              ).toUpperCase() === "PRIVATE"
                ? "PRIVATE"
                : "PUBLIC",

            // =================================================
            // PRESENCIA
            // =================================================
            //
            // La presencia real se manejará mediante Socket.IO.
            //

            isOnline:
              false,

          })
        );

      return res.json({

        status:
          "OK",

        operators,

      });

    } catch (error) {

      console.error(
        "CHAT GET OPERATORS ERROR:",
        error
      );

      return res.status(500).json({

        status:
          "ERROR",

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
// =========================================================
// CHAT - PRIVATE MESSAGE
// =========================================================

// =========================================================
// POST /api/chat/private/:currentUserId/:otherUserId/messages
//
// Enviar mensaje privado.
//
// Texto:
// PostgreSQL
//
// Multimedia:
// Multer memoryStorage()
//        ↓
// Supabase Storage privado
//        ↓
// storage_path en PostgreSQL
//        ↓
// Signed URL temporal para el frontend
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

    // =====================================================
    // ARCHIVOS RECIBIDOS POR MULTER
    // =====================================================

    const uploadedFiles =
      Array.isArray(req.files)
        ? req.files
        : [];

    // =====================================================
    // ADJUNTOS SUBIDOS A SUPABASE
    // =====================================================

    let attachments = [];

    // =====================================================
    // RUTAS DE STORAGE PARA LIMPIEZA
    // =====================================================

    let uploadedStoragePaths = [];

    // =====================================================
    // VALIDAR USUARIOS
    // =====================================================

    if (
      !cleanCurrentUserId ||
      !cleanOtherUserId
    ) {

      return res.status(400).json({
        status:
          "ERROR",

        message:
          "Los usuarios de la conversación son obligatorios.",
      });

    }

    if (
      cleanCurrentUserId ===
      cleanOtherUserId
    ) {

      return res.status(400).json({
        status:
          "ERROR",

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
    ) {

      return res.status(400).json({
        status:
          "ERROR",

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

        return res.status(404).json({
          status:
            "ERROR",

          message:
            "Uno o ambos usuarios no existen.",
        });

      }

      // ===================================================
      // IDENTIFICAR USUARIOS
      // ===================================================

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

        return res.status(404).json({
          status:
            "ERROR",

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

        return res.status(403).json({
          status:
            "ERROR",

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
      // SUBIR ARCHIVOS A SUPABASE STORAGE
      // ===================================================

      if (
        uploadedFiles.length > 0
      ) {

        attachments =
          await uploadPrivateAttachments(
            uploadedFiles,
            cleanCurrentUserId,
            conversationId
          );

        uploadedStoragePaths =
          attachments
            .map(
              (attachment) =>
                attachment.storagePath
            )
            .filter(Boolean);

        // =================================================
        // GUARDAR REFERENCIAS DE LOS ARCHIVOS
        // =================================================

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
                size,
                storage_path
              )

              VALUES
              (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6
              )
            `,
            [
              message.id,

              null,

              attachment.name,

              attachment.type,

              attachment.size,

              attachment.storagePath,
            ]
          );

        }

      }

      // ===================================================
      // GENERAR URLS PRIVADAS TEMPORALES
      // ===================================================

      const responseAttachments =
        await Promise.all(
          (attachments || []).map(
            async (
              attachment
            ) => {

              const signedUrl =
                await createPrivateAttachmentSignedUrl(
                  attachment.storagePath
                );

              return {

                name:
                  attachment.name,

                type:
                  attachment.type,

                size:
                  attachment.size,

                url:
                  signedUrl,

              };

            }
          )
        );

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
      // CONFIRMAR TRANSACCIÓN
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
            message.text ||
            "",

          createdAt:
            message.created_at,

          read:
            message.read_at !== null,

          readAt:
            message.read_at,

          // ===============================================
          // MULTIMEDIA
          // ===============================================

          attachments:
            responseAttachments,

          // ===============================================
          // AUTOR
          // ===============================================

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

          // ===============================================
          // RECEPTOR
          // ===============================================

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

    } catch (
      error
    ) {

      // ===================================================
      // ROLLBACK
      // ===================================================

      try {

        await client.query(
          "ROLLBACK"
        );

      } catch (
        rollbackError
      ) {

        console.error(
          "CHAT PRIVATE ROLLBACK ERROR:",
          rollbackError
        );

      }

      // ===================================================
      // ELIMINAR ARCHIVOS DE SUPABASE SI FALLÓ EL PROCESO
      // ===================================================

      if (
        uploadedStoragePaths.length > 0
      ) {

        try {

          await supabase.storage
            .from(
              PRIVATE_CHAT_BUCKET
            )
            .remove(
              uploadedStoragePaths
            );

        } catch (
          cleanupError
        ) {

          console.error(
            "MACHINE PRIVATE STORAGE CLEANUP ERROR:",
            cleanupError
          );

        }

      }

      console.error(
        "CHAT PRIVATE MESSAGE ERROR:",
        error
      );

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
//
// Los archivos almacenados en Supabase Storage son privados.
// Por eso cada storage_path recibe una Signed URL temporal.
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
        status:
          "ERROR",

        message:
          "Los usuarios de la conversación son obligatorios.",
      });

    }

    if (
      cleanCurrentUserId ===
      cleanOtherUserId
    ) {

      return res.status(400).json({
        status:
          "ERROR",

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
                    a.size,

                    'storagePath',
                    a.storage_path

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
              ON receiver_member.conversation_id =
                 m.conversation_id

              AND receiver_member.user_id <>
                  m.author_user_id


            INNER JOIN public.users receiver_u
              ON receiver_u.id =
                 receiver_member.user_id


            LEFT JOIN public.user_profiles receiver_p
              ON receiver_p.user_id =
                 receiver_u.id


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
      //
      // Cargar adjuntos de forma controlada.
      // Un error temporal de Supabase Storage no debe
      // impedir la carga del historial completo.
      // ===================================================

      const messages = [];

      for (const message of messagesResult.rows) {
        const rawAttachments = Array.isArray(
          message.attachments
        )
          ? message.attachments
          : [];

        const attachments = [];

        // -------------------------------------------------
        // GENERAR URLS FIRMADAS DE FORMA SECUENCIAL
        // Evita lanzar muchas solicitudes a Storage a la vez.
        // -------------------------------------------------

        for (const attachment of rawAttachments) {
          const storagePath =
            attachment?.storagePath || null;

          let signedUrl =
            attachment?.url || null;

          if (storagePath) {
            try {
              signedUrl =
                await createPrivateAttachmentSignedUrl(
                  storagePath
                );
            } catch (storageError) {
              // El mensaje se conserva aunque Storage falle.
              signedUrl = null;

              console.error(
                "MACHINE PRIVATE ATTACHMENT URL TEMPORARILY UNAVAILABLE:",
                {
                  messageId: message.id,
                  error:
                    storageError?.message ||
                    "Error desconocido de Supabase Storage",
                  status:
                    storageError?.status ||
                    storageError?.statusCode ||
                    null,
                  code:
                    storageError?.code ||
                    null,
                }
              );
            }
          }

          attachments.push({
            url: signedUrl,

            name:
              attachment?.name ||
              "Archivo",

            type:
              attachment?.type ||
              "application/octet-stream",

            size:
              attachment?.size ||
              0,
          });
        }

        // -------------------------------------------------
        // CONSTRUIR MENSAJE
        // -------------------------------------------------

        messages.push({
          id: message.id,

          conversationId:
            message.conversation_id,

          senderId:
            message.author_user_id,

          text:
            message.text || "",

          createdAt:
            message.created_at,

          // -----------------------------------------------
          // LECTURA
          // -----------------------------------------------

          read:
            message.read_at !== null,

          readAt:
            message.read_at,

          // -----------------------------------------------
          // ADJUNTOS MULTIMEDIA
          // -----------------------------------------------

          attachments,

          // -----------------------------------------------
          // COMPATIBILIDAD CON MENSAJES ANTIGUOS
          // -----------------------------------------------

          attachmentUrl:
            attachments[0]?.url || null,

          attachmentName:
            attachments[0]?.name || null,

          attachmentType:
            attachments[0]?.type || null,

          attachmentSize:
            attachments[0]?.size || null,

          // -----------------------------------------------
          // EMISOR
          // -----------------------------------------------

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

          // -----------------------------------------------
          // DESTINATARIO
          // -----------------------------------------------

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
        });
      }



      // ===================================================
      // RESPUESTA
      // ===================================================

      return res.status(200).json({

        status:
          "OK",

        conversationId,

        messages,

      });

    } catch (
      error
    ) {

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
