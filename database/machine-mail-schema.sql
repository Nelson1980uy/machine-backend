
-- =========================================================
-- MACHINE CONTROL SYSTEM
-- INTERNAL MAIL DATABASE SCHEMA
-- =========================================================
-- Independiente del sistema CHAT.
-- No modifica public.users ni las tablas del chat.
-- =========================================================

BEGIN;

-- ---------------------------------------------------------
-- 1. MENSAJES INTERNOS
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.machine_mail_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    sender_user_id UUID NOT NULL,
    subject VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT machine_mail_sender_fk
        FOREIGN KEY (sender_user_id)
        REFERENCES public.users(id)
        ON DELETE CASCADE,

    CONSTRAINT machine_mail_subject_check
        CHECK (length(trim(subject)) BETWEEN 1 AND 200),

    CONSTRAINT machine_mail_body_check
        CHECK (length(trim(body)) > 0)
);

-- ---------------------------------------------------------
-- 2. DESTINATARIOS Y ESTADO DE CADA MENSAJE
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.machine_mail_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    message_id UUID NOT NULL,
    recipient_user_id UUID NOT NULL,

    read_at TIMESTAMPTZ NULL,
    deleted_at TIMESTAMPTZ NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT machine_mail_recipient_message_fk
        FOREIGN KEY (message_id)
        REFERENCES public.machine_mail_messages(id)
        ON DELETE CASCADE,

    CONSTRAINT machine_mail_recipient_user_fk
        FOREIGN KEY (recipient_user_id)
        REFERENCES public.users(id)
        ON DELETE CASCADE,

    CONSTRAINT machine_mail_unique_recipient
        UNIQUE (message_id, recipient_user_id)
);

-- ---------------------------------------------------------
-- 3. ÍNDICES PARA LAS BANDEJAS
-- ---------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_machine_mail_sender_date
    ON public.machine_mail_messages
    (sender_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_machine_mail_recipient_date
    ON public.machine_mail_recipients
    (recipient_user_id, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_machine_mail_unread
    ON public.machine_mail_recipients
    (recipient_user_id, created_at DESC)
    WHERE read_at IS NULL AND deleted_at IS NULL;

COMMIT;

-- =========================================================
-- FIN DEL ESQUEMA
-- =========================================================
