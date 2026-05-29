ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_email TEXT,
  ADD COLUMN IF NOT EXISTS customer_phone TEXT,
  ADD COLUMN IF NOT EXISTS customer_cpf TEXT,
  ADD COLUMN IF NOT EXISTS customer_address TEXT,
  ADD COLUMN IF NOT EXISTS traffic_source TEXT,
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS payment_id TEXT,
  ADD COLUMN IF NOT EXISTS pix_payload TEXT,
  ADD COLUMN IF NOT EXISTS pix_qr_code TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

UPDATE public.orders
SET created_at = COALESCE(created_at, date, NOW())
WHERE created_at IS NULL;

ALTER TABLE public.orders
  ALTER COLUMN status SET DEFAULT 'pending';

UPDATE public.orders
SET status = CASE status
  WHEN 'Aprovado' THEN 'approved'
  WHEN 'Pendente' THEN 'pending'
  WHEN 'Cancelado' THEN 'declined'
  ELSE status
END;

CREATE TABLE IF NOT EXISTS public.payment_gateways (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  api_url TEXT DEFAULT '',
  public_key TEXT DEFAULT '',
  secret_key TEXT DEFAULT '',
  webhook_url TEXT DEFAULT '',
  logo_url TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT FALSE,
  auto_approve BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.payment_gateways ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages payment gateways" ON public.payment_gateways;
CREATE POLICY "Service role manages payment gateways" ON public.payment_gateways
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

INSERT INTO public.payment_gateways (id, display_name, api_url, public_key, secret_key, webhook_url, logo_url, is_active, auto_approve)
VALUES
  ('primecash', 'PrimeCash', '', '', '', '', '', false, true),
  ('manualpix', 'Pix Manual', '', '', '', '', '', false, true),
  ('mercadopago', 'Mercado Pago', 'https://api.mercadopago.com/v1/payments', '', '', '', '', false, true),
  ('westpay', 'WestPay', 'https://painel.westpay.com.br/api/v1/transactions', '', '', '', '', true, true)
ON CONFLICT (id) DO NOTHING;

UPDATE public.payment_gateways
SET is_active = (id = 'westpay')
WHERE id IN ('primecash', 'manualpix', 'mercadopago', 'westpay');

CREATE TABLE IF NOT EXISTS public.tracking_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  tiktok_pixel_id TEXT DEFAULT '',
  tiktok_access_token TEXT DEFAULT '',
  facebook_pixel_id TEXT DEFAULT '',
  google_analytics_id TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.tracking_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages tracking settings" ON public.tracking_settings;
CREATE POLICY "Service role manages tracking settings" ON public.tracking_settings
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

INSERT INTO public.tracking_settings (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;
