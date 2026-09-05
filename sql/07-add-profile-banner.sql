-- ==================================================
-- 07-add-profile-banner.sql
-- Upgrade: tambah fitur Banner Profil
-- Aman dijalankan berkali-kali (idempotent) & tidak
-- menyentuh/menghapus kolom atau data yang sudah ada.
-- ==================================================

-- 1. Tambah kolom banner_url ke tabel users (nullable,
--    default NULL = pakai default banner di frontend)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS banner_url text;

COMMENT ON COLUMN public.users.banner_url IS
  'URL gambar banner profil (Cloudinary). NULL = pakai default banner XREZZKY Chatroom.';

-- 2. Pastikan RLS existing untuk tabel users tetap berlaku.
--    banner_url ikut policy SELECT/UPDATE yang sudah ada
--    di 04-rls.sql (kolom baru otomatis ikut row policy),
--    jadi TIDAK perlu membuat policy baru.
--    Kolom sensitif seperti email TETAP tidak terpengaruh
--    perubahan ini.

-- 3. (Opsional) Jika kamu punya view/RPC "public_user_profile"
--    yang secara eksplisit menyebutkan daftar kolom (bukan
--    SELECT *), tambahkan "banner_url" ke daftar kolom itu
--    secara manual — cek 05-functions.sql punyamu.
