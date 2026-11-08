
import express from "express";
import multer from "multer";
import path from "path";
import crypto from "crypto";

import pool from "../config/database.js";
import supabase from "../config/supabase.js";
import { emitGlobalChannelEvent } from "../socket/chat.socket.js";

const router = express.Router();

const GLOBAL_BUCKET = "machine-topic-attachments";
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_FILES = 20;
const SIGNED_URL_SECONDS = 3600;

const allowedExtensions = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif",
  ".bmp", ".tif", ".tiff", ".ico", ".heic", ".heif",
  ".svg", ".mp4", ".m4v", ".webm", ".mov", ".avi",
  ".mkv", ".3gp", ".3g2", ".mpeg", ".mpg", ".wmv",
  ".flv", ".mp3", ".wav", ".ogg", ".oga", ".opus",
  ".m4a", ".aac", ".flac", ".wma", ".aiff", ".aif",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt",
  ".pptx", ".txt", ".csv", ".rtf", ".zip", ".rar",
  ".7z", ".tar", ".gz", ".bz2",
]);

const allowedMimeCategories = new Set([
  "image",
  "video",
  "audio",
]);

const fileFilter = (req, file, callback) => {
  const mimeType = String(file.mimetype || "").trim().toLowerCase();
  const extension = path.extname(
    String(file.originalname || "").toLowerCase()
  );

  const category = mimeType.includes("/")
    ? mimeType.split("/")[0]
    : "";

  const extensionAllowed = allowedExtensions.has(extension);

  if (allowedMimeCategories.has(category)) {
    return callback(null, true);
  }

  if (
    extensionAllowed &&
    (category === "application" || category === "text")
  ) {
    return callback(null, true);
  }

  if (!mimeType && extensionAllowed) {
    return callback(null, true);
  }

  if (
    mimeType === "application/octet-stream" &&
    extensionAllowed
  ) {
    return callback(null, true);
  }

  return callback(
    new Error(`Tipo de archivo no permitido: ${mimeType || "desconocido"}`)
  );
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
  },
});

function uploadGlobalFiles(req, res, next) {
  upload.array("files", MAX_FILES)(req, res, (error) => {
    if (!error) return next();

    console.error("GLOBAL CHANNEL FILE UPLOAD:", error);

    if (error instanceof multer.MulterError) {
      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? "Cada archivo no puede superar los 50 MB."
          : error.code === "LIMIT_FILE_COUNT"
            ? "No se permiten más de 20 archivos."
            : "No fue posible procesar los archivos adjuntos.";

      return res.status(400).json({
        status: "ERROR",
        message,
      });
    }

    return res.status(400).json({
      status: "ERROR",
      message: error.message || "Archivo no permitido.",
    });
  });
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function cleanFileName(name) {
  return String(name || "archivo")
    .replace(/^.*[\\/]/, "")
    .replace(/[^\p{L}\p{N}._() -]/gu, "_")
    .slice(0, 255);
}

function getAuthenticatedObjectUrl(bucket, storagePath) {
  const supabaseUrl = String(
    process.env.SUPABASE_URL || ""
  ).replace(/\/+$/, "");

  if (!supabaseUrl) {
    throw new Error("Falta configurar SUPABASE_URL.");
  }

  const encodedPath = storagePath
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  return (
    `${supabaseUrl}/storage/v1/object/authenticated/` +
    `${bucket}/${encodedPath}`
  );
}

async function getSignedUrl(bucket, storagePath) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, SIGNED_URL_SECONDS);

  if (error) {
    console.error("GLOBAL CHANNEL SIGNED URL:", error);
    throw new Error("No fue posible generar el enlace del archivo.");
  }

  return data.signedUrl;
}

async function removeUploadedFiles(paths) {
  if (!paths.length) return;

  const { error } = await supabase.storage
    .from(GLOBAL_BUCKET)
    .remove(paths);

  if (error) {
    console.error("GLOBAL CHANNEL STORAGE CLEANUP:", error);
  }
}

