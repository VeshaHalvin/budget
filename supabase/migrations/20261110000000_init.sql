-- Daily budget tracker schema.
-- All tables have RLS on with no policies, so only the edge functions
-- (which use the service role key) can read or write them.

create table settings (
  id int primary key default 1 check (id = 1),
  daily_budget numeric(12,2) not null default 50,
  start_date date not null default (now() at time zone 'Asia/Shanghai')::date,
  timezone text not null default 'Asia/Shanghai'
);
insert into settings default values;

create table transactions (
  id bigserial primary key,
  gmail_id text unique,                 -- null for manual entries
  occurred_at timestamptz not null,
  merchant text not null,
  amount numeric(12,2) not null,        -- negative = refund
  currency text not null default 'CNY',
  source text not null check (source in ('email', 'manual')),
  excluded boolean not null default false, -- true = big purchase, not counted
  note text,
  created_at timestamptz not null default now()
);
create index on transactions (occurred_at desc);

-- Every BCA email we've looked at, so we never process one twice
-- (including emails that weren't transactions).
create table seen_emails (
  gmail_id text primary key,
  parsed boolean not null,
  seen_at timestamptz not null default now()
);

alter table settings enable row level security;
alter table transactions enable row level security;
alter table seen_emails enable row level security;

-- Rolling balance:
--   left_today = daily_budget * (days since start, including today) - everything spent
-- Unspent money rolls forward; overspending comes out of later days.
-- Only CNY, non-excluded transactions count.
create or replace function get_balance()
returns json
language sql
stable
as $$
  with s as (
    select daily_budget as b, start_date as sd, timezone as tz,
           (now() at time zone timezone)::date as today
    from settings where id = 1
  ),
  t as (
    select (tr.occurred_at at time zone s.tz)::date as d, tr.amount
    from transactions tr, s
    where not tr.excluded
      and tr.currency = 'CNY'
      and (tr.occurred_at at time zone s.tz)::date between s.sd and s.today
  )
  select json_build_object(
    'today',        s.today,
    'start_date',   s.sd,
    'daily_budget', s.b,
    'carry_in',     s.b * (s.today - s.sd)
                    - coalesce((select sum(amount) from t where d < s.today), 0),
    'spent_today',  coalesce((select sum(amount) from t where d = s.today), 0),
    'left_today',   s.b * (s.today - s.sd + 1)
                    - coalesce((select sum(amount) from t), 0)
  )
  from s;
$$;
