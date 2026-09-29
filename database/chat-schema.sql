-- =========================================================
-- MACHINE CONTROL SYSTEM
-- CHAT DATABASE SCHEMA
-- =========================================================
--
-- Este archivo crea únicamente las tablas del sistema CHAT.
--
-- NO modifica:
--   public.users
--   public.user_profiles
--
-- Las tablas del Chat utilizan public.users.id como
-- identidad principal del operador.
-- =========================================================


-- =========================================================
-- 1. TEMAS DEL CHAT GLOBAL
-- =========================================================

CREATE TABLE IF NOT EXISTS public.chat_topics (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    author_user_id UUID NOT NULL,

    title VARCHAR(200) NOT NULL,

    description TEXT NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'OPEN',

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chat_topics_author_fk
        FOREIGN KEY (author_user_id)
        REFERENCES public.users(id)
        ON DELETE CASCADE,

    CONSTRAINT chat_topics_status_check
        CHECK (status IN ('OPEN', 'CLOSED')),

    CONSTRAINT chat_topics_title_check
        CHECK (length(trim(title)) >= 3),

    CONSTRAINT chat_topics_description_check
        CHECK (length(trim(description)) > 0)

);


-- =========================================================
-- 2. COMENTARIOS DE LOS TEMAS
-- =========================================================
--
-- El comentario puede contener:
--
--   texto
--   archivo
--   texto + archivo
--
-- La validación de que exista al menos uno de ellos
-- se realizará desde el backend, porque el archivo se
-- registra en chat_attachments después de crear el comentario.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.chat_topic_comments (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    topic_id UUID NOT NULL,

    author_user_id UUID NOT NULL,

    text TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chat_topic_comments_topic_fk
        FOREIGN KEY (topic_id)
        REFERENCES public.chat_topics(id)
        ON DELETE CASCADE,

    CONSTRAINT chat_topic_comments_author_fk
        FOREIGN KEY (author_user_id)
        REFERENCES public.users(id)
        ON DELETE CASCADE

);


-- =========================================================
-- 3. MENSAJES DEL CANAL GLOBAL
-- =========================================================
--
-- text puede ser NULL porque el mensaje puede contener
-- únicamente un archivo adjunto.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.chat_global_messages (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    author_user_id UUID NOT NULL,

    text TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chat_global_messages_author_fk
        FOREIGN KEY (author_user_id)
        REFERENCES public.users(id)
        ON DELETE CASCADE

);


-- =========================================================
-- 4. CONVERSACIONES PRIVADAS
-- =========================================================

CREATE TABLE IF NOT EXISTS public.chat_private_conversations (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

);


-- =========================================================
-- 5. MIEMBROS DE CONVERSACIONES PRIVADAS
-- =========================================================

CREATE TABLE IF NOT EXISTS public.chat_private_members (

    conversation_id UUID NOT NULL,

    user_id UUID NOT NULL,

    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (
        conversation_id,
        user_id
    ),

    CONSTRAINT chat_private_members_conversation_fk
        FOREIGN KEY (conversation_id)
        REFERENCES public.chat_private_conversations(id)
        ON DELETE CASCADE,

    CONSTRAINT chat_private_members_user_fk
        FOREIGN KEY (user_id)
        REFERENCES public.users(id)
        ON DELETE CASCADE

);


-- =========================================================
-- 6. MENSAJES PRIVADOS
-- =========================================================
--
-- text puede ser NULL porque el mensaje puede contener
-- únicamente un archivo adjunto.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.chat_private_messages (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    conversation_id UUID NOT NULL,

    author_user_id UUID NOT NULL,

    text TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chat_private_messages_conversation_fk
        FOREIGN KEY (conversation_id)
        REFERENCES public.chat_private_conversations(id)
        ON DELETE CASCADE,

    CONSTRAINT chat_private_messages_author_fk
        FOREIGN KEY (author_user_id)
        REFERENCES public.users(id)
        ON DELETE CASCADE

);


