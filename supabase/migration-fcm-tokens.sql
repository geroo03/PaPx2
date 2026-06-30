-- Tabla para suscripciones Web Push (push notifications)
-- Cada fila es una suscripción de un dispositivo/navegador de un usuario.

CREATE TABLE IF NOT EXISTS public.fcm_tokens (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token      TEXT        NOT NULL,
  rol        TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(token)
);

ALTER TABLE public.fcm_tokens ENABLE ROW LEVEL SECURITY;

-- Cada usuario gestiona solo sus propios tokens
CREATE POLICY "fcm_tokens_select_own"
  ON public.fcm_tokens FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "fcm_tokens_insert_own"
  ON public.fcm_tokens FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "fcm_tokens_update_own"
  ON public.fcm_tokens FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "fcm_tokens_delete_own"
  ON public.fcm_tokens FOR DELETE
  USING (user_id = auth.uid());
