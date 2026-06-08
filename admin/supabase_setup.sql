-- ==========================================================================
-- PARKPRO.IN | SUPABASE SCHEMATIC BLUEPRINTS
-- Run this SQL in your Supabase Project SQL Editor to build and enable
-- all real-time tables, seed pricing rates, and activate WebSockets sync!
-- ==========================================================================

-- 1. CLEAN UP PREVIOUS TABLES (If rebuilding)
drop table if exists public.parking_slots cascade;
drop table if exists public.parking_transactions cascade;
drop table if exists public.parking_rates cascade;

-- 2. CREATE PRICING RATES TABLE
create table public.parking_rates (
    type text primary key, -- 'Car' or 'Bike'
    hourly_rate numeric not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS & create Public Read/Write Access Policies
alter table public.parking_rates enable row level security;
create policy "Allow public access to parking_rates" on public.parking_rates for all using (true);

-- Seed Pricing defaults (INR Rates)
insert into public.parking_rates (type, hourly_rate) values 
('Car', 50), 
('Bike', 20);


-- 3. CREATE COMPLETED TRANSACTIONS TABLE
create table public.parking_transactions (
    receipt_id text primary key, -- e.g. 'PP-2026-1024'
    plate text not null,
    type text not null,
    floor text not null,
    slot_number text not null,
    duration text not null,
    amount_paid numeric not null,
    payment_method text not null,
    check_out_time timestamp with time zone not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.parking_transactions enable row level security;
create policy "Allow public access to parking_transactions" on public.parking_transactions for all using (true);


-- 4. CREATE PARKING SLOTS TABLE (Interactive Sensor Array)
create table public.parking_slots (
    id text primary key, -- e.g. '1-C01' (Floor 1 - Car 01)
    floor text not null, -- e.g. '1'
    number text not null, -- e.g. 'C01'
    type text not null, -- 'Car' or 'Bike'
    status text not null default 'Available', -- 'Available', 'Occupied', 'Reserved'
    vehicle jsonb, -- Stores vehicle details if status is Occupied: { "plate": "...", "type": "...", "checkInTime": "..." }
    reservation jsonb, -- Stores reservation details if status is Reserved: { "plate": "...", "name": "..." }
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.parking_slots enable row level security;
create policy "Allow public access to parking_slots" on public.parking_slots for all using (true);


-- 5. ENABLE REALTIME BROADCAST CHANNELS
-- This triggers Supabase Realtime to publish postgres changes via WebSockets instantly!
-- We wrap this in a safe DO block to ignore duplicate exceptions if run multiple times.
do $$
begin
  begin
    alter publication supabase_realtime add table public.parking_slots;
  exception when others then
    -- Table is already in publication or publication not initialized yet
  end;

  begin
    alter publication supabase_realtime add table public.parking_transactions;
  exception when others then
    -- Table is already in publication
  end;

  begin
    alter publication supabase_realtime add table public.parking_rates;
  exception when others then
    -- Table is already in publication
  end;
end $$;
