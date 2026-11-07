-- Warden's choice of how many cleaners to call each morning: 0 = automatic, 1 or 2.
alter table cleaning_schedules add column if not exists cleaner_count integer not null default 0;