-- =========================================================
-- 7. GRUPOS
-- =========================================================

CREATE TABLE IF NOT EXISTS public.chat_groups (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name VARCHAR(150) NOT NULL,

    created_by_user_id UUID NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chat_groups_creator_fk
        FOREIGN KEY (created_by_user_id)
        REFERENCES public.users(id)
        ON DELETE CASCADE,

    CONSTRAINT chat_groups_name_check
        CHECK (length(trim(name)) >= 2)

);


-- =========================================================
-- 8. MIEMBROS DE GRUPOS
-- =========================================================

CREATE TABLE IF NOT EXISTS public.chat_group_members (

    group_id UUID NOT NULL,

    user_id UUID NOT NULL,

    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (
        group_id,
        user_id
    ),

    CONSTRAINT chat_group_members_group_fk
        FOREIGN KEY (group_id)
        REFERENCES public.chat_groups(id)
        ON DELETE CASCADE,

    CONSTRAINT chat_group_members_user_fk
        FOREIGN KEY (user_id)
        REFERENCES public.users(id)
        ON DELETE CASCADE

);


-- =========================================================
-- 9. MENSAJES DE GRUPOS
-- =========================================================
--
-- text puede ser NULL porque el mensaje puede contener
-- únicamente un archivo adjunto.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.chat_group_messages (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    group_id UUID NOT NULL,

    author_user_id UUID NOT NULL,

    text TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chat_group_messages_group_fk
        FOREIGN KEY (group_id)
        REFERENCES public.chat_groups(id)
        ON DELETE CASCADE,

    CONSTRAINT chat_group_messages_author_fk
        FOREIGN KEY (author_user_id)
        REFERENCES public.users(id)
        ON DELETE CASCADE

);


-- =========================================================
-- 10. ARCHIVOS / ADJUNTOS
-- =========================================================
--
-- Cada archivo pertenece a UN SOLO elemento del Chat:
--
--   topic
--   comentario
--   mensaje global
--   mensaje privado
--   mensaje de grupo
--
-- Esto permite recuperar correctamente los archivos
-- después de cerrar Chrome o actualizar la página.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.chat_attachments (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    uploaded_by_user_id UUID NOT NULL,

    file_name VARCHAR(255) NOT NULL,

    mime_type VARCHAR(150) NOT NULL,

    file_size BIGINT NOT NULL,

    storage_bucket VARCHAR(150) NOT NULL,

    storage_path TEXT NOT NULL,

    public_url TEXT NOT NULL,

    topic_id UUID NULL,

    topic_comment_id UUID NULL,

    global_message_id UUID NULL,

    private_message_id UUID NULL,

    group_message_id UUID NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chat_attachments_user_fk
        FOREIGN KEY (uploaded_by_user_id)
        REFERENCES public.users(id)
        ON DELETE CASCADE,

    CONSTRAINT chat_attachments_topic_fk
        FOREIGN KEY (topic_id)
        REFERENCES public.chat_topics(id)
        ON DELETE CASCADE,

    CONSTRAINT chat_attachments_topic_comment_fk
        FOREIGN KEY (topic_comment_id)
        REFERENCES public.chat_topic_comments(id)
        ON DELETE CASCADE,

    CONSTRAINT chat_attachments_global_message_fk
        FOREIGN KEY (global_message_id)
        REFERENCES public.chat_global_messages(id)
        ON DELETE CASCADE,

    CONSTRAINT chat_attachments_private_message_fk
        FOREIGN KEY (private_message_id)
        REFERENCES public.chat_private_messages(id)
        ON DELETE CASCADE,

    CONSTRAINT chat_attachments_group_message_fk
        FOREIGN KEY (group_message_id)
        REFERENCES public.chat_group_messages(id)
        ON DELETE CASCADE,

    CONSTRAINT chat_attachments_file_size_check
        CHECK (file_size >= 0),

    CONSTRAINT chat_attachments_single_parent_check
        CHECK (
            (
                CASE WHEN topic_id IS NOT NULL THEN 1 ELSE 0 END
                +
                CASE WHEN topic_comment_id IS NOT NULL THEN 1 ELSE 0 END
                +
                CASE WHEN global_message_id IS NOT NULL THEN 1 ELSE 0 END
                +
                CASE WHEN private_message_id IS NOT NULL THEN 1 ELSE 0 END
                +
                CASE WHEN group_message_id IS NOT NULL THEN 1 ELSE 0 END
            ) = 1
        )

);


