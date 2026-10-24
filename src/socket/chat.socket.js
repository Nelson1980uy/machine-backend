// =========================================================
// MACHINE - CHAT SOCKET
// PRESENCIA + CHAT PRIVADO EN TIEMPO REAL
// =========================================================

import pool from "../config/database.js";

const connectedUsers = new Map();
const userSockets = new Map();

// Referencia al Socket.IO principal de MACHINE.
let activeIo = null;


// =========================================================
// GESTIONAR LAS SESIONES ACTIVAS DE UN USUARIO
// =========================================================

function refreshUserConnection(io, userId) {
  const sockets = userSockets.get(String(userId));

  if (!sockets || sockets.size === 0) {
    userSockets.delete(String(userId));
    connectedUsers.delete(String(userId));
    return false;
  }

  // Elegir una sesión que realmente siga conectada.
  for (const socketId of sockets) {
    const currentSocket = io.sockets.sockets.get(socketId);

    if (currentSocket && currentSocket.connected) {
      connectedUsers.set(String(userId), {
        userId: String(userId),
        socketId,
        connectedAt:
          currentSocket.data.connectedAt ||
          new Date().toISOString(),
      });

      return true;
    }

    // Limpiar sockets que ya no existen.
    sockets.delete(socketId);
  }

  userSockets.delete(String(userId));
  connectedUsers.delete(String(userId));

  return false;
}


// =========================================================
// ENVIAR EVENTOS A TODAS LAS SESIONES DE UN USUARIO
// =========================================================

function emitToUser(io, userId, event, payload) {
  const normalizedUserId = String(userId);
  const sockets = userSockets.get(normalizedUserId);

  if (!sockets || sockets.size === 0) {
    refreshUserConnection(io, normalizedUserId);
    return false;
  }

  let delivered = false;

  for (const socketId of [...sockets]) {
    const targetSocket = io.sockets.sockets.get(socketId);

    if (!targetSocket || !targetSocket.connected) {
      sockets.delete(socketId);
      continue;
    }

    targetSocket.emit(event, payload);
    delivered = true;
  }

  refreshUserConnection(io, normalizedUserId);

  return delivered;
}


// =========================================================
// ACTUALIZAR PRESENCIA GLOBAL
// =========================================================

function broadcastPresence(io) {
  io.emit("chat:presence", {
    onlineUserIds: Array.from(connectedUsers.keys()),
  });
}


// =========================================================
// REGISTRAR SOCKET DE CHAT
// =========================================================

