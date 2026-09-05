-- ==================================================
-- 09-group-invites.sql
-- Upgrade: sistem Undangan Grup (private by default,
-- masuk grup harus lewat undangan — sesuai spec).
-- Aman dijalankan berkali-kali (idempotent), tidak
-- mengubah/menghapus fitur grup yang sudah ada.
-- ==================================================

-- 1. TABEL group_invites
CREATE TABLE IF NOT EXISTS public.group_invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  sender_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  receiver_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);

-- Satu user hanya boleh punya satu baris undangan aktif per grup.
-- Undangan baru ke user yang sama akan UPDATE baris lama (upsert),
-- jadi kalau sebelumnya ditolak, bisa diundang ulang.
CREATE UNIQUE INDEX IF NOT EXISTS group_invites_group_receiver_uidx
  ON public.group_invites (group_id, receiver_id);

CREATE INDEX IF NOT EXISTS group_invites_receiver_idx ON public.group_invites (receiver_id);
CREATE INDEX IF NOT EXISTS group_invites_group_idx    ON public.group_invites (group_id);

-- 2. RLS
ALTER TABLE public.group_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS group_invites_select ON public.group_invites;
CREATE POLICY group_invites_select ON public.group_invites
  FOR SELECT
  USING (
    auth.uid() = receiver_id
    OR auth.uid() = sender_id
    OR EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = group_invites.group_id
        AND gm.user_id = auth.uid()
        AND gm.role IN ('owner','admin')
    )
  );

-- Hanya owner/admin grup yang boleh mengirim undangan.
DROP POLICY IF EXISTS group_invites_insert ON public.group_invites;
CREATE POLICY group_invites_insert ON public.group_invites
  FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = group_invites.group_id
        AND gm.user_id = auth.uid()
        AND gm.role IN ('owner','admin')
    )
  );

-- Penerima boleh update statusnya sendiri (terima/tolak).
-- Owner/admin pengirim boleh membatalkan (tetap lewat UPDATE, bukan hapus data user lain).
DROP POLICY IF EXISTS group_invites_update ON public.group_invites;
CREATE POLICY group_invites_update ON public.group_invites
  FOR UPDATE
  USING (
    auth.uid() = receiver_id
    OR EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = group_invites.group_id
        AND gm.user_id = auth.uid()
        AND gm.role IN ('owner','admin')
    )
  );

DROP POLICY IF EXISTS group_invites_delete ON public.group_invites;
CREATE POLICY group_invites_delete ON public.group_invites
  FOR DELETE
  USING (
    auth.uid() = receiver_id
    OR EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = group_invites.group_id
        AND gm.user_id = auth.uid()
        AND gm.role IN ('owner','admin')
    )
  );

-- 3. Realtime (biar badge undangan update live tanpa refresh)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'group_invites'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_invites;
  END IF;
END $$;