async function ensureActiveUser(userId) {
  const result = await pool.query(
    `
      SELECT id
      FROM public.users
      WHERE id = $1
        AND status = 'active'
      LIMIT 1
    `,
    [userId]
  );

  return result.rows.length > 0;
}

async function ensureMessageExists(messageId) {
  const result = await pool.query(
    `
      SELECT id
      FROM public.chat_global_messages
      WHERE id = $1
      LIMIT 1
    `,
    [messageId]
  );

  return result.rows.length > 0;
}

async function attachPublicationFiles(client, messageId, userId, files, uploadedPaths) {
  const attachments = [];

  for (const file of files) {
    if (!file.buffer || file.size <= 0) {
      throw new Error("Se recibió un archivo vacío o no válido.");
    }

    const fileName = cleanFileName(file.originalname);
    const extension = path.extname(fileName).toLowerCase();

    const uniqueName =
      `${Date.now()}-${crypto.randomUUID()}${extension}`;

    const storagePath =
      `global-channel/messages/${messageId}/${userId}/${uniqueName}`;

    const { data, error } = await supabase.storage
      .from(GLOBAL_BUCKET)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype || "application/octet-stream",
        upsert: false,
      });

    if (error) {
      console.error("GLOBAL CHANNEL STORAGE UPLOAD:", error);
      throw new Error("No fue posible guardar un archivo en Supabase.");
    }

    const uploadedPath = data?.path || storagePath;
    uploadedPaths.push(uploadedPath);

    const authenticatedUrl = getAuthenticatedObjectUrl(
      GLOBAL_BUCKET,
      uploadedPath
    );

    const result = await client.query(
      `
        INSERT INTO public.chat_attachments (
          uploaded_by_user_id,
          file_name,
          mime_type,
          file_size,
          storage_bucket,
          storage_path,
          public_url,
          global_message_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, file_name, mime_type, file_size,
                  storage_bucket, storage_path
      `,
      [
        userId,
        fileName,
        file.mimetype || "application/octet-stream",
        file.size,
        GLOBAL_BUCKET,
        uploadedPath,
        authenticatedUrl,
        messageId,
      ]
    );

    const attachment = result.rows[0];

    attachments.push({
      id: attachment.id,
      name: attachment.file_name,
      type: attachment.mime_type,
      size: Number(attachment.file_size),
      url: await getSignedUrl(
        attachment.storage_bucket,
        attachment.storage_path
      ),
    });
  }

  return attachments;
}

async function attachReplyFiles(client, replyId, userId, files, uploadedPaths) {
  const attachments = [];

  for (const file of files) {
    if (!file.buffer || file.size <= 0) {
      throw new Error("Se recibió un archivo vacío o no válido.");
    }

    const fileName = cleanFileName(file.originalname);
    const extension = path.extname(fileName).toLowerCase();

    const uniqueName =
      `${Date.now()}-${crypto.randomUUID()}${extension}`;

    const storagePath =
      `global-channel/replies/${replyId}/${userId}/${uniqueName}`;

    const { data, error } = await supabase.storage
      .from(GLOBAL_BUCKET)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype || "application/octet-stream",
        upsert: false,
      });

    if (error) {
      console.error("GLOBAL CHANNEL REPLY STORAGE:", error);
      throw new Error("No fue posible guardar un archivo de la respuesta.");
    }

    const uploadedPath = data?.path || storagePath;
    uploadedPaths.push(uploadedPath);

    const result = await client.query(
      `
        INSERT INTO public.chat_global_reply_attachments (
          reply_id,
          uploaded_by_user_id,
          file_name,
          mime_type,
          file_size,
          storage_bucket,
          storage_path
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, file_name, mime_type, file_size,
                  storage_bucket, storage_path
      `,
      [
        replyId,
        userId,
        fileName,
        file.mimetype || "application/octet-stream",
        file.size,
        GLOBAL_BUCKET,
        uploadedPath,
      ]
    );

    const attachment = result.rows[0];

    attachments.push({
      id: attachment.id,
      name: attachment.file_name,
      type: attachment.mime_type,
      size: Number(attachment.file_size),
      url: await getSignedUrl(
        attachment.storage_bucket,
        attachment.storage_path
      ),
    });
  }

  return attachments;
}

