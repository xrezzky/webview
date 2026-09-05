-- ==================================================
-- 11-status.sql
-- Upgrade: fitur Status/SW (seperti WhatsApp Status).
-- - Hanya terlihat oleh user yang FOLLOW (accepted) ke pembuat status.
-- - Expire 24 jam, dibersihkan otomatis (lihat catatan cleanup di bawah).
-- - RLS didesain supaya proses cleanup TIDAK butuh service-role key:
--   siapapun (anon-key user manapun) boleh SELECT/DELETE baris yang
--   SUDAH expired — baris aktif tetap terlindungi penuh oleh aturan Follow.
-- Aman dijalankan berkali-kali (idempotent).
-- ==================================================

-- 1. TABEL statuses
CREATE TABLE IF NOT EXISTS public.statuses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type             text NOT NULL CHECK (type IN ('photo','video','text')),
  content_url      text,              -- URL Cloudinary (foto/video)
  storage_public_id text,             -- public_id Cloudinary, dipakai buat hapus media saat expired
  text_content     text,              -- isi untuk status teks
  bg_color         text DEFAULT '#1e3a5f',
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS statuses_expires_idx ON public.statuses (expires_at);
CREATE INDEX IF NOT EXISTS statuses_user_idx    ON public.statuses (user_id);

-- 2. TABEL status_views
CREATE TABLE IF NOT EXISTS public.status_views (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id  uuid NOT NULL REFERENCES public.statuses(id) ON DELETE CASCADE,
  viewer_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  viewed_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (status_id, viewer_id)
);
CREATE INDEX IF NOT EXISTS status_views_status_idx ON public.status_views (status_id);
CREATE INDEX IF NOT EXISTS status_views_viewer_idx ON public.status_views (viewer_id);

-- 3. Batas wajar (anti-spam) — maksimal status aktif per user.
--    Dicek juga di frontend, tapi trigger ini jadi jaring pengaman di DB.
CREATE OR REPLACE FUNCTION public.enforce_status_limit()
RETURNS trigger AS $$
BEGIN
  IF (SELECT COUNT(*) FROM public.statuses
      WHERE user_id = NEW.user_id AND expires_at > now()) >= 30 THEN
    RAISE EXCEPTION 'Batas maksimal 30 status aktif tercapai. Tunggu status lama expired dulu.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_status_limit ON public.statuses;
CREATE TRIGGER trg_enforce_status_limit
  BEFORE INSERT ON public.statuses
  FOR EACH ROW EXECUTE FUNCTION public.enforce_status_limit();

-- ==================================================
-- RLS
-- ==================================================
ALTER TABLE public.statuses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_views ENABLE ROW LEVEL SECURITY;

-- SELECT: pemilik sendiri, ATAU follower (accepted) selama belum expired,
-- ATAU baris yang SUDAH expired (dibutuhkan proses cleanup — lihat catatan di atas).
DROP POLICY IF EXISTS statuses_select ON public.statuses;
CREATE POLICY statuses_select ON public.statuses
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR expires_at <= now()
    OR EXISTS (
      SELECT 1 FROM public.follows f
      WHERE f.sender_id = auth.uid() AND f.receiver_id = statuses.user_id AND f.status = 'accepted'
    )
  );

DROP POLICY IF EXISTS statuses_insert ON public.statuses;
CREATE POLICY statuses_insert ON public.statuses
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- DELETE: pemilik boleh hapus statusnya sendiri kapan saja,
-- SIAPAPUN boleh hapus baris yang SUDAH expired (buat proses cleanup client-side,
-- tanpa perlu service-role key — aman karena baris aktif tidak kena aturan ini).
DROP POLICY IF EXISTS statuses_delete ON public.statuses;
CREATE POLICY statuses_delete ON public.statuses
  FOR DELETE USING (user_id = auth.uid() OR expires_at <= now());

-- status_views
DROP POLICY IF EXISTS status_views_select ON public.status_views;
CREATE POLICY status_views_select ON public.status_views
  FOR SELECT USING (
    viewer_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.statuses s WHERE s.id = status_views.status_id AND s.user_id = auth.uid())
  );

-- INSERT view: hanya boleh kalau status masih aktif DAN viewer berhak lihat
-- (pemilik sendiri ATAU follower accepted).
DROP POLICY IF EXISTS status_views_insert ON public.status_views;
CREATE POLICY status_views_insert ON public.status_views
  FOR INSERT WITH CHECK (
    viewer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.statuses s
      WHERE s.id = status_views.status_id
        AND s.expires_at > now()
        AND (
          s.user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.follows f WHERE f.sender_id = auth.uid() AND f.receiver_id = s.user_id AND f.status = 'accepted')
        )
    )
  );

DROP POLICY IF EXISTS status_views_delete ON public.status_views;
CREATE POLICY status_views_delete ON public.status_views
  FOR DELETE USING (
    viewer_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.statuses s WHERE s.id = status_views.status_id AND (s.user_id = auth.uid() OR s.expires_at <= now()))
  );

-- Realtime (buat indikator "Status baru" tanpa refresh)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='statuses') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.statuses;
  END IF;
END $$;

-- ==================================================
-- CATATAN CLEANUP (baca ini!)
-- ==================================================
-- Migration ini TIDAK bergantung pada pg_cron/edge function supaya
-- dijamin langsung jalan begitu di-deploy (nggak semua paket Supabase/
-- Vercel gratis punya cron yang fleksibel).
--
-- Cleanup dijalankan OPPORTUNISTIK dari sisi client (lihat js/status.js
-- fungsi cleanupExpiredStatuses()) — dipanggil otomatis setiap kali ada
-- user yang buka tab Status, dengan throttle 5 menit sekali per browser.
-- Karena RLS di atas mengizinkan siapapun menghapus baris yang SUDAH
-- expired, proses ini aman dijalankan pakai anon key biasa (tidak perlu
-- service-role key yang riskan kalau bocor).
--
-- Kalau kamu mau lapisan tambahan (misal traffic app sepi banget),
-- kamu BISA opsional tambahkan pg_cron di Supabase:
--
--   SELECT cron.schedule(
--     'cleanup-expired-statuses',
--     '*/10 * * * *',
--     $$DELETE FROM public.statuses WHERE expires_at <= now()$$
--   );
--
-- (aktifkan dulu extension pg_cron: Database → Extensions → pg_cron)
-- Ini akan bersihkan baris DB, tapi TIDAK menghapus file di Cloudinary
-- (itu perlu panggilan API Cloudinary dari server — sudah dihandle
-- endpoint api/cleanup-status.js yang dipanggil dari client).
