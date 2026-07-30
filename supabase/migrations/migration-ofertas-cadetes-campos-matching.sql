-- ============================================================
-- Campos nuevos en ofertas_cadetes para el matching automático.
-- Fecha: 2026-07-30
-- Idempotente — se puede re-ejecutar sin daño.
--
-- oferta_timeout_seg: se congela por oferta (mismo patrón que
-- ganancia_estimada/pago_cadete, ya congelados hoy) para que el cadete arme
-- su cuenta regresiva sin pegarle a un endpoint de configuración aparte.
-- clima_aplicado: para poder mostrarle al cadete un badge "aplicado por
-- clima" en esa oferta puntual.
-- score_ranking: solo observabilidad/debug — por qué se eligió este cadete.
-- ============================================================

ALTER TABLE public.ofertas_cadetes ADD COLUMN IF NOT EXISTS oferta_timeout_seg int4;
ALTER TABLE public.ofertas_cadetes ADD COLUMN IF NOT EXISTS clima_aplicado     bool NOT NULL DEFAULT false;
ALTER TABLE public.ofertas_cadetes ADD COLUMN IF NOT EXISTS score_ranking      numeric;
