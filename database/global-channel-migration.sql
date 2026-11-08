
-- =========================================================
-- MACHINE — GLOBAL CHANNEL
-- MIGRATION 001
-- =========================================================
--
-- Crea las estructuras necesarias para:
--   1. Respuestas de publicaciones globales.
--   2. Historial de entradas y salidas.
--   3. Archivos adjuntos de las respuestas.
--
-- No elimina ni modifica registros históricos.
-- No modifica chat-schema.sql.
-- No altera las tablas de temas ni sus adjuntos.
--
-- Ejecutar únicamente después de revisar esta migración.
-- =========================================================

BEGIN;

-- =========================================================
-- 1. RESPUESTAS DE PUBLICACIONES GLOBALES
-- =========================================================

CREATE TABLE IF NOT EXISTS public.chat_global_replies (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    global_message_id UUID NOT NULL,

    author_user_id UUID NOT NULL,

    text TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chat_global_replies_message_fk
        FOREIGN KEY (global_message_id)
        REFERENCES public.chat_global_messages(id)
        ON DELETE RESTRICT,

    CONSTRAINT chat_global_replies_author_fk
        FOREIGN KEY (author_user_id)
        REFERENCES public.users(id)
        ON DELETE RESTRICT

);

-- =========================================================
-- 2. VISITAS A CONVERSACIONES GLOBALES
-- =========================================================
--
-- Cada entrada genera un registro independiente.
--
-- exited_at permanece NULL mientras la visita no se haya
-- cerrado explícitamente.
--
-- Las entradas repetidas del mismo operador se conservan.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.chat_global_visits (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    global_message_id UUID NOT NULL,

    user_id UUID NOT NULL,

    entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    exited_at TIMESTAMPTZ NULL,

    exit_reason VARCHAR(20) NULL,

    CONSTRAINT chat_global_visits_message_fk
        FOREIGN KEY (global_message_id)
        REFERENCES public.chat_global_messages(id)
        ON DELETE RESTRICT,

    CONSTRAINT chat_global_visits_user_fk
        FOREIGN KEY (user_id)
        REFERENCES public.users(id)
        ON DELETE RESTRICT,

    CONSTRAINT chat_global_visits_exit_check
        CHECK (
            exited_at IS NULL
            OR exited_at >= entered_at
        ),

    CONSTRAINT chat_global_visits_activity_check
        CHECK (
            last_activity_at >= entered_at
        ),

    CONSTRAINT chat_global_visits_reason_check
        CHECK (
            (exited_at IS NULL AND exit_reason IS NULL)
            OR
            (
                exited_at IS NOT NULL
                AND exit_reason IS NOT NULL
                AND exit_reason IN ('USER', 'DISCONNECT', 'TIMEOUT')
            )
        )

);

-- =========================================================
-- 3. ARCHIVOS ADJUNTOS DE LAS RESPUESTAS
-- =========================================================
--
-- Se utiliza una tabla independiente para no modificar
-- la restricción de relaciones de chat_attachments.
--
-- Las URL firmadas se generarán desde el backend.
-- Se conserva bucket y ruta de almacenamiento.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.chat_global_reply_attachments (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    reply_id UUID NOT NULL,

    uploaded_by_user_id UUID NOT NULL,

    file_name VARCHAR(255) NOT NULL,

    mime_type VARCHAR(150) NOT NULL,

    file_size BIGINT NOT NULL,

    storage_bucket VARCHAR(150) NOT NULL,

    storage_path TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chat_global_reply_attachments_reply_fk
        FOREIGN KEY (reply_id)
        REFERENCES public.chat_global_replies(id)
        ON DELETE CASCADE,

    CONSTRAINT chat_global_reply_attachments_user_fk
        FOREIGN KEY (uploaded_by_user_id)
        REFERENCES public.users(id)
        ON DELETE RESTRICT,

    CONSTRAINT chat_global_reply_attachments_file_size_check
        CHECK (file_size >= 0),

    CONSTRAINT chat_global_reply_attachments_storage_unique
        UNIQUE (storage_bucket, storage_path)

);

-- =========================================================
-- 4. ÍNDICES DE RESPUESTAS
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_chat_global_replies_message_created
ON public.chat_global_replies(
    global_message_id,
    created_at ASC
);

CREATE INDEX IF NOT EXISTS idx_chat_global_replies_author
ON public.chat_global_replies(author_user_id);

-- =========================================================
-- 5. ÍNDICES DE VISITAS
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_chat_global_visits_message_entered
ON public.chat_global_visits(
    global_message_id,
    entered_at ASC
);

CREATE INDEX IF NOT EXISTS idx_chat_global_visits_message_user
ON public.chat_global_visits(
    global_message_id,
    user_id,
    entered_at ASC
);

CREATE INDEX IF NOT EXISTS idx_chat_global_visits_active
ON public.chat_global_visits(
    global_message_id,
    user_id
)
WHERE exited_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_chat_global_visits_stale
ON public.chat_global_visits(last_activity_at)
WHERE exited_at IS NULL;

-- =========================================================
-- 6. ÍNDICES DE ARCHIVOS DE RESPUESTAS
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_chat_global_reply_attachments_reply
ON public.chat_global_reply_attachments(reply_id);

CREATE INDEX IF NOT EXISTS idx_chat_global_reply_attachments_user
ON public.chat_global_reply_attachments(uploaded_by_user_id);

-- =========================================================
-- FIN DE MIGRACIÓN
-- =========================================================

COMMIT;
