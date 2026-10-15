-- ハムとイガグリ: database setup for Supabase.
-- Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.

-- Every shared record is one JSON document in `docs`, addressed by collection + id:
--   courses/<id>   a published course            (anyone signed in may post; only the author or an admin may delete)
--   people/<uid>   one hamster per account       (only that account may write it)
--   board/<id>     operator announcements        (admins only)
--   meta/site      site settings                 (admins only)
create table if not exists public.docs (
  col        text        not null check (col in ('courses', 'people', 'board', 'meta')),
  id         text        not null check (char_length(id) between 1 and 64),
  owner      uuid        not null default auth.uid(),
  data       jsonb       not null check (pg_column_size(data) < 262144),
  updated_at timestamptz not null default now(),
  primary key (col, id)
);

-- Operators. Add yourself with:  insert into public.admins (user_id) values ('<your user id from マイページ>');
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before update on public.docs for each row execute function public.touch_updated_at();

alter table public.docs   enable row level security;
alter table public.admins enable row level security;

drop policy if exists "docs readable by everyone" on public.docs;
create policy "docs readable by everyone" on public.docs for select using (true);

drop policy if exists "docs insert" on public.docs;
create policy "docs insert" on public.docs for insert to authenticated with check (
  owner = auth.uid() and (
    (col = 'courses' and data->>'author' = auth.uid()::text)
    or (col = 'people' and id = auth.uid()::text)
    or (col in ('board', 'meta') and public.is_admin())
  )
);

drop policy if exists "docs update" on public.docs;
create policy "docs update" on public.docs for update to authenticated
  using (
    (col = 'people' and id = auth.uid()::text)
    or (col = 'courses' and owner = auth.uid())
    or (col in ('board', 'meta') and public.is_admin())
  )
  with check (
    owner = auth.uid() or public.is_admin()
  );

drop policy if exists "docs delete" on public.docs;
create policy "docs delete" on public.docs for delete to authenticated using (
  owner = auth.uid() or public.is_admin()
);

drop policy if exists "admins readable by everyone" on public.admins;
create policy "admins readable by everyone" on public.admins for select using (true);

-- live updates for the page
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;