-- =========================================================
-- ÍNDICES
-- =========================================================


-- ---------------------------------------------------------
-- TEMAS
-- ---------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_chat_topics_author
ON public.chat_topics(author_user_id);

CREATE INDEX IF NOT EXISTS idx_chat_topics_created
ON public.chat_topics(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_topics_status
ON public.chat_topics(status);


-- ---------------------------------------------------------
-- COMENTARIOS
-- ---------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_chat_topic_comments_topic
ON public.chat_topic_comments(topic_id);

CREATE INDEX IF NOT EXISTS idx_chat_topic_comments_author
ON public.chat_topic_comments(author_user_id);

CREATE INDEX IF NOT EXISTS idx_chat_topic_comments_created
ON public.chat_topic_comments(created_at);


-- ---------------------------------------------------------
-- MENSAJES GLOBALES
-- ---------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_chat_global_messages_author
ON public.chat_global_messages(author_user_id);

CREATE INDEX IF NOT EXISTS idx_chat_global_messages_created
ON public.chat_global_messages(created_at DESC);


-- ---------------------------------------------------------
-- CONVERSACIONES PRIVADAS
-- ---------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_chat_private_members_user
ON public.chat_private_members(user_id);

CREATE INDEX IF NOT EXISTS idx_chat_private_messages_conversation
ON public.chat_private_messages(conversation_id);

CREATE INDEX IF NOT EXISTS idx_chat_private_messages_author
ON public.chat_private_messages(author_user_id);

CREATE INDEX IF NOT EXISTS idx_chat_private_messages_created
ON public.chat_private_messages(created_at DESC);


-- ---------------------------------------------------------
-- GRUPOS
-- ---------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_chat_groups_creator
ON public.chat_groups(created_by_user_id);

CREATE INDEX IF NOT EXISTS idx_chat_groups_created
ON public.chat_groups(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_group_members_user
ON public.chat_group_members(user_id);

CREATE INDEX IF NOT EXISTS idx_chat_group_messages_group
ON public.chat_group_messages(group_id);

CREATE INDEX IF NOT EXISTS idx_chat_group_messages_author
ON public.chat_group_messages(author_user_id);

CREATE INDEX IF NOT EXISTS idx_chat_group_messages_created
ON public.chat_group_messages(created_at DESC);


-- ---------------------------------------------------------
-- ARCHIVOS
-- ---------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_chat_attachments_user
ON public.chat_attachments(uploaded_by_user_id);

CREATE INDEX IF NOT EXISTS idx_chat_attachments_topic
ON public.chat_attachments(topic_id);

CREATE INDEX IF NOT EXISTS idx_chat_attachments_topic_comment
ON public.chat_attachments(topic_comment_id);

CREATE INDEX IF NOT EXISTS idx_chat_attachments_global_message
ON public.chat_attachments(global_message_id);

CREATE INDEX IF NOT EXISTS idx_chat_attachments_private_message
ON public.chat_attachments(private_message_id);

CREATE INDEX IF NOT EXISTS idx_chat_attachments_group_message
ON public.chat_attachments(group_message_id);

CREATE INDEX IF NOT EXISTS idx_chat_attachments_created
ON public.chat_attachments(created_at DESC);


-- =========================================================
-- FIN DEL ESQUEMA
-- =========================================================