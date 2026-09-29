import express from "express";
import nodemailer from "nodemailer";

import pool from "../config/database.js";

const router = express.Router();

// =========================================================
// CONFIGURACIÓN DE CORREO
// =========================================================

const mailTransporter =
  nodemailer.createTransport({
    service: "gmail",

    auth: {
      user:
        process.env.MACHINE_SUPPORT_EMAIL,

      pass:
        process.env.MACHINE_SUPPORT_APP_PASSWORD,
    },
  });

const SUPPORT_EMAIL =
  process.env.MACHINE_SUPPORT_EMAIL ||
  "machineofficialsupport@gmail.com";

// =========================================================
// UTILIDADES
// =========================================================

const normalizeText = (value) => {

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
};

// =========================================================
// ESCAPE HTML
// Evita que datos enviados por usuarios se interpreten
// como HTML dentro del correo.
// =========================================================

const escapeHtml = (value) => {

  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

// =========================================================
// VALIDACIÓN DE EMAIL
// =========================================================

const isValidEmail = (email) => {

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    email
  );
};

// =========================================================
// GET /api/public/comments
// SOLO COMENTARIOS APROBADOS
// =========================================================

router.get(
  "/comments",
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT
            id,
            name,
            message,
            created_at
          FROM public.site_comments
          WHERE status = 'approved'
          ORDER BY created_at DESC
          LIMIT 50
          `
        );

      return res.status(200).json({
        success: true,
        data: result.rows,
      });

    } catch (error) {

      console.error(
        "PUBLIC COMMENTS GET ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "No fue posible cargar los comentarios.",
      });

    }
  }
);

// =========================================================
// POST /api/public/comments
// NUEVO COMENTARIO
// =========================================================

router.post(
  "/comments",
  async (req, res) => {

    try {

      const name =
        normalizeText(
          req.body?.name
        );

      const email =
        normalizeText(
          req.body?.email
        ).toLowerCase();

      const message =
        normalizeText(
          req.body?.message
        );

      // ===================================================
      // VALIDACIONES
      // ===================================================

      if (!name) {

        return res.status(400).json({
          success: false,
          message:
            "El nombre es obligatorio.",
        });

      }

      if (name.length > 120) {

        return res.status(400).json({
          success: false,
          message:
            "El nombre no puede superar 120 caracteres.",
        });

      }

      if (!email) {

        return res.status(400).json({
          success: false,
          message:
            "El correo electrónico es obligatorio.",
        });

      }

      if (
        email.length > 254 ||
        !isValidEmail(email)
      ) {

        return res.status(400).json({
          success: false,
          message:
            "Introduce un correo electrónico válido.",
        });

      }

      if (!message) {

        return res.status(400).json({
          success: false,
          message:
            "El comentario es obligatorio.",
        });

      }

      if (message.length < 5) {

        return res.status(400).json({
          success: false,
          message:
            "El comentario es demasiado corto.",
        });

      }

      if (message.length > 2000) {

        return res.status(400).json({
          success: false,
          message:
            "El comentario no puede superar 2000 caracteres.",
        });

      }

      // ===================================================
      // GUARDAR COMO PENDIENTE
      // ===================================================

      const result =
        await pool.query(
          `
          INSERT INTO public.site_comments (
            name,
            email,
            message,
            status
          )
          VALUES (
            $1,
            $2,
            $3,
            'pending'
          )
          RETURNING
            id,
            name,
            message,
            status,
            created_at
          `,
          [
            name,
            email,
            message,
          ]
        );

      return res.status(201).json({
        success: true,
        message:
          "Tu comentario fue recibido y quedará pendiente de moderación.",
        data:
          result.rows[0],
      });

    } catch (error) {

      console.error(
        "PUBLIC COMMENTS POST ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "No fue posible enviar el comentario.",
      });

    }
  }
);

// =========================================================
// POST /api/public/support
// NUEVA SOLICITUD DE SOPORTE
// =========================================================

router.post(
  "/support",
  async (req, res) => {

    try {

      const name =
        normalizeText(
          req.body?.name
        );

      const email =
        normalizeText(
          req.body?.email
        ).toLowerCase();

      const subject =
        normalizeText(
          req.body?.subject
        );

      const message =
        normalizeText(
          req.body?.message
        );

      // ===================================================
      // VALIDACIONES
      // ===================================================

      if (!name) {

        return res.status(400).json({
          success: false,
          message:
            "El nombre es obligatorio.",
        });

      }

      if (name.length > 120) {

        return res.status(400).json({
          success: false,
          message:
            "El nombre no puede superar 120 caracteres.",
        });

      }

      if (!email) {

        return res.status(400).json({
          success: false,
          message:
            "El correo electrónico es obligatorio.",
        });

      }

      if (
        email.length > 254 ||
        !isValidEmail(email)
      ) {

        return res.status(400).json({
          success: false,
          message:
            "Introduce un correo electrónico válido.",
        });

      }

      if (!subject) {

        return res.status(400).json({
          success: false,
          message:
            "El asunto es obligatorio.",
        });

      }

      if (subject.length > 180) {

        return res.status(400).json({
          success: false,
          message:
            "El asunto no puede superar 180 caracteres.",
        });

      }

      if (!message) {

        return res.status(400).json({
          success: false,
          message:
            "El mensaje es obligatorio.",
        });

      }

      if (message.length < 5) {

        return res.status(400).json({
          success: false,
          message:
            "El mensaje es demasiado corto.",
        });

      }

      if (message.length > 5000) {

        return res.status(400).json({
          success: false,
          message:
            "El mensaje no puede superar 5000 caracteres.",
        });

      }

      // ===================================================
      // GUARDAR SOLICITUD EN POSTGRESQL
      // ===================================================

      const result =
        await pool.query(
          `
          INSERT INTO public.site_support_requests (
            name,
            email,
            subject,
            message,
            status
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            'open'
          )
          RETURNING
            id,
            name,
            email,
            subject,
            message,
            status,
            created_at
          `,
          [
            name,
            email,
            subject,
            message,
          ]
        );

      const supportRequest =
        result.rows[0];

      // ===================================================
      // PREPARAR DATOS SEGUROS PARA HTML
      // ===================================================

      const safeName =
        escapeHtml(name);

      const safeEmail =
        escapeHtml(email);

      const safeSubject =
        escapeHtml(subject);

      const safeMessage =
        escapeHtml(message)
          .replace(/\r?\n/g, "<br>");

      const safeId =
        escapeHtml(
          supportRequest.id
        );

      const safeCreatedAt =
        escapeHtml(
          supportRequest.created_at
        );

      const safeStatus =
        escapeHtml(
          supportRequest.status
        );

      // ===================================================
      // ENVIAR CORREO
      // ===================================================

      try {

        await mailTransporter.sendMail({

          // =================================================
          // REMITENTE
          // =================================================

          from:
            `"MACHINE Support" <${SUPPORT_EMAIL}>`,

          // =================================================
          // DESTINO
          // =================================================

          to:
            SUPPORT_EMAIL,

          // =================================================
          // RESPONDER DIRECTAMENTE AL USUARIO
          //
          // Cuando abras Gmail y pulses "Responder",
          // Gmail utilizará este correo.
          // =================================================

          replyTo:
            email,

          // =================================================
          // ASUNTO
          // =================================================

          subject:
            `[MACHINE SUPPORT] ${subject}`,

          // =================================================
          // VERSIÓN TEXTO
          // =================================================

          text:
`MACHINE SUPPORT
Nueva solicitud de soporte

Nombre:
${name}

Correo:
${email}

Asunto:
${subject}

Mensaje:
${message}

----------------------------------------
ID DE solicitud: ${supportRequest.id}
Fecha: ${supportRequest.created_at}
Estado: ${supportRequest.status}
----------------------------------------

Para responder al usuario, utiliza el botón "Responder" de Gmail.
`,

          // =================================================
          // VERSIÓN HTML PROFESIONAL
          // =================================================

          html:
`
<!DOCTYPE html>

<html lang="es">

<head>

  <meta charset="UTF-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >

  <title>
    MACHINE Support
  </title>

</head>

<body
  style="
    margin:0;
    padding:0;
    background:#070b10;
    font-family:
      Arial,
      Helvetica,
      sans-serif;
    color:#e8eef5;
  "
>

  <table
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    style="
      background:#070b10;
      padding:32px 16px;
    "
  >

    <tr>

      <td align="center">

        <table
          width="680"
          cellpadding="0"
          cellspacing="0"
          border="0"
          style="
            width:100%;
            max-width:680px;
            background:#111821;
            border:1px solid #263442;
            border-radius:16px;
            overflow:hidden;
          "
        >

          <!-- =========================================
               HEADER
               ========================================= -->

          <tr>

            <td
              style="
                padding:28px 30px;
                background:
                  linear-gradient(
                    135deg,
                    #151f2a,
                    #0d141c
                  );
                border-bottom:
                  1px solid #263442;
              "
            >

              <div
                style="
                  font-size:12px;
                  letter-spacing:4px;
                  font-weight:bold;
                  color:#7dd3fc;
                  margin-bottom:10px;
                "
              >
                MACHINE
              </div>

              <div
                style="
                  font-size:25px;
                  line-height:1.25;
                  font-weight:700;
                  color:#ffffff;
                "
              >
                Nueva solicitud de soporte
              </div>

              <div
                style="
                  margin-top:8px;
                  font-size:13px;
                  color:#8ea2b5;
                "
              >
                Centro oficial de atención MACHINE
              </div>

            </td>

          </tr>

          <!-- =========================================
               CONTENIDO
               ========================================= -->

          <tr>

            <td
              style="
                padding:30px;
              "
            >

              <div
                style="
                  display:inline-block;
                  padding:7px 12px;
                  background:#102b22;
                  border:1px solid #1f6b4e;
                  border-radius:999px;
                  color:#65e6ad;
                  font-size:11px;
                  font-weight:bold;
                  letter-spacing:1px;
                  text-transform:uppercase;
                "
              >
                Solicitud recibida
              </div>

              <h2
                style="
                  margin:20px 0 8px;
                  font-size:20px;
                  color:#ffffff;
                "
              >
                Atención requerida
              </h2>

              <p
                style="
                  margin:0;
                  color:#9eb0c0;
                  font-size:14px;
                  line-height:1.7;
                "
              >
                Se recibió una nueva solicitud desde
                <strong style="color:#dce8f2;">
                  MACHINE-WEB
                </strong>.
              </p>

              <!-- =====================================
                   DATOS DEL USUARIO
                   ===================================== -->

              <table
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border="0"
                style="
                  margin-top:24px;
                  border:1px solid #263442;
                  border-radius:12px;
                  overflow:hidden;
                "
              >

                <tr>

                  <td
                    style="
                      padding:14px 16px;
                      background:#151f2a;
                      color:#7dd3fc;
                      font-size:12px;
                      font-weight:bold;
                      letter-spacing:1px;
                    "
                    colspan="2"
                  >
                    DATOS DEL SOLICITANTE
                  </td>

                </tr>

                <tr>

                  <td
                    width="130"
                    style="
                      padding:14px 16px;
                      color:#71869a;
                      font-size:13px;
                      border-top:1px solid #263442;
                    "
                  >
                    Nombre
                  </td>

                  <td
                    style="
                      padding:14px 16px;
                      color:#f2f7fb;
                      font-size:14px;
                      border-top:1px solid #263442;
                      font-weight:600;
                    "
                  >
                    ${safeName}
                  </td>

                </tr>

                <tr>

                  <td
                    style="
                      padding:14px 16px;
                      color:#71869a;
                      font-size:13px;
                      border-top:1px solid #263442;
                    "
                  >
                    Correo
                  </td>

                  <td
                    style="
                      padding:14px 16px;
                      font-size:14px;
                      border-top:1px solid #263442;
                    "
                  >

                    <a
                      href="mailto:${safeEmail}"
                      style="
                        color:#7dd3fc;
                        text-decoration:none;
                      "
                    >
                      ${safeEmail}
                    </a>

                  </td>

                </tr>

                <tr>

                  <td
                    style="
                      padding:14px 16px;
                      color:#71869a;
                      font-size:13px;
                      border-top:1px solid #263442;
                    "
                  >
                    Asunto
                  </td>

                  <td
                    style="
                      padding:14px 16px;
                      color:#f2f7fb;
                      font-size:14px;
                      border-top:1px solid #263442;
                      font-weight:600;
                    "
                  >
                    ${safeSubject}
                  </td>

                </tr>

              </table>

              <!-- =====================================
                   MENSAJE
                   ===================================== -->

              <div
                style="
                  margin-top:24px;
                  padding:20px;
                  background:#0b1118;
                  border:1px solid #263442;
                  border-radius:12px;
                "
              >

                <div
                  style="
                    margin-bottom:12px;
                    color:#7dd3fc;
                    font-size:11px;
                    font-weight:bold;
                    letter-spacing:2px;
                  "
                >
                  MENSAJE DEL USUARIO
                </div>

                <div
                  style="
                    color:#e8eef5;
                    font-size:14px;
                    line-height:1.8;
                  "
                >
                  ${safeMessage}
                </div>

              </div>

              <!-- =====================================
                   INFORMACIÓN INTERNA
                   ===================================== -->

              <table
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border="0"
                style="
                  margin-top:24px;
                "
              >

                <tr>

                  <td
                    style="
                      padding:12px 0;
                      border-top:1px solid #263442;
                      color:#71869a;
                      font-size:12px;
                    "
                  >
                    ID de solicitud
                  </td>

                  <td
                    align="right"
                    style="
                      padding:12px 0;
                      border-top:1px solid #263442;
                      color:#dce8f2;
                      font-size:12px;
                      font-weight:bold;
                    "
                  >
                    #${safeId}
                  </td>

                </tr>

                <tr>

                  <td
                    style="
                      padding:12px 0;
                      border-top:1px solid #263442;
                      color:#71869a;
                      font-size:12px;
                    "
                  >
                    Fecha de recepción
                  </td>

                  <td
                    align="right"
                    style="
                      padding:12px 0;
                      border-top:1px solid #263442;
                      color:#dce8f2;
                      font-size:12px;
                    "
                  >
                    ${safeCreatedAt}
                  </td>

                </tr>

                <tr>

                  <td
                    style="
                      padding:12px 0;
                      border-top:1px solid #263442;
                      color:#71869a;
                      font-size:12px;
                    "
                  >
                    Estado
                  </td>

                  <td
                    align="right"
                    style="
                      padding:12px 0;
                      border-top:1px solid #263442;
                      color:#65e6ad;
                      font-size:12px;
                      font-weight:bold;
                      text-transform:uppercase;
                    "
                  >
                    ${safeStatus}
                  </td>

                </tr>

              </table>

              <!-- =====================================
                   RESPUESTA
                   ===================================== -->

              <div
                style="
                  margin-top:26px;
                  padding:18px;
                  background:#101923;
                  border:1px solid #263442;
                  border-radius:12px;
                "
              >

                <div
                  style="
                    color:#ffffff;
                    font-size:13px;
                    font-weight:bold;
                    margin-bottom:6px;
                  "
                >
                  Responder al usuario
                </div>

                <div
                  style="
                    color:#8ea2b5;
                    font-size:12px;
                    line-height:1.6;
                  "
                >
                  Esta solicitud está configurada para que al pulsar
                  <strong style="color:#dce8f2;">
                    Responder
                  </strong>
                  en Gmail, la respuesta sea enviada directamente a:
                </div>

                <div
                  style="
                    margin-top:8px;
                    color:#7dd3fc;
                    font-size:13px;
                    font-weight:bold;
                  "
                >
                  ${safeEmail}
                </div>

              </div>

            </td>

          </tr>

          <!-- =========================================
               FOOTER
               ========================================= -->

          <tr>

            <td
              style="
                padding:20px 30px;
                background:#0d141c;
                border-top:1px solid #263442;
              "
            >

              <div
                style="
                  color:#71869a;
                  font-size:11px;
                  line-height:1.7;
                "
              >
                MACHINE Support · Centro oficial de atención
                <br>
                Este mensaje fue generado automáticamente por MACHINE-WEB.
              </div>

            </td>

          </tr>

        </table>

      </td>

    </tr>

  </table>

</body>

</html>
`,

        });

        console.log(
          "PUBLIC SUPPORT EMAIL SENT:",
          {
            requestId:
              supportRequest.id,

            to:
              SUPPORT_EMAIL,

            from:
              email,
          }
        );

      } catch (mailError) {

        console.error(
          "PUBLIC SUPPORT EMAIL ERROR:",
          mailError
        );

        return res.status(201).json({

          success: true,

          message:
            "Tu solicitud fue recibida y guardada correctamente, pero el aviso por correo no pudo enviarse en este momento.",

          emailSent:
            false,

          data:
            supportRequest,

        });

      }

      // ===================================================
      // RESPUESTA FINAL
      // ===================================================

      return res.status(201).json({

        success: true,

        message:
          "Tu solicitud fue recibida correctamente.",

        emailSent:
          true,

        data:
          supportRequest,

      });

    } catch (error) {

      console.error(
        "PUBLIC SUPPORT POST ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "No fue posible enviar la solicitud.",
      });

    }
  }
);

export default router;