async function getPublicationAttachments(messageIds) {
  if (!messageIds.length) return new Map();

  const result = await pool.query(
    `
      SELECT
        id,
        global_message_id,
        file_name,
        mime_type,
        file_size,
        storage_bucket,
        storage_path
      FROM public.chat_attachments
      WHERE global_message_id = ANY($1::uuid[])
      ORDER BY created_at ASC
    `,
    [messageIds]
  );

  const grouped = new Map();

  for (const row of result.rows) {
    const url = await getSignedUrl(
      row.storage_bucket,
      row.storage_path
    );

    const item = {
      id: row.id,
      name: row.file_name,
      type: row.mime_type,
      size: Number(row.file_size),
      url,
    };

    if (!grouped.has(row.global_message_id)) {
      grouped.set(row.global_message_id, []);
    }

    grouped.get(row.global_message_id).push(item);
  }

  return grouped;
}

async function getReplyAttachments(replyIds) {
  if (!replyIds.length) return new Map();

  const result = await pool.query(
    `
      SELECT
        id,
        reply_id,
        file_name,
        mime_type,
        file_size,
        storage_bucket,
        storage_path
      FROM public.chat_global_reply_attachments
      WHERE reply_id = ANY($1::uuid[])
      ORDER BY created_at ASC
    `,
    [replyIds]
  );

  const grouped = new Map();

  for (const row of result.rows) {
    const url = await getSignedUrl(
      row.storage_bucket,
      row.storage_path
    );

    const item = {
      id: row.id,
      name: row.file_name,
      type: row.mime_type,
      size: Number(row.file_size),
      url,
    };

    if (!grouped.has(row.reply_id)) {
      grouped.set(row.reply_id, []);
    }

    grouped.get(row.reply_id).push(item);
  }

  return grouped;
}

