-- ==================================================
-- 08-unique-username.sql
-- Upgrade: pastikan username benar-benar unik di level
-- database (bukan hanya cek di aplikasi), menutup celah
-- race condition kalau 2 user daftar bersamaan.
-- Aman dijalankan berkali-kali (idempotent).
-- ==================================================

CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_idx
  ON public.users (username);

-- Catatan:
-- Kalau CREATE UNIQUE INDEX gagal dengan error duplicate
-- key, artinya SUDAH ADA username kembar lama di data kamu.
-- Cek dulu dengan query ini sebelum menjalankan ulang:
--
-- SELECT username, COUNT(*) FROM public.users
-- GROUP BY username HAVING COUNT(*) > 1;
--
-- Ganti/uniq-kan manual data yang bentrok, baru jalankan
-- migration ini lagi.
