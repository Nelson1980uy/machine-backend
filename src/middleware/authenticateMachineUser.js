import jwt from "jsonwebtoken";
import pool from "../config/database.js";

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET no está configurado."
  );
}

export default async function authenticateMachineUser(
  req,
  res,
  next
) {
  const authorization =
    req.headers.authorization || "";

  if (!authorization.startsWith("Bearer ")) {
    return res.status(401).json({
      status: "ERROR",
      message: "Sesión no autorizada.",
    });
  }

  const token = authorization.substring(7).trim();

  if (!token) {
    return res.status(401).json({
      status: "ERROR",
      message: "Token de sesión no válido.",
    });
  }

  let decoded;

  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({
      status: "ERROR",
      message: "La sesión ha expirado o no es válida.",
    });
  }

  if (!decoded?.userId) {
    return res.status(401).json({
      status: "ERROR",
      message: "Sesión no válida.",
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        id,
        email,
        employee_id,
        role,
        status
      FROM public.users
      WHERE id = $1
      LIMIT 1
      `,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        status: "ERROR",
        message: "El operador ya no existe.",
      });
    }

    const user = result.rows[0];

    if (user.status !== "active") {
      return res.status(403).json({
        status: "ERROR",
        message: "La cuenta del operador no está activa.",
      });
    }

    req.user = {
      id: user.id,
      email: user.email,
      employeeId: user.employee_id,
      role: user.role,
      status: user.status,
    };

    return next();
  } catch (error) {
    console.error(
      "MACHINE AUTHENTICATION ERROR:",
      error.message
    );

    return res.status(500).json({
      status: "ERROR",
      message: "No se pudo validar la sesión.",
    });
  }
}
