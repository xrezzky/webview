-- ==================================================
-- 12-groups-rls-fix.sql
-- Fix: pastikan grup PRIVATE benar-benar tidak terlihat
-- oleh semua orang (bukan cuma disembunyikan di frontend),
-- dan tambah policy supaya OWNER bisa menghapus grup.
-- Aman dijalankan berkali-kali (idempotent). Tidak
-- menghapus data, hanya mendefinisikan ulang aturan akses.
-- ==================================================

ALTER TABLE public.groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

-- ── groups ──
-- SELECT: cuma boleh lihat baris grup kalau publik, ATAU dia
-- pembuatnya, ATAU dia anggota grup itu. Grup private yang dia
-- BUKAN anggota -> tidak akan pernah muncul di query manapun.
DROP POLICY IF EXISTS groups_select ON public.groups;
CREATE POLICY groups_select ON public.groups
  FOR SELECT
  USING (
    is_public = true
    OR created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = groups.id AND gm.user_id = auth.uid())
  );

DROP POLICY IF EXISTS groups_insert ON public.groups;
CREATE POLICY groups_insert ON public.groups
  FOR INSERT WITH CHECK (created_by = auth.uid());

-- UPDATE: owner/admin grup itu saja.
DROP POLICY IF EXISTS groups_update ON public.groups;
CREATE POLICY groups_update ON public.groups
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = groups.id AND gm.user_id = auth.uid() AND gm.role IN ('owner','admin'))
  );

-- DELETE: HANYA owner grup yang boleh hapus grup.
DROP POLICY IF EXISTS groups_delete ON public.groups;
CREATE POLICY groups_delete ON public.groups
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = groups.id AND gm.user_id = auth.uid() AND gm.role = 'owner')
  );

-- ── group_members ──
-- SELECT: anggota grup itu sendiri, atau siapapun kalau grupnya publik
-- (buat preview jumlah member sebelum join). Member grup PRIVATE yang
-- dia bukan bagiannya -> tidak akan terlihat.
DROP POLICY IF EXISTS group_members_select ON public.group_members;
CREATE POLICY group_members_select ON public.group_members
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.group_members me WHERE me.group_id = group_members.group_id AND me.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = group_members.group_id AND g.is_public = true)
  );

-- DELETE dari group_members: keluar sendiri, atau dikeluarkan owner/admin,
-- ATAU cascade otomatis kalau grupnya dihapus (lihat catatan di bawah).
DROP POLICY IF EXISTS group_members_delete ON public.group_members;
CREATE POLICY group_members_delete ON public.group_members
  FOR DELETE USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.group_members me WHERE me.group_id = group_members.group_id AND me.user_id = auth.uid() AND me.role IN ('owner','admin'))
  );

-- ── group_messages ──
-- Tambahan: izinkan OWNER grup menghapus pesan grup (dibutuhkan supaya
-- proses hapus grup bisa cascade dengan bersih tanpa diblokir RLS).
-- Ini HANYA menambah izin baru, tidak menyentuh policy SELECT/INSERT
-- yang sudah ada dan sudah berjalan normal.
ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS group_messages_delete_by_owner ON public.group_messages;
CREATE POLICY group_messages_delete_by_owner ON public.group_messages
  FOR DELETE USING (
    sender_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = group_messages.group_id AND gm.user_id = auth.uid() AND gm.role = 'owner')
  );

-- ==================================================
-- CATATAN PENTING soal Hapus Grup
-- ==================================================
-- Migration ini TIDAK mengubah struktur foreign key kamu.
-- Supaya "Hapus Grup" beneran bersih (ikut menghapus semua
-- group_members & pesan grup terkait), pastikan foreign key
-- di tabel group_members dan group_messages (atau nama tabel
-- pesan grup kamu) mengarah ke groups(id) dengan ON DELETE CASCADE.
--
-- Cek dengan query ini di SQL Editor:
--
--   SELECT conname, confrelid::regclass, conrelid::regclass
--   FROM pg_constraint
--   WHERE confrelid = 'public.groups'::regclass;
--
-- Kalau hasilnya menunjukkan ada FK TANPA "ON DELETE CASCADE",
-- kirim ke saya nama tabel pesan grup kamu, saya buatkan
-- migration tambahan buat perbaiki itu spesifik.
