-- Monthly reset: on the reset day (default the 20th) the carry-over goes back to
-- zero and the 50/day counting starts again from that day.

alter table settings
  add column if not exists reset_day int not null default 20
  check (reset_day between 1 and 28);

-- Most recent reset day on or before d.
create or replace function period_start(d date, reset_day int)
returns date
language sql
immutable
as $$
  select case
    when extract(day from d) >= reset_day
      then make_date(extract(year from d)::int, extract(month from d)::int, reset_day)
    else (date_trunc('month', d) - interval '1 month')::date + (reset_day - 1)
  end;
$$;

-- Same rolling balance as before, but counted from the later of
-- start_date and the current period's reset day.
create or replace function get_balance()
returns json
language sql
stable
as $$
  with s0 as (
    select daily_budget as b, start_date, timezone as tz, reset_day,
           (now() at time zone timezone)::date as today
    from settings where id = 1
  ),
  s as (
    select *, greatest(start_date, period_start(today, reset_day)) as sd,
           (period_start(today, reset_day) + interval '1 month')::date as next_reset
    from s0
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
    'start_date',   s.start_date,
    'period_start', s.sd,
    'next_reset',   s.next_reset,
    'reset_day',    s.reset_day,
    'daily_budget', s.b,
    'carry_in',     s.b * (s.today - s.sd)
                    - coalesce((select sum(amount) from t where d < s.today), 0),
    'spent_today',  coalesce((select sum(amount) from t where d = s.today), 0),
    'left_today',   s.b * (s.today - s.sd + 1)
                    - coalesce((select sum(amount) from t), 0)
  )
  from s;
$$;
