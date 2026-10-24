
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

import pool from "./config/database.js";

import authRoutes from "./routes/auth.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import profileVisitsRoutes from "./profileVisits.routes.js";
import profileAccessRoutes from "./routes/profileAccess.routes.js";
import publicRoutes from "./routes/public.routes.js";
import operatorActivityRoutes from "./routes/operatorActivity.routes.js";
import professionalVotesRoutes from "./routes/professionalVotes.routes.js";
import operatorLocationsRoutes from "./routes/operatorLocations.routes.js";
import operatorNearbyRoutes from "./routes/operatorNearby.routes.js";
import sparePartsGovernanceRoutes from "./routes/sparePartsGovernance.routes.js";
import sparePartsRoutes from "./routes/spareParts.routes.js";
import { registerChatSocket } from "./socket/chat.socket.js";
import mailRoutes from "./routes/mail.routes.js";

// =========================================================
// VARIABLES DE ENTORNO
// =========================================================

dotenv.config();

// =========================================================
// RUTAS DEL SISTEMA DE ARCHIVOS
// =========================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =========================================================
// APLICACIÓN EXPRESS
// =========================================================

const app = express();
const PORT = process.env.PORT || 8080;

// =========================================================
// SERVIDOR HTTP
// =========================================================

const httpServer = createServer(app);

// =========================================================
// SOCKET.IO
// =========================================================

const io = new Server(httpServer, {
  cors: {
    origin: true,
    credentials: true,
  },
});

// =========================================================
// MIDDLEWARE CORS
// =========================================================

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

// =========================================================
// JSON
// =========================================================

app.use(express.json());

// =========================================================
// ARCHIVOS MULTIMEDIA
// =========================================================
//
// Los archivos de MACHINE se guardan en:
//
// machine-backend/uploads
//
// Se sirven mediante:
//
// /uploads/nombre-del-archivo
//
// =========================================================

const uploadsPath = path.join(
  __dirname,
  "..",
  "uploads"
);

app.use("/uploads", express.static(uploadsPath));

// =========================================================
// API ROUTES
// =========================================================

app.use(
  "/api/operator-activity",
  operatorActivityRoutes
);

app.use("/api/auth", authRoutes);

app.use("/api/chat", chatRoutes);

app.use("/api/mail", mailRoutes);

app.use(
  "/api/profile-access",
  profileAccessRoutes
);

app.use(
  "/api/professional-votes",
  professionalVotesRoutes
);

app.use(
  "/api/operator-locations",
  operatorLocationsRoutes
);

app.use(
  "/api/operator-nearby",
  operatorNearbyRoutes
);

app.use(
  "/api/profile-visits",
  profileVisitsRoutes
);

app.use("/api/public", publicRoutes);

// =========================================================
// REPOSITORIO DE REPUESTOS
// =========================================================

app.use(
  "/api/spare-parts/governance",
  sparePartsGovernanceRoutes
);

app.use(
  "/api/spare-parts",
  sparePartsRoutes
);

// =========================================================
// SYSTEM STATUS
// =========================================================

app.get("/", (req, res) => {
  res.status(200).json({
    system: "MACHINE",
    status: "ONLINE",
    service: "INDUSTRIAL CONTROL API",
    version: "1.0.0",
  });
});

// =========================================================
// DATABASE HEALTH CHECK
// =========================================================

app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT NOW() AS server_time"
    );

    return res.status(200).json({
      status: "OK",
      database: "CONNECTED",
      serverTime: result.rows[0].server_time,
    });
  } catch (error) {
    console.error(
      "DATABASE ERROR:",
      error.message
    );

    return res.status(500).json({
      status: "ERROR",
      database: "DISCONNECTED",
    });
  }
});

// =========================================================
// SOCKET.IO CONNECTION
// =========================================================
//
// MACHINE utiliza una sola instancia de Socket.IO.
//
// registerChatSocket administra la conexión existente
// para presencia, chat privado, mensajes y notificaciones.
// =========================================================

io.on("connection", (socket) => {
  registerChatSocket(io, socket);
});

// =========================================================
// START SERVER
// =========================================================

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("========================================");
  console.log("        MACHINE BACKEND");
  console.log("========================================");
  console.log(`SERVER: http://localhost:${PORT}`);
  console.log("STATUS: ONLINE");
  console.log("SOCKET.IO: ENABLED");
  console.log("DATABASE: READY");
  console.log("UPLOADS: ENABLED");
  console.log("========================================");
  console.log("");
});
