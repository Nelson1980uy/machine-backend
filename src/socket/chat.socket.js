// =========================================================
// MACHINE - CHAT SOCKET
// PRESENCIA + CHAT PRIVADO EN TIEMPO REAL
// =========================================================

import pool from "../config/database.js";

const connectedUsers = new Map();


// =========================================================
// REFERENCIA AL SOCKET.IO PRINCIPAL DE MACHINE
// =========================================================
//
// Permite que otros módulos del backend,
// como profileAccess.routes.js, puedan emitir eventos
// utilizando EL MISMO Socket.IO.
//
// NO crea una segunda conexión.
// =========================================================

let activeIo = null;


// =========================================================
// REGISTRAR SOCKET DE CHAT
// =========================================================

function registerChatSocket(io, socket) {

  // =======================================================
  // GUARDAR REFERENCIA DEL SOCKET.IO PRINCIPAL
  // =======================================================

  activeIo = io;


  console.log(
    `CHAT SOCKET CONNECTED: ${socket.id}`
  );


  // =======================================================
  // REGISTRAR USUARIO
  // =======================================================

  socket.on(
    "chat:register",
    async (data = {}) => {

      try {

        const userId =
          typeof data.userId === "string"
            ? data.userId.trim()
            : "";


        // =================================================
        // VALIDAR USER ID
        // =================================================

        if (!userId) {

          socket.emit(
            "chat:register:error",
            {
              message:
                "No se recibió un ID de usuario válido.",
            }
          );

          return;

        }


        // =================================================
        // SI EL SOCKET YA TENÍA UN USUARIO
        // =================================================

        if (socket.data.userId) {

          connectedUsers.delete(
            socket.data.userId
          );

        }


        // =================================================
        // GUARDAR USUARIO EN SOCKET
        // =================================================

        socket.data.userId =
          userId;

        socket.data.connectedAt =
          new Date().toISOString();


        // =================================================
        // REGISTRAR CONEXIÓN
        // =================================================

        connectedUsers.set(
          userId,
          {
            userId,
            socketId: socket.id,
            connectedAt:
              socket.data.connectedAt,
          }
        );


        console.log(
          `CHAT USER ONLINE: ${userId}`
        );


        // =================================================
        // CONFIRMACIÓN
        // =================================================

        socket.emit(
          "chat:registered",
          {
            userId,
            socketId: socket.id,
            connectedAt:
              socket.data.connectedAt,
          }
        );


        // =================================================
        // RECONSTRUIR NOTIFICACIONES PRIVADAS NO LEÍDAS
        //
        // La base de datos es la fuente real.
        //
        // Si el usuario hace F5 y tenía mensajes privados
        // sin leer, se vuelven a cargar aquí.
        // =================================================

        try {

          const unreadResult =
            await pool.query(
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
                  ON
                    recipient_member.conversation_id =
                      m.conversation_id

                  AND
                    recipient_member.user_id =
                      $1

                INNER JOIN public.users u
                  ON
                    u.id =
                      m.author_user_id

                LEFT JOIN public.user_profiles p
                  ON
                    p.user_id =
                      u.id

                WHERE
                  m.author_user_id <> $1

                  AND
                  m.read_at IS NULL

                GROUP BY
                  m.conversation_id,
                  m.author_user_id,

                  u.email,
                  u.employee_id,

                  p.first_name,
                  p.last_name,
                  p.gender,
                  p.photo_url

                ORDER BY
                  MAX(m.created_at) DESC
              `,
              [
                userId,
              ]
            );


          // =================================================
          // CONSTRUIR NOTIFICACIONES
          // =================================================

          const unreadNotifications =
            unreadResult.rows.map(
              (row) => {

                const senderName =
                  [
                    row.first_name,
                    row.last_name,
                  ]
                    .filter(Boolean)
                    .join(" ")
                    .trim() ||
                  "Operador";


                return {

                  conversationId:
                    row.conversation_id,

                  userId:
                    row.user_id,

                  firstName:
                    row.first_name ||
                    "Operador",

                  lastName:
                    row.last_name ||
                    "Local",

                  name:
                    senderName,

                  employeeId:
                    row.employee_id ||
                    null,

                  gender:
                    row.gender ||
                    null,

                  photo:
                    row.photo_url ||
                    null,

                  photoUrl:
                    row.photo_url ||
                    null,

                  unreadCount:
                    Number(
                      row.unread_count ||
                      0
                    ),

                  lastMessage:
                    row.last_message ||
                    "Nuevo mensaje privado.",

                  createdAt:
                    row.created_at,

                };

              }
            );


          // =================================================
          // ENVIAR NOTIFICACIONES AL USUARIO
          // =================================================

          socket.emit(
            "chat:private:unread",
            {
              notifications:
                unreadNotifications,
            }
          );


          console.log(
            `CHAT PRIVATE UNREAD RESTORED: ${userId} → ${unreadNotifications.length} conversación(es)`
          );


        } catch (error) {

          console.error(
            "CHAT PRIVATE UNREAD RESTORE ERROR:",
            error
          );


          // =================================================
          // SI LA CONSULTA FALLA
          //
          // El usuario igualmente puede continuar conectado.
          // =================================================

          socket.emit(
            "chat:private:unread",
            {
              notifications: [],
            }
          );

        }


        // =================================================
        // PRESENCIA
        // =================================================

        io.emit(
          "chat:presence",
          {
            onlineUserIds:
              Array.from(
                connectedUsers.keys()
              ),
          }
        );


      } catch (error) {

        console.error(
          "CHAT SOCKET REGISTER ERROR:",
          error
        );

        socket.emit(
          "chat:register:error",
          {
            message:
              "No fue posible registrar la conexión.",
          }
        );

      }

    }
  );


  // =======================================================
  // CHAT PRIVADO
  // ENTREGAR MENSAJE AL OTRO OPERADOR
  // =======================================================

  socket.on(
    "chat:private:send",
    (data = {}) => {

      try {

        const senderId =
          socket.data.userId;

        const receiverId =
          typeof data.receiverId === "string"
            ? data.receiverId.trim()
            : "";

        const conversationId =
          typeof data.conversationId === "string"
            ? data.conversationId.trim()
            : "";

        const message =
          data.message || null;


        // =================================================
        // VALIDAR
        // =================================================

        if (!senderId) {

          console.error(
            "CHAT PRIVATE SOCKET: usuario no registrado."
          );

          return;

        }

        if (!receiverId) {

          console.error(
            "CHAT PRIVATE SOCKET: receiverId inválido."
          );

          return;

        }

        if (!conversationId) {

          console.error(
            "CHAT PRIVATE SOCKET: conversationId inválido."
          );

          return;

        }

        if (!message) {

          console.error(
            "CHAT PRIVATE SOCKET: mensaje inexistente."
          );

          return;

        }


        // =================================================
        // SEGURIDAD BÁSICA
        // =================================================

        if (
          String(message.senderId) !==
          String(senderId)
        ) {

          console.error(
            "CHAT PRIVATE SOCKET: senderId no coincide con el socket."
          );

          return;

        }


        // =================================================
        // BUSCAR SOCKET DEL DESTINATARIO
        // =================================================

        const targetConnection =
          connectedUsers.get(
            receiverId
          );


        // =================================================
        // DESTINATARIO OFFLINE
        // =================================================

        if (!targetConnection) {

          console.log(
            `CHAT PRIVATE MESSAGE STORED - USER OFFLINE: ${receiverId}`
          );

          return;

        }


        // =================================================
        // PREPARAR MENSAJE
        // =================================================

        const incomingMessage = {

          ...message,

          read:
            false,

        };


        // =================================================
        // ENTREGAR AL DESTINATARIO
        // =================================================

        io.to(
          targetConnection.socketId
        ).emit(
          "chat:private:message",
          {
            conversationId,

            senderId,

            receiverId,

            message:
              incomingMessage,
          }
        );


        console.log(
          `CHAT PRIVATE MESSAGE SENT: ${senderId} → ${receiverId}`
        );


      } catch (error) {

        console.error(
          "CHAT PRIVATE SOCKET SEND ERROR:",
          error
        );

      }

    }
  );


  // =======================================================
  // MARCAR MENSAJES PRIVADOS COMO LEÍDOS
  //
  // El usuario actual está viendo la conversación.
  //
  // Se marcan como leídos solamente los mensajes:
  //
  // - de esa conversación
  // - enviados por el otro usuario
  // - que todavía no tienen read_at
  // =======================================================

  socket.on(
    "chat:private:read",
    async (data = {}) => {

      try {

        const currentUserId =
          socket.data.userId;

        const conversationId =
          typeof data.conversationId === "string"
            ? data.conversationId.trim()
            : "";

        const otherUserId =
          typeof data.otherUserId === "string"
            ? data.otherUserId.trim()
            : "";


        // =================================================
        // VALIDAR SOCKET
        // =================================================

        if (!currentUserId) {

          console.error(
            "CHAT PRIVATE READ: usuario no registrado."
          );

          return;

        }


        // =================================================
        // VALIDAR CONVERSACIÓN
        // =================================================

        if (!conversationId) {

          console.error(
            "CHAT PRIVATE READ: conversationId inválido."
          );

          return;

        }


        // =================================================
        // VALIDAR OTRO USUARIO
        // =================================================

        if (!otherUserId) {

          console.error(
            "CHAT PRIVATE READ: otherUserId inválido."
          );

          return;

        }


        // =================================================
        // MARCAR COMO LEÍDOS
        //
        // IMPORTANTE:
        //
        // author_user_id = otherUserId
        //
        // porque queremos marcar como leídos
        // LOS MENSAJES QUE EL OTRO NOS ENVIÓ.
        // =================================================

        const result =
          await pool.query(
            `
              UPDATE public.chat_private_messages

              SET
                read_at = NOW()

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


        // =================================================
        // NO HABÍA MENSAJES NUEVOS PARA MARCAR
        // =================================================

        if (
          result.rows.length === 0
        ) {

          return;

        }


        // =================================================
        // IDS DE MENSAJES LEÍDOS
        // =================================================

        const messageIds =
          result.rows.map(
            (message) =>
              message.id
          );


        // =================================================
        // BUSCAR SOCKET DEL USUARIO
        // QUE ENVIÓ LOS MENSAJES
        // =================================================

        const senderConnection =
          connectedUsers.get(
            otherUserId
          );


        // =================================================
        // SI EL OTRO USUARIO ESTÁ ONLINE
        // AVISARLE EN TIEMPO REAL
        // =================================================

        if (senderConnection) {

          io.to(
            senderConnection.socketId
          ).emit(
            "chat:private:read",
            {
              conversationId,

              readerId:
                currentUserId,

              messageIds,

              readAt:
                result.rows[
                  result.rows.length - 1
                ].read_at,
            }
          );

        }


        console.log(
          `CHAT PRIVATE READ: ${currentUserId} leyó ${messageIds.length} mensaje(s) de ${otherUserId}`
        );


      } catch (error) {

        console.error(
          "CHAT PRIVATE READ ERROR:",
          error
        );

      }

    }
  );


  // =======================================================
  // DESCONEXIÓN
  // =======================================================

  socket.on(
    "disconnect",
    (reason) => {

      const userId =
        socket.data.userId;


      // ===================================================
      // SOCKET SIN USUARIO
      // ===================================================

      if (!userId) {

        console.log(
          `CHAT SOCKET DISCONNECTED: ${socket.id}`
        );

        console.log(
          `REASON: ${reason}`
        );

        return;

      }


      // ===================================================
      // ELIMINAR SOLO LA CONEXIÓN ACTUAL
      // ===================================================

      const currentConnection =
        connectedUsers.get(
          userId
        );


      if (
        currentConnection &&
        currentConnection.socketId ===
          socket.id
      ) {

        connectedUsers.delete(
          userId
        );

      }


      console.log(
        `CHAT USER OFFLINE: ${userId}`
      );

      console.log(
        `SOCKET: ${socket.id}`
      );

      console.log(
        `REASON: ${reason}`
      );


      // ===================================================
      // ACTUALIZAR PRESENCIA
      // ===================================================

      io.emit(
        "chat:presence",
        {
          onlineUserIds:
            Array.from(
              connectedUsers.keys()
            ),
        }
      );

    }
  );

}


// =========================================================
// OBTENER USUARIOS CONECTADOS
// =========================================================

function getConnectedUsers() {

  return Array.from(
    connectedUsers.values()
  );

}


// =========================================================
// OBTENER SOCKET DE UN USUARIO
// =========================================================

function getUserSocketId(
  userId
) {

  const connection =
    connectedUsers.get(
      String(userId)
    );

  return connection
    ? connection.socketId
    : null;

}


// =========================================================
// EMITIR SOLICITUD DE ACCESO A PERFIL PRIVADO
// =========================================================
//
// Esta función permite que profileAccess.routes.js
// envíe una solicitud directamente al operador destino.
//
// Utiliza el MISMO Socket.IO principal de MACHINE.
// =========================================================

function emitProfileAccessRequest(
  targetUserId,
  payload
) {

  if (!activeIo) {

    console.error(
      "PROFILE ACCESS SOCKET: Socket.IO todavía no está disponible."
    );

    return false;

  }


  const connection =
    connectedUsers.get(
      String(targetUserId)
    );


  // =======================================================
  // USUARIO DESTINO OFFLINE
  // =======================================================

  if (!connection) {

    console.log(
      `PROFILE ACCESS: usuario destino offline → ${targetUserId}`
    );

    return false;

  }


  // =======================================================
  // ENVIAR SOLICITUD
  // =======================================================

  activeIo
    .to(
      connection.socketId
    )
    .emit(
      "profile:access:request",
      payload
    );


  console.log(
    `PROFILE ACCESS REQUEST SENT: → ${targetUserId}`
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

