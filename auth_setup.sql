-- ==========================================================================
-- PARKPRO.IN | SUPABASE AUTHENTICATION & ROLES SETUP
-- Run this SQL in your Supabase Project SQL Editor to build the 
-- user_roles table and automatic triggers for new signups.
-- ==========================================================================

-- 1. CREATE USER ROLES TABLE
create table public.user_roles (
    user_id uuid references auth.users on delete cascade primary key,
    role text check (role in ('admin', 'user')) default 'user',
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.user_roles enable row level security;

-- Policy: Users can only read their own role
create policy "Users can read own role" on public.user_roles
    for select using (auth.uid() = user_id);



-- 2. CREATE TRIGGER FOR NEW SIGNUPS
-- Automatically inserts a 'user' role whenever a new account is created
create or replace function public.handle_new_user() 
returns trigger as $$
begin
  insert into public.user_roles (user_id, role)
  values (new.id, 'user');
  return new;
end;
$$ language plpgsql security definer;

-- Bind the trigger to auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ==========================================================================
-- INSTRUCTIONS FOR ADMIN ACCESS:
-- After you sign up, go to your Supabase Dashboard -> Table Editor
-- Open the `user_roles` table, find your row, and change 'user' to 'admin'.
-- ==========================================================================