function registerChatSocket(io, socket) {
  activeIo = io;

  console.log(`CHAT SOCKET CONNECTED: ${socket.id}`);


  // =======================================================
  // REGISTRAR USUARIO
  // =======================================================

  socket.on("chat:register", async (data = {}) => {
    try {
      const userId =
        typeof data.userId === "string"
          ? data.userId.trim()
          : "";

      if (!userId) {
        socket.emit("chat:register:error", {
          message: "No se recibió un ID de usuario válido.",
        });

        return;
      }

      // Si el socket cambia de usuario, quitarlo de la sesión anterior.
      const previousUserId = socket.data.userId;

      if (
        previousUserId &&
        String(previousUserId) !== String(userId)
      ) {
        const previousSockets = userSockets.get(
          String(previousUserId)
        );

        if (previousSockets) {
          previousSockets.delete(socket.id);

          if (previousSockets.size === 0) {
            userSockets.delete(String(previousUserId));
          }
        }

        refreshUserConnection(io, previousUserId);
      }

      // Guardar la identidad de este socket.
      socket.data.userId = userId;
      socket.data.connectedAt =
        socket.data.connectedAt ||
        new Date().toISOString();

      // Agregar la sesión sin eliminar las otras sesiones del usuario.
      if (!userSockets.has(userId)) {
        userSockets.set(userId, new Set());
      }

      userSockets.get(userId).add(socket.id);

      refreshUserConnection(io, userId);

      console.log(`CHAT USER ONLINE: ${userId}`);

      socket.emit("chat:registered", {
        userId,
        socketId: socket.id,
        connectedAt: socket.data.connectedAt,
      });

      broadcastPresence(io);


      // ===================================================
      // RESTAURAR NOTIFICACIONES PRIVADAS NO LEÍDAS
      // ===================================================

      try {
        const unreadResult = await pool.query(
          `
            SELECT
              m.conversation_id,
              m.author_user_id AS user_id,
              COUNT(*)::int AS unread_count,
              MAX(m.created_at) AS created_at,

              (
                ARRAY_AGG(
                  m.text
                  ORDER BY m.created_at DESC
                )
              )[1] AS last_message,

              u.email,
              u.employee_id,
              p.first_name,
              p.last_name,
              p.gender,
              p.photo_url

            FROM public.chat_private_messages m

            INNER JOIN public.chat_private_members recipient_member
              ON recipient_member.conversation_id = m.conversation_id
              AND recipient_member.user_id = $1

            INNER JOIN public.users u
              ON u.id = m.author_user_id

            LEFT JOIN public.user_profiles p
              ON p.user_id = u.id

            WHERE
              m.author_user_id <> $1
              AND m.read_at IS NULL

            GROUP BY
              m.conversation_id,
              m.author_user_id,
              u.email,
              u.employee_id,
              p.first_name,
              p.last_name,
              p.gender,
              p.photo_url

            ORDER BY MAX(m.created_at) DESC
          `,
          [userId]
        );

        const unreadNotifications = unreadResult.rows.map((row) => {
          const senderName = [
            row.first_name,
            row.last_name,
          ]
            .filter(Boolean)
            .join(" ")
            .trim() || "Operador";

          return {
            conversationId: row.conversation_id,
            userId: row.user_id,

            firstName: row.first_name || "Operador",
            lastName: row.last_name || "Local",
            name: senderName,

            employeeId: row.employee_id || null,
            gender: row.gender || null,

            photo: row.photo_url || null,
            photoUrl: row.photo_url || null,

            unreadCount: Number(row.unread_count || 0),

            lastMessage:
              row.last_message ||
              "Nuevo mensaje privado.",

            createdAt: row.created_at,
          };
        });

        socket.emit("chat:private:unread", {
          notifications: unreadNotifications,
        });

        console.log(
          `CHAT PRIVATE UNREAD RESTORED: ${userId} → ${unreadNotifications.length} conversación(es)`
        );
      } catch (error) {
        console.error(
          "CHAT PRIVATE UNREAD RESTORE ERROR:",
          error
        );

        socket.emit("chat:private:unread", {
          notifications: [],
        });
      }
    } catch (error) {
      console.error("CHAT SOCKET REGISTER ERROR:", error);

      socket.emit("chat:register:error", {
        message: "No fue posible registrar la conexión.",
      });
    }
  });


  // =======================================================
  // CHAT PRIVADO: ENTREGAR MENSAJE
  // =======================================================

  socket.on("chat:private:send", (data = {}) => {
    try {
      const senderId = socket.data.userId;

      const receiverId =
        typeof data.receiverId === "string"
          ? data.receiverId.trim()
          : "";

      const conversationId =
        typeof data.conversationId === "string"
          ? data.conversationId.trim()
          : "";

      const message = data.message || null;

      if (!senderId) {
        console.error(
          "CHAT PRIVATE SOCKET: usuario no registrado."
        );
        return;
      }

      if (!receiverId || !conversationId || !message) {
        console.error(
          "CHAT PRIVATE SOCKET: datos del mensaje incompletos."
        );
        return;
      }

      if (
        String(message.senderId) !== String(senderId)
      ) {
        console.error(
          "CHAT PRIVATE SOCKET: senderId no coincide con el socket."
        );
        return;
      }

      const incomingMessage = {
        ...message,
        read: false,
      };

      const delivered = emitToUser(
        io,
        receiverId,
        "chat:private:message",
        {
          conversationId,
          senderId,
          receiverId,
          message: incomingMessage,
        }
      );

      if (delivered) {
        console.log(
          `CHAT PRIVATE MESSAGE SENT: ${senderId} → ${receiverId}`
        );
      } else {
        console.log(
          `CHAT PRIVATE MESSAGE STORED - USER OFFLINE: ${receiverId}`
        );
      }
    } catch (error) {
      console.error(
        "CHAT PRIVATE SOCKET SEND ERROR:",
        error
      );
    }
  });


  // =======================================================
  // MARCAR MENSAJES PRIVADOS COMO LEÍDOS
  // =======================================================

  socket.on("chat:private:read", async (data = {}) => {
    try {
      const currentUserId = socket.data.userId;

      const conversationId =
        typeof data.conversationId === "string"
          ? data.conversationId.trim()
          : "";

      const otherUserId =
        typeof data.otherUserId === "string"
          ? data.otherUserId.trim()
          : "";

      if (!currentUserId || !conversationId || !otherUserId) {
        console.error(
          "CHAT PRIVATE READ: faltan datos válidos."
        );
        return;
      }

      const result = await pool.query(
        `
          UPDATE public.chat_private_messages
          SET read_at = NOW()

          WHERE
            conversation_id = $1
            AND author_user_id = $2
            AND read_at IS NULL

          RETURNING
            id,
            conversation_id,
            author_user_id,
            read_at
        `,
        [
          conversationId,
          otherUserId,
        ]
      );

      if (result.rows.length === 0) {
        return;
      }

      const messageIds = result.rows.map(
        (message) => message.id
      );

      const readAt =
        result.rows[result.rows.length - 1].read_at;

      emitToUser(
        io,
        otherUserId,
        "chat:private:read",
        {
          conversationId,
          readerId: currentUserId,
          messageIds,
          readAt,
        }
      );

      console.log(
        `CHAT PRIVATE READ: ${currentUserId} leyó ${messageIds.length} mensaje(s) de ${otherUserId}`
      );
    } catch (error) {
      console.error(
        "CHAT PRIVATE READ ERROR:",
        error
      );
    }
  });


  // =======================================================
  // DESCONEXIÓN
  // =======================================================

  socket.on("disconnect", (reason) => {
    const userId = socket.data.userId;

    if (!userId) {
      console.log(
        `CHAT SOCKET DISCONNECTED: ${socket.id}`
      );

      console.log(`REASON: ${reason}`);
      return;
    }

    const normalizedUserId = String(userId);
    const sockets = userSockets.get(normalizedUserId);

    // Eliminar exclusivamente el socket que se desconectó.
    if (sockets) {
      sockets.delete(socket.id);

      if (sockets.size === 0) {
        userSockets.delete(normalizedUserId);
      }
    }

    // Si quedan sesiones activas, el usuario sigue online.
    const stillOnline = refreshUserConnection(
      io,
      normalizedUserId
    );

    console.log(
      stillOnline
        ? `CHAT USER STILL ONLINE: ${normalizedUserId}`
        : `CHAT USER OFFLINE: ${normalizedUserId}`
    );

    console.log(`SOCKET: ${socket.id}`);
    console.log(`REASON: ${reason}`);

    broadcastPresence(io);
  });
}


