-- 다시출근 문의 게시판 테이블
-- Supabase 대시보드 > SQL Editor 에 붙여 넣고 Run 하면 됩니다. 여러 번 실행해도 안전합니다.

create table if not exists public.inquiries (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  name          text not null check (char_length(name)    between 1 and 20),
  title         text not null check (char_length(title)   between 1 and 100),
  content       text not null check (char_length(content) between 1 and 3000),
  is_private    boolean not null default false,
  password_hash text not null,                 -- 글쓴이 비밀번호 (scrypt 해시, 원문은 저장하지 않음)
  answer        text check (answer is null or char_length(answer) <= 3000),
  answered_at   timestamptz
);

create index if not exists inquiries_created_at_idx on public.inquiries (created_at desc);

-- 행 단위 보안(RLS)을 켜고 정책은 만들지 않습니다.
-- → 브라우저용 공개 키(anon/publishable)로는 읽기·쓰기가 모두 막히고,
--   Vercel 서버에 넣은 secret 키로만 접근할 수 있습니다.
alter table public.inquiries enable row level security;
