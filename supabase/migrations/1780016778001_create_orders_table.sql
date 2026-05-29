CREATE TABLE public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id VARCHAR(255) NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    amount VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending'
);

-- Row Level Security
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts (from checkout)
CREATE POLICY "Allow anonymous inserts" ON public.orders
FOR INSERT TO anon
WITH CHECK (true);

-- Allow authenticated users to read and update
CREATE POLICY "Allow authenticated select" ON public.orders
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Allow authenticated update" ON public.orders
FOR UPDATE TO authenticated
USING (true);

CREATE POLICY "Allow authenticated delete" ON public.orders
FOR DELETE TO authenticated
USING (true);