// =========================================================
// OBTENER USUARIOS CONECTADOS
// =========================================================

function getConnectedUsers() {
  return Array.from(connectedUsers.values());
}


// =========================================================
// OBTENER SOCKET PRINCIPAL DE UN USUARIO
// =========================================================

function getUserSocketId(userId) {
  const normalizedUserId = String(userId);

  const connection = connectedUsers.get(normalizedUserId);

  return connection ? connection.socketId : null;
}


// =========================================================
// EMITIR SOLICITUD DE ACCESO A PERFIL PRIVADO
// =========================================================

function emitProfileAccessRequest(targetUserId, payload) {
  if (!activeIo) {
    console.error(
      "PROFILE ACCESS SOCKET: Socket.IO todavía no está disponible."
    );

    return false;
  }

  const normalizedUserId = String(targetUserId);

  const delivered = emitToUser(
    activeIo,
    normalizedUserId,
    "profile:access:request",
    payload
  );

  if (!delivered) {
    console.log(
      `PROFILE ACCESS: usuario destino offline → ${normalizedUserId}`
    );

    return false;
  }

  console.log(
    `PROFILE ACCESS REQUEST SENT: → ${normalizedUserId}`
  );

  return true;
}


// =========================================================
// EXPORTAR
// =========================================================

export {
  registerChatSocket,
  getConnectedUsers,
  getUserSocketId,
  emitProfileAccessRequest,
};
