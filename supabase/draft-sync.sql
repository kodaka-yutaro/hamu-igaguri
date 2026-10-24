-- Private work-in-progress courses, separate from the public docs table.
create table public.course_drafts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null check (pg_column_size(data) < 262144),
  version integer not null check (version > 0)
);
alter table public.course_drafts enable row level security;
revoke all on public.course_drafts from public, anon, authenticated;
grant select, insert, update on public.course_drafts to authenticated;
create policy "drafts select own" on public.course_drafts for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "drafts insert own" on public.course_drafts for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "drafts update own" on public.course_drafts for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

