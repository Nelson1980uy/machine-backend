import "dotenv/config";
import nodemailer from "nodemailer";

const email =
  process.env.MACHINE_SUPPORT_EMAIL;

const appPassword =
  process.env.MACHINE_SUPPORT_APP_PASSWORD;

console.log("========================================");
console.log("MACHINE EMAIL TEST");
console.log("========================================");

console.log(
  "EMAIL:",
  email
    ? email
    : "NO CONFIGURADO"
);

console.log(
  "APP PASSWORD:",
  appPassword
    ? "CONFIGURADA"
    : "NO CONFIGURADA"
);

if (!email || !appPassword) {

  console.error(
    "ERROR: Faltan las variables de correo en .env"
  );

  process.exit(1);
}

const transporter =
  nodemailer.createTransport({

    service: "gmail",

    auth: {
      user:
        email,

      pass:
        appPassword,
    },

  });

try {

  console.log(
    "Verificando conexión con Gmail..."
  );

  await transporter.verify();

  console.log(
    "GMAIL AUTH OK"
  );

  console.log(
    "Enviando correo de prueba..."
  );

  const info =
    await transporter.sendMail({

      from:
        `"MACHINE Support" <${email}>`,

      to:
        email,

      subject:
        "MACHINE - Prueba de correo",

      text:
        `Este es un correo de prueba de MACHINE.

Si recibiste este mensaje, Nodemailer y Gmail están funcionando correctamente.

Fecha:
${new Date().toISOString()}
`,

      html:
`
<!DOCTYPE html>

<html lang="es">

<head>
  <meta charset="UTF-8">
  <title>MACHINE - Prueba de correo</title>
</head>

<body
  style="
    margin:0;
    padding:30px;
    background:#0b0f14;
    font-family:Arial,Helvetica,sans-serif;
    color:#e8eef5;
  "
>

  <div
    style="
      max-width:600px;
      margin:auto;
      padding:30px;
      background:#111821;
      border:1px solid #263442;
      border-radius:12px;
    "
  >

    <div
      style="
        color:#7dd3fc;
        font-size:13px;
        letter-spacing:3px;
        font-weight:bold;
      "
    >
      MACHINE
    </div>

    <h1
      style="
        color:#ffffff;
        margin-bottom:10px;
      "
    >
      Prueba de correo
    </h1>

    <p>
      Si estás viendo este mensaje,
      Nodemailer y Gmail están funcionando
      correctamente en MACHINE.
    </p>

    <p
      style="
        color:#71869a;
        font-size:12px;
      "
    >
      Fecha:
      ${new Date().toISOString()}
    </p>

  </div>

</body>

</html>
`,
    });

  console.log(
    "========================================"
  );

  console.log(
    "EMAIL ENVIADO CORRECTAMENTE"
  );

  console.log(
    "MESSAGE ID:",
    info.messageId
  );

  console.log(
    "RESPONSE:",
    info.response
  );

  console.log(
    "========================================"
  );

} catch (error) {

  console.error(
    "========================================"
  );

  console.error(
    "ERROR ENVIANDO CORREO"
  );

  console.error(
    "========================================"
  );

  console.error(
    error
  );

  process.exit(1);
}