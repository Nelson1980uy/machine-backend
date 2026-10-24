import nodemailer from "nodemailer";

const SUPPORT_EMAIL =
  process.env.MACHINE_SUPPORT_EMAIL || "";

const APP_PASSWORD =
  process.env.MACHINE_SUPPORT_APP_PASSWORD || "";

let transporter;

function getTransporter() {
  if (!SUPPORT_EMAIL || !APP_PASSWORD) {
    throw new Error(
      "El servicio de correo no está configurado."
    );
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: SUPPORT_EMAIL,
        pass: APP_PASSWORD,
      },
    });
  }

  return transporter;
}

export async function sendMachineEmail({
  to,
  subject,
  text,
  html,
}) {
  if (
    typeof to !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())
  ) {
    throw new Error(
      "La dirección de correo del destinatario no es válida."
    );
  }

  return getTransporter().sendMail({
    from: `"MACHINE Support" <${SUPPORT_EMAIL}>`,
    to: to.trim(),
    subject,
    text,
    html,
  });
}
