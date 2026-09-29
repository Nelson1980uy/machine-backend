-- =========================================================
-- MACHINE · SITIO OFICIAL
-- COMUNIDAD + SOPORTE
-- =========================================================

CREATE TABLE IF NOT EXISTS public.site_comments (
    id BIGSERIAL PRIMARY KEY,

    name VARCHAR(120) NOT NULL,

    email VARCHAR(254) NOT NULL,

    message TEXT NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (
            status IN (
                'pending',
                'approved',
                'rejected'
            )
        ),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    moderated_at TIMESTAMPTZ,

    moderation_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_site_comments_status
    ON public.site_comments(status);

CREATE INDEX IF NOT EXISTS idx_site_comments_created_at
    ON public.site_comments(created_at DESC);


CREATE TABLE IF NOT EXISTS public.site_support_requests (
    id BIGSERIAL PRIMARY KEY,

    name VARCHAR(120) NOT NULL,

    email VARCHAR(254) NOT NULL,

    subject VARCHAR(180) NOT NULL,

    message TEXT NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'open'
        CHECK (
            status IN (
                'open',
                'in_progress',
                'answered',
                'closed'
            )
        ),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_support_status
    ON public.site_support_requests(status);

CREATE INDEX IF NOT EXISTS idx_site_support_created_at
    ON public.site_support_requests(created_at DESC);
