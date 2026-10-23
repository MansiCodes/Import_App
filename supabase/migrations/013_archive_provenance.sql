-- ============================================================================
-- 013 Archive provenance
--
-- Records which folder in the historical archive a row came from.
--
-- Two reasons this is a column rather than a note. It makes the archive load
-- idempotent: re-running skips what is already there instead of creating a
-- second copy of every import. And it keeps the answer to "where did this come
-- from" attached to the row, which matters for exactly the records nobody
-- entered by hand and nobody remembers.
--
-- Null for anything created in the app. Only the loader sets it.
-- ============================================================================

alter table imports add column if not exists source_folder text;

-- Unique so a second load cannot duplicate an import, but only over rows that
-- actually came from the archive — everything created in the app stays null.
create unique index if not exists imports_source_folder_idx
  on imports (source_folder) where source_folder is not null;

alter table documents add column if not exists source_path text;

create unique index if not exists documents_source_path_idx
  on documents (source_path) where source_path is not null;