// =========================================================
// PUBLICACIONES
// =========================================================

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          m.id,
          m.author_user_id,
          m.text,
          m.created_at,
          u.employee_id,
          p.first_name,
          p.last_name,
          p.photo_url,
          p.job_title
        FROM public.chat_global_messages m
        LEFT JOIN public.users u
          ON u.id = m.author_user_id
        LEFT JOIN public.user_profiles p
          ON p.user_id = u.id
        ORDER BY m.created_at DESC
        LIMIT 100
      `
    );

    const attachments = await getPublicationAttachments(
      result.rows.map((row) => row.id)
    );

    const messages = result.rows.map((row) => ({
      ...row,
      author: {
        id: row.author_user_id,
        employeeId: row.employee_id,
        firstName: row.first_name,
        lastName: row.last_name,
        photoUrl: row.photo_url,
        jobTitle: row.job_title,
      },
      attachments: attachments.get(row.id) || [],
    }));

    return res.status(200).json({
      status: "OK",
      total: messages.length,
      messages,
    });
  } catch (error) {
    console.error("GLOBAL CHANNEL - GET MESSAGES:", error);

    return res.status(500).json({
      status: "ERROR",
      message: "No se pudieron cargar las publicaciones.",
    });
  }
});

router.post("/", uploadGlobalFiles, async (req, res) => {
  const userId = req.user?.id;
  const text = String(req.body?.text ?? "").trim();
  const files = req.files || [];
  const uploadedPaths = [];

  if (!userId) {
    return res.status(401).json({
      status: "ERROR",
      message: "Usuario no autenticado.",
    });
  }

  if (!text && files.length === 0) {
    return res.status(400).json({
      status: "ERROR",
      message: "Escribí una publicación o adjuntá un archivo.",
    });
  }

  if (text.length > 10000) {
    return res.status(400).json({
      status: "ERROR",
      message: "La publicación supera los 10.000 caracteres.",
    });
  }

  let client;
  let transactionStarted = false;

  try {
    if (!(await ensureActiveUser(userId))) {
      return res.status(403).json({
        status: "ERROR",
        message: "El usuario no está activo.",
      });
    }

    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;

    const result = await client.query(
      `
        INSERT INTO public.chat_global_messages (
          author_user_id,
          text
        )
        VALUES ($1, $2)
        RETURNING id, author_user_id, text, created_at
      `,
      [userId, text || null]
    );

    const publication = result.rows[0];

    const attachments = await attachPublicationFiles(
      client,
      publication.id,
      userId,
      files,
      uploadedPaths
    );

    await client.query("COMMIT");
    transactionStarted = false;

    const responsePublication = {
      ...publication,
      attachments,
    };

    emitGlobalChannelEvent("global-channel:message-created", {
      publication: responsePublication,
    });

    return res.status(201).json({
      status: "OK",
      message: "Publicación creada correctamente.",
      publication: responsePublication,
    });
  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK").catch(() => {});
    }

    await removeUploadedFiles(uploadedPaths);

    console.error("GLOBAL CHANNEL - CREATE MESSAGE:", error);

    return res.status(500).json({
      status: "ERROR",
      message: error.message || "No se pudo crear la publicación.",
    });
  } finally {
    client?.release();
  }
});

// =========================================================
// RESPUESTAS
// =========================================================

router.get("/:messageId/replies", async (req, res) => {
  const { messageId } = req.params;

  if (!isUuid(messageId)) {
    return res.status(400).json({
      status: "ERROR",
      message: "Identificador de publicación no válido.",
    });
  }

  try {
    if (!(await ensureMessageExists(messageId))) {
      return res.status(404).json({
        status: "ERROR",
        message: "La publicación no existe.",
      });
    }

    const result = await pool.query(
      `
        SELECT
          r.id,
          r.global_message_id,
          r.author_user_id,
          r.text,
          r.created_at,
          u.employee_id,
          p.first_name,
          p.last_name,
          p.photo_url,
          p.job_title
        FROM public.chat_global_replies r
        LEFT JOIN public.users u
          ON u.id = r.author_user_id
        LEFT JOIN public.user_profiles p
          ON p.user_id = u.id
        WHERE r.global_message_id = $1
        ORDER BY r.created_at ASC
      `,
      [messageId]
    );

    const attachments = await getReplyAttachments(
      result.rows.map((row) => row.id)
    );

    const replies = result.rows.map((row) => ({
      ...row,
      author: {
        id: row.author_user_id,
        employeeId: row.employee_id,
        firstName: row.first_name,
        lastName: row.last_name,
        photoUrl: row.photo_url,
        jobTitle: row.job_title,
      },
      attachments: attachments.get(row.id) || [],
    }));

    return res.status(200).json({
      status: "OK",
      total: replies.length,
      replies,
    });
  } catch (error) {
    console.error("GLOBAL CHANNEL - GET REPLIES:", error);

    return res.status(500).json({
      status: "ERROR",
      message: "No se pudieron cargar las respuestas.",
    });
  }
});

router.post(
  "/:messageId/replies",
  uploadGlobalFiles,
  async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user?.id;
    const text = String(req.body?.text ?? "").trim();
    const files = req.files || [];
    const uploadedPaths = [];

    if (!isUuid(messageId)) {
      return res.status(400).json({
        status: "ERROR",
        message: "Identificador de publicación no válido.",
      });
    }

    if (!userId) {
      return res.status(401).json({
        status: "ERROR",
        message: "Usuario no autenticado.",
      });
    }

    if (!text && files.length === 0) {
      return res.status(400).json({
        status: "ERROR",
        message: "Escribí una respuesta o adjuntá un archivo.",
      });
    }

    if (text.length > 10000) {
      return res.status(400).json({
        status: "ERROR",
        message: "La respuesta supera los 10.000 caracteres.",
      });
    }

    let client;
    let transactionStarted = false;

    try {
      if (!(await ensureActiveUser(userId))) {
        return res.status(403).json({
          status: "ERROR",
          message: "El usuario no está activo.",
        });
      }

      client = await pool.connect();
      await client.query("BEGIN");
      transactionStarted = true;

      const messageResult = await client.query(
        `
          SELECT id
          FROM public.chat_global_messages
          WHERE id = $1
          LIMIT 1
        `,
        [messageId]
      );

      if (!messageResult.rows.length) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          status: "ERROR",
          message: "La publicación no existe.",
        });
      }

      const result = await client.query(
        `
          INSERT INTO public.chat_global_replies (
            global_message_id,
            author_user_id,
            text
          )
          VALUES ($1, $2, $3)
          RETURNING id, global_message_id, author_user_id,
                    text, created_at
        `,
        [messageId, userId, text || null]
      );

      const reply = result.rows[0];

      const attachments = await attachReplyFiles(
        client,
        reply.id,
        userId,
        files,
        uploadedPaths
      );

      await client.query("COMMIT");
      transactionStarted = false;

      const responseReply = {
        ...reply,
        attachments,
      };

      emitGlobalChannelEvent("global-channel:reply-created", {
        messageId,
        reply: responseReply,
      });

      return res.status(201).json({
        status: "OK",
        message: "Respuesta publicada correctamente.",
        reply: responseReply,
      });
    } catch (error) {
      if (client && transactionStarted) {
        await client.query("ROLLBACK").catch(() => {});
      }

      await removeUploadedFiles(uploadedPaths);

      console.error("GLOBAL CHANNEL - CREATE REPLY:", error);

      return res.status(500).json({
        status: "ERROR",
        message: error.message || "No se pudo publicar la respuesta.",
      });
    } finally {
      client?.release();
    }
  }
);

// =========================================================
// REGISTRO DE VISITAS
// =========================================================

router.post("/:messageId/visits", async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user?.id;

  if (!isUuid(messageId)) {
    return res.status(400).json({
      status: "ERROR",
      message: "Identificador de publicación no válido.",
    });
  }

  if (!userId) {
    return res.status(401).json({
      status: "ERROR",
      message: "Usuario no autenticado.",
    });
  }

  try {
    if (!(await ensureActiveUser(userId))) {
      return res.status(403).json({
        status: "ERROR",
        message: "El usuario no está activo.",
      });
    }

    if (!(await ensureMessageExists(messageId))) {
      return res.status(404).json({
        status: "ERROR",
        message: "La publicación no existe.",
      });
    }

    const result = await pool.query(
      `
        INSERT INTO public.chat_global_visits (
          global_message_id,
          user_id,
          entered_at,
          last_activity_at
        )
        VALUES ($1, $2, NOW(), NOW())
        RETURNING
          id,
          global_message_id,
          user_id,
          entered_at,
          last_activity_at,
          exited_at,
          exit_reason
      `,
      [messageId, userId]
    );

    emitGlobalChannelEvent("global-channel:visits-updated", {
      messageId,
    });

    return res.status(201).json({
      status: "OK",
      message: "Visita registrada.",
      visit: result.rows[0],
    });
  } catch (error) {
    console.error("GLOBAL CHANNEL - REGISTER VISIT:", error);

    return res.status(500).json({
      status: "ERROR",
      message: "No se pudo registrar la visita.",
    });
  }
});

router.post(
  "/:messageId/visits/:visitId/activity",
  async (req, res) => {
    const { messageId, visitId } = req.params;
    const userId = req.user?.id;

    if (!isUuid(messageId) || !isUuid(visitId)) {
      return res.status(400).json({
        status: "ERROR",
        message: "Identificador de visita no válido.",
      });
    }

    try {
      const result = await pool.query(
        `
          UPDATE public.chat_global_visits
          SET last_activity_at = NOW()
          WHERE id = $1
            AND global_message_id = $2
            AND user_id = $3
            AND exited_at IS NULL
          RETURNING id, last_activity_at
        `,
        [visitId, messageId, userId]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          status: "ERROR",
          message: "No se encontró una visita activa.",
        });
      }

      return res.status(200).json({
        status: "OK",
        visit: result.rows[0],
      });
    } catch (error) {
      console.error("GLOBAL CHANNEL - VISIT ACTIVITY:", error);

      return res.status(500).json({
        status: "ERROR",
        message: "No se pudo actualizar la actividad.",
      });
    }
  }
);

router.patch(
  "/:messageId/visits/:visitId/exit",
  async (req, res) => {
    const { messageId, visitId } = req.params;
    const userId = req.user?.id;

    if (!isUuid(messageId) || !isUuid(visitId)) {
      return res.status(400).json({
        status: "ERROR",
        message: "Identificador de visita no válido.",
      });
    }

    try {
      const result = await pool.query(
        `
          UPDATE public.chat_global_visits
          SET
            exited_at = NOW(),
            last_activity_at = NOW(),
            exit_reason = 'USER'
          WHERE id = $1
            AND global_message_id = $2
            AND user_id = $3
            AND exited_at IS NULL
          RETURNING
            id,
            global_message_id,
            user_id,
            entered_at,
            last_activity_at,
            exited_at,
            exit_reason
        `,
        [visitId, messageId, userId]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          status: "ERROR",
          message: "La visita no existe o ya fue cerrada.",
        });
      }

      emitGlobalChannelEvent("global-channel:visits-updated", {
        messageId,
      });

      return res.status(200).json({
        status: "OK",
        message: "Visita cerrada correctamente.",
        visit: result.rows[0],
      });
    } catch (error) {
      console.error("GLOBAL CHANNEL - EXIT VISIT:", error);

      return res.status(500).json({
        status: "ERROR",
        message: "No se pudo cerrar la visita.",
      });
    }
  }
);

// =========================================================
// VISITANTES ÚNICOS E HISTORIAL DE SESIONES
// =========================================================

router.get("/:messageId/visitors", async (req, res) => {
  const { messageId } = req.params;

  if (!isUuid(messageId)) {
    return res.status(400).json({
      status: "ERROR",
      message: "Identificador de publicación no válido.",
    });
  }

  try {
    if (!(await ensureMessageExists(messageId))) {
      return res.status(404).json({
        status: "ERROR",
        message: "La publicación no existe.",
      });
    }

    const result = await pool.query(
      `
        SELECT
          v.id AS visit_id,
          v.user_id,
          v.entered_at,
          v.last_activity_at,
          v.exited_at,
          v.exit_reason,
          u.employee_id,
          p.first_name,
          p.last_name,
          p.photo_url,
          p.job_title
        FROM public.chat_global_visits v
        LEFT JOIN public.users u
          ON u.id = v.user_id
        LEFT JOIN public.user_profiles p
          ON p.user_id = u.id
        WHERE v.global_message_id = $1
        ORDER BY v.entered_at DESC
      `,
      [messageId]
    );

    const visitorsMap = new Map();

    for (const row of result.rows) {
      if (!visitorsMap.has(row.user_id)) {
        visitorsMap.set(row.user_id, {
          id: row.user_id,
          employeeId: row.employee_id,
          firstName: row.first_name,
          lastName: row.last_name,
          photoUrl: row.photo_url,
          jobTitle: row.job_title,
          totalVisits: 0,
          sessions: [],
        });
      }

      const visitor = visitorsMap.get(row.user_id);

      visitor.totalVisits += 1;

      visitor.sessions.push({
        id: row.visit_id,
        enteredAt: row.entered_at,
        lastActivityAt: row.last_activity_at,
        exitedAt: row.exited_at,
        exitReason: row.exit_reason,
        active: row.exited_at === null,
      });
    }

    const visitors = Array.from(visitorsMap.values());

    return res.status(200).json({
      status: "OK",
      totalUniqueVisitors: visitors.length,
      totalSessions: result.rows.length,
      visitors,
    });
  } catch (error) {
    console.error("GLOBAL CHANNEL - GET VISITORS:", error);

    return res.status(500).json({
      status: "ERROR",
      message: "No se pudo cargar el historial de visitantes.",
    });
  }
});

export default router;
