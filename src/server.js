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

import {
  registerChatSocket,
} from "./socket/chat.socket.js";


// =========================================================
// VARIABLES DE ENTORNO
// =========================================================

dotenv.config();


// =========================================================
// RUTAS DEL SISTEMA DE ARCHIVOS
// =========================================================

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);


// =========================================================
// APLICACIÓN EXPRESS
// =========================================================

const app =
  express();

const PORT =
  process.env.PORT ||
  8080;


// =========================================================
// SERVIDOR HTTP
// =========================================================

const httpServer =
  createServer(app);


// =========================================================
// SOCKET.IO
// =========================================================

const io =
  new Server(
    httpServer,
    {
      cors: {
        origin: true,
        credentials: true,
      },
    }
  );


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

app.use(
  express.json()
);


// =========================================================
// ARCHIVOS MULTIMEDIA
// =========================================================
//
// Los archivos guardados por MACHINE estarán en:
//
// machine-backend/uploads/chat
//
// Se sirven mediante:
//
// /uploads/chat/nombre-del-archivo
//
// =========================================================

const uploadsPath =
  path.join(
    __dirname,
    "..",
    "uploads"
  );

app.use(
  "/uploads",
  express.static(
    uploadsPath
  )
);

app.use(
  "/api/operator-activity",
  operatorActivityRoutes
);


// =========================================================
// API ROUTES
// =========================================================

app.use(
  "/api/auth",
  authRoutes
);

app.use(
  "/api/chat",
  chatRoutes
);

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

app.use(
  "/api/public",
  publicRoutes
);

// =========================================================
// SYSTEM STATUS
// =========================================================

app.get(
  "/",
  (req, res) => {

    res.json({
      system:
        "MACHINE",

      status:
        "ONLINE",

      service:
        "INDUSTRIAL CONTROL API",

      version:
        "1.0.0",
    });

  }
);


// =========================================================
// DATABASE HEALTH CHECK
// =========================================================

app.get(
  "/api/health",
  async (req, res) => {

    try {

      const result =
        await pool.query(
          "SELECT NOW() AS server_time"
        );


      return res.status(200).json({

        status:
          "OK",

        database:
          "CONNECTED",

        serverTime:
          result.rows[0]
            .server_time,

      });

    } catch (error) {

      console.error(
        "DATABASE ERROR:",
        error
      );


      return res.status(500).json({

        status:
          "ERROR",

        database:
          "DISCONNECTED",

      });

    }

  }
);


// =========================================================
// SOCKET.IO CONNECTION
// =========================================================
//
// Toda conexión Socket.IO de MACHINE pasa por:
//
// registerChatSocket(io, socket)
//
// Allí se manejan actualmente:
// - presencia
// - chat privado
// - mensajes
// - mensajes leídos
// - notificaciones
//
// También utilizaremos esta misma conexión para:
// - solicitudes de acceso a perfiles privados
//
// NO se crea un segundo Socket.IO.
//
// =========================================================

io.on(
  "connection",
  (socket) => {

    registerChatSocket(
      io,
      socket
    );

  }
);


// =========================================================
// START SERVER
// =========================================================

httpServer.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log("");

    console.log(
      "========================================"
    );

    console.log(
      "        MACHINE BACKEND"
    );

    console.log(
      "========================================"
    );

    console.log(
      `SERVER: http://localhost:${PORT}`
    );

    console.log(
      "STATUS: ONLINE"
    );

    console.log(
      "SOCKET.IO: ENABLED"
    );

    console.log(
      "DATABASE: READY"
    );

    console.log(
      "UPLOADS: ENABLED"
    );

    console.log(
      "========================================"
    );

    console.log("");

  }
);
