-- ==================================================
-- 10-communities.sql
-- Upgrade: sistem Komunitas (private secara default,
-- public opsional dengan join langsung, private via
-- undangan — sesuai spec). Mirror pola Grup yang sudah
-- ada supaya konsisten & aman.
-- Aman dijalankan berkali-kali (idempotent), tidak
-- menyentuh tabel groups/group_* yang sudah ada.
-- ==================================================

-- 1. TABEL communities
CREATE TABLE IF NOT EXISTS public.communities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  avatar_url  text,
  is_public   boolean NOT NULL DEFAULT false,
  created_by  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 2. TABEL community_members
CREATE TABLE IF NOT EXISTS public.community_members (
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role         text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);
CREATE INDEX IF NOT EXISTS community_members_user_idx ON public.community_members (user_id);

-- 3. TABEL community_invites (mirror group_invites)
CREATE TABLE IF NOT EXISTS public.community_invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  sender_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  receiver_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS community_invites_uidx ON public.community_invites (community_id, receiver_id);
CREATE INDEX IF NOT EXISTS community_invites_receiver_idx ON public.community_invites (receiver_id);
CREATE INDEX IF NOT EXISTS community_invites_community_idx ON public.community_invites (community_id);

-- ==================================================
-- RLS
-- ==================================================
ALTER TABLE public.communities       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_invites ENABLE ROW LEVEL SECURITY;

-- communities: publik bisa dilihat semua orang, private cuma member/creator
DROP POLICY IF EXISTS communities_select ON public.communities;
CREATE POLICY communities_select ON public.communities
  FOR SELECT
  USING (
    is_public = true
    OR created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.community_members cm WHERE cm.community_id = communities.id AND cm.user_id = auth.uid())
  );

DROP POLICY IF EXISTS communities_insert ON public.communities;
CREATE POLICY communities_insert ON public.communities
  FOR INSERT WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS communities_update ON public.communities;
CREATE POLICY communities_update ON public.communities
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.community_members cm WHERE cm.community_id = communities.id AND cm.user_id = auth.uid() AND cm.role IN ('owner','admin'))
  );

DROP POLICY IF EXISTS communities_delete ON public.communities;
CREATE POLICY communities_delete ON public.communities
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.community_members cm WHERE cm.community_id = communities.id AND cm.user_id = auth.uid() AND cm.role = 'owner')
  );

-- community_members
DROP POLICY IF EXISTS community_members_select ON public.community_members;
CREATE POLICY community_members_select ON public.community_members
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.community_members me WHERE me.community_id = community_members.community_id AND me.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.communities c WHERE c.id = community_members.community_id AND c.is_public = true)
  );

-- Insert diri sendiri: boleh kalau komunitas public, ATAU kalau creator (owner pertama),
-- ATAU kalau punya undangan yang sudah diterima.
DROP POLICY IF EXISTS community_members_insert ON public.community_members;
CREATE POLICY community_members_insert ON public.community_members
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND (
      EXISTS (SELECT 1 FROM public.communities c WHERE c.id = community_members.community_id AND (c.is_public = true OR c.created_by = auth.uid()))
      OR EXISTS (SELECT 1 FROM public.community_invites ci WHERE ci.community_id = community_members.community_id AND ci.receiver_id = auth.uid() AND ci.status = 'accepted')
    )
  );

-- Keluar sendiri, atau dikeluarkan owner/admin
DROP POLICY IF EXISTS community_members_delete ON public.community_members;
CREATE POLICY community_members_delete ON public.community_members
  FOR DELETE USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.community_members me WHERE me.community_id = community_members.community_id AND me.user_id = auth.uid() AND me.role IN ('owner','admin'))
  );

-- community_invites (persis pola group_invites)
DROP POLICY IF EXISTS community_invites_select ON public.community_invites;
CREATE POLICY community_invites_select ON public.community_invites
  FOR SELECT USING (
    auth.uid() = receiver_id
    OR auth.uid() = sender_id
    OR EXISTS (SELECT 1 FROM public.community_members cm WHERE cm.community_id = community_invites.community_id AND cm.user_id = auth.uid() AND cm.role IN ('owner','admin'))
  );

DROP POLICY IF EXISTS community_invites_insert ON public.community_invites;
CREATE POLICY community_invites_insert ON public.community_invites
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (SELECT 1 FROM public.community_members cm WHERE cm.community_id = community_invites.community_id AND cm.user_id = auth.uid() AND cm.role IN ('owner','admin'))
  );

DROP POLICY IF EXISTS community_invites_update ON public.community_invites;
CREATE POLICY community_invites_update ON public.community_invites
  FOR UPDATE USING (
    auth.uid() = receiver_id
    OR EXISTS (SELECT 1 FROM public.community_members cm WHERE cm.community_id = community_invites.community_id AND cm.user_id = auth.uid() AND cm.role IN ('owner','admin'))
  );

DROP POLICY IF EXISTS community_invites_delete ON public.community_invites;
CREATE POLICY community_invites_delete ON public.community_invites
  FOR DELETE USING (
    auth.uid() = receiver_id
    OR EXISTS (SELECT 1 FROM public.community_members cm WHERE cm.community_id = community_invites.community_id AND cm.user_id = auth.uid() AND cm.role IN ('owner','admin'))
  );

-- Realtime (badge undangan komunitas & list update live)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='community_invites') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.community_invites;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='community_members') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.community_members;
  END IF;
END $$;
